const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPage, blockText, CORE_SCRIPT_PATTERN } = require('../scripts/load_core');
const { MODELS, loadExperimentCore, validateModelSet, Budget, requestAllowance, makeClient, consolidate, score, validateReview, completeReviewPartitions, completeReviewEvidence, reviewRequest } = require('../scripts/eval_consolidation_matched');
const core = loadExperimentCore(blockText(readPage(), CORE_SCRIPT_PATTERN));
const { noCacheCost, aggregate, buildReport } = require('../scripts/report_consolidation_matched');

test('matched experiment sends production consolidation/scoring requests and produces identical rows', async () => {
    const thread = { title: 'Workweek', comments: [
        { id: 1, author: 'a', text: 'Adopt four days.', parentId: null, depth: 0 },
        { id: 2, author: 'b', text: 'Keep five days.', parentId: null, depth: 0 }
    ] };
    const axis = { statementA: 'Adopt a four-day workweek.', statementB: 'Keep a five-day workweek.' };
    const candidates = [{ ...axis, commentsA: [1], commentsB: [2] }];
    const jsonFor = call => call.stage === 'extract' ? { candidates }
        : call.stage === 'consolidate' ? { axes: [axis] }
        : call.stage === 'score' ? { stances: [
            { comment: 1, axis: 1, stance: call.meta.swapPoles ? 'B' : 'A' },
            { comment: 2, axis: 1, stance: call.meta.swapPoles ? 'A' : 'B' }
        ] } : { sections: [{ text: 'The commenters disagree[[axis:1]].', axisIds: [1] }], caveats: [] };
    for (const key of MODELS) {
        const productionCalls = [], experimentCalls = [];
        const config = { ...core.DEFAULT_CONFIG, ...core.buildStageConfig('lunaLow', key), concurrency: 10 };
        const response = call => ({ json: jsonFor(call), usage: { cost: 0 } });
        const production = await core.runPipeline({ thread, config, onProgress() {}, callChat: async call => {
            if (['consolidate', 'score'].includes(call.stage)) productionCalls.push(JSON.parse(JSON.stringify(call)));
            return response(call);
        } });
        const client = { call: async call => { experimentCalls.push(JSON.parse(JSON.stringify(call))); return response(call); } };
        const item = { thread, candidates };
        const consolidated = await consolidate(core, client, item, config);
        const scored = await score(core, client, item, consolidated.axes, config);
        assert.deepEqual(experimentCalls, productionCalls);
        assert.deepEqual(scored.rows, production.rows);
        assert.equal(scored.twoSided, 1);
    }
});

test('budget reserves in-flight ceilings before calls can overspend', () => {
    const budget = new Budget(1, 0.2);
    const settle = budget.reserve(0.6);
    assert.throws(() => budget.reserve(0.3), /Budget stop/);
    settle(0.1);
    assert.ok(Math.abs(budget.spent - 0.3) < 1e-12);
    assert.equal(budget.reserved, 0);
    assert.throws(() => budget.reserve(NaN), /Budget stop/);
    const allowance = requestAllowance({ model: 'm', messages: [], schema: {}, maxTokens: 10 },
        { m: { prompt: 0.01, input_cache_write: 0.02, completion: 0.03 } });
    assert.ok(allowance >= 4096 * 0.02 + 10 * 0.03);
});

test('paid trace replays across restarts without another API request; uncertain billing blocks restart', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let calls = 0;
    const fakeCore = { callOpenRouter: async () => { calls++; return { json: { ok: true }, usage: { cost: 0.1 } }; } };
    const prices = { m: { prompt: 0.000001, completion: 0.000001 } };
    const call = { stage: 'test', model: 'm', messages: [], schema: {}, maxTokens: 100 };
    const client = makeClient(fakeCore, root, prices, 1);
    await Promise.all([client.call(call), client.call(call)]);
    const resumed = makeClient(fakeCore, root, prices, 1);
    await resumed.call(call);
    assert.equal(calls, 1);
    assert.equal(resumed.budget.spent, 0.1);
    fs.writeFileSync(path.join(root, 'traces', 'unknown.json'), JSON.stringify({ status: 'unknown' }));
    assert.throws(() => makeClient(fakeCore, root, prices, 1), /Unresolved paid request/);
});

