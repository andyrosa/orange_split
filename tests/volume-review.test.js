const test = require('node:test');
const assert = require('node:assert/strict');
const { population, selectSample, makeCases, reviewRequest, validateReview, normalizeReviewQuotes, aggregate } = require('../scripts/eval_volume_review');
const thread = { title: 'A choice', comments: [
    { id: 1, parentId: null, author: 'private-name', text: 'I prefer A.' },
    { id: 2, parentId: 1, author: 'another-name', text: 'I prefer B.' },
] };
const result = { rows: [{ axisId: 1, statementA: 'Choose A', statementB: 'Choose B', commentIdsA: [1], commentIdsB: [2], commentIdsM: [], commentIdsC: [] }] };

test('review selection is reproducible, bounded and includes only agreed reported stance pairs', () => {
    assert.equal(population(result).length, 2);
    assert.deepEqual(selectSample(result, 'geminiFlash', 1), selectSample(result, 'geminiFlash', 1));
    assert.equal(selectSample(result, 'geminiFlash', 1).length, 1);
    assert.equal(selectSample(result, 'geminiFlash', 100).length, 2);
    assert.throws(() => population({ rows: [{ ...result.rows[0], commentIdsB: [1] }] }), /Duplicate/);
});

test('blind review hides models, proposed stances and author names while retaining full parent context', () => {
    const sample = selectSample(result, 'geminiFlash');
    const selected = makeCases(thread, { geminiFlash: sample, glmFlash: sample });
    assert.equal(selected.cases.length, 2, 'shared cases receive one common judgment');
    const request = reviewRequest(thread, selected.cases), payload = JSON.parse(request.messages[1].content);
    assert.equal(payload.cases.find(c => c.comment.id === 2).ancestors[0].text, 'I prefer A.');
    assert.doesNotMatch(request.messages[1].content, /geminiFlash|glmFlash|private-name|another-name|"stance"/);
});

test('review validation rejects missing cases and fabricated supporting quotations', () => {
    const selected = makeCases(thread, { geminiFlash: selectSample(result, 'geminiFlash') });
    const response = { judgments: selected.cases.map(c => ({ caseId: c.caseId, stance: c.comment.id === 1 ? 'A' : 'B', quote: c.comment.text, explanation: 'Explicit preference' })) };
    validateReview(response, selected.cases);
    assert.throws(() => validateReview({ judgments: response.judgments.slice(1) }, selected.cases), /Missing/);
    const bad = structuredClone(response); bad.judgments[0].quote = 'Invented words';
    assert.throws(() => validateReview(bad, selected.cases), /quote must come from/);
    bad.judgments[0].quote = ''; bad.judgments[0].stance = 'U'; validateReview(bad, selected.cases);
});

test('held, wrong and unclear use the entire sampled denominator without treating ambiguity as wrong', () => {
    const mapping = { geminiFlash: [{ caseId: 'a', stance: 'A' }, { caseId: 'b', stance: 'B' }, { caseId: 'c', stance: 'M' }] };
    const result = aggregate(mapping, [{ caseId: 'a', stance: 'A' }, { caseId: 'b', stance: 'N' }, { caseId: 'c', stance: 'U' }]).geminiFlash;
    assert.deepEqual([result.held, result.wrong, result.unclear], [1, 1, 1]);
    assert.equal(result.reviewHeldPercent, 100 / 3);
    assert.equal(result.reviewWrongPercent, 100 / 3);
    assert.throws(() => aggregate(mapping, []), /Missing/);
});

test('quote normalization restores only source typography and preserves the original judgment', () => {
    const cases = [{ caseId: 'a', comment: { text: 'It’s likely.' } }];
    const original = { judgments: [{ caseId: 'a', stance: 'A', quote: "It's likely.", explanation: 'Explicit claim' }] };
    const result = normalizeReviewQuotes(original, cases);
    validateReview(result.review, cases);
    assert.equal(original.judgments[0].quote, "It's likely.");
    assert.equal(result.review.judgments[0].quote, 'It’s likely.');
    assert.equal(result.review.judgments[0].stance, 'A');
    assert.equal(result.changes.length, 1);
    original.judgments[0].quote = "It's impossible.";
    assert.throws(() => validateReview(normalizeReviewQuotes(original, cases).review, cases), /quote must come from/);
});
