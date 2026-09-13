const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');

test('only the two missing Flash review records are filled from retained blind judgments', () => {
    const core = loadCore(), report = require('../data/volume-review-holes.json');
    assert.deepEqual(Object.keys(report.models).sort(), ['geminiFlash', 'glmFlash']);
    for (const [key, measured] of Object.entries(report.models)) {
        assert.equal(measured.held + measured.wrong + measured.unclear, measured.sampled);
        assert.equal(measured.sampled, Math.min(report.policy.samplePerModel, measured.population));
        const choice = core.VOLUME_MODELS[key];
        assert.equal(choice.quality.reviewHeldPercent, 100 * measured.held / measured.sampled);
        assert.equal(choice.quality.reviewWrongPercent, 100 * measured.wrong / measured.sampled);
        const display = core.volumeMetrics(choice);
        assert.equal(display.consistency, `${measured.reviewHeldPercent}%`);
        assert.equal(display.wrong, `${measured.reviewWrongPercent}%`);
    }
    for (const [key, held, wrong] of [['haiku', 59, 12], ['opus5', 74, 0], ['lunaLow', 80, 6]]) {
        assert.equal(core.VOLUME_MODELS[key].quality.reviewHeldPercent, held);
        assert.equal(core.VOLUME_MODELS[key].quality.reviewWrongPercent, wrong);
    }
});
