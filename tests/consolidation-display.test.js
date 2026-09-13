const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');

test('consolidation cost and time use actual benchmark comments rather than legacy character assumptions', () => {
    const core = loadCore();
    const choice = { ...core.CONSOLIDATION_MODELS.sonnet5,
        quality: { ...core.CONSOLIDATION_MODELS.sonnet5.quality,
            benchmark: { ...core.CONSOLIDATION_MODELS.sonnet5.quality.benchmark,
                costPer1k: 0.123456, secondsPer1k: 87.6 } } };
    const values = core.consolidationMetrics(choice);
    assert.equal(values.cost, '$0.12');
    assert.equal(values.time, '1.5');
    assert.deepEqual(core.perThousandCommentsRates(choice), { usd: 0.123456, seconds: 87.6 });
    const legacy = core.CONSOLIDATION_MODELS.sonnet5;
    assert.ok(Math.abs(core.perThousandCommentsRates(legacy).usd - legacy.usdPerMillionChars * core.CHARS_PER_COMMENT / 1000) < 1e-12);
});
