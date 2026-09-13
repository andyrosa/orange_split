const fs = require('node:fs');
const path = require('node:path');
const { loadCore } = require('./load_core');
const core = loadCore();
const directory = path.resolve(process.argv[2] || 'outputs/astra-benchmark');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const fixture = read('fixture.json');
const pricing = read('models.json').find(model => model.id === 'openai/gpt-6-astra').pricing;
const money = n => `$${n.toFixed(3)}`;
const percent = n => `${(100 * n).toFixed(1)}%`;
const runs = fixture.items.map(item => ({ item, sonnet: read(`${item.id}-sonnet.json`), astra: read(`${item.id}-astra.json`),
    review: fs.existsSync(path.join(directory, `${item.id}-review.json`)) ? read(`${item.id}-review.json`) : null }));
for (const run of runs) {
    if (JSON.stringify(run.sonnet.result.candidates) !== JSON.stringify(run.astra.result.candidates)
        || run.sonnet.sourceHash !== run.astra.sourceHash) throw new Error(`Unequal frozen inputs for ${run.item.id}`);
    if (run.review) for (const review of run.review.response.json.reviews) {
        const role = run.review.mapping[review.variant];
        if (!['astra', 'sonnet'].includes(role)) throw new Error('Unknown reviewer variant');
        const axisIds = new Set(run[role].result.axes.map(axis => axis.id));
        const commentIds = new Set(run.item.thread.comments.map(comment => comment.id));
        for (const issue of review.consolidationIssues) {
            if (!issue.axisIds.every(id => axisIds.has(id)) || !issue.candidateIds.every(id => Number.isInteger(id) && id > 0 && id <= run[role].result.candidates.length)) throw new Error(`Invalid consolidation review references: ${run.item.id}`);
        }
        for (const issue of review.summaryIssues) {
            if (!issue.axisIds.every(id => axisIds.has(id)) || !issue.commentIds.every(id => commentIds.has(id))) throw new Error(`Invalid summary review references: ${run.item.id}`);
        }
    }
}
const chars = runs.reduce((sum, run) => sum + core.estimateRunCost(run.item.thread.comments, 0).chars, 0);
const totals = role => runs.reduce((sum, run) => {
    const m = run[role].metrics;
    for (const key of ['comments', 'axes', 'twoSided', 'historicalOrNewCost']) sum[key] = (sum[key] || 0) + m[key];
    sum.agreed += m.stats.agreedStances; sum.classified += m.stats.classifiedPairs;
    return sum;
}, { agreed: 0, classified: 0 });
const rateTotals = { consolidate: { cost: 0, coldEquivalentCost: 0, seconds: 0 }, synthesize: { cost: 0, coldEquivalentCost: 0, seconds: 0 } };
const traces = fs.readdirSync(path.join(directory, 'traces')).filter(n => n.endsWith('.json')).map(n => read(`traces/${n}`));
for (const run of runs) for (const call of run.astra.log) {
    const rate = rateTotals[call.stage];
    if (!rate) continue;
    const trace = read(`traces/${call.key}.json`);
    const cachedTokens = trace.provider?.usage?.prompt_tokens_details?.cached_tokens || 0;
    rate.cost += trace.usage.cost;
    // Project the observed output on a new input: replace cache-read charges with first-write charges.
    rate.coldEquivalentCost += trace.usage.cost + cachedTokens * (Number(pricing.input_cache_write) - Number(pricing.input_cache_read));
    rate.seconds += trace.elapsedSeconds;
}
const rates = Object.fromEntries(Object.entries(rateTotals).map(([stage, value]) => [stage, {
    ...value, usdPerMillionChars: value.coldEquivalentCost / chars * 1e6,
    secondsPerMillionChars: value.seconds / chars * 1e6,
}]));
const astra = totals('astra'), sonnet = totals('sonnet');
const result = { threads: runs.length, sourceCharactersWithFraming: chars, totals: { astra, sonnet }, rates,
    astraTwoSidedRange: [Math.min(...runs.map(r => r.astra.metrics.twoSidedPercent)), Math.max(...runs.map(r => r.astra.metrics.twoSidedPercent))],
    totalNewSpend: traces.reduce((sum, trace) => sum + (trace.usage?.cost || 0), 0),
    reviewWinners: runs.map(run => ({ id: run.item.id, consolidation: run.review ? (run.review.mapping[run.review.response.json.consolidationWinner] || 'tie') : null,
        summary: run.review ? (run.review.mapping[run.review.response.json.summaryWinner] || 'tie') : null })) };
