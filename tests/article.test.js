const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');
const core = loadCore();

const parts = [
    ['Alex:', 'background', null], ['Slow development.', 'quotation', 1],
    ['Alex:', 'background', null], ['Slow development.', 'quotation', 1],
    ['Bea:', 'background', null], ['Keep the current pace.', 'quotation', 2],
    ['I favor slowing development.', 'author', 0], ['We should slow down for safety.', 'author', 0],
    ['Cora reportedly opposes a slowdown.', 'paraphrase', 3],
    ['An unidentified voice said to keep going.', 'unresolved', null],
];
const article = core.createArticleSource(parts.map(p => p[0]).join(' '), 'A pasted discussion');
let nextWord = 1;
const preparation = {
    speakers: [{ id: 1, labels: ['Alex'] }, { id: 2, labels: ['Bea'] }, { id: 3, labels: ['Cora'] }],
    passages: parts.map(([text, kind, speakerId]) => {
        const firstWord = nextWord;
        nextWord += text.split(/\s+/).length;
        return { firstWord, lastWord: nextWord - 1, kind, speakerId };
    }),
};
const axis = { statementA: 'Development should slow down.', statementB: 'Development should continue at its current pace.' };
const incompatibleQuestion = { statementA: 'AI is not currently safe.', statementB: 'AI could become safe in the future.' };
const summary = { sections: [{ text: 'The selected voices disagree about slowing development[[axis:1]].', axisIds: [1] }], caveats: ['This is a selected article, not a survey.'] };
function fakeProvider(calls, override) {
    return async call => {
        calls.push(call);
        const custom = override?.(call);
        if (custom !== undefined) return custom;
        let json;
        if (call.stage === 'prepare') json = preparation;
        if (call.stage === 'extract') json = { candidates: [axis, incompatibleQuestion].map(a => ({ ...a, commentsA: [2, 7, 8], commentsB: [6] })) };
        if (call.stage === 'consolidate') json = { axes: [axis, incompatibleQuestion] };
        if (call.stage === 'reviewAxes') json = { decisions: call.meta.axes.map(a => ({ axisId: a.id, valid: a.id === 1, reason: a.id === 1 ? 'Opposite pacing choices.' : 'Both statements can be true.' })) };
        if (call.stage === 'score') json = { stances: call.meta.commentIds.map(id => ({ comment: id, axis: 1, stance: call.meta.swapPoles ? core.flipStance(id === 6 ? 'B' : 'A') : id === 6 ? 'B' : 'A' })) };
        if (call.stage === 'synthesize') json = summary;
        if (call.stage === 'reviewSynthesis') json = { valid: true, reason: '' };
        assert.ok(json, 'Unexpected stage ' + call.stage);
        return { json, usage: { cost: 0.01 } };
    };
}
const run = (callChat, source = article, config = {}) => core.runPipeline({ thread: source, callChat, config, onProgress() {} });
const memoryStore = () => {
    const entries = new Map();
    return { entries, get: key => entries.get(key), set: (key, value) => entries.set(key, value) };
};

test('mixed article pipeline sends axis review to consolidation and evidence review to summary', async () => {
    const calls = [];
    const result = await run(fakeProvider(calls), article, core.buildStageConfig('lunaLow', 'geminiFlash', 'astraLow'));
    assert.ok(result.synthesis);
    for (const stage of ['consolidate', 'reviewAxes']) {
        assert.equal(calls.find(c => c.stage === stage).model, 'google/gemini-3.8-flash');
    }
    for (const stage of ['synthesize', 'reviewSynthesis']) {
        assert.equal(calls.find(c => c.stage === stage).model, 'openai/gpt-6-astra');
        assert.deepEqual(calls.find(c => c.stage === stage).reasoning, { effort: 'low' });
    }
});

test('Astra selector settings reach article axis review, summary, and evidence review', async () => {
    const calls = [];
    const result = await run(fakeProvider(calls), article, core.buildStageConfig('lunaLow', 'astraLow'));
    assert.ok(result.synthesis);
    for (const stage of ['consolidate', 'reviewAxes', 'synthesize', 'reviewSynthesis']) {
        const call = calls.find(call => call.stage === stage);
        assert.equal(call.model, 'openai/gpt-6-astra', stage);
        assert.deepEqual(call.reasoning, { effort: 'low' }, stage);
    }
    for (const stage of ['prepare', 'extract', 'score']) {
        assert.equal(calls.find(call => call.stage === stage).model, 'openai/gpt-5.6-luna', stage);
    }
});

