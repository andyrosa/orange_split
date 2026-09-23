const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');
const core = loadCore();
test('selector measurements match the retained evaluation and cover only the two agreed settings', () => {
    const report = require('../data/summary-quality.json');
    assert.deepEqual(Object.keys(report.models).sort(), ['astra', 'sonnet']);
    assert.equal(report.policy.evaluator, 'openai/gpt-6-astra');
    assert.equal(report.policy.effort, 'high');
    assert.equal(report.threads, 5);
    assert.equal(report.evaluations, 10);
    assert.deepEqual(core.CONSOLIDATION_MODELS.astraLow.summaryQuality, report.models.astra);
    assert.deepEqual(core.CONSOLIDATION_MODELS.sonnet5.summaryQuality, report.models.sonnet);
    for (const [key, choice] of Object.entries(core.CONSOLIDATION_MODELS)) {
        if (!['astraLow', 'sonnet5'].includes(key)) assert.equal(choice.summaryQuality, undefined);
    }
});
test('summary details distinguish tied ranks, support errors and untested models', () => {
    const q = { rank: 1, tied: true, threads: 5, reviews: 10, majorReviewCount: 0,
        scores: { faithfulness: 90, coverage: 80, clarity: 95 }, weighted: 87.5 };
    const tied = core.summaryQualityText({ summaryQuality: q });
    assert.equal(tied.rank, '#1 (tied) · 5 threads');
    assert.match(tied.scores, /Faithfulness 90.0\/100/);
    assert.match(tied.method, /Evaluated by Astra high/);
    assert.match(tied.method, /not article results/);
    const rejected = core.summaryQualityText({ summaryQuality: { ...q, rank: null, tied: false, majorReviewCount: 2 } });
    assert.match(rejected.rank, /Rank withheld: major support errors flagged in 2\/10 reviews/);
    assert.match(rejected.label, /Rank withheld: major support errors flagged in 2\/10 reviews/);
    assert.match(rejected.scores, /2 of 10 reviews/);
    const missing = core.summaryQualityText({});
    assert.equal(missing.rank, 'Not ranked');
    assert.equal(missing.scores, '');
});

test('every summary row exposes the same matched quality and cost/time measurements as retained evidence', () => {
    const matched = require('../data/summary-matched.json').models, added = require('../data/summary-additions.json').models;
    assert.deepEqual(Object.keys(matched).filter(key => key in added), []);
    const report = { models: { ...matched, ...added } };
    assert.deepEqual(Object.keys(report.models).sort(), Object.keys(core.SUMMARY_MODELS).sort());
    assert.deepEqual(core.SUMMARY_METRIC_COLUMNS.map(([key]) => key), ['model', 'cost', 'time', 'summaryQuality', 'summaryErrors']);
    for (const [key, choice] of Object.entries(core.SUMMARY_MODELS)) {
        const retained = report.models[key], q = choice.summaryQuality;
        assert.equal(q.weighted, retained.weighted);
        assert.equal(q.errorPercent, retained.errorPercent);
        assert.equal(q.failedCount, retained.failedCount);
        assert.equal(q.threads, 5);
        assert.equal(q.benchmark.comments, 1234);
        assert.deepEqual(q.scores, retained.scores);
        assert.deepEqual(q.benchmark, retained.benchmark);
        const values = core.summaryMetrics(choice);
        assert.equal(values.summaryQuality, retained.weighted.toFixed(1));
        assert.equal(values.summaryErrors, `${retained.errorPercent.toFixed(0)}%`);
        assert.equal(values.cost, `$${retained.benchmark.costPer1k.toFixed(2)}`);
        assert.equal(values.time, (retained.benchmark.secondsPer1k / 60).toFixed(1));
        assert.doesNotMatch(values.model, /\(default\)/);
        assert.equal(choice.usdPerMillionChars, retained.rates.usdPerMillionChars);
        assert.equal(choice.secondsPerMillionChars, retained.rates.secondsPerMillionChars);
    }
});

test('summary cell colors follow quality upward and errors, cost and time downward', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const page = fs.readFileSync(require.resolve('../hn_polarization.html'), 'utf8');
    const start = page.indexOf('function modelMetricScore('), end = page.indexOf('function closeModelOptions(', start);
    const sandbox = { perThousandCommentsRates: core.perThousandCommentsRates };
    vm.runInNewContext(page.slice(start, end), sandbox);
    for (const choice of Object.values(core.SUMMARY_MODELS)) {
        assert.equal(sandbox.modelMetricScore(choice, 'summaryQuality'), choice.summaryQuality.weighted);
        assert.equal(sandbox.modelMetricScore(choice, 'summaryErrors'), -choice.summaryQuality.errorPercent);
        assert.equal(sandbox.modelMetricScore(choice, 'cost'), -choice.summaryQuality.benchmark.costPer1k);
        assert.equal(sandbox.modelMetricScore(choice, 'time'), -choice.summaryQuality.benchmark.secondsPer1k);
    }
});
