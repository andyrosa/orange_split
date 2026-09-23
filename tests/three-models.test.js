const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');
const core = loadCore();

test('three roles route independently and retain legacy helper behavior', () => {
    const cfg = core.buildStageConfig('lunaLow', 'geminiFlash', 'astraLow');
    assert.equal(cfg.modelExtract, 'openai/gpt-5.6-luna');
    assert.equal(cfg.modelScore, cfg.modelExtract);
    assert.equal(cfg.modelConsolidate, 'google/gemini-3.8-flash');
    assert.equal(cfg.modelSynthesize, 'openai/gpt-6-astra');
    assert.deepEqual(cfg.reasoningSynthesize, { effort: 'low' });
    assert.equal(cfg.maxTokensSynthesize, 16000);
    assert.equal(core.DEFAULT_CONFIG.modelSynthesize, 'openai/gpt-6-sol');
    assert.deepEqual(core.buildStageConfig('lunaLow', 'geminiFlash'), core.buildStageConfig('lunaLow', 'geminiFlash', 'geminiFlash'));
    assert.equal(core.CONSOLIDATION_MODELS.geminiFlash.config.modelSynthesize, undefined);
});

test('CLI role flags override only their own stage', () => {
    const { buildConfig } = require('../scripts/run_node');
    const original = process.argv;
    try {
        process.argv = ['node', 'runner', '--consolidation=geminiFlash', '--summary=astraLow'];
        assert.equal(buildConfig().modelConsolidate, 'google/gemini-3.8-flash');
        assert.equal(buildConfig().modelSynthesize, 'openai/gpt-6-astra');
        process.argv.pop();
        assert.equal(buildConfig().modelSynthesize, undefined);
    } finally { process.argv = original; }
});

test('mixed summary links and result keys are distinct while old links still restore', () => {
    const selection = { article: '123', snapshot: '2026-09-04T12:34:56.789Z', share: 50, volume: 'lunaLow', consolidation: 'sonnet5', budget: 1 };
    const legacy = core.makeRunPageUrl('https://example.test/', selection);
    const old = new URL(legacy); old.searchParams.delete('summary');
    assert.deepEqual(core.parseRunPageUrl(old.href), { ...selection, summary: 'sonnet5' });
    assert.equal(core.runResultCacheKey(selection), core.runResultCacheKey({ ...selection, summary: 'sonnet5' }));
    const mixed = { ...selection, summary: 'astraLow' };
    assert.notEqual(core.runResultCacheKey(selection), core.runResultCacheKey(mixed));
    assert.deepEqual(core.parseRunPageUrl(core.makeRunPageUrl(old.href, mixed)), mixed);
    old.searchParams.set('summary', 'unknown');
    assert.equal(core.parseRunPageUrl(old.href), null);
});

test('summary benchmarks remain visible when upstream choices change, with their fixed inputs stated', () => {
    for (const choice of Object.values(core.SUMMARY_MODELS)) {
        const measured = core.summaryQualityText(choice, 'solLow', 'lunaLow');
        assert.equal(measured.rank, 'Matched benchmark');
        assert.match(measured.method, /same five Sol-low consolidation and Luna-low scoring inputs/);
        for (const [cons, volume] of [['geminiFlash', 'lunaLow'], ['astraLow', 'haiku']]) {
            assert.deepEqual(core.summaryQualityText(choice, cons, volume), measured);
        }
        assert.match(measured.method, /does not grade every upstream combination/);
    }
});

test('summary cost changes independently of consolidation', () => {
    const a = core.combinedRate('lunaLow', 'geminiFlash', 'usdPerMillionChars', 'astraLow');
    const b = core.combinedRate('lunaLow', 'geminiFlash', 'usdPerMillionChars', 'sonnet5');
    assert.ok(Math.abs((b - a) - (core.SUMMARY_MODELS.sonnet5.usdPerMillionChars - core.SUMMARY_MODELS.astraLow.usdPerMillionChars)) < 1e-10);
});
