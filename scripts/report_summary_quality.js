// Keep the compact evaluation evidence in git; full source and provider traces stay under outputs/.
const fs = require('node:fs');
const path = require('node:path');
const { aggregate, POLICY } = require('./eval_summary_quality');
function main() {
    const directory = process.argv[2] || 'outputs/summary-quality';
    const original = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
    if (JSON.stringify(original.policy) !== JSON.stringify(POLICY)) throw Error('Evaluation policy changed');
    const result = aggregate(original.reviews);
    const expected = ['22866284', '49571634', '47155526', '49574167', '49568506'].sort();
    if (JSON.stringify([...new Set(original.reviews.map(r => r.id))].sort()) !== JSON.stringify(expected)) throw Error('Incomplete frozen sample');
    const compact = { ...result, sourceHash: original.sourceHash, generatedAt: original.generatedAt, spend: original.spend,
        reviews: original.reviews.map(r => ({ id: r.id, title: r.title, repeat: r.repeat, requestHash: r.requestHash,
            themes: r.response.json.themes, grades: r.response.json.grades.map(({ variant, ...grade }) => ({ model: r.mapping[variant], ...grade })) })) };
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync('data/summary-quality.json', JSON.stringify(compact, null, 2) + '\n');
    const lines = ['# Summary quality: Astra low and Sonnet 5 adaptive', '',
        'Astra high graded existing end-to-end summaries from five frozen HN threads, twice with anonymous presentation order reversed. Both models were evaluated against the same complete source comments; citation checks also used each summary’s own supplied evidence. No humans or other candidate models participated. The candidates retain Luna-low extraction and scoring. This measures the summary a user gets from each pipeline, not isolated writing ability on identical axes.', '',
        '| Model setting | Summary rank | Faithfulness /100 | Coverage /100 | Clarity /100 | Weighted /100 | Reviews flagging major support errors |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
    const name = role => role === 'astra' ? 'Astra low' : 'Sonnet 5 adaptive';
    for (const [role, m] of Object.entries(result.models)) lines.push(`| ${name(role)} | ${m.rank === null ? 'Withheld: support errors' : '#' + m.rank + (m.tied ? ' (tied)' : '')} | ${m.scores.faithfulness.toFixed(1)} | ${m.scores.coverage.toFixed(1)} | ${m.scores.clarity.toFixed(1)} | ${m.weighted.toFixed(1)} | ${m.majorReviewCount}/${m.reviews} |`);
    lines.push('', '## Method and limits', '',
        'The policy was fixed before grading: 60% faithfulness, 30% coverage, 10% clarity; average equally over threads and order passes. Score gaps under five points tie. Any major support error flagged in either order withholds that model’s numeric rank. If both models have such errors, neither receives a numeric rank. This prevents an attractive average from obscuring a serious faithfulness defect. It is a conservative display rule, not a statistical significance test.', '',
        'Each grade uses a common 0–100 rubric, first identifies central source themes, then scores the anonymous summaries individually. The evaluator is instructed to distinguish missing coverage from unsupported claims. Local checks reject unknown comment references, issues that do not quote actual summary text, duplicate/missing grades, and major-error labels inconsistent with faithfulness scores. These checks validate provenance and consistency, not the correctness of the model’s judgments.', '',
        'Astra high also evaluates its own model family; this is not an independent or human-calibrated assessment. Two order passes are repeated judgments of the same output, not additional source samples. Five threads of 137–337 comments do not establish article quality or performance on very large threads. Previously observed Opus preferences used a different rubric and evidence scope and are not combined into these ranks.', '',
        `New evaluation cost: $${original.spend.toFixed(6)}. Full requests and raw responses are cached under outputs/summary-quality. Compact evidence and request hashes are in data/summary-quality.json.`, '',
        '## Per-thread evidence', '');
    for (const r of compact.reviews) {
        lines.push(`### ${r.title} — order ${r.repeat + 1}`, '');
        for (const g of r.grades) {
            lines.push(`**${name(g.model)}:** faithfulness ${g.faithfulness}, coverage ${g.coverage}, clarity ${g.clarity}. ${g.rationale}`, '');
            for (const issue of g.issues) lines.push(`- ${issue.severity}: “${issue.claim}” — ${issue.explanation} Evidence: ${issue.commentIds.map(id => `[${id}](https://news.ycombinator.com/item?id=${id})`).join(', ') || 'absence of supporting evidence'}.`);
            for (const omission of g.omissions) lines.push(`- Coverage: ${omission}`);
            lines.push('');
        }
    }
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync('docs/summary-quality.md', lines.join('\n') + '\n');
    console.log(JSON.stringify(result.models, null, 2));
}
if (require.main === module) main();
