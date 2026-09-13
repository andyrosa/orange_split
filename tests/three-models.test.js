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
    assert.equal(core.DEFAULT_CONFIG.modelSynthesize, cfg.modelSynthesize);
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

test('quality applies only to its measured pipeline and Gemini remains standalone', () => {
    assert.match(core.summaryQualityText(core.SUMMARY_MODELS.astraLow, 'astraLow', 'lunaLow').rank, /#1/);
    for (const [cons, volume] of [['geminiFlash', 'lunaLow'], ['astraLow', 'haiku']]) {
        const text = core.summaryQualityText(core.SUMMARY_MODELS.astraLow, cons, volume);
        assert.equal(text.rank, 'Untested combination');
        assert.equal(text.scores, '');
    }
    const gemini = core.summaryQualityText(core.SUMMARY_MODELS.geminiFlash, 'geminiFlash', 'lunaLow');
    assert.match(gemini.rank, /Standalone.*8\/10/);
    assert.match(gemini.method, /without comparison or ranking/);
    const report = require('../data/gemini-summary-quality.json');
    assert.deepEqual(core.SUMMARY_MODELS.geminiFlash.summaryQuality.scores, report.scores);
});

test('summary cost changes independently of consolidation', () => {
    const a = core.combinedRate('lunaLow', 'geminiFlash', 'usdPerMillionChars', 'astraLow');
    const b = core.combinedRate('lunaLow', 'geminiFlash', 'usdPerMillionChars', 'sonnet5');
    assert.ok(Math.abs((b - a) - (core.SUMMARY_MODELS.sonnet5.usdPerMillionChars - core.SUMMARY_MODELS.astraLow.usdPerMillionChars)) < 1e-10);
});
