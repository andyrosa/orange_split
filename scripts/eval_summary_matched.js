// Matched summary-only evaluation; frozen production prompts and shared Sol/Luna inputs.
const fs = require('node:fs');
const path = require('node:path');
const { readPage, blockText, CORE_SCRIPT_PATTERN } = require('./load_core');
const { hash, save, loadExperimentCore, makeClient, MODELS } = require('./eval_consolidation_matched');
const { RUBRIC, SCHEMA, validateReview } = require('./eval_summary_quality');
const POLICY = Object.freeze({ version: 1, weights: { faithfulness: 0.6, coverage: 0.3, clarity: 0.1 },
    evaluator: 'openai/gpt-6-astra', effort: 'high', maxTokens: 32000, reviewsPerThread: 1,
    runsPerThread: 1, concurrency: 5, consolidation: 'solLow', volume: 'lunaLow', budget: 15, unavailableScore: 0 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function loadSummaryCore(source) {
    return loadExperimentCore(source + '\nObject.assign(module.exports, { SYNTHESIS_SCHEMA });');
}
function summaryRequest(core, item, key) {
    const config = { ...core.DEFAULT_CONFIG, ...core.buildStageConfig(POLICY.volume, POLICY.consolidation, key) };
    return { stage: 'synthesize', ...core.stageSettings(config, 'synthesize'),
        messages: core.buildSynthesisMessages(item.thread.title, item.rows, core.indexCommentsById(item.thread.comments)),
        schema: core.SYNTHESIS_SCHEMA, meta: { axisIds: item.rows.slice(0, 40).map(row => row.axisId) } };
}
async function generate(core, client, request) {
    const log = [], warnings = [];
    async function attempt(call) {
        log.push(hash(call));
        return core.parseModelResponse(call, (await client.call(call)).json);
    }
    let summary;
    try { summary = await attempt(request); }
    catch (error) {
        if (!core.isResponseFailure(error) || error.response === undefined) throw error;
        warnings.push('One production format repair: ' + error.message);
        try { summary = await attempt(core.buildFormatRepairCall(request, error)); }
        catch (failure) {
            if (!core.isResponseFailure(failure)) throw failure;
            return { summary: null, failure: failure.message, log, warnings };
        }
    }
    return { summary, log, warnings };
}
function reviewRequest(core, item, variants) {
    const schema = structuredClone(SCHEMA);
    schema.properties.grades.minItems = schema.properties.grades.maxItems = variants.length;
    schema.properties.grades.items.properties.variant.enum = variants.map(v => v.label);
    const rubric = RUBRIC.replace('two anonymous summaries', 'eight anonymous summary attempts')
        .replace('Neither is a reference answer.', 'None is a reference answer.')
        .replace("each variant's supplied axis/evidence context", 'the shared citationEvidence supplied once for all variants')
        + ' A variant marked unavailable failed production validation after its one repair and would not be shown to the user. Give it 0 for all three dimensions, empty issues and omissions, and explain that no usable summary was produced. Do not infer content for an unavailable summary.';
    return { stage: 'summaryQuality', model: POLICY.evaluator, reasoning: { effort: POLICY.effort }, sampling: null,
        maxTokens: POLICY.maxTokens, schema: { name: 'summary_matched_quality_v1', schema },
        messages: [{ role: 'system', content: rubric }, { role: 'user', content: JSON.stringify({
            title: item.thread.title, comments: item.thread.comments.map(({ id, parentId, text }) => ({ id, parentId, text })),
            citationEvidence: JSON.parse(core.buildSynthesisMessages(item.thread.title, item.rows, core.indexCommentsById(item.thread.comments))[1].content),
            variants }) }] };
}
function validateMatchedReview(result, item, variants) {
    validateReview(result, item, variants);
    for (const variant of variants.filter(v => v.unavailable)) {
        const grade = result.grades.find(g => g.variant === variant.label);
        if (Object.keys(POLICY.weights).some(key => grade[key] !== 0) || grade.issues.length || grade.omissions.length) throw Error('Unavailable summary must have zero scores and no invented issues');
    }
    return result;
}
async function review(core, client, item, variants) {
    const request = reviewRequest(core, item, variants), log = [hash(request)];
    let response;
    try {
        response = await client.call(request);
        validateMatchedReview(response.json, item, variants);
    } catch (error) {
        if (!response && !core.isResponseFailure(error)) throw error;
        const repair = core.buildFormatRepairCall(request, { message: error.message, response: response?.json ?? error.response });
        log.push(hash(repair));
        response = await client.call(repair);
        validateMatchedReview(response.json, item, variants);
    }
    return { review: response.json, log };
}
function validateFixture(fixture, source) {
    if (fixture.coreHash !== hash(source) || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY)
        || JSON.stringify(fixture.models) !== JSON.stringify(MODELS)) throw Error('Frozen experiment settings changed');
    const expectedIds = ['22866284', '49571634', '47155526', '49574167', '49568506'];
    if (JSON.stringify(fixture.items.map(i => i.id)) !== JSON.stringify(expectedIds)) throw Error('Frozen thread sample changed');
    for (const item of fixture.items) {
        if (item.sourceHash !== hash(item.thread) || item.rowsHash !== hash(item.rows)) throw Error('Frozen summary input changed');
    }
}
async function main() {
    const arg = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
    const root = path.resolve(arg('out-dir', 'outputs/summary-matched'));
    const input = path.resolve(arg('input-dir', 'outputs/consolidation-matched-eight'));
    fs.mkdirSync(root, { recursive: true });
    const sourceFile = path.join(root, 'core.js');
    if (!fs.existsSync(sourceFile)) fs.writeFileSync(sourceFile, blockText(readPage(), CORE_SCRIPT_PATTERN));
    const source = fs.readFileSync(sourceFile, 'utf8'), core = loadSummaryCore(source);
    const fixtureFile = path.join(root, 'fixture.json');
    if (!fs.existsSync(fixtureFile)) {
        const old = read(path.join(input, 'fixture.json'));
        const items = old.items.map(item => {
            const consolidation = read(path.join(input, item.id + '-solLow-consolidation.json'));
            const scored = read(path.join(input, item.id + '-solLow-score.json'));
            if (consolidation.sourceHash !== hash(item.thread) || scored.axesHash !== hash(consolidation.axes)) throw Error('Shared input provenance mismatch');
            return { id: item.id, thread: item.thread, rows: scored.rows, sourceHash: hash(item.thread), rowsHash: hash(scored.rows),
                consolidationHash: hash(consolidation), scoringHash: hash(scored) };
        });
        save(fixtureFile, { experiment: 'summary-matched-v1', createdAt: new Date().toISOString(), coreHash: hash(source),
            models: MODELS, policy: POLICY, items });
    }
    const fixture = read(fixtureFile);
    validateFixture(fixture, source);
    const priceFile = path.join(root, 'prices.json');
    if (!fs.existsSync(priceFile)) {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (!response.ok) throw Error('Cannot obtain model prices');
        const catalog = await response.json();
        const ids = [...new Set([...MODELS.map(key => core.SUMMARY_MODELS[key].config.modelSynthesize), POLICY.evaluator])];
        save(priceFile, { fetchedAt: new Date().toISOString(), source: 'https://openrouter.ai/api/v1/models',
            models: Object.fromEntries(ids.map(id => { const model = catalog.data.find(m => m.id === id); if (!model) throw Error('Missing model: ' + id); return [id, model.pricing]; })) });
    }
    const prices = read(priceFile).models;
    if (!process.argv.includes('--run')) {
        console.log(JSON.stringify({ prepared: fixture.experiment, threads: fixture.items.length, summaries: fixture.items.length * MODELS.length,
            budget: POLICY.budget, inputCharacters: fixture.items.map(item => summaryRequest(core, item, MODELS[0]).messages[1].content.length) }));
        return;
    }
    if (!process.env.OPENROUTER_API_KEY) throw Error('OPENROUTER_API_KEY required');
    let client = makeClient(core, root, prices, POLICY.budget);
    const log = message => console.log(new Date().toISOString() + ' ' + message + '; spent $' + client.budget.spent.toFixed(4));
    const jobs = fixture.items.map((item, index) => async () => {
        const order = MODELS.slice(index).concat(MODELS.slice(0, index));
        for (const key of order) {
            const file = path.join(root, item.id + '-' + key + '.json');
            if (fs.existsSync(file)) continue;
            log(item.id + ' ' + key + ': summary');
            const result = await generate(core, client, summaryRequest(core, item, key));
            save(file, { id: item.id, key, sourceHash: item.sourceHash, rowsHash: item.rowsHash, ...result });
            log(item.id + ' ' + key + (result.summary ? ': summary complete' : ': summary unavailable after repair'));
        }
        const file = path.join(root, item.id + '-review.json');
        if (!fs.existsSync(file)) {
            const anonymousOrder = [...order].reverse();
            const variants = anonymousOrder.map((key, i) => {
                const run = read(path.join(root, item.id + '-' + key + '.json'));
                return { label: 'V' + (i + 1), summary: run.summary ?? { sections: [], caveats: [] }, unavailable: !run.summary };
            });
            log(item.id + ': anonymous eight-model review');
            const result = await review(core, client, item, variants);
            save(file, { id: item.id, mapping: Object.fromEntries(anonymousOrder.map((key, i) => ['V' + (i + 1), key])), ...result });
            log(item.id + ': review complete');
        }
    });
    // All five independent threads finish or checkpoint before any error is reported.
    for (;;) {
        const before = fs.readdirSync(root).filter(name => /^\d+-.*\.json$/.test(name)).length;
        const results = await Promise.allSettled(jobs.map(job => job()));
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (!failures.length) break;
        // A temporary reservation stop can leave queued work even when actual spend is small.
        // Retry only after all in-flight calls settle, using persisted responses and a fresh ledger.
        const after = fs.readdirSync(root).filter(name => /^\d+-.*\.json$/.test(name)).length;
        if (failures.some(error => !error.message.startsWith('Budget stop:')) || after <= before) throw failures[0];
        client = makeClient(core, root, prices, POLICY.budget);
        log('Continuing queued work after request reservations settled');
    }
    save(path.join(root, 'completion.json'), { completedAt: new Date().toISOString(), spent: client.budget.spent, budget: POLICY.budget });
    log('Matched summary experiment complete');
}
module.exports = { POLICY, summaryRequest, generate, reviewRequest, review, validateMatchedReview, validateFixture, loadSummaryCore, save, read };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