test('review uses common eligibility and rejects overlapping partitions and invented references', () => {
    const variants = ['V1', 'V2', 'V3', 'V4'].map(label => ({ label, axes: [{ id: 1 }] }));
    const review = { exclusions: [{ candidateId: 3, reason: 'Both poles can be true.' }],
        reviews: variants.map(({ label }) => ({ variant: label, fullyPreservedCandidateIds: [1], partialCandidateIds: [2], missingCandidateIds: [],
            coverageIssues: [{ candidateId: 2, axisIds: [1], explanation: 'A condition is missing.' }], consolidationIssues: [] })) };
    assert.equal(validateReview(review, 3, variants), review);
    const duplicate = structuredClone(review); duplicate.reviews[0].fullyPreservedCandidateIds.push(2);
    assert.throws(() => validateReview(duplicate, 3, variants), /partition/);
    const badAxis = structuredClone(review); badAxis.reviews[0].consolidationIssues.push({ axisIds: [99], candidateIds: [1] });
    assert.throws(() => validateReview(badAxis, 3, variants), /references/);
    const excludedAgain = structuredClone(review); excludedAgain.reviews[0].missingCandidateIds.push(3);
    assert.throws(() => validateReview(excludedAgain, 3, variants), /partition/);
    const missingSol = structuredClone(review); missingSol.reviews.pop();
    assert.throws(() => validateReview(missingSol, 3, variants), /Missing or duplicate variants/);
    const request = reviewRequest(core, { thread: { title: 'Four-way comparison' }, candidates: [] }, variants);
    assert.match(request.messages[0].content, /all 4 anonymous/);
    assert.deepEqual(request.reasoning, { effort: 'medium' });
    assert.equal(request.maxTokens, 64000);
    assert.equal(JSON.parse(request.messages[1].content).variants.length, 4);
    assert.doesNotThrow(() => validateModelSet({ models: MODELS }));
    assert.doesNotThrow(() => validateModelSet({ models: MODELS.slice(0, 4) }));
    assert.throws(() => validateModelSet({ models: MODELS.slice(0, 7) }), /Frozen model set/);
    assert.throws(() => validateModelSet({ models: MODELS.slice(0, 3) }), /Frozen model set/);
});

test('report pools equal source denominators and reprices tokens without cache discounts', () => {
    assert.equal(noCacheCost({ promptTokens: 100, completionTokens: 20, cost: 0.001 }, { prompt: '0.01', completion: '0.1' }), 3);
    assert.throws(() => noCacheCost({ cost: 1 }, {}), /token accounting/);
    const model = aggregate([
        { comments: 100, chars: 10000, axes: 10, twoSided: 8, noCacheCost: 0.1, billed: 0.05, seconds: 10,
            review: { candidates: 12, fullyPreserved: 8, partial: 2, missing: 1, excluded: 1, flaggedAxes: 2 } },
        { comments: 300, chars: 30000, axes: 20, twoSided: 12, noCacheCost: 0.3, billed: 0.1, seconds: 30,
            review: { candidates: 30, fullyPreserved: 24, partial: 2, missing: 2, excluded: 2, flaggedAxes: 3 } }
    ]);
    assert.equal(model.benchmark.costPer1k, 1);
    assert.equal(model.benchmark.secondsPer1k, 100);
    assert.equal(model.benchmark.comments, 400);
    assert.equal(model.benchmark.twoSided, 20);
    assert.equal(model.benchmark.review.fullyPreserved, 32);
    assert.equal(model.benchmark.review.candidates - model.benchmark.review.excluded, 39);
    assert.equal(model.cost.usdPerMillionChars, 10);
    assert.throws(() => buildReport(path.join(os.tmpdir(), 'absent-matched-experiment')), /ENOENT/);
});

test('explicit credit rejection is resumable, while uncertain paid calls stay blocked', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-rejection-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'traces'));
    fs.writeFileSync(path.join(root, 'traces', 'rejected.json'), JSON.stringify({ status: 'unknown', httpStatus: 402, provider: { error: { code: 402 } } }));
    const client = makeClient({}, root, {}, 15);
    assert.equal(client.budget.spent, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'traces', 'rejected.json'))).status, 'rejected');
});

