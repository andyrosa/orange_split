const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate, astraRequest, sampleFile, spent } = require('../scripts/eval_astra');

test('Astra replay preserves the exact production input/schema/ceiling and only changes model settings', () => {
    const request = { stage: 'synthesize', model: 'baseline', reasoning: null,
        sampling: { temperature: 0.2 }, maxTokens: 16000, schema: { name: 'actual' },
        messages: [{ role: 'user', content: 'frozen evidence' }] };
    const changed = astraRequest({ request });
    assert.equal(changed.messages, request.messages);
    assert.equal(changed.schema, request.schema);
    assert.equal(changed.maxTokens, request.maxTokens);
    assert.equal(changed.model, 'openai/gpt-6-astra');
    assert.deepEqual(changed.reasoning, { effort: 'low' });
    assert.equal(changed.sampling, null);
    assert.equal(request.model, 'baseline');
    assert.notEqual(sampleFile('out', 'synthesize', 1), sampleFile('out', 'synthesize', 2));
});

test('summary evaluation rejects valid JSON with unsupported or misplaced evidence references', () => {
    const summary = { sections: [{ text: 'Disagreement remains[[axis:1]].', axisIds: [1] }], caveats: [] };
    assert.equal(validate('synthesize', summary, [1]).valid, true);
    assert.equal(validate('synthesize', summary, [2]).valid, false);
    assert.equal(validate('synthesize', { ...summary, sections: [{ text: '[[axis:1]]Disagreement remains.', axisIds: [1] }] }, [1]).valid, false);
});

test('summary API regex compatibility does not alter the prompt or production validator', () => {
    const schema = { schema: { properties: { sections: { items: { properties: { text: { pattern: '^(?=x)x$' } } } } } } };
    const request = { stage: 'synthesize', schema, messages: [{ role: 'system', content: 'unchanged strict instructions' }] };
    const actual = astraRequest({ request });
    const pattern = actual.schema.schema.properties.sections.items.properties.text.pattern;
    assert.equal(pattern.includes('(?'), false);
    assert.equal(new RegExp(pattern).test('Supported claim[[axis:1]].'), true);
    assert.equal(new RegExp(pattern).test('Missing citation.'), false);
    assert.equal(actual.messages, request.messages);
    assert.equal(schema.schema.properties.sections.items.properties.text.pattern, '^(?=x)x$');
    const overlong = { sections: [{ text: 'word '.repeat(101) + '[[axis:1]]', axisIds: [1] }], caveats: [] };
    assert.equal(validate('synthesize', overlong, [1]).valid, false);
});

test('budget accounting includes failed paid calls and stops on unresolved or absent billing', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-eval-'));
    t.after(() => {
        for (const file of ['complete.json', 'failed.json', 'unknown.json']) {
            const target = path.join(directory, 'calls', file);
            if (fs.existsSync(target)) fs.unlinkSync(target);
        }
        fs.rmdirSync(path.join(directory, 'calls'));
        fs.rmdirSync(directory);
    });
    fs.mkdirSync(path.join(directory, 'calls'));
    const save = (name, record) => fs.writeFileSync(path.join(directory, 'calls', name), JSON.stringify(record));
    save('complete.json', { status: 'complete', response: { usage: { cost: 0.2 } } });
    save('failed.json', { status: 'failed', error: { usage: { cost: 0.3 } } });
    assert.equal(spent(directory), 0.5);
    save('unknown.json', { status: 'billing-unknown' });
    assert.throws(() => spent(directory), /Unresolved/);
    save('unknown.json', { status: 'complete', response: {} });
    assert.throws(() => spent(directory), /Missing valid billed cost/);
});
