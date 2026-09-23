// Build summary-addition results only after every addition summary and review exists.
// node scripts/report_summary_additions.js [--out-dir=outputs/summary-additions] [--write-data]
const fs = require('node:fs');
const path = require('node:path');
const { hash, save } = require('./eval_consolidation_matched');
const { noCacheCost } = require('./report_consolidation_matched');
const { aggregate } = require('./report_summary_matched');
const { POLICY, loadSummaryCore, validateMatchedReview, read } = require('./eval_summary_matched');
const { ADDITIONS, MODELS, CORE_ADJUSTMENT, summaryRequest, reviewRequest } = require('./eval_summary_additions');
function buildReport(root) {
    const fixture = read(path.join(root, 'fixture.json')), completion = read(path.join(root, 'completion.json'));
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
    if (hash(source) !== fixture.coreHash || JSON.stringify(fixture.models) !== JSON.stringify(MODELS) || JSON.stringify(fixture.additions) !== JSON.stringify(ADDITIONS)
        || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY) || JSON.stringify(fixture.adjustments) !== JSON.stringify([CORE_ADJUSTMENT])) throw Error('Frozen addition settings changed');
    const core = loadSummaryCore(source), prices = read(path.join(root, 'prices.json'));
    const runs = Object.fromEntries(MODELS.map(key => [key, []])), reviews = [], accounted = new Set();
    function tracesFor(keys, stage, model) {
        if (!keys.length || new Set(keys).size !== keys.length) throw Error('Invalid trace list');
        return keys.map(key => {
            const trace = read(path.join(root, 'traces', key + '.json'));
            if (trace.key !== key || hash(trace.request) !== key || !['complete', 'failed'].includes(trace.status)
                || trace.request.stage !== stage || trace.request.model !== model || !Number.isFinite(trace.usage?.cost)
                || !Number.isFinite(trace.elapsedSeconds)) throw Error('Invalid paid trace: ' + key);
            accounted.add(key);
            return trace;
        });
    }
    for (const item of fixture.items) {
        if (item.sourceHash !== hash(item.thread) || item.rowsHash !== hash(item.rows)) throw Error('Frozen summary input changed');
        const reviewed = read(path.join(root, item.id + '-review.json'));
        if (JSON.stringify(Object.values(reviewed.mapping).sort()) !== JSON.stringify([...MODELS].sort())) throw Error('Incomplete anonymous mapping');
        const variants = Object.entries(reviewed.mapping).map(([label, key]) => {
            const run = read(path.join(root, item.id + '-' + key + '.json'));
            return { label, summary: run.summary ?? { sections: [], caveats: [] }, unavailable: !run.summary };
        });
        validateMatchedReview(reviewed.review, item, variants);
        const reviewTraces = tracesFor(reviewed.log, 'summaryQuality', POLICY.evaluator);
        if (reviewed.log[0] !== hash(reviewRequest(core, item, variants)) || hash(reviewTraces.at(-1).response.json) !== hash(reviewed.review)) throw Error('Review provenance mismatch');
        reviews.push({ id: item.id, mapping: reviewed.mapping, ...reviewed.review, traces: reviewed.log });
        for (const key of MODELS) {
            const run = read(path.join(root, item.id + '-' + key + '.json'));
            const request = summaryRequest(core, item, key);
            if (run.sourceHash !== item.sourceHash || run.rowsHash !== item.rowsHash || run.log[0] !== hash(request)) throw Error('Summary input mismatch');
            const traces = tracesFor(run.log, 'synthesize', request.model);
            if (run.summary) {
                if (hash(core.parseModelResponse(request, traces.at(-1).response.json)) !== hash(run.summary)) throw Error('Summary output mismatch');
            } else {
                if (traces.length !== 2 || !run.failure || !traces.at(-1).request.meta.formatRepair) throw Error('Unsubstantiated summary failure');
                let invalid = false;
                try { core.parseModelResponse(request, traces.at(-1).response?.json ?? traces.at(-1).error?.response); }
                catch (error) { if (!core.isResponseFailure(error)) throw error; invalid = true; }
                if (!invalid) throw Error('Failed summary was actually valid');
            }
            const grade = reviewed.review.grades.find(g => reviewed.mapping[g.variant] === key);
            runs[key].push({ id: item.id, title: item.thread.title, sourceHash: item.sourceHash, rowsHash: item.rowsHash,
                comments: item.thread.comments.length, chars: core.estimateRunCost(item.thread.comments, 0).chars,
                noCacheCost: traces.reduce((n, trace) => n + noCacheCost(trace.usage, prices.models[request.model]), 0),
                billed: traces.reduce((n, trace) => n + trace.usage.cost, 0), seconds: traces.reduce((n, trace) => n + trace.elapsedSeconds, 0),
                summary: run.summary, failure: run.failure, grade, traces: run.log, warnings: run.warnings });
        }
    }
    let spent = 0;
    for (const name of fs.readdirSync(path.join(root, 'traces')).filter(name => name.endsWith('.json'))) {
        const trace = read(path.join(root, 'traces', name));
        if (!accounted.has(trace.key) && trace.status !== 'rejected') throw Error('Unaccounted evaluation call: ' + name);
        spent += trace.usage?.cost || 0;
    }
    if (Math.abs(spent - completion.spent) > 1e-8 || spent > fixture.budget) throw Error('Evaluation ledger mismatch');
    return { experiment: fixture.experiment, baseExperiment: fixture.baseExperiment, coreHash: fixture.coreHash, baseCoreHash: fixture.baseCoreHash,
        adjustments: fixture.adjustments, completedAt: completion.completedAt, spent, policy: POLICY, prices,
        method: `Each added summary model receives the identical frozen Sol-low consolidation and two-pass Luna-low scoring results used by ${fixture.baseExperiment} on the same five threads (1,234 comments), with production summary prompts, reasoning settings and 16,000-token ceilings; one output per model per thread, with at most one production format repair. Each thread receives one Astra-high review of only the ${MODELS.length} added anonymous outputs, with complete source comments and the shared citation evidence.`,
        limitations: ['The added models are graded in a separate review call from the matched eight; the reviewer sees different companion summaries, which can shift grades.',
            'Five HN threads and one output/review per model per thread; model judgments, not statistically established ranks.',
            'The Astra reviewer evaluates another OpenAI model (GPT-6 Sol); anonymity does not eliminate evaluator bias.',
            'Opus 5.5 receives the lookaround-free paragraph pattern already sent to OpenAI models, because it rejects regex lookaround; the parser still enforces all word limits.',
            'Prices come from a later catalog snapshot than the matched experiment; costs use uncached token prices.'],
        models: Object.fromEntries(MODELS.map(key => [key, { name: ADDITIONS[key].name, effort: ADDITIONS[key].effort, model: ADDITIONS[key].model, ...aggregate(runs[key]) }])), reviews };
}
function markdown(report) {
    const lines = ['# Summary additions', '', report.method, '',
        '| Model | Quality /100 | Failed / major error | Cost /1k comments | Time /1k comments |', '| --- | ---: | ---: | ---: | ---: |'];
    for (const model of Object.values(report.models)) {
        lines.push(`| ${model.name} (${model.effort}) | ${model.weighted.toFixed(1)} | ${model.errorPercent.toFixed(0)}% | $${model.benchmark.costPer1k.toFixed(2)} | ${(model.benchmark.secondsPer1k / 60).toFixed(1)} min |`);
    }
    lines.push('', ...report.limitations.map(text => '- ' + text), '', ...report.adjustments.map(change => 'Protocol adjustment: ' + change.reason), '',
        `Total new spending: $${report.spent.toFixed(6)}, including quality reviews. Raw requests and responses: outputs/summary-additions/.`, '');
    return lines.join('\n');
}
function main() {
    const root = path.resolve(process.argv.find(arg => arg.startsWith('--out-dir='))?.slice(10) || 'outputs/summary-additions');
    const report = buildReport(root);
    save(path.join(root, 'report.json'), report);
    fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) {
        save('data/summary-additions.json', report);
        fs.writeFileSync('docs/summary-additions.md', markdown(report));
    }
    console.log(markdown(report));
}
module.exports = { buildReport, markdown };
if (require.main === module) main();