test('article identity is based on full content and title, and preserves literal markup', () => {
    assert.equal(core.createArticleSource('a\r\nb').id, core.createArticleSource('a\nb').id);
    assert.notEqual(article.id, core.createArticleSource(article.text + ' Changed.', article.title).id);
    assert.notEqual(article.id, core.createArticleSource(article.text, 'Changed').id);
    assert.equal(core.createArticleSource('<script>literal</script>').text, '<script>literal</script>');
    assert.throws(() => core.createArticleSource(' '), /Paste/);
    assert.throws(() => core.createArticleSource('x'.repeat(core.ARTICLE_MAX_CHARS + 1)), /Nothing has been analyzed or truncated/);
    assert.equal(core.sourceFromSnapshot({ source: article }).id, article.id);
});

test('preparation covers unformatted input exactly and separates voices, paraphrases and duplicates', () => {
    const parsed = core.parseArticlePreparation(preparation, article);
    assert.equal(parsed.article.coverage, 'complete');
    assert.equal(parsed.article.passages[3].duplicateOf, 2);
    assert.deepEqual(parsed.comments.map(c => c.id), [2, 6, 7, 8]);
    assert.equal(new Set(parsed.comments.map(c => c.author)).size, 3);
    assert.equal(parsed.comments[2].author, parsed.comments[3].author, 'author paragraphs are one person');
    for (const passage of parsed.article.passages) assert.equal(article.text.slice(passage.start, passage.end), passage.text);
});

test('preparation rejects invented text/identities, omitted coverage and ambiguous counted speakers', () => {
    const cases = [
        json => { json.passages.splice(2, 1); },
        json => { json.passages[1].lastWord = 100000; },
        json => { json.passages.pop(); },
        json => { json.speakers[0].labels = ['Invented person']; },
        json => { json.speakers[1].labels = ['Alex']; },
        json => { json.passages[1].speakerId = null; },
        json => { json.passages[6].speakerId = 1; },
        json => { json.passages[9].speakerId = 1; },
    ];
    for (const mutate of cases) {
        const json = structuredClone(preparation);
        mutate(json);
        assert.throws(() => core.parseArticlePreparation(json, article), core.InvalidResponseError);
    }
});

test('case-equivalent aliases for the same speaker are harmless', () => {
    const json = structuredClone(preparation);
    json.speakers[0].labels.push('Alex');
    assert.equal(core.parseArticlePreparation(json, article).comments.length, 4);
});

test('article pipeline counts people once, rejects compatible axes, and reviews the summary', async () => {
    const calls = [];
    const result = await run(fakeProvider(calls));
    assert.deepEqual(result.rows.map(row => [row.countA, row.countB, row.countM, row.countC]), [[2, 1, 0, 0]]);
    assert.equal(result.stats.authors, 3);
    assert.equal(result.stats.comments, 4);
    assert.equal(result.article.text, article.text);
    assert.equal(result.synthesisError, null);
    assert.match(result.warnings.join('\n'), /Removed comparison 2.*Both statements can be true/);
    assert.ok(calls.some(c => c.stage === 'reviewSynthesis'));
    for (const call of calls.filter(c => c.stage === 'score')) {
        assert.equal(call.meta.presentedAxes.length, 1);
        assert.match(call.messages[0].content, /Article mode/);
        assert.doesNotMatch(call.messages[1].content, /Cora|unidentified voice/);
    }
});

test('all article stages cache and probe without making calls; changed text misses preparation', async () => {
    const calls = [], store = memoryStore();
    const cached = core.makeCachedCallChat(fakeProvider(calls), store);
    const first = await run(cached);
    const paidCalls = calls.length;
    const second = await run(cached);
    assert.equal(second.cost, 0);
    assert.equal(calls.length, paidCalls);
    assert.equal(second.stats.cachedCalls, second.calls);
    assert.deepEqual(first.rows, second.rows);
    const probe = await core.probeCache({ thread: article, store });
    assert.equal(probe.complete, true);
    assert.deepEqual(probe.stages.map(s => s.stage), ['prepare', 'extract', 'consolidate', 'reviewAxes', 'score', 'synthesize', 'reviewSynthesis']);
    const changed = await core.probeCache({ thread: core.createArticleSource(article.text + ' Extra text.'), store });
    assert.equal(changed.complete, false);
    assert.deepEqual(changed.stages, [{ stage: 'prepare', hits: 0, total: 1 }]);
});