fs.writeFileSync(path.join(directory, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
const lines = ['# Astra low: five-thread pipeline comparison', '',
    'Five frozen cached HN snapshots. Both pipelines use the same cached Luna-low extraction. Astra-low axes receive fresh two-pass Luna-low scoring; Sonnet uses its original cached scoring. Summaries use each pipeline’s own verified evidence. Sonnet needed a new summary on Fermat; the other four baselines fully replayed from cache. Opus 5 reviews anonymized variants and supplied evidence without model names. No human gold labels were created.', '',
    '| Thread | Comments | Axes Sonnet / Astra | Two-sided Sonnet / Astra | Agreement Sonnet / Astra | Pipeline USD Sonnet / Astra | Astra seconds* |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for (const run of runs) {
    const s = run.sonnet.metrics, a = run.astra.metrics;
    lines.push(`| [${run.item.thread.title}](https://news.ycombinator.com/item?id=${run.item.id}) | ${a.comments} | ${s.axes} / ${a.axes} | ${s.twoSided} / ${a.twoSided} | ${percent(s.agreedShareOfAllClassifiedPairs)} / ${percent(a.agreedShareOfAllClassifiedPairs)} | ${money(s.historicalOrNewCost)} / ${money(a.historicalOrNewCost)} | ${a.elapsedSeconds.toFixed(1)} |`);
}
lines.push('', '*Astra time includes consolidation, scoring and summary, with extraction replayed. Cached Sonnet timing is not a measured generation time. Pipeline costs include original extraction charges and format repairs, not just this session’s spending. Historical baseline prices and provider caching differ, so this is not a controlled cold-cache price benchmark. Agreement is agreed comment-axis stance pairs divided by the union of pairs classified in either pass, not agreement conditional on both passes emitting a stance.', '',
    `Across ${astra.comments} comments: Astra ${astra.twoSided}/${astra.axes} axes two-sided (${percent(astra.twoSided / astra.axes)}), Sonnet ${sonnet.twoSided}/${sonnet.axes} (${percent(sonnet.twoSided / sonnet.axes)}). Pooled scoring agreement: Astra ${percent(astra.agreed / astra.classified)}, Sonnet ${percent(sonnet.agreed / sonnet.classified)}.`, '',
    `Reconstructed pipeline costs: Astra ${money(astra.historicalOrNewCost)}, Sonnet ${money(sonnet.historicalOrNewCost)}. New benchmark spending including article checks/reviews: ${money(result.totalNewSpend)}.`, '', '## Independent model review', '',
    '| Thread | Consolidation preference | Summary preference |', '| --- | --- | --- |');
for (const run of runs) {
    const winner = result.reviewWinners.find(value => value.id === run.item.id);
    lines.push(`| ${run.item.thread.title} | ${winner.consolidation || 'pending'} | ${winner.summary || 'pending'} |`);
}
for (const run of runs.filter(run => run.review)) {
    lines.push('', `### ${run.item.thread.title}`, '', run.review.response.json.rationale, '');
    for (const review of run.review.response.json.reviews) {
        const role = run.review.mapping[review.variant];
        lines.push(`**${role}:** ${review.fullyPreservedCandidateIds.length} fully preserved, ${review.partialCandidateIds.length} partial, ${review.missingCandidateIds.length} missing, ${review.excludedCandidateIds.length} excluded candidate IDs; ${review.consolidationIssues.length} consolidation issues; ${review.summaryIssues.length} summary issues; coverage ${review.summaryCoverage}/5. ${review.note}`, '');
        for (const issue of review.consolidationIssues) lines.push(`- Axes ${issue.axisIds.join(', ')} (${issue.kind}); candidates ${issue.candidateIds.join(', ')}: ${issue.explanation}`);
        for (const issue of review.summaryIssues) lines.push(`- Summary (${issue.severity}): “${issue.claim}” — ${issue.explanation}`);
    }
}
lines.push('', '## Estimate calibration and limitations', '',
    'Rate denominators use the complete source comment text plus the app’s framing allowance, pooled over these five threads. Astra consolidation and synthesis rates are separate. Cost rates replace observed cache-read charges with first-write charges using captured provider token details and the recorded model catalog; they are forecasts for new inputs using observed output lengths, not additional billed experiments. Time rates are measured service time normalized by source size. Provider cache state, reasoning variability, candidate volume, excerpt caps and parallel scoring all affect real runs.', '',
    'The reviewer is independent of Astra, but remains a model and is in the same vendor family as Sonnet. Its candidate mappings, severity judgments and preferences are uncalibrated assessments, not ground truth. More axes are not automatically better, and scoring agreement is not correctness. Five modest-sized threads do not establish behavior on very large threads. The prior three-repeat frozen-stage test remains a separate experiment.', '',
    'The Astra API adapter replaces the unsupported summary-schema lookaround regex only for Astra. Prompt text, request/cache identity and full local validators remain unchanged. Original schema constraints remain in use for other models. Article smoke results are stored separately and excluded from the five-thread metrics.', '');
lines.push('## App verification', '', 'All 169 tests in the project test directory pass, including the selector role settings, a real API-body schema adapter test, the production bounded format-repair path, article stage routing, and CSP validation. The complete tested HTML was installed only after verifying the live source had not changed since staging. A browser check confirmed that Astra appears with its measured metrics and selects correctly.', '',
    'The paid article smoke completed all stages without repair. It also exposes a semantic limitation: the original general statement that teams can stagger days off was consolidated into a claim about this particular small team, and the first axis added a priority comparison between burnout and coverage. The summary itself correctly notes these limits, but the axis review still accepted the axes. Functional success therefore does not establish article-axis faithfulness.', '');
fs.writeFileSync(path.join(directory, 'report.md'), lines.join('\n') + '\n');
console.log(JSON.stringify(result, null, 2));