test('evidence completion fills only requested explanations and preserves all grades', async () => {
    const variants = ['V1', 'V2', 'V3', 'V4'].map(label => ({ label, axes: [{ id: 1 }] }));
    const response = { json: { exclusions: [], reviews: variants.map(({ label }) => ({ variant: label,
        fullyPreservedCandidateIds: [1], partialCandidateIds: [], missingCandidateIds: [2],
        coverageIssues: [], consolidationIssues: [] })) } };
    const item = { thread: { title: 'Evidence completion' }, candidates: [{}, {}] };
    const log = [];
    const client = { call: async call => {
        const input = JSON.parse(call.messages[1].content);
        assert.equal(input.gaps.length, 4);
        return { json: { evidence: input.gaps.map(gap => ({ variant: gap.variant, candidateId: gap.candidateId,
            axisIds: [], explanation: 'No output axis represents this separate disagreement.' })) } };
    } };
    const completed = await completeReviewEvidence(core, client, item, variants, response, log);
    assert.equal(log.length, 1);
    for (const [index, result] of completed.json.reviews.entries()) {
        assert.deepEqual(result.fullyPreservedCandidateIds, response.json.reviews[index].fullyPreservedCandidateIds);
        assert.deepEqual(result.missingCandidateIds, response.json.reviews[index].missingCandidateIds);
        assert.equal(result.coverageIssues.length, 1);
        assert.equal(response.json.reviews[index].coverageIssues.length, 0);
    }
    await assert.rejects(() => completeReviewEvidence(core, { call: async () => ({ json: { evidence: [] } }) }, item, variants, response, []), /Incomplete evidence supplement/);
});

test('timeout retry requires verified cancellation and retains the failed attempt in accounting', async () => {
    const item = { thread: { title: 'Timeout accounting' }, candidates: [] };
    const config = { ...core.DEFAULT_CONFIG, ...core.buildStageConfig('lunaLow', 'glm53') };
    const error = Object.assign(new Error('timeout'), { name: 'TimeoutError', usage: { cost: 0.38 }, cancelled: true });
    const calls = [];
    const result = await consolidate(core, { call: async call => {
        calls.push(call);
        if (calls.length === 1) throw error;
        return { json: { axes: [{ statementA: 'Adopt four days.', statementB: 'Keep five days.' }] }, usage: { cost: 0.2 } };
    } }, item, config);
    assert.equal(calls.length, 2);
    assert.equal(result.log.length, 2);
    assert.equal(calls[1].meta.retryOfCancelledRequest, result.log[0]);
    assert.deepEqual(calls[0].messages, calls[1].messages);
    assert.match(result.warnings.join(' '), /failed attempt cost and time included/);
    let unknownCalls = 0;
    await assert.rejects(() => consolidate(core, { call: async () => {
        unknownCalls++; throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    } }, item, config), /timeout/);
    assert.equal(unknownCalls, 1);
});

test('partition supplement fills only unassigned candidates without changing existing grades', async () => {
    const variants = ['V1', 'V2'].map(label => ({ label, axes: [{ id: 1 }] }));
    const item = { thread: { title: 'Missing classification' }, candidates: [
        { statementA: 'Adopt four days.', statementB: 'Keep five days.', commentsA: [1], commentsB: [2] },
        { statementA: 'Allow remote work.', statementB: 'Require office work.', commentsA: [1], commentsB: [2] },
    ] };
    const response = { json: { exclusions: [], reviews: variants.map(({ label }) => ({ variant: label,
        fullyPreservedCandidateIds: [1], partialCandidateIds: [], missingCandidateIds: [],
        coverageIssues: [], consolidationIssues: [] })) } };
    const log = [];
    const result = await completeReviewPartitions(core, { call: async call => {
        const input = JSON.parse(call.messages[1].content);
        assert.deepEqual(input.gaps.map(x => x.candidateId), [2, 2]);
        return { json: { classifications: input.gaps.map((gap, i) => ({ variant: gap.variant, candidateId: gap.candidateId,
            classification: i ? 'fullyPreserved' : 'partial', axisIds: [1], explanation: 'Compared candidate scope with output axis.' })) } };
    } }, item, variants, response, log);
    assert.equal(log.length, 1);
    assert.deepEqual(result.json.reviews[0].fullyPreservedCandidateIds, [1]);
    assert.deepEqual(result.json.reviews[0].partialCandidateIds, [2]);
    assert.deepEqual(result.json.reviews[1].fullyPreservedCandidateIds, [1, 2]);
    assert.deepEqual(result.json.exclusions, response.json.exclusions);
    assert.deepEqual(response.json.reviews[1].fullyPreservedCandidateIds, [1]);
    const conflicting = structuredClone(response); conflicting.json.reviews[0].partialCandidateIds.push(1);
    await assert.rejects(() => completeReviewPartitions(core, { call: async () => { throw new Error('Must not call'); } }, item, variants, conflicting, []), /conflicting candidate classifications/);
    await assert.rejects(() => completeReviewPartitions(core, { call: async () => ({ json: { classifications: [] } }) }, item, variants, response, []), /Incomplete partition supplement/);
});