test('a summary claiming nonexistent opposition is repaired and audited again, with no rescoring', async () => {
    const calls = [];
    const repairedText = 'A corrected description of the supported views[[axis:1]].';
    const result = await run(fakeProvider(calls, call => {
        if (call.stage === 'reviewSynthesis') {
            const prior = calls.filter(c => c.stage === 'reviewSynthesis').length;
            return { json: { valid: prior > 1, reason: 'Do not claim opposing voices where the count is zero.' }, usage: { cost: 0.01 } };
        }
        if (call.stage === 'synthesize' && call.meta.evidenceRevision) return { json: { ...summary, sections: [{ text: repairedText, axisIds: [1] }] }, usage: { cost: 0.01 } };
    }));
    assert.equal(result.synthesis.sections[0].text, repairedText);
    assert.equal(calls.filter(c => c.stage === 'synthesize').length, 2);
    assert.equal(calls.filter(c => c.stage === 'score').length, 2);
    assert.equal(calls.filter(c => c.stage === 'reviewSynthesis').length, 2);
});

test('repeated summary review failure preserves counts and hides rejected prose', async () => {
    const calls = [];
    const result = await run(fakeProvider(calls, call => call.stage === 'reviewSynthesis' ? { json: { valid: false, reason: 'Invented opposition' }, usage: { cost: 0.01 } } : undefined));
    assert.equal(result.synthesis, null);
    assert.match(result.synthesisError, /Invented opposition/);
    assert.equal(result.rows.length, 1);
    assert.equal(calls.filter(c => c.stage === 'synthesize').length, 2);
});

test('preparation repair is paid once and replayed; missing coverage cannot be silently accepted', async () => {
    const calls = [], store = memoryStore();
    const cached = core.makeCachedCallChat(fakeProvider(calls, call => {
        if (call.stage === 'prepare' && !call.meta.formatRepair) return { json: { ...preparation, passages: preparation.passages.slice(0, -1) }, usage: { cost: 0.01 } };
    }), store);
    const result = await run(cached);
    assert.equal(calls.filter(c => c.stage === 'prepare').length, 2);
    assert.equal(result.article.coverage, 'complete');
    const count = calls.length;
    assert.equal((await run(cached)).cost, 0);
    assert.equal(calls.length, count);
});

test('rejected semantic revisions are retried without paying for earlier stages or original prose', async () => {
    const calls = [], store = memoryStore();
    let fixed = false;
    const cached = core.makeCachedCallChat(fakeProvider(calls, call => {
        if (call.stage === 'reviewSynthesis') return { json: { valid: fixed && call.messages[1].content.includes('Corrected wording'), reason: 'Unsupported opposition' }, usage: { cost: 0.01 } };
        if (call.stage === 'synthesize' && call.meta.evidenceRevision && fixed) return { json: { ...summary, sections: [{ text: 'Corrected wording about the positions[[axis:1]].', axisIds: [1] }] }, usage: { cost: 0.01 } };
    }), store);
    assert.equal((await run(cached)).synthesis, null);
    assert.equal((await core.probeCache({ thread: article, store })).complete, false);
    const paid = calls.length;
    fixed = true;
    assert.ok((await run(cached)).synthesis);
    assert.deepEqual(calls.slice(paid).map(c => c.stage), ['synthesize', 'reviewSynthesis']);
    assert.equal(calls.slice(paid)[0].meta.evidenceRevision, true);
    assert.equal((await core.probeCache({ thread: article, store })).complete, true);
});

