// Build results only after every matched consolidation, scoring and review artifact exists.
const fs = require('node:fs');
const path = require('node:path');
const { hash, validateReview, validateModelSet, loadExperimentCore } = require('./eval_consolidation_matched');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function noCacheCost(usage, price) {
    for (const key of ['promptTokens', 'completionTokens']) {
        if (!Number.isFinite(usage?.[key]) || usage[key] < 0) throw new Error('Missing token accounting: ' + key);
    }
    return usage.promptTokens * Number(price.prompt) + usage.completionTokens * Number(price.completion);
}
function aggregate(runs) {
    if (!runs.length) throw new Error('No runs');
    const benchmark = { comments: 0, axes: 0, twoSided: 0,
        review: { candidates: 0, fullyPreserved: 0, partial: 0, missing: 0, excluded: 0, flaggedAxes: 0 } };
    let cost = 0, seconds = 0, chars = 0, billed = 0;
    for (const run of runs) {
        for (const key of ['comments', 'axes', 'twoSided']) benchmark[key] += run[key];
        for (const key of Object.keys(benchmark.review)) benchmark.review[key] += run.review[key];
        cost += run.noCacheCost; seconds += run.seconds; chars += run.chars; billed += run.billed;
    }
    if (benchmark.comments <= 0 || chars <= 0 || benchmark.axes <= 0 || benchmark.review.candidates <= benchmark.review.excluded) throw new Error('Empty measurement denominator');
    benchmark.costPer1k = 1000 * cost / benchmark.comments;
    benchmark.secondsPer1k = 1000 * seconds / benchmark.comments;
    return { benchmark, threads: runs.length, runsPerThread: 1,
        cost: { noCache: cost, billed, usdPerMillionChars: 1e6 * cost / chars },
        time: { seconds, secondsPerMillionChars: 1e6 * seconds / chars, minimumSeconds: Math.min(...runs.map(run => run.seconds)) },
        runs };
}
function buildReport(root) {
    const completion = read(path.join(root, 'completion.json'));
    const fixture = read(path.join(root, 'fixture.json'));
    validateModelSet(fixture);
    const MODELS = fixture.models;
    const settings = fixture.reviewSettings;
    if (![32000, 64000].some(maxTokens => JSON.stringify(settings) === JSON.stringify({ reasoning: { effort: 'medium' }, maxTokens, concurrency: 2 }))) throw new Error('Frozen reviewer settings mismatch');
    const source = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
    if (hash(source) !== fixture.coreHash) throw new Error('Changed experiment core');
    const core = loadExperimentCore(source);
    const prices = read(path.join(root, 'prices.json'));
    const runs = Object.fromEntries(MODELS.map(key => [key, []]));
    const reviews = [];
    for (const item of fixture.items) {
        if (item.sourceHash !== hash(item.thread) || item.candidatesHash !== hash(item.candidates)) throw new Error('Changed frozen input');
        const outputs = Object.fromEntries(MODELS.map(key => [key, read(path.join(root, `${item.id}-${key}-consolidation.json`))]));
        const reviewed = read(path.join(root, `${item.id}-review.json`));
        if (JSON.stringify(reviewed.settings) !== JSON.stringify(settings)) throw new Error('Reviewer settings mismatch');
        if (reviewed.reviewer !== fixture.reviewer || JSON.stringify(Object.values(reviewed.mapping).sort()) !== JSON.stringify([...MODELS].sort())) throw new Error('Reviewer or model mapping mismatch');
        const variants = Object.entries(reviewed.mapping).map(([label, key]) => ({ label, axes: outputs[key].axes }));
        validateReview(reviewed.review, item.candidates.length, variants);
        reviews.push({ thread: item.id, ...reviewed });
        for (const key of MODELS) {
            const output = outputs[key], scored = read(path.join(root, `${item.id}-${key}-score.json`));
            if (output.sourceHash !== item.sourceHash || output.candidatesHash !== item.candidatesHash || scored.axesHash !== hash(output.axes)) throw new Error('Run input mismatch');
            const profile = core.CONSOLIDATION_MODELS[key];
            const grade = reviewed.review.reviews.find(x => reviewed.mapping[x.variant] === key);
            const traces = output.log.map(traceKey => read(path.join(root, 'traces', traceKey + '.json')));
            if (traces.some(t => !['complete', 'failed'].includes(t.status) || t.request.model !== profile.config.modelConsolidate || t.request.stage !== 'consolidate')) throw new Error('Invalid consolidation accounting');
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
    const models = Object.fromEntries(MODELS.map(key => [key, { name: core.CONSOLIDATION_MODELS[key].name,
        effort: key === 'geminiFlash' && core.CONSOLIDATION_MODELS[key].config.reasoningConsolidate === null
            ? 'default' : core.CONSOLIDATION_MODELS[key].effort, ...aggregate(runs[key]) }]));
    const common = models[MODELS[0]].benchmark;
    for (const key of MODELS) {
        const b = models[key].benchmark;
        if (b.comments !== common.comments || b.review.candidates !== common.review.candidates || b.review.excluded !== common.review.excluded) throw new Error('Nonmatching denominators');
    }
    return { experiment: fixture.experiment, completedAt: completion.completedAt, spent: completion.spent, inheritedSpend: completion.inheritedSpend || 0, additionalSpend: completion.additionalSpend ?? completion.spent,
        coreHash: fixture.coreHash, reviewer: fixture.reviewer, reviewSettings: fixture.reviewSettings, adjustments: fixture.adjustments || [], prices,
        method: `One accepted consolidation output per model on each of the same five frozen HN threads, with identical Luna-low extracted candidates and production prompts. Isolated sequential consolidation calls. ${MODELS.length === 8 ? 'The first four models reuse the earlier rotated-order experiment; the added models run Sonnet, GLM, Luna max, then Fable on each thread.' : 'Model order rotates by thread.'} The same Luna-low scorer runs two passes per output with shuffled axes and swapped poles, at concurrency 10. One Sonnet 5 medium-effort review per thread sees all ${MODELS.length} anonymous variants in rotated order and uses one common eligibility list. Reviews run at concurrency 2 alongside scoring after all consolidation timing is complete.`,
        definitions: {
            cost: 'Consolidation only, including format repairs and verified-cancellation retries. Token usage repriced at the same dated catalog: uncached input rate plus output rate (including billed reasoning tokens). Divide total by total source comments and multiply by 1000. Excludes extraction, scoring, summaries and evaluation reviews.',
            time: 'Consolidation service wall seconds including format repairs and verified-cancellation retries, summed over threads, divided by total comments and multiplied by 1000. No local response-cache hits or concurrent generation calls. Provider caching/routing and ordinary latency variation remain.',
            twoSided: '1000 * total axes with verified people on both poles / total source comments.',
            flagged: '100 * distinct output axes with at least one concrete review issue / total output axes; count an axis only once per thread.',
            preserved: '100 * fully preserved candidates / (all candidates minus common legitimate exclusions). Partial and missing candidates remain in the denominator. The same denominator applies to every model.',
        },
        limitations: ['Five threads, one accepted output per model per thread; bounded repairs and verified-cancellation retries are included in cost/time. Repeatability and article quality are not measured.',
            MODELS.includes('sonnet5') ? 'The common Sonnet reviewer is an uncalibrated model judge; it reviews its own model and shares a provider/model family with Opus and Fable.' : 'The common Sonnet reviewer is an uncalibrated model judge and shares a provider/model family with Opus.',
            'Candidate preservation measures the frozen extractor output, not all disagreements in the original discussion.',
            ...(MODELS.length < 8 ? ['Other selector models retain earlier measurements and are outside this matched experiment.'] : ['The first four models were generated earlier; their outputs and scoring are reused, and all eight outputs receive a new common review.'])],
        models, reviews };
}
function markdown(report) {
    const lines = ['# Matched consolidation comparison', '', report.method, '',
        '| Model | Cost / 1k comments | Minutes / 1k comments | Two-sided / 1k comments | Axes flagged | Candidates preserved |',
        '| --- | ---: | ---: | ---: | ---: | ---: |'];
    for (const model of Object.values(report.models)) {
        const b = model.benchmark, r = b.review;
        lines.push(`| ${model.name}${model.effort === 'default' ? '' : ` (${model.effort})`} | $${b.costPer1k.toFixed(2)} | ${(b.secondsPer1k / 60).toFixed(1)} | ${(1000 * b.twoSided / b.comments).toFixed(1)} | ${(100 * r.flaggedAxes / b.axes).toFixed(1)}% (${r.flaggedAxes}/${b.axes}) | ${(100 * r.fullyPreserved / (r.candidates - r.excluded)).toFixed(1)}% (${r.fullyPreserved}/${r.candidates - r.excluded}) |`);
    }
    lines.push('', ...Object.entries(report.definitions).map(([key, value]) => `- **${key}:** ${value}`), '', ...report.limitations.map(text => '- ' + text), '',
        `Completed ${report.completedAt}. Additional evaluation spend: $${report.additionalSpend.toFixed(6)}; total including reused experiment: $${report.spent.toFixed(6)}. Raw requests, responses and frozen sources: outputs/consolidation-matched${Object.keys(report.models).length === 8 ? '-eight' : ''}/.`, '',
        'The retained JSON includes per-thread measurements, anonymous mappings, common exclusions, and every review issue. Evaluation design follows the model-grading considerations in [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).', '',
        ...(report.adjustments || []).map(change => `Protocol adjustment: ${change.reason} All related calls are included in evaluation spending.`), '',
        'When a complete grade omitted a required explanation, a separate evidence-completion call supplied only the missing explanation and references. It did not change candidate classifications or axis flags. Those calls are included in evaluation spending and retained in each review log.', '');
    return lines.join('\n');
}
function main() {
    const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
    const root = path.resolve(arg('out-dir', 'outputs/consolidation-matched-eight'));
    const report = buildReport(root);
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(root, 'report.md'), markdown(report));
    if (process.argv.includes('--write-data')) {
        fs.mkdirSync('data', { recursive: true }); fs.mkdirSync('docs', { recursive: true });
        fs.writeFileSync('data/consolidation-matched.json', JSON.stringify(report, null, 2) + '\n');
        fs.writeFileSync('docs/consolidation-matched.md', markdown(report));
    }
    console.log(markdown(report));
}
module.exports = { noCacheCost, aggregate, buildReport, markdown };
if (require.main === module) main();
