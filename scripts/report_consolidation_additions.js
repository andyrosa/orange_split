// Build consolidation-addition results only after every addition, scoring and review artifact exists.
// node scripts/report_consolidation_additions.js [--out-dir=outputs/consolidation-additions] [--write-data]
const fs = require('node:fs');
const path = require('node:path');
const { REVIEWER, REVIEW_SETTINGS, hash, loadExperimentCore, validateReview } = require('./eval_consolidation_matched');
const { noCacheCost, aggregate } = require('./report_consolidation_matched');
const { ADDITIONS, MODELS, BASE_DIR, additionConfig } = require('./eval_consolidation_additions');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function buildReport(root) {
    const fixture = read(path.join(root, 'fixture.json')), completion = read(path.join(root, 'completion.json'));
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
    if (hash(source) !== fixture.coreHash || JSON.stringify(fixture.models) !== JSON.stringify(MODELS)
        || JSON.stringify(fixture.additions) !== JSON.stringify(ADDITIONS) || JSON.stringify(fixture.reviewSettings) !== JSON.stringify(REVIEW_SETTINGS)) throw Error('Frozen addition settings changed');
    const core = loadExperimentCore(source), prices = read(path.join(root, 'prices.json'));
    const baseReport = read(path.resolve('data/consolidation-matched.json'));
    const runs = Object.fromEntries(MODELS.map(key => [key, []])), reviews = [], accounted = new Set();
    for (const item of fixture.items) {
        if (item.sourceHash !== hash(item.thread) || item.candidatesHash !== hash(item.candidates) || item.exclusionsHash !== hash(item.exclusions)) throw Error('Changed frozen input');
        const outputs = Object.fromEntries(MODELS.map(key => [key, read(path.join(root, `${item.id}-${key}-consolidation.json`))]));
        const reviewed = read(path.join(root, `${item.id}-review.json`));
        if (reviewed.reviewer !== REVIEWER || JSON.stringify(Object.values(reviewed.mapping).sort()) !== JSON.stringify([...MODELS].sort())) throw Error('Reviewer or model mapping mismatch');
        if (JSON.stringify(reviewed.review.exclusions) !== JSON.stringify(item.exclusions)) throw Error('Review changed the common exclusions');
        const variants = Object.entries(reviewed.mapping).map(([label, key]) => ({ label, axes: outputs[key].axes }));
        validateReview(reviewed.review, item.candidates.length, variants);
        reviewed.log.forEach(key => accounted.add(key));
        reviews.push({ thread: item.id, ...reviewed });
        for (const key of MODELS) {
            const output = outputs[key], scored = read(path.join(root, `${item.id}-${key}-score.json`));
            if (output.sourceHash !== item.sourceHash || output.candidatesHash !== item.candidatesHash || scored.axesHash !== hash(output.axes)) throw Error('Run input mismatch');
            if (JSON.stringify(output.config) !== JSON.stringify(additionConfig(core, key))) throw Error('Run config mismatch: ' + key);
            const traces = output.log.map(traceKey => read(path.join(root, 'traces', traceKey + '.json')));
            if (traces.some(t => !['complete', 'failed'].includes(t.status) || t.request.model !== ADDITIONS[key].model || t.request.stage !== 'consolidate')) throw Error('Invalid consolidation accounting');
            [...output.log, ...scored.log].forEach(traceKey => accounted.add(traceKey));
            const grade = reviewed.review.reviews.find(x => reviewed.mapping[x.variant] === key);
            runs[key].push({ thread: item.id, title: item.thread.title, sourceHash: item.sourceHash, candidatesHash: item.candidatesHash,
                comments: item.thread.comments.length, chars: core.estimateRunCost(item.thread.comments, 0).chars,
                axes: output.axes.length, twoSided: scored.twoSided,
                noCacheCost: traces.reduce((sum, trace) => sum + noCacheCost(trace.usage, prices.models[trace.request.model]), 0),
                billed: traces.reduce((sum, trace) => sum + trace.usage.cost, 0),
                seconds: traces.reduce((sum, trace) => sum + trace.elapsedSeconds, 0),
                review: { candidates: item.candidates.length,
                    fullyPreserved: grade.fullyPreservedCandidateIds.length, partial: grade.partialCandidateIds.length,
                    missing: grade.missingCandidateIds.length, excluded: reviewed.review.exclusions.length,
                    flaggedAxes: new Set(grade.consolidationIssues.flatMap(issue => issue.axisIds)).size },
                warnings: [...output.warnings, ...scored.warnings], traces: output.log, scoringTraces: scored.log });
        }
    }
    let spent = 0;
    for (const name of fs.readdirSync(path.join(root, 'traces')).filter(name => name.endsWith('.json'))) {
        const trace = read(path.join(root, 'traces', name));
        if (!accounted.has(trace.key) && trace.status !== 'rejected') throw Error('Unaccounted evaluation call: ' + name);
        spent += trace.usage?.cost || 0;
    }
    if (Math.abs(spent - completion.spent) > 1e-8) throw Error('Evaluation ledger mismatch');
    const models = Object.fromEntries(MODELS.map(key => [key, { name: ADDITIONS[key].name, effort: ADDITIONS[key].effort, model: ADDITIONS[key].model, ...aggregate(runs[key]) }]));
    const baseCommon = Object.values(baseReport.models)[0].benchmark;
    for (const model of Object.values(models)) {
        const b = model.benchmark;
        if (b.comments !== baseCommon.comments || b.review.candidates !== baseCommon.review.candidates || b.review.excluded !== baseCommon.review.excluded) throw Error('Denominators differ from the matched experiment');
    }
    return { experiment: fixture.experiment, baseExperiment: fixture.baseExperiment, completedAt: completion.completedAt, spent,
        coreHash: fixture.coreHash, reviewer: REVIEWER, reviewSettings: REVIEW_SETTINGS, prices,
        method: `Same five frozen HN threads, 233 Luna-low candidates, frozen production core and consolidation settings as ${fixture.baseExperiment}; only the model differs. Isolated sequential consolidation calls, model order rotating by thread. The same two-pass Luna-low scoring at concurrency 10. One Sonnet 5 medium-effort review per thread sees only the ${MODELS.length} added anonymous variants, with each thread's common exclusion list from the matched review supplied as fixed.`,
        limitations: ['The added models are graded in a separate review call from the matched eight. The candidate denominator is identical, but the reviewer sees different companion outputs, which can shift grades.',
            'Five threads, one accepted output per model per thread; model judgments, not calibrated accuracy.',
            'The Sonnet reviewer shares a provider/model family with Opus 5.5.',
            'Prices come from a later catalog snapshot than the matched experiment; costs use uncached token prices.'],
        models, reviews };
}
function markdown(report) {
    const lines = ['# Consolidation additions', '', report.method, '',
        '| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |',
        '| --- | ---: | ---: | ---: | ---: | ---: |'];
    for (const model of Object.values(report.models)) {
        const b = model.benchmark, r = b.review;
        lines.push(`| ${model.name} (${model.effort}) | $${b.costPer1k.toFixed(2)} | ${(b.secondsPer1k / 60).toFixed(1)} | ${(1000 * b.twoSided / b.comments).toFixed(1)} | ${(100 * r.flaggedAxes / b.axes).toFixed(1)}% (${r.flaggedAxes}/${b.axes}) | ${(100 * r.fullyPreserved / (r.candidates - r.excluded)).toFixed(1)}% (${r.fullyPreserved}/${r.candidates - r.excluded}) |`);
    }
    lines.push('', ...report.limitations.map(text => '- ' + text), '',
        `Completed ${report.completedAt}. Evaluation spend: $${report.spent.toFixed(6)}. Raw requests and responses: outputs/consolidation-additions/.`, '');
    return lines.join('\n');
}
function main() {
    const root = path.resolve(process.argv.find(a => a.startsWith('--out-dir='))?.slice(10) || 'outputs/consolidation-additions');
    const report = buildReport(root);
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) {
        fs.writeFileSync('data/consolidation-additions.json', JSON.stringify(report, null, 2) + '\n');
        fs.writeFileSync('docs/consolidation-additions.md', markdown(report));
    }
    console.log(markdown(report));
}
module.exports = { buildReport, markdown, BASE_DIR };
if (require.main === module) main();