test('preparation shares budget, cancellation and unknown-billing safeguards', async () => {
    const calls = [];
    await assert.rejects(run(fakeProvider(calls), article, { budgetUsd: 0.005 }), /Budget/);
    assert.equal(calls.length, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(core.runPipeline({ thread: article, callChat: fakeProvider([]), onProgress() {}, signal: controller.signal }), /Cancelled/);
    await assert.rejects(run(async () => ({ json: preparation, usage: {} })), /cost.*unknown/i);
});

test('an article with no attributable claims finishes with explicit complete coverage', async () => {
    const source = core.createArticleSource('A neutral heading');
    const calls = [];
    const result = await run(fakeProvider(calls, call => call.stage === 'prepare' ? { json: { speakers: [], passages: [{ firstWord: 1, lastWord: 3, kind: 'background', speakerId: null }] }, usage: { cost: 0.01 } } : undefined), source);
    assert.equal(calls.length, 1);
    assert.equal(result.rows.length, 0);
    assert.equal(result.article.coverage, 'complete');
    assert.match(result.warnings.join(' '), /no directly attributable/);
    assert.match(result.emptyReason, /Comparison analysis did not run/);
    assert.match(result.emptyReason, /does not establish that the text contains no comparisons/);
});

// Public-domain speech, without a character label, from the RSC's Act 3 Scene 1 extract:
// https://www.rsc.org.uk/shakespeare-learning-zone/hamlet/language/to-be-or-not-to-be
test('a standalone soliloquy can retain a deliberated comparison as one middle voice', async () => {
    const fs = require('node:fs');
    const source = core.createArticleSource(fs.readFileSync(require.resolve('./fixtures/hamlet-soliloquy.txt'), 'utf8'));
    const choice = { statementA: 'Continuing to live with suffering is preferable to dying.', statementB: 'Dying is preferable to continuing to live with suffering.' };
    const calls = [];
    const result = await run(fakeProvider(calls, call => {
        if (call.stage === 'prepare') return { json: { speakers: [], passages: [
            { firstWord: 1, lastWord: source.text.match(/\S+/g).length, kind: 'author', speakerId: 0 },
        ] }, usage: { cost: 0.01 } };
        if (call.stage === 'extract') return { json: { candidates: [{ ...choice, commentsA: [], commentsB: [] }] }, usage: { cost: 0.01 } };
        if (call.stage === 'consolidate') return { json: { axes: [choice] }, usage: { cost: 0.01 } };
        if (call.stage === 'score') return { json: { stances: [{ comment: 1, axis: 1, stance: 'M' }] }, usage: { cost: 0.01 } };
        if (call.stage === 'synthesize') return { json: { sections: [{ text: 'The speaker weighs continuing to suffer against dying, with uncertainty about death preventing a settled choice[[axis:1]].', axisIds: [1] }], caveats: [] }, usage: { cost: 0.01 } };
    }), source);
    assert.equal(result.article.coverage, 'complete');
    assert.equal(result.comments[0].text, source.text);
    assert.equal(result.stats.authors, 1);
    assert.deepEqual(result.article.speakers, [], 'no identity invented from recognition');
    assert.deepEqual(result.rows.map(row => [row.countA, row.countB, row.countM, row.countC]), [[0, 0, 1, 0]]);
    assert.ok(result.synthesis);
    assert.match(calls.find(c => c.stage === 'extract').messages[0].content, /leave commentsA and commentsB empty/);
    assert.match(calls.find(c => c.stage === 'consolidate').messages[1].content, /nA=0, nB=0/);
    const synthesisContext = JSON.parse(calls.find(c => c.stage === 'synthesize').messages[1].content);
    assert.equal(synthesisContext.axes[0].observedOpposition, false);
    assert.equal(synthesisContext.passages[0].text, source.text);
});

test('an embedded anonymous report is still excluded and explains the missing comparison analysis', async () => {
    const source = core.createArticleSource('An unidentified person said, "Continuing is preferable to stopping."');
    const calls = [];
    const result = await run(fakeProvider(calls, call => call.stage === 'prepare' ? { json: {
        speakers: [], passages: [{ firstWord: 1, lastWord: source.text.match(/\S+/g).length, kind: 'unresolved', speakerId: null }],
    }, usage: { cost: 0.01 } } : undefined), source);
    assert.deepEqual(calls.map(c => c.stage), ['prepare']);
    assert.equal(result.comments.length, 0);
    assert.equal(result.article.passages[0].kind, 'unresolved');
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.every(w => typeof w === 'string' && w.trim()));
    assert.match(result.emptyReason, /attribution step/);
});

