const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');
const core = loadCore();

test('four roles route independently through buildRunConfig and roleConfig', () => {
    const cfg = core.buildRunConfig({ extraction: 'lunaLow', consolidation: 'geminiFlash', scoring: 'haiku', summary: 'astraLow' });
    assert.equal(cfg.modelExtract, 'openai/gpt-5.6-luna');
    assert.equal(cfg.modelScore, 'anthropic/claude-haiku-4.5');
    assert.equal(cfg.modelConsolidate, 'google/gemini-3.8-flash');
    assert.equal(cfg.modelSynthesize, 'openai/gpt-6-astra');
    assert.deepEqual(cfg.reasoningSynthesize, { effort: 'low' });
    assert.equal(cfg.maxTokensSynthesize, 16000);
    assert.equal(core.DEFAULT_CONFIG.modelSynthesize, 'openai/gpt-6-sol');
    assert.deepEqual(core.roleConfig('summary', 'astraLow'),
        { modelSynthesize: 'openai/gpt-6-astra', samplingSynthesize: null, reasoningSynthesize: { effort: 'low' }, maxTokensSynthesize: 16000 });
    assert.deepEqual(Object.keys(core.roleConfig('scoring', 'haiku')).sort(), ['maxTokensScore', 'modelScore', 'reasoningScore', 'samplingScore']);
    assert.equal(core.buildStageConfig, undefined);
    assert.equal(core.DEFAULT_VOLUME_KEY, undefined);
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

test('mixed summary links and result keys are distinct and old volume links no longer restore', () => {
    const selection = { article: '123', snapshot: '2026-09-04T12:34:56.789Z', share: 50, extraction: 'lunaLow', consolidation: 'sonnet5', scoring: 'lunaLow', summary: 'sonnet5', budget: 1 };
    const link = core.makeRunPageUrl('https://example.test/', selection);
    assert.deepEqual(core.parseRunPageUrl(link), selection);
    const mixed = { ...selection, summary: 'astraLow' };
    assert.notEqual(core.runResultCacheKey(selection), core.runResultCacheKey(mixed));
    assert.deepEqual(core.parseRunPageUrl(core.makeRunPageUrl(link, mixed)), mixed);
    const withoutSummary = new URL(link); withoutSummary.searchParams.delete('summary');
    assert.equal(core.parseRunPageUrl(withoutSummary.href), null);
    const legacy = new URL(link);
    legacy.searchParams.delete('extraction'); legacy.searchParams.delete('scoring'); legacy.searchParams.set('volume', 'lunaLow');
    assert.equal(core.parseRunPageUrl(legacy.href), null);
    const unknown = new URL(link); unknown.searchParams.set('summary', 'unknown');
    assert.equal(core.parseRunPageUrl(unknown.href), null);
});

test('summary benchmarks remain visible when upstream choices change, with their fixed inputs stated', () => {
    const measuredChoices = Object.values(core.SUMMARY_MODELS).filter(choice => !choice.unmeasured);
    assert.equal(measuredChoices.length, Object.keys(core.SUMMARY_MODELS).length - 1);
    for (const choice of measuredChoices) {
        const measured = core.summaryQualityText(choice, { extraction: 'lunaLow', consolidation: 'solLow', scoring: 'lunaLow', summary: 'solLow' });
        assert.equal(measured.rank, 'Matched benchmark');
        assert.match(measured.method, /same five Sol-low consolidation and Luna-low scoring inputs/);
        for (const keys of [{ extraction: 'lunaLow', consolidation: 'geminiFlash', scoring: 'lunaLow' }, { extraction: 'haiku', consolidation: 'astraLow', scoring: 'opus5' }]) {
            assert.deepEqual(core.summaryQualityText(choice, keys), measured);
        }
        assert.match(measured.method, /does not grade every upstream combination/);
    }
    const router = core.SUMMARY_MODELS.jevRouter;
    assert.equal(router.unmeasured, true);
    assert.deepEqual(core.summaryQualityText(router, { extraction: 'lunaLow', consolidation: 'solLow', scoring: 'lunaLow' }),
        { rank: 'Not ranked', label: 'Summary quality: not evaluated', scores: '', method: `Jev Router ${router.note}.` });
});

test('summary cost changes independently of consolidation', () => {
    const keys = { extraction: 'lunaLow', consolidation: 'geminiFlash', scoring: 'lunaLow' };
    const a = core.combinedRate({ ...keys, summary: 'astraLow' }, 'usdPerMillionChars');
    const b = core.combinedRate({ ...keys, summary: 'sonnet5' }, 'usdPerMillionChars');
    assert.ok(Math.abs((b - a) - (core.SUMMARY_MODELS.sonnet5.usdPerMillionChars - core.SUMMARY_MODELS.astraLow.usdPerMillionChars)) < 1e-10);
});
