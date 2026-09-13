const test = require('node:test');
const assert = require('node:assert/strict');
const { readPage, blockText, CORE_SCRIPT_PATTERN } = require('../scripts/load_core');
const { MODELS } = require('../scripts/eval_consolidation_matched');
const { POLICY, loadSummaryCore, summaryRequest, reviewRequest, generate, validateMatchedReview } = require('../scripts/eval_summary_matched');
const { aggregate } = require('../scripts/report_summary_matched');
const core = loadSummaryCore(blockText(readPage(), CORE_SCRIPT_PATTERN));
const item = { thread: { title: 'Shared topic', comments: [{ id: 101, parentId: 1, text: 'Evidence.', author: 'private-author' }] }, rows: [] };

test('all eight summary candidates receive identical production evidence and selected settings', () => {
    const calls = MODELS.map(key => summaryRequest(core, item, key));
    for (const [i, call] of calls.entries()) {
        const settings = core.stageSettings({ ...core.DEFAULT_CONFIG, ...core.buildStageConfig('lunaLow', 'solLow', MODELS[i]) }, 'synthesize');
        assert.deepEqual({ model: call.model, reasoning: call.reasoning, sampling: call.sampling, maxTokens: call.maxTokens }, settings);
        assert.deepEqual(call.messages, calls[0].messages);
        assert.equal(call.maxTokens, 16000);
        assert.equal(call.schema, core.SYNTHESIS_SCHEMA);
    }
});

test('one shared review presents anonymous summaries and evidence without authors or model names', () => {
    const variants = MODELS.map((_, i) => ({ label: 'V' + (i + 1), summary: { sections: [], caveats: [] } }));
    const call = reviewRequest(core, item, variants);
    const payload = JSON.parse(call.messages[1].content);
    assert.equal(payload.variants.length, 8);
    assert.ok(payload.citationEvidence);
    assert.equal(payload.comments[0].author, undefined);
    assert.equal(call.schema.schema.properties.grades.minItems, 8);
    assert.equal(call.schema.schema.properties.grades.maxItems, 8);
    assert.equal(call.model, POLICY.evaluator);
    assert.match(call.messages[0].content, /eight anonymous summary attempts/);
    assert.doesNotMatch(call.messages[0].content, /two anonymous summaries|Neither is/);
});

test('summary format failure gets exactly one production repair, preserving both billed calls', async () => {
    const request = summaryRequest(core, item, 'solLow');
    let calls = [];
    const client = { call: async call => { calls.push(call); return { json: calls.length === 1 ? {} : { sections: [], caveats: [] } }; } };
    // Empty summaries are invalid too; even a second validation failure cannot cause a third call.
    const result = await generate(core, client, request);
    assert.equal(result.summary, null);
    assert.ok(result.failure);
    assert.equal(result.log.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].meta.formatRepair, true);
    assert.equal(calls[1].model, request.model);
});

test('Astra, Sol and Luna transport schemas avoid unsupported lookaround while preserving local limits', async () => {
    for (const key of ['astraLow', 'solLow', 'lunaMax']) {
        const request = summaryRequest(core, item, key), original = JSON.stringify(request);
        let sent;
        await core.callOpenRouter({ apiKey: 'test', request, fetchImpl: async (_, options) => {
            sent = JSON.parse(options.body);
            return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { cost: 0 } }) };
        } });
        assert.equal(sent.response_format.json_schema.schema.properties.sections.items.properties.text.pattern.includes('(?'), false);
        assert.equal(JSON.stringify(request), original);
        assert.throws(() => core.parseSynthesisResponse({ sections: [{ text: 'word '.repeat(101) + 'claim[[axis:1]].', axisIds: [1] }], caveats: [] }, [1]), /maximum 100/);
    }
});

test('matched summary totals count unusable outputs and major errors once, and pool cost/time by comments', () => {
    const grade = { faithfulness: 90, coverage: 80, clarity: 90, issues: [] };
    const runs = [
        { id: 'a', comments: 100, chars: 1000, noCacheCost: 0.1, billed: 0.08, seconds: 10, summary: {}, grade },
        { id: 'b', comments: 200, chars: 2000, noCacheCost: 0.2, billed: 0.1, seconds: 20, summary: null, grade: { faithfulness: 0, coverage: 0, clarity: 0, issues: [] } },
        { id: 'c', comments: 300, chars: 3000, noCacheCost: 0.3, billed: 0.2, seconds: 30, summary: {}, grade: { ...grade, faithfulness: 70, issues: [{ severity: 'major' }, { severity: 'major' }] } },
    ];
    const result = aggregate(runs);
    assert.equal(result.failedCount, 1);
    assert.equal(result.majorReviewCount, 1);
    assert.equal(result.errorPercent, 200 / 3);
    assert.ok(Math.abs(result.weighted - 54) < 1e-8);
    assert.ok(Math.abs(result.benchmark.costPer1k - 1) < 1e-8);
    assert.equal(result.benchmark.secondsPer1k, 100);
    assert.throws(() => aggregate([...runs, runs[0]]), /duplicate/);
});

test('unavailable variants cannot receive invented quality grades', () => {
    const variants = [{ label: 'V1', summary: { sections: [], caveats: [] }, unavailable: true }];
    const review = { themes: [{ point: 'A disagreement', commentIds: [101] }], grades: [{ variant: 'V1', faithfulness: 0, coverage: 0, clarity: 0, issues: [], omissions: [], rationale: 'Unavailable' }] };
    validateMatchedReview(review, item, variants);
    review.grades[0].coverage = 20;
    assert.throws(() => validateMatchedReview(review, item, variants), /Unavailable summary/);
});
