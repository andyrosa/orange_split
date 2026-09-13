const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');
const core = loadCore();

test('Astra API summary compatibility preserves prompts, schema identity and local limits through repair', async () => {
    const sent = [];
    const originalRequests = [];
    const axis = { statementA: 'A four-day workweek should be adopted.', statementB: 'A five-day workweek should be kept.' };
    const thread = { title: 'Workweek', comments: [
        { id: 1, author: 'a', text: 'Adopt a four-day workweek.', parentId: null, depth: 0 },
        { id: 2, author: 'b', text: 'Keep a five-day workweek.', parentId: null, depth: 0 },
    ] };
    const result = await core.runPipeline({ thread, config: { ...core.buildStageConfig('lunaLow', 'sonnet5'),
        modelConsolidate: 'openai/gpt-6-astra', modelSynthesize: 'openai/gpt-6-astra',
        reasoningConsolidate: { effort: 'low' }, reasoningSynthesize: { effort: 'low' }, budgetUsd: 2 },
    onProgress() {}, callChat: async call => {
        let json;
        if (call.stage === 'extract') json = { candidates: [{ ...axis, commentsA: [1], commentsB: [2] }] };
        if (call.stage === 'consolidate') json = { axes: [axis] };
        if (call.stage === 'score') json = { stances: [{ comment: 1, axis: 1, stance: call.meta.swapPoles ? 'B' : 'A' }, { comment: 2, axis: 1, stance: call.meta.swapPoles ? 'A' : 'B' }] };
        if (call.stage !== 'synthesize') return { json, usage: { cost: 0.01 } };
        originalRequests.push(JSON.stringify(call.schema));
        json = { sections: [{ text: call.meta.formatRepair ? 'The voices disagree about the workweek[[axis:1]].' : 'word '.repeat(101) + 'claim[[axis:1]].', axisIds: [1] }], caveats: [] };
        const response = await core.callOpenRouter({ apiKey: 'test', request: call, fetchImpl: async (url, options) => {
            const body = JSON.parse(options.body); sent.push(body);
            return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(json) } }], usage: { cost: 0.01 } }) };
        } });
        assert.equal(JSON.stringify(call.schema), originalRequests.at(-1));
        return response;
    } });
    assert.ok(result.synthesis);
    assert.equal(sent.length, 2, 'overlong generated output must use the bounded production repair');
    for (const body of sent) {
        const schema = body.response_format.json_schema;
        assert.equal(schema.name, 'thread_synthesis');
        assert.equal(schema.schema.properties.sections.items.properties.text.pattern.includes('(?'), false);
        assert.equal(schema.schema.properties.sections.maxItems, 4);
        assert.equal(body.reasoning.effort, 'low');
        assert.match(JSON.stringify(body.messages), /300 narrative words/);
    }
    assert.ok(result.warnings.some(warning => /corrected by one format repair/.test(warning)));
});

test('Astra selector choice keeps extraction/scoring on the chosen volume model', () => {
    const cfg = core.buildStageConfig('lunaLow', 'astraLow');
    assert.equal(cfg.modelExtract, 'openai/gpt-5.6-luna');
    assert.equal(cfg.modelScore, 'openai/gpt-5.6-luna');
    assert.equal(cfg.modelConsolidate, 'openai/gpt-6-astra');
    assert.equal(cfg.modelSynthesize, 'openai/gpt-6-astra');
    assert.deepEqual(cfg.reasoningConsolidate, { effort: 'low' });
    assert.deepEqual(cfg.reasoningSynthesize, { effort: 'low' });
    assert.equal(cfg.samplingConsolidate, null);
    const display = core.consolidationMetrics(core.CONSOLIDATION_MODELS.astraLow);
    assert.equal(display.measurement, '5 threads');
    assert.match(display.twoSided, /%/);
    const volume = core.VOLUME_MODELS.opus5;
    const astra = core.CONSOLIDATION_MODELS.astraLow;
    assert.equal(core.combinedRate('opus5', 'astraLow', 'usdPerMillionChars'),
        volume.usdPerMillionChars + astra.usdPerMillionChars * volume.candidateFactor + core.SUMMARY_MODELS.astraLow.usdPerMillionChars);
    assert.equal(core.estimateRunSeconds(0, 'lunaLow', 'astraLow'),
        2 * core.VOLUME_MODELS.lunaLow.minimumSeconds + astra.minimumSeconds + core.SUMMARY_MODELS.astraLow.minimumSeconds);
});
