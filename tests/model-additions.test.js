const test = require('node:test');
const assert = require('node:assert/strict');
const { readPage, blockText, CORE_SCRIPT_PATTERN } = require('../scripts/load_core');
const { loadSummaryCore } = require('../scripts/eval_summary_matched');
const core = loadSummaryCore(blockText(readPage(), CORE_SCRIPT_PATTERN));
const comments = [{ id: 101, parentId: 1, text: 'Evidence.' }];

async function sentSynthesisPattern(model) {
    const request = { stage: 'synthesize', model, sampling: null, reasoning: null, maxTokens: 16000, schema: core.SYNTHESIS_SCHEMA,
        messages: core.buildSynthesisMessages('Shared topic', [], core.indexCommentsById(comments)) };
    let sent;
    await core.callOpenRouter({ apiKey: 'test', request, fetchImpl: async (_, options) => {
        sent = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { cost: 0 } }) };
    } });
    return sent.response_format.json_schema.schema.properties.sections.items.properties.text.pattern;
}

test('Opus 5.5 receives the lookaround-free synthesis pattern; other Anthropic models keep the full pattern', async () => {
    assert.equal((await sentSynthesisPattern('anthropic/claude-opus-5.5')).includes('(?'), false);
    for (const model of ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'anthropic/claude-fable-5.1']) {
        assert.equal(await sentSynthesisPattern(model), core.SYNTHESIS_SCHEMA.schema.properties.sections.items.properties.text.pattern, model);
    }
});
