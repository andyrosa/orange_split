const fs = require('node:fs');
const path = require('node:path');
const { hash, MODELS } = require('./eval_consolidation_matched');
const { noCacheCost } = require('./report_consolidation_matched');
const { POLICY, loadSummaryCore, summaryRequest, reviewRequest, validateMatchedReview, validateFixture, read, save } = require('./eval_summary_matched');

function aggregate(runs) {
    if (!runs.length || new Set(runs.map(r => r.id)).size !== runs.length) throw Error('Missing or duplicate runs');
    const sum = field => runs.reduce((total, run) => total + run[field], 0);
    const scores = Object.fromEntries(Object.keys(POLICY.weights).map(key => [key, runs.reduce((n, run) => n + run.grade[key], 0) / runs.length]));
    const comments = sum('comments'), chars = sum('chars');
    const majorReviewCount = runs.filter(run => run.grade.issues.some(issue => issue.severity === 'major')).length;
    const failedCount = runs.filter(run => run.summary === null).length;
    return { matched: true, threads: runs.length, reviews: runs.length, scores,
        weighted: Object.entries(POLICY.weights).reduce((n, [key, weight]) => n + weight * scores[key], 0),
        majorReviewCount, majorErrorPercent: 100 * majorReviewCount / runs.length, failedCount,
        errorPercent: 100 * runs.filter(run => run.summary === null || run.grade.issues.some(issue => issue.severity === 'major')).length / runs.length,
        benchmark: { comments, costPer1k: sum('noCacheCost') * 1000 / comments, secondsPer1k: sum('seconds') * 1000 / comments },
        rates: { usdPerMillionChars: sum('noCacheCost') * 1e6 / chars, secondsPerMillionChars: sum('seconds') * 1e6 / chars,
            minimumSeconds: Math.min(...runs.map(run => run.seconds)) },
        billed: sum('billed'), runs };
}
function buildReport(root) {
    const fixture = read(path.join(root, 'fixture.json'));
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
    validateFixture(fixture, source);
    const core = loadSummaryCore(source), prices = read(path.join(root, 'prices.json'));
    const completion = read(path.join(root, 'completion.json'));
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
    if (Math.abs(spent - completion.spent) > 1e-8 || spent > POLICY.budget) throw Error('Evaluation ledger mismatch');
    return { experiment: fixture.experiment, coreHash: fixture.coreHash, adjustments: fixture.adjustments || [], completedAt: completion.completedAt, spent, policy: POLICY, prices,
        method: 'Eight summary models each receive identical frozen Sol-low consolidation and two-pass Luna-low scoring results on the same five threads (1,234 comments). Production summary prompts, reasoning settings and 16,000-token ceilings; one output per model per thread, with at most one production format repair. Five independent thread workers rotate generation order. Each completed thread receives one Astra-high review of all eight anonymous outputs in rotated/reversed order, with complete source comments and the shared citation evidence. Generation and review calls share the five-worker pool.',
        definitions: {
            quality: 'Mean of five per-thread grades: 60% faithfulness, 30% coverage, 10% clarity; each dimension uses a 0–100 rubric. A summary unavailable after its one production repair scores zero.',
            majorErrorPercent: 'Percentage of the five summaries whose review flags at least one materially unsupported claim. Counts summaries, not individual issues.',
            errorPercent: 'Percentage of the five summary attempts that failed production validation after repair OR had a major support error. Each attempt counts at most once; failures and major-error counts are retained separately.',
            cost: 'Summary calls only, including format repairs. Reprice input and output token usage at the same catalog snapshot without cache discounts. Divide total by 1,234 comments and multiply by 1,000. Excludes extraction, consolidation, scoring and quality reviews.',
            time: 'Sum summary service wall time including repairs, divided by 1,234 comments and multiplied by 1,000. Five independent thread workers; this is service latency, not total experiment makespan.',
        },
        limitations: ['Five HN threads and one output/review per model per thread; scores are preliminary model judgments, not statistically established ranks or article results.',
            'The Astra reviewer evaluates its own model and other OpenAI models; anonymity does not eliminate evaluator bias.',
            'Every model uses the same Sol/Luna inputs. These benchmarks compare summary choices and do not grade every possible upstream combination.',
            'Provider routing, caching and ordinary latency variation remain; cost is normalized to uncached prices.'],
        models: Object.fromEntries(MODELS.map(key => [key, { name: core.SUMMARY_MODELS[key].name, effort: core.SUMMARY_MODELS[key].effort,
            model: core.SUMMARY_MODELS[key].config.modelSynthesize, ...aggregate(runs[key]) }])), reviews };
}
function markdown(report) {
    const lines = ['# Matched summary model comparison', '', report.method, '',
        '| Model | Quality /100 | Failed / major error | Cost /1k comments | Time /1k comments |',
        '| --- | ---: | ---: | ---: | ---: |'];
    for (const model of Object.values(report.models).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
        lines.push(`| ${model.name}${model.effort === 'default' ? '' : ' (' + model.effort + ')'} | ${model.weighted.toFixed(1)} | ${model.errorPercent.toFixed(0)}% | $${model.benchmark.costPer1k.toFixed(2)} | ${(model.benchmark.secondsPer1k / 60).toFixed(1)} min |`);
    }
    lines.push('', ...Object.values(report.definitions).map(text => '- ' + text), '', ...report.limitations.map(text => '- ' + text), '',
        ...report.adjustments.map(change => 'Protocol adjustment: ' + change.reason), '',
        `Total new spending: $${report.spent.toFixed(6)}, including quality reviews. Full traces and frozen inputs are retained in outputs/summary-matched; compact per-thread grades, summaries and request hashes are in data/summary-matched.json.`, '');
    return lines.join('\n');
}
function main() {
    const root = path.resolve(process.argv.find(arg => arg.startsWith('--out-dir='))?.slice(10) || 'outputs/summary-matched');
    const report = buildReport(root);
    save(path.join(root, 'report.json'), report);
    fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) {
        save('data/summary-matched.json', report);
        fs.mkdirSync('docs', { recursive: true });
        fs.writeFileSync('docs/summary-matched.md', markdown(report));
    }
    console.log(markdown(report));
}
module.exports = { aggregate, buildReport, markdown };
if (require.main === module) main();