test('updated article attribution misses old responses without invalidating HN result keys', async () => {
    const source = core.createArticleSource('A standalone speech.');
    const currentMessages = core.buildArticlePrepareMessages(source);
    assert.match(currentMessages[0].content, /Article attribution v3/);
    assert.match(currentMessages[0].content, /standalone poem, monologue or soliloquy/);
    assert.match(currentMessages[0].content, /keep those unresolved/);
    const calls = [], store = memoryStore();
    await run(fakeProvider(calls, call => call.stage === 'prepare' ? { json: {
        speakers: [], passages: [{ firstWord: 1, lastWord: 3, kind: 'background', speakerId: null }],
    }, usage: { cost: 0.01 } } : undefined), source);
    const call = calls[0];
    const previousCall = { ...call, messages: currentMessages.map(m => ({ ...m, content: m.content.replace('Article attribution v3', 'Article attribution v2') })) };
    store.set(core.requestCacheKey(previousCall), { json: { speakers: [], passages: [] }, usage: { cost: 0.01 } });
    const probe = await core.probeCache({ thread: source, store });
    assert.equal(probe.complete, false);
    assert.deepEqual(probe.stages, [{ stage: 'prepare', hits: 0, total: 1 }]);
    const selection = { article: source.id, snapshot: '2026-09-12T08:00:00.000Z', share: 100, volume: 'lunaLow', consolidation: 'sonnet5', budget: 1 };
    assert.match(core.runResultCacheKey(selection), /&articleAnalysis=2$/);
    assert.equal(core.runResultCacheKey({ ...selection, article: 123 }), 'article=123&snapshot=2026-09-12T08%3A00%3A00.000Z&share=100&volume=lunaLow&consolidation=sonnet5&budget=1');
    assert.ok(!core.makeRunPageUrl('https://example.test/', selection).includes('articleAnalysis'));
});

test('a single-author essay counts one voice across multiple supporting passages', async () => {
    const source = core.createArticleSource('I support slowing development. Safety work needs time.');
    const result = await run(fakeProvider([], call => {
        if (call.stage === 'prepare') return { json: { speakers: [], passages: [
            { firstWord: 1, lastWord: 4, kind: 'author', speakerId: 0 },
            { firstWord: 5, lastWord: 8, kind: 'author', speakerId: 0 },
        ] }, usage: { cost: 0.01 } };
        if (call.stage === 'synthesize') return { json: { sections: [{ text: 'The author supports slowing development to allow safety work[[axis:1]].', axisIds: [1] }], caveats: [] }, usage: { cost: 0.01 } };
    }), source);
    assert.equal(result.stats.authors, 1);
    assert.equal(result.stats.comments, 2);
    assert.deepEqual([result.rows[0].countA, result.rows[0].countB], [1, 0]);
});

test('pasted article URLs and cache exports round trip without putting source text into the URL', () => {
    const selection = { article: article.id, snapshot: '2026-09-12T08:00:00.000Z', share: 100, volume: core.DEFAULT_VOLUME_KEY, consolidation: core.DEFAULT_CONSOLIDATION_KEY, budget: 1 };
    const url = core.makeRunPageUrl('https://example.test/', selection);
    assert.deepEqual(core.parseRunPageUrl(url), { ...selection, summary: selection.consolidation });
    assert.ok(!url.includes('Alex'));
    assert.equal(core.parseRunPageUrl(url.replace('share=100', 'share=50')), null);
    const entries = { [core.CONSTANTS.THREAD_KEY_PREFIX + article.id]: { fetchedAt: selection.snapshot, source: article } };
    const restored = core.parseCacheExport(JSON.stringify({ entries }));
    assert.equal(core.sourceFromSnapshot(Object.values(restored.entries)[0]).text, article.text);
});

test('article forecasts include preparation and both reviews', () => {
    const estimate = core.estimateSourceRun(article, core.DEFAULT_VOLUME_KEY, core.DEFAULT_CONSOLIDATION_KEY);
    const hn = core.estimateSourceRun({ comments: [{ text: article.text }] }, core.DEFAULT_VOLUME_KEY, core.DEFAULT_CONSOLIDATION_KEY);
    assert.ok(estimate.usd > hn.usd && estimate.seconds > hn.seconds);
});
