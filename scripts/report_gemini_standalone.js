const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarize } = require('./eval_gemini_standalone');
function main() {
    const input = process.argv[2] || 'outputs/gemini-standalone';
    const grades = process.argv[3] || 'outputs/gemini-summary-quality';
    const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = read(path.join(grades, 'report.json'));
    const fixture = read(path.join(input, 'fixture.json'));
    const runs = fixture.items.map(i => read(path.join(input, `${i.id}-gemini.json`)));
    const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    if (report.sourceHash !== hash(fixture.items) || runs.some((r, i) => r.sourceHash !== hash(fixture.items[i].thread))) throw Error('Pipeline and grading sources differ');
    const totals = runs.reduce((t, r) => {
        t.comments += r.metrics.comments; t.candidates += r.metrics.candidates; t.axes += r.metrics.axes;
        t.twoSided += r.metrics.twoSided; t.agreedPairs += r.metrics.stats.agreedStances;
        t.classifiedPairs += r.metrics.stats.classifiedPairs; t.pipelineCost += r.metrics.historicalOrNewCost;
        t.seconds += r.metrics.elapsedSeconds;
        for (const stage of ['consolidate', 'score', 'synthesize']) t[stage + 'Cost'] += r.metrics.stages[stage].historicalOrNewCost;
        return t;
    }, { comments: 0, candidates: 0, axes: 0, twoSided: 0, agreedPairs: 0, classifiedPairs: 0, pipelineCost: 0,
        seconds: 0, consolidateCost: 0, scoreCost: 0, synthesizeCost: 0 });
    const newPipelineSpend = read(path.join(input, 'metrics.json')).knownNewSpend;
    const compact = { model: report.model, effort: report.effort, evaluator: report.evaluator, evaluatorEffort: report.evaluatorEffort,
        method: report.method, weights: report.weights, sourceHash: report.sourceHash, generatedAt: report.generatedAt,
        ...summarize(report.evaluations), totals, newPipelineSpend, gradingSpend: report.spend,
        runs: runs.map(r => ({ id: r.id, title: r.title, metrics: r.metrics })),
        evaluations: report.evaluations.map(r => ({ id: r.id, title: r.title, repeat: r.repeat, requestHash: r.requestHash,
            themes: r.response.json.themes, grade: r.response.json.grades[0] })) };
    fs.mkdirSync('data', { recursive: true }); fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('data/gemini-summary-quality.json', JSON.stringify(compact, null, 2) + '\n');
    const dollar = n => '$' + n.toFixed(4);
    const lines = ['# Gemini 3.8 Flash: standalone consolidation and summary evaluation', '',
        'Five frozen HN snapshots, 1,234 comments. Gemini 3.8 Flash uses the existing no-explicit-reasoning setting for consolidation and summary. Luna-low extraction replays from cache; Gemini axes receive fresh two-pass Luna-low scoring. No competing candidate was run or supplied to the evaluator, and no rank is assigned.', '',
        '| Summary criterion | Score /100 |', '| --- | ---: |',
        ...Object.entries(compact.scores).map(([k, v]) => `| ${k} | ${v.toFixed(1)} |`),
        `| Weighted (60% faithfulness, 30% coverage, 10% clarity) | ${compact.weighted.toFixed(1)} |`, '',
        `Astra high flagged major support errors in ${compact.majorReviewCount}/${compact.reviews} reviews. These are two independent grading calls per summary: five distinct summaries, ten reviews. The grader sees only the candidate summary, its citation context, and the complete source comments. Local checks validate citation IDs and exact quoted issue text. Model judgments remain fallible; no human labels were used.`, '',
        '| Thread | Comments | Candidates | Axes | Two-sided axes | Pipeline USD* | Seconds** |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...runs.map(r => `| ${r.title} | ${r.metrics.comments} | ${r.metrics.candidates} | ${r.metrics.axes} | ${r.metrics.twoSided} | ${dollar(r.metrics.historicalOrNewCost)} | ${r.metrics.elapsedSeconds.toFixed(1)} |`), '',
        `Totals: ${totals.axes} axes, ${totals.twoSided} two-sided (${(100 * totals.twoSided / totals.axes).toFixed(1)}%). Two-pass scoring agreement over the union of classified pairs: ${(100 * totals.agreedPairs / totals.classifiedPairs).toFixed(1)}%. These are structural metrics, not a semantic consolidation grade. A high two-sided percentage alone does not establish faithful consolidation or adequate coverage.`, '',
        `*Reconstructed pipeline cost ${dollar(totals.pipelineCost)} includes the original cached extraction charges. Fresh consolidation ${dollar(totals.consolidateCost)}, scoring ${dollar(totals.scoreCost)}, synthesis ${dollar(totals.synthesizeCost)}. **Elapsed time includes extraction replay, consolidation, parallel scoring and summary, not grading.`, '',
        `New pipeline spending: ${dollar(newPipelineSpend)}. Grading spending: ${dollar(report.spend)}. Total new spending: ${dollar(newPipelineSpend + report.spend)}.`, '',
        'This standalone rubric uses the same three scoring dimensions as the earlier summary evaluation, but presents only one candidate. Its grades are not used to rerank the earlier paired evaluations. The five selected HN threads do not establish article quality or very-large-thread behavior. Full requests, raw responses and cached pipeline results remain under outputs/gemini-standalone and outputs/gemini-summary-quality; request hashes and compact evidence are retained in data/gemini-summary-quality.json.', '',
        '## Evidence from individual reviews', ''];
    for (const r of compact.evaluations) {
        const g = r.grade;
        lines.push(`### ${r.title} — review ${r.repeat + 1}`, '', `Faithfulness ${g.faithfulness}; coverage ${g.coverage}; clarity ${g.clarity}. ${g.rationale}`, '');
        for (const issue of g.issues) lines.push(`- ${issue.severity}: “${issue.claim}” — ${issue.explanation} Evidence: ${issue.commentIds.map(id => `[${id}](https://news.ycombinator.com/item?id=${id})`).join(', ') || 'no supporting evidence identified'}.`);
        for (const omission of g.omissions) lines.push(`- Coverage: ${omission}`);
        lines.push('');
    }
    fs.writeFileSync('docs/gemini-summary-quality.md', lines.join('\n') + '\n');
    console.log(JSON.stringify({ ...summarize(report.evaluations), totals, newPipelineSpend, gradingSpend: report.spend }, null, 2));
}
if (require.main === module) main();
