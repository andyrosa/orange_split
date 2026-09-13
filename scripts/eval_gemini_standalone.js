// Grade Gemini summaries individually. No competing outputs, winners or ranks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadCore } = require('./load_core');
const { RUBRIC, SCHEMA, POLICY, validateReview } = require('./eval_summary_quality');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schema = JSON.parse(JSON.stringify(SCHEMA));
schema.properties.grades.minItems = schema.properties.grades.maxItems = 1;
schema.properties.grades.items.properties.variant.enum = ['V1'];
const rubric = RUBRIC.replace('Evaluate two anonymous summaries independently against the SAME complete frozen discussion. Neither is a reference answer.',
    'Evaluate ONE anonymous summary against its complete frozen discussion. There is no competing output and no reference summary.')
    .replace('then grade each summary against that shared inventory.', 'then grade the summary against that source inventory.');
function summarize(reviews) {
    const byThread = new Map();
    for (const r of reviews) {
        const repeats = byThread.get(r.id) || new Set();
        if (![0, 1].includes(r.repeat) || repeats.has(r.repeat)) throw Error('Invalid or duplicate repeat');
        repeats.add(r.repeat); byThread.set(r.id, repeats);
    }
    if (byThread.size !== 5 || [...byThread.values()].some(s => s.size !== 2)) throw Error('Incomplete standalone sample');
    const grades = reviews.map(r => r.response.json.grades[0]);
    const scores = Object.fromEntries(Object.keys(POLICY.weights).map(k => [k, grades.reduce((sum, g) => sum + g[k], 0) / grades.length]));
    return { threads: byThread.size, pipelineRuns: byThread.size, reviews: grades.length, scores,
        weighted: Object.entries(POLICY.weights).reduce((n, [k, w]) => n + scores[k] * w, 0),
        majorReviewCount: grades.filter(g => g.issues.some(i => i.severity === 'major')).length,
        majorIssues: grades.reduce((n, g) => n + g.issues.filter(i => i.severity === 'major').length, 0) };
}
async function main() {
    const arg = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
    const input = arg('input', 'outputs/gemini-standalone');
    const out = arg('out', 'outputs/gemini-summary-quality');
    const budget = Number(arg('budget', '15'));
    if (!Number.isFinite(budget) || budget <= 0) throw Error('Invalid budget');
    fs.mkdirSync(out, { recursive: true });
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    const core = loadCore(), fixture = read(path.join(input, 'fixture.json'));
    const expected = ['22866284', '49571634', '47155526', '49574167', '49568506'].sort();
    if (JSON.stringify(fixture.items.map(i => i.id).sort()) !== JSON.stringify(expected)) throw Error('Frozen sample changed');
    let spend = 0;
    for (const file of fs.readdirSync(out).filter(f => f.startsWith('call-'))) {
        const trace = read(path.join(out, file));
        if (trace.status !== 'complete') throw Error('Resolve unfinished request: ' + file);
        spend += trace.response.usage.cost;
    }
    // Prepare and validate every candidate before launching any paid reviews.
    const jobs = fixture.items.flatMap(item => {
        const run = read(path.join(input, `${item.id}-gemini.json`));
        if (run.sourceHash !== hash(item.thread)) throw Error('Source changed');
        const expectedConfig = core.buildStageConfig('lunaLow', 'geminiFlash');
        for (const [key, value] of Object.entries(expectedConfig)) if (JSON.stringify(run.config[key]) !== JSON.stringify(value)) throw Error('Candidate settings changed: ' + key);
        core.parseSynthesisResponse(run.result.synthesis, new Set(run.result.rows.map(r => r.axisId)));
        const variants = [{ label: 'V1', summary: run.result.synthesis,
            citationEvidence: JSON.parse(core.buildSynthesisMessages(item.thread.title, run.result.rows, core.indexCommentsById(item.thread.comments))[1].content) }];
        return [0, 1].map(repeat => ({ item, repeat, variants, request: {
            stage: 'standaloneSummaryQuality', model: POLICY.evaluator, reasoning: { effort: 'high' }, sampling: null, maxTokens: 16000,
            meta: { repeat }, schema: { name: 'standalone_summary_quality_v1', schema },
            messages: [{ role: 'system', content: rubric }, { role: 'user', content: JSON.stringify({ title: item.thread.title,
                comments: item.thread.comments.map(({ id, parentId, text }) => ({ id, parentId, text })), variants }) }] } }));
    });
    let next = 0, stopped = false;
    const reviews = [], failures = [];
    async function worker() {
        while (!stopped && next < jobs.length) {
            const { item, repeat, variants, request } = jobs[next++];
            const key = hash(request), file = path.join(out, `call-${key}.json`);
            let trace;
            try {
                if (fs.existsSync(file)) trace = read(file);
                else {
                    if (!process.argv.includes('--run')) throw Error('Missing grade; --run permits paid grading');
                    if (!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY required');
                    if (spend >= budget) throw Error('Spending stop reached');
                    trace = { status: 'pending', request, startedAt: new Date().toISOString() }; save(file, trace);
                    console.log(`Grading ${item.id}, independent repeat ${repeat + 1}/2; spent $${spend.toFixed(3)}`);
                    try {
                        trace.response = await core.callOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, request,
                            signal: AbortSignal.timeout(600000), fetchImpl: async (url, options) => {
                                const response = await fetch(url, options); trace.provider = await response.clone().json().catch(() => null); return response;
                            } });
                        trace.status = 'complete'; spend += trace.response.usage.cost;
                    } catch (error) { trace.status = 'unknown'; trace.error = error.message; throw error; }
                    finally { save(file, trace); }
                }
                validateReview(trace.response.json, item, variants);
                const r = { id: item.id, title: item.thread.title, repeat, requestHash: key, response: trace.response };
                reviews.push(r); save(path.join(out, `${item.id}-${repeat}.json`), r);
                console.log(`Completed ${item.id} repeat ${repeat + 1}: ${JSON.stringify(trace.response.json.grades[0])}`);
            } catch (error) { stopped = true; failures.push(error); }
        }
    }
    await Promise.all([worker(), worker()]); // Two grading calls at most; both finish/cache on failure.
    if (failures.length) throw failures[0];
    reviews.sort((a, b) => a.id.localeCompare(b.id) || a.repeat - b.repeat);
    const result = { model: 'google/gemini-3.8-flash', effort: 'none', evaluator: POLICY.evaluator, evaluatorEffort: 'high',
        method: 'Standalone absolute grading, two independent repeats per summary, no comparison or ranking',
        weights: POLICY.weights, sourceHash: hash(fixture.items), generatedAt: new Date().toISOString(),
        ...summarize(reviews), spend, evaluations: reviews };
    save(path.join(out, 'report.json'), result);
    console.log(JSON.stringify({ ...summarize(reviews), spend }, null, 2));
}
module.exports = { summarize, schema, rubric };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
