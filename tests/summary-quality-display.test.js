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
