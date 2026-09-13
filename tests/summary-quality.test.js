const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, validateCandidate, validateReview } = require('../scripts/eval_summary_quality');
const { loadCore } = require('../scripts/load_core');
const grade = (variant, value, issues = []) => ({ variant, faithfulness: value, coverage: value, clarity: value, issues, omissions: [], rationale: 'Evidence based.' });
function reviews(a, s, major = false) {
    return [0, 1].map(repeat => ({ id: '1', repeat, mapping: repeat ? { V1: 'sonnet', V2: 'astra' } : { V1: 'astra', V2: 'sonnet' },
        response: { json: { grades: [grade(repeat ? 'V2' : 'V1', a, major ? [{ severity: 'major' }] : []), grade(repeat ? 'V1' : 'V2', s)] } } }));
}
test('summary rank uses absolute scores, tolerates order reversal and ties close results', () => {
    const tied = aggregate(reviews(90, 86));
    assert.equal(tied.models.astra.rank, 1); assert.equal(tied.models.sonnet.rank, 1);
    assert.equal(tied.models.astra.tied, true); assert.equal(tied.threads, 1);
    const clear = aggregate(reviews(90, 80));
    assert.equal(clear.models.astra.rank, 1); assert.equal(clear.models.sonnet.rank, 2);
    assert.equal(aggregate(reviews(80, 90)).models.sonnet.rank, 1);
});
test('major support errors withhold ranking regardless of aggregate score', () => {
    const result = aggregate(reviews(95, 80, true));
    assert.equal(result.models.astra.rank, null); assert.equal(result.models.sonnet.rank, 1);
    const both = reviews(95, 80, true);
    both[0].response.json.grades[1].issues.push({ severity: 'major' });
    assert.equal(aggregate(both).models.sonnet.rank, null);
});
test('partial and duplicated evaluation passes cannot produce ranks', () => {
    assert.throws(() => aggregate(reviews(90, 80).slice(0, 1)), /Incomplete/);
    assert.throws(() => aggregate([reviews(90, 80)[0], reviews(90, 80)[0]]), /Duplicate/);
    const bad = reviews(90, 80); bad[1].repeat = 2;
    assert.throws(() => aggregate(bad), /Unknown repeat/);
});
test('only the agreed candidate and volume model settings can enter this evaluation', () => {
    const core = loadCore();
    const astra = core.buildStageConfig('lunaLow', 'astraLow');
    assert.doesNotThrow(() => validateCandidate(astra, 'astra'));
    assert.doesNotThrow(() => validateCandidate(core.buildStageConfig('lunaLow', 'sonnet5'), 'sonnet'));
    assert.throws(() => validateCandidate({ ...astra, reasoningSynthesize: { effort: 'high' } }, 'astra'), /Candidate/);
    assert.throws(() => validateCandidate({ ...astra, modelScore: 'some-other-model' }, 'astra'), /Volume/);
});
test('review validation rejects invented evidence, invented quotations and contradictory grades', () => {
    const item = { thread: { comments: [{ id: 1 }] } };
    const variants = ['V1', 'V2'].map(label => ({ label, summary: { sections: [{ text: 'A supported claim.' }], caveats: [] } }));
    const base = () => ({ themes: [{ point: 'Theme', commentIds: [1] }], grades: [grade('V1', 90), grade('V2', 85)] });
    assert.doesNotThrow(() => validateReview(base(), item, variants));
    let bad = base(); bad.themes[0].commentIds = [2];
    assert.throws(() => validateReview(bad, item, variants), /Unknown comment/);
    bad = base(); bad.grades[0].issues = [{ severity: 'minor', claim: 'Invented quote', commentIds: [1] }];
    assert.throws(() => validateReview(bad, item, variants), /actual summary/);
    bad.grades[0].issues[0] = { severity: 'major', claim: 'A supported claim.', commentIds: [1] };
    assert.throws(() => validateReview(bad, item, variants), /conflicts/);
});
