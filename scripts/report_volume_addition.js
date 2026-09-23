// Build GPT-6 Luna extraction/scoring results after the addition pipeline and blind review complete.
// node scripts/report_volume_addition.js [--out-dir=outputs/volume-addition] [--write-data]
const fs = require('node:fs');
const path = require('node:path');
const { hash, save, loadExperimentCore } = require('./eval_consolidation_matched');
const { noCacheCost } = require('./report_consolidation_matched');
const { read } = require('./eval_summary_matched');
const { POLICY: REVIEW_POLICY, population, selectSample, makeCases, reviewRequest, validateReview, aggregate } = require('./eval_volume_review');
const { POLICY, CACHE_FILE, pipelineConfig } = require('./eval_volume_addition');
const VOLUME_STAGES = ['extract', 'score'];
// Busy wall seconds of a set of calls: the length of the union of their [start, end] intervals, so an
// interruption between calls does not count as stage time.
function busySeconds(traces) {
    const intervals = traces.map(trace => { const start = Date.parse(trace.startedAt) / 1000; return [start, start + trace.elapsedSeconds]; })
        .sort((a, b) => a[0] - b[0]);
    let total = 0, current = null;
    for (const [start, end] of intervals) {
        if (!current || start > current[1]) { if (current) total += current[1] - current[0]; current = [start, end]; }
        else current[1] = Math.max(current[1], end);
    }
    return current ? total + current[1] - current[0] : 0;
}
function median(values) {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function measure(core, root, prices, fixture, key) {
    const pipeline = read(path.join(root, key + '-pipeline.json'));
    if (pipeline.sourceHash !== fixture.sourceHash || JSON.stringify(pipeline.config) !== JSON.stringify(pipelineConfig(core, key))) throw Error('Pipeline input mismatch: ' + key);
    const comments = fixture.thread.comments.length, chars = core.estimateRunCost(fixture.thread.comments, 0).chars;
    const volumeCalls = pipeline.calls.filter(call => VOLUME_STAGES.includes(call.stage));
    const traced = volumeCalls.filter(call => fs.existsSync(path.join(root, 'traces', call.requestHash + '.json')));
    const traces = traced.map(call => read(path.join(root, 'traces', call.requestHash + '.json')));
    if (traces.some(trace => trace.status !== 'complete' || trace.key !== hash(trace.request))) throw Error('Invalid generation trace: ' + key);
    const rows = pipeline.result.rows;
    const result = { key, comments, chars, candidates: pipeline.result.candidates.length, axes: pipeline.result.axes.length,
        stances: population(pipeline.result).length, twoSided: rows.filter(row => row.countA > 0 && row.countB > 0).length,
        volumeCalls: volumeCalls.length, pricedCalls: traces.length, importedCalls: pipeline.importedKeys.length };
    result.stancesPerComment = result.stances / comments;
    result.twoSidedPer100Comments = 100 * result.twoSided / comments;
    if (traces.length === volumeCalls.length) {
        const cost = traces.reduce((sum, trace) => sum + noCacheCost(trace.usage, prices[trace.request.model]), 0);
        const seconds = VOLUME_STAGES.reduce((sum, stage) => sum + busySeconds(traces.filter(trace => trace.request.stage === stage)), 0);
        Object.assign(result, { noCacheCost: cost, billed: traces.reduce((sum, trace) => sum + trace.usage.cost, 0), seconds,
            usdPerMillionChars: 1e6 * cost / chars, secondsPerMillionChars: 1e6 * seconds / chars,
            medianCallSeconds: median(traces.map(trace => trace.elapsedSeconds)) });
    }
    return { pipeline, result };
}
function buildReport(root) {
    const fixture = read(path.join(root, 'fixture.json')), completion = read(path.join(root, 'completion.json'));
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
    if (hash(source) !== fixture.coreHash || hash(read(path.resolve(CACHE_FILE))) !== fixture.cacheHash || hash(fixture.thread) !== fixture.sourceHash
        || JSON.stringify(fixture.policy) !== JSON.stringify(POLICY) || JSON.stringify(fixture.reviewPolicy) !== JSON.stringify(REVIEW_POLICY)) throw Error('Frozen experiment changed');
    const core = loadExperimentCore(source), prices = read(path.join(root, 'prices.json')).models;
    const measured = measure(core, root, prices, fixture, POLICY.model), reference = measure(core, root, prices, fixture, POLICY.reference);
    if (measured.result.noCacheCost === undefined) throw Error('Measured model has calls without traces');
    const selected = read(path.join(root, 'sample.json'));
    const expected = makeCases(fixture.thread, { [POLICY.model]: selectSample(measured.pipeline.result, POLICY.model) });
    if (hash(selected) !== hash(expected)) throw Error('Sample differs from fixed sampling rule');
    const judgments = [], reviews = [];
    for (let offset = 0, index = 0; offset < selected.cases.length; offset += REVIEW_POLICY.reviewBatchSize, index++) {
        const cases = selected.cases.slice(offset, offset + REVIEW_POLICY.reviewBatchSize), reviewed = read(path.join(root, 'review-' + index + '.json'));
        validateReview(reviewed.response, cases);
        if (reviewed.traceKeys[0] !== hash(reviewRequest(fixture.thread, cases))) throw Error('Review input mismatch');
        judgments.push(...reviewed.response.judgments); reviews.push(reviewed);
    }
    let spent = 0;
    for (const file of fs.readdirSync(path.join(root, 'traces')).filter(file => file.endsWith('.json'))) {
        const trace = read(path.join(root, 'traces', file));
        if (!['complete', 'failed', 'rejected'].includes(trace.status)) throw Error('Unresolved paid request: ' + file);
        spent += trace.usage?.cost || 0;
    }
    if (Math.abs(spent - completion.spent) > 1e-8 || spent > POLICY.budget) throw Error('Budget ledger mismatch');
    const review = aggregate(selected.mapping, judgments)[POLICY.model];
    return { experiment: fixture.experiment, baseExperiment: fixture.baseExperiment, completedAt: completion.completedAt, spent, policy: POLICY, reviewPolicy: REVIEW_POLICY,
        thread: { id: REVIEW_POLICY.threadId, title: fixture.thread.title, comments: fixture.thread.comments.length, fetchedAt: fixture.fetchedAt, sourceHash: fixture.sourceHash },
        coreHash: fixture.coreHash, cacheHash: fixture.cacheHash,
        method: `GPT-6 Luna low runs production extraction, GPT-5.6 Sol low consolidation and two-pass scoring on the frozen ${fixture.thread.comments.length}-comment stance-review thread at production concurrency, with no summary. A GPT-5.6 Luna low reference run uses the same thread and settings. Up to ${REVIEW_POLICY.samplePerModel} agreed GPT-6 Luna comment/axis stances, selected by a fixed seeded hash, receive the same blind Astra-high classification as the Flash stance review.`,
        definitions: { stancesPerComment: 'Agreed comment/axis stances in the result rows divided by source comments.',
            twoSidedPer100Comments: '100 * result rows with people on both poles / source comments.',
            candidateFactor: 'Extracted candidates relative to the GPT-5.6 Luna low reference run on the same thread, whose selector factor is 1.',
            cost: 'Extraction and scoring calls only, repriced at uncached token prices, per million characters of framed comment text.',
            time: 'Busy wall seconds of the extraction stage plus the scoring stage (union of call intervals), per million characters.',
            minimumSeconds: 'Median single-call latency of the extraction and scoring calls.',
            held: 'Reviewer assigns exactly the original A/B/M/C stance.', wrong: 'Reviewer confidently assigns a different stance or N.' },
        limitations: ['One source thread and a sample of at most 100 reported stances; model judgments, not human ground truth.',
            'The review sample contains only GPT-6 Luna stances, so its batches differ from earlier stance reviews.',
            'The scoring stage was interrupted once by a local file-rename error and resumed from saved responses; busy-interval timing excludes the pause.'],
        model: { name: POLICY.addition.name, effort: POLICY.addition.effort, model: POLICY.addition.model, ...measured.result,
            candidateFactor: measured.result.candidates / reference.result.candidates, minimumSeconds: measured.result.medianCallSeconds, ...review,
            sample: selected.mapping[POLICY.model].map(pair => ({ ...pair, judgment: judgments.find(j => j.caseId === pair.caseId) })) },
        reference: reference.result, reviews };
}
function markdown(report) {
    const model = report.model, reference = report.reference;
    const row = value => `| ${value.name ?? 'GPT-5.6 Luna (reference)'} | ${value.usdPerMillionChars === undefined ? 'n/a' : '$' + value.usdPerMillionChars.toFixed(3)} | ${value.secondsPerMillionChars === undefined ? 'n/a' : value.secondsPerMillionChars.toFixed(0)} | ${value.candidates} | ${value.stancesPerComment.toFixed(2)} | ${value.twoSidedPer100Comments.toFixed(1)} |`;
    const lines = ['# GPT-6 Luna extraction and scoring', '', report.method, '',
        '| Model | USD / million chars | Seconds / million chars | Candidates | Stances / comment | Two-sided rows / 100 comments |', '| --- | ---: | ---: | ---: | ---: | ---: |',
        row(model), row(reference), '',
        `Blind review: ${model.held}/${model.sampled} held (${model.reviewHeldPercent.toFixed(1)}%), ${model.wrong} wrong (${model.reviewWrongPercent.toFixed(1)}%), ${model.unclear} unclear. Candidate factor ${model.candidateFactor.toFixed(2)}; median call ${model.minimumSeconds.toFixed(1)} s.`, '',
        ...Object.entries(report.definitions).map(([key, text]) => `- ${key}: ${text}`), '', ...report.limitations.map(text => '- ' + text), '',
        `New cost: $${report.spent.toFixed(6)}. Raw requests and responses: outputs/volume-addition/.`, ''];
    return lines.join('\n');
}
function main() {
    const root = path.resolve(process.argv.find(a => a.startsWith('--out-dir='))?.slice(10) || 'outputs/volume-addition');
    const report = buildReport(root);
    save(path.join(root, 'report.json'), report); fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) { save('data/volume-addition.json', report); fs.writeFileSync('docs/volume-addition.md', markdown(report)); }
    console.log(markdown(report));
}
module.exports = { buildReport, markdown, busySeconds };
if (require.main === module) main();
