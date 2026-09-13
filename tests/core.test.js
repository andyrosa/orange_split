// Unit and integration tests for the core script block of hn_polarization.html.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');

const FLOAT_TOLERANCE = 0.001;

const core = loadCore();

test('minimum-comment arrows double or halve with whole-number bounds', () => {
    let value = 100;
    for (const expected of [200, 400, 800]) {
        value = core.stepMinComments(value, 'up');
        assert.equal(value, expected);
    }
    value = 100;
    for (const expected of [50, 25, 12, 6, 3, 1, 0, 0]) {
        value = core.stepMinComments(value, 'down');
        assert.equal(value, expected);
    }
    for (const value of ['', '0', -1, 'invalid', NaN, Infinity, -Infinity]) {
        assert.equal(core.stepMinComments(value, 'up'), 1);
        assert.equal(core.stepMinComments(value, 'down'), 0);
    }
    assert.equal(core.stepMinComments('137', 'up'), 274);
    assert.equal(core.stepMinComments('137', 'down'), 68);
    assert.equal(core.stepMinComments('25.75', 'up'), 51);
    assert.equal(core.stepMinComments('25.75', 'down'), 12);
    for (const value of [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, '1e300']) {
        assert.equal(core.stepMinComments(value, 'up'), Number.MAX_SAFE_INTEGER);
        assert.ok(Number.isSafeInteger(core.stepMinComments(value, 'down')));
    }
});

test('minimum-comment input and buttons refresh both story sources without changing typed values or storage', () => {
    const source = require('node:fs').readFileSync(require.resolve('../hn_polarization.html'), 'utf8');
    class Control extends EventTarget {
        constructor(value = '') { super(); this.value = value; this.hidden = true; }
    }
    const elements = {
        minComments: new Control(), minCommentsUp: new Control(), minCommentsDown: new Control(),
        threadId: new Control(), storyList: new Control(),
    };
    const stories = [0, 25, 50, 100, 137, 200, 400].map(numComments => ({ title: 'Example story', numComments }));
    let visible = [];
    let refreshes = 0;
    const sandbox = {
        elements, Event, stepMinComments: core.stepMinComments, isThreadId: core.isThreadId,
        homePageStories: stories, lastSearch: { text: 'Example', stories },
        storyScope: 'front', articleModeSelected: false, searchLatest: { cancel() {} },
        SEARCH_MIN_CHARS: 3, HEADER_HOME_PAGE: 'Front page', searchHeader: () => 'Search',
        closeList() { elements.storyList.hidden = true; },
        showList(rows) {
            refreshes += 1;
            visible = Array.from(sandbox.storiesAboveMinComments(rows), story => story.numComments);
            elements.storyList.hidden = false;
        },
        localStorage: new Proxy({}, { get() { throw new Error('Threshold must not access storage'); } }),
        fetch() { throw new Error('No network requests in this test'); },
    };
    const vm = require('node:vm');
    for (const [start, end] of [
        ['function positiveNumberInBox(', 'function maxCostInBox('],
        ['const DEFAULT_MIN_COMMENTS =', '// The thread id the box currently denotes'],
        ['function refreshList(', 'function selectStoryScope('],
    ]) {
        const offset = source.indexOf(start);
        assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
        vm.runInNewContext(source.slice(offset, source.indexOf(end, offset)), sandbox);
    }
    assert.match(source, /\ninitializeMinComments\(\);/);
    sandbox.initializeMinComments();
    assert.equal(elements.minComments.value, 100);
    const press = key => {
        const event = new Event('keydown', { cancelable: true });
        Object.defineProperty(event, 'key', { value: key });
        elements.minComments.dispatchEvent(event);
        return event.defaultPrevented;
    };
    for (const scope of ['front', 'search']) {
        sandbox.storyScope = scope;
        elements.threadId.value = scope === 'search' ? 'Example' : '';
        elements.minComments.value = '100';
        assert.equal(press('ArrowUp'), true);
        assert.equal(Number(elements.minComments.value), 200);
        assert.deepEqual(visible, [200, 400]);
        elements.minCommentsUp.dispatchEvent(new Event('click'));
        assert.equal(Number(elements.minComments.value), 400);
        assert.deepEqual(visible, [400]);
        elements.minCommentsDown.dispatchEvent(new Event('click'));
        assert.equal(Number(elements.minComments.value), 200);
        assert.equal(press('ArrowDown'), true);
        assert.equal(Number(elements.minComments.value), 100);
        assert.deepEqual(visible, [100, 137, 200, 400]);
        for (const value of ['137', '25.75', '', '0', '1e300']) {
            elements.minComments.value = value;
            const before = refreshes;
            elements.minComments.dispatchEvent(new Event('input'));
            assert.equal(elements.minComments.value, value, 'typing must not be quantized');
            assert.equal(refreshes, before + 1);
            assert.deepEqual(visible, stories.filter(story => story.numComments >= Number(value)).map(story => story.numComments));
        }
        elements.minComments.value = '';
        assert.equal(press('ArrowUp'), true);
        assert.equal(Number(elements.minComments.value), 1);
        elements.minCommentsDown.dispatchEvent(new Event('click'));
        assert.equal(Number(elements.minComments.value), 0);
        elements.minCommentsDown.dispatchEvent(new Event('click'));
        assert.equal(Number(elements.minComments.value), 0);
        const before = refreshes;
        for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']) assert.equal(press(key), false);
        assert.equal(refreshes, before);
        assert.equal(press('Escape'), false);
        assert.equal(elements.storyList.hidden, true);
        for (const control of [elements.minComments, elements.minCommentsUp, elements.minCommentsDown]) {
            elements.storyList.hidden = false;
            control.dispatchEvent(new Event('blur'));
            assert.equal(elements.storyList.hidden, true);
        }
    }
    assert.match(source, /#min-comments \{[^}]*appearance: textfield/);
    assert.match(source, /#min-comments::-webkit-inner-spin-button[^}]*-webkit-appearance: none/);
    assert.match(source, /<input id="min-comments"[^>]*step="any"[^>]*aria-describedby="min-comments-help"/);
    for (const [direction, label] of [['up', 'Double'], ['down', 'Halve']]) {
        assert.match(source, new RegExp(`<button id="min-comments-${direction}" type="button" aria-label="${label} minimum comments" aria-controls="min-comments"`));
    }
});

function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) < FLOAT_TOLERANCE, `${label}: expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// Toy fixture: "Ember opens downtown", 12 comments, 12 authors.
// ---------------------------------------------------------------------------

function toyComment(id, author, text, children) {
    return { id, author, text, type: 'comment', children: children || [] };
}

const TOY_THREAD = {
    id: 100, type: 'story', title: 'Ember opens downtown', url: 'https://example.com/ember', author: 'op', text: null,
    children: [
        toyComment(1, 'alice', 'Portions are tiny for $30 a plate. Not worth it.', [
            toyComment(2, 'bob', 'Tiny? I could not finish mine. Generous for the price.', [
                toyComment(3, 'carol', 'Agree, portions fine. But the noise made talking impossible.', [
                    toyComment(4, 'dave', 'Noise was not bad at 6pm. Go earlier.')])])]),
        toyComment(5, 'erin', 'Tasting menu is the best value in town. Parking is a nightmare.', [
            toyComment(6, 'frank', 'Value? $120 for six small courses is a ripoff.', [
                toyComment(7, 'grace', 'Depends what you compare to. Same as other tasting menus here.')])]),
        toyComment(8, 'hank', 'Service was slow, 40 minutes for mains.', [
            toyComment(9, 'ivy', 'Same, slow kitchen.'),
            toyComment(10, 'jack', 'Opening week, it will settle.')]),
        toyComment(11, 'kim', 'Parking is fine, garage two blocks away.'),
        toyComment(12, 'leo', 'Loved the decor. Prices are steep though.'),
    ],
};

// Small batches so the toy thread exercises batching, splitting, and concurrency.
const TOY_CONFIG = { extractBatchChars: 800, scoreBatchComments: 5, concurrency: 2 };

const TOY_AXES = [
    { id: 1, statementA: 'Portions are adequate for the price', statementB: 'Portions are too small for the price' },
    { id: 2, statementA: 'The tasting menu is good value', statementB: 'The tasting menu is overpriced' },
    { id: 3, statementA: 'The room is too loud for conversation', statementB: 'The noise level is acceptable' },
    { id: 4, statementA: 'Parking nearby is difficult', statementB: 'Parking nearby is easy' },
    { id: 5, statementA: 'Service is slow', statementB: 'Service speed is acceptable' },
    { id: 6, statementA: 'Slow service is a temporary opening-week issue', statementB: 'Slow service is a structural problem' },
];

// Canonical stances keyed "commentId|axisId".
const TOY_PASS1 = new Map(Object.entries({
    '1|1': 'B', '2|1': 'A', '3|1': 'A', '3|3': 'A', '4|3': 'B',
    '5|2': 'A', '5|4': 'A', '6|2': 'B', '7|2': 'M',
    '8|5': 'A', '9|5': 'A', '10|5': 'M', '10|6': 'A',
    '11|4': 'B', '12|2': 'B',
}));
const TOY_PASS2 = new Map(TOY_PASS1);
TOY_PASS2.delete('12|2');
TOY_PASS2.set('7|2', 'B');

// Order by side A + side B people; middle does not contribute to rank.
const TOY_EXPECTED_ORDER = [1, 4, 5, 3, 2, 6];

// ---------------------------------------------------------------------------
// Stage 0: thread parsing
// ---------------------------------------------------------------------------

test('stripHtml turns <p> into paragraph breaks, strips tags, decodes entities', () => {
    const input = 'First para<p>Second &#x27;quoted&#x27; &amp; <a href="http://x">link</a><p><pre><code>code &gt; 1</code></pre>';
    assert.equal(core.stripHtml(input), "First para\n\nSecond 'quoted' & link\n\ncode > 1");
});

test('stripHtml decodes decimal and named entities', () => {
    assert.equal(core.stripHtml('a &#39;b&#39; &quot;c&quot; &lt;d&gt; &#x2F;'), 'a \'b\' "c" <d> /');
});

test('flattenThread walks depth-first, skips deleted comments, keeps their children, keeps the posting date', () => {
    const tree = {
        id: 1, type: 'story', title: 'T', url: 'u', text: null, created_at: '2026-09-01T00:00:00.000Z',
        children: [
            { id: 10, type: 'comment', author: 'a', text: 'x', children: [
                { id: 11, type: 'comment', author: 'b', text: 'y', children: [
                    { id: 12, type: 'comment', author: null, text: null, children: [
                        { id: 13, type: 'comment', author: 'd', text: 'z', children: [] }] }] }] },
            { id: 20, type: 'comment', author: 'e', text: 'w', children: [] },
        ],
    };
    const thread = core.flattenThread(tree);
    assert.equal(thread.id, 1);
    assert.equal(thread.title, 'T');
    assert.equal(thread.createdAt, '2026-09-01T00:00:00.000Z');
    assert.equal(thread.commentCount, 5);
    assert.deepEqual(thread.comments.map(comment => comment.id), [10, 11, 13, 20]);
    assert.deepEqual(thread.comments.map(comment => comment.parentId), [1, 10, 12, 1]);
    assert.deepEqual(thread.comments.map(comment => comment.depth), [0, 1, 3, 0]);
    assert.deepEqual(thread.comments.map(comment => comment.author), ['a', 'b', 'd', 'e']);
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

function fakeComment(id, depth, textChars) {
    return { id, author: 'u' + id, parentId: 0, depth, text: 'x'.repeat(textChars) };
}

test('makeExtractBatches keeps subtrees together, splits oversized subtrees, isolates oversized comments', () => {
    const frame = core.CONSTANTS.COMMENT_FRAME_CHARS;
    const budget = 400;
    // Each comment costs text characters + frame. Text sizes are chosen so that:
    //   S1: three comments of 128 characters each -> 384 total, fits alone.
    //   S2: two comments of 128 -> 256, does not fit with S1.
    //   S3: five comments of 168 -> 840, oversized -> split 2, 2, 1.
    //   S4: one comment of 128 -> joins the last S3 chunk (168 + 128 = 296).
    //   S5: one comment of 648 -> alone, exceeds the budget by itself.
    const textChars128 = 128 - frame;
    const textChars168 = 168 - frame;
    const textChars648 = 648 - frame;
    assert.ok(textChars128 > 0, 'frame must be below 128 characters for this fixture');
    const comments = [
        fakeComment(1, 0, textChars128), fakeComment(2, 1, textChars128), fakeComment(3, 2, textChars128),
        fakeComment(4, 0, textChars128), fakeComment(5, 1, textChars128),
        fakeComment(6, 0, textChars168), fakeComment(7, 1, textChars168), fakeComment(8, 1, textChars168), fakeComment(9, 2, textChars168), fakeComment(10, 1, textChars168),
        fakeComment(11, 0, textChars128),
        fakeComment(12, 0, textChars648),
    ];
    const batches = core.makeExtractBatches(comments, budget);
    assert.deepEqual(batches.map(batch => batch.map(comment => comment.id)), [
        [1, 2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12],
    ]);
});

test('makeScoreBatches chunks in order', () => {
    const comments = Array.from({ length: 45 }, (_, index) => fakeComment(index + 1, 0, 1));
    const batches = core.makeScoreBatches(comments, 20);
    assert.deepEqual(batches.map(batch => batch.length), [20, 20, 5]);
    assert.equal(batches[2][4].id, 45);
});

test('seededShuffle is a deterministic permutation', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = core.seededShuffle(input, 42);
    const second = core.seededShuffle(input, 42);
    const other = core.seededShuffle(input, 43);
    assert.deepEqual(first, second);
    assert.deepEqual([...first].sort((left, right) => left - right), input);
    assert.notDeepEqual(first, other);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'input must not be mutated');
});

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

test('buildScoreMessages lists axes in presented order and swaps the two statements when asked', () => {
    const presented = [TOY_AXES[2], TOY_AXES[0]];
    const thread = core.flattenThread(TOY_THREAD);
    const commentsById = core.indexCommentsById(thread.comments);
    const batch = [commentsById.get(2)];
    const messages = core.buildScoreMessages('Ember', presented, batch, commentsById, true, 300);
    const systemText = messages[0].content;
    const userText = messages[1].content;
    const firstAxisLine = '1. A: The noise level is acceptable | B: The room is too loud for conversation';
    const secondAxisLine = '2. A: Portions are too small for the price | B: Portions are adequate for the price';
    assert.ok(systemText.includes(firstAxisLine), 'swapped statements for the first presented axis');
    assert.ok(systemText.includes(secondAxisLine), 'swapped statements for the second presented axis');
    assert.ok(systemText.indexOf(firstAxisLine) < systemText.indexOf(secondAxisLine), 'presented order kept');
    assert.ok(userText.includes('[id 2, replying to 1:'), 'comment id and parent id present');
    assert.ok(userText.includes('Portions are tiny'), 'parent snippet present');
    assert.ok(!userText.includes('bob') && !userText.includes('alice'), 'no author names in prompts');
});

test('buildExtractMessages omits author names and allows verdict axes', () => {
    const thread = core.flattenThread(TOY_THREAD);
    const messages = core.buildExtractMessages('Ember', thread.comments.slice(0, 2));
    assert.ok(messages[1].content.includes('[id 1]'), 'top-level comment framed by id only');
    assert.ok(messages[1].content.includes('[id 2, re 1]'), 'reply framed by id and parent id');
    assert.ok(!messages[1].content.includes('alice') && !messages[1].content.includes('bob'), 'no author names');
    assert.ok(/verdict/i.test(messages[0].content), 'system prompt allows whole-subject verdict axes');
    assert.ok(!/sentiments/i.test(messages[0].content), 'system prompt no longer excludes sentiments wholesale');
});

test('buildConsolidateMessages states the merge test instead of a count, allows verdict axes, lists candidates with counts', () => {
    const messages = core.buildConsolidateMessages('Ember', [{ statementA: 'p', statementB: 'q', commentsA: [1], commentsB: [] }]);
    assert.ok(/same disagreement/i.test(messages[0].content));
    assert.ok(!/between \d+ and \d+/i.test(messages[0].content));
    assert.ok(/verdict/i.test(messages[0].content));
    assert.ok(!/sentiments/i.test(messages[0].content));
    assert.ok(messages[1].content.includes('[nA=1, nB=0] A: p | B: q'));
});

test('buildScoreMessages excerpts the parent without its quoted lines', () => {
    const commentsById = core.indexCommentsById([
        { id: 1, parentId: null, depth: 0, author: 'a', text: '> Portions are tiny\nTiny? I could not finish mine.' },
        { id: 2, parentId: 1, depth: 1, author: 'b', text: 'Same here, huge plates.' },
        { id: 3, parentId: null, depth: 0, author: 'c', text: '> only a quote' },
        { id: 4, parentId: 3, depth: 1, author: 'd', text: 'Reply to a quote-only parent.' },
    ]);
    const messages = core.buildScoreMessages('Ember', TOY_AXES, [commentsById.get(2), commentsById.get(4)], commentsById, false, 300);
    assert.ok(messages[1].content.includes('[id 2, replying to 1: "Tiny? I could not finish mine."]'), 'quoted line skipped');
    assert.ok(messages[1].content.includes('[id 4, replying to 3: "> only a quote"]'), 'quote-only parent keeps its text');
});

test('buildScoreMessages truncates the parent snippet', () => {
    const thread = core.flattenThread(TOY_THREAD);
    const commentsById = core.indexCommentsById(thread.comments);
    const messages = core.buildScoreMessages('Ember', TOY_AXES, [commentsById.get(2)], commentsById, false, 10);
    assert.ok(messages[1].content.includes('Portions a'), 'first 10 characters kept');
    assert.ok(!messages[1].content.includes('Portions are tiny'), 'rest dropped');
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

test('parseExtractResponse drops unknown ids and candidates missing a statement, with warnings', () => {
    const response = { candidates: [
        { statementA: 'p', statementB: 'q', commentsA: [1, 99], commentsB: ['2'] },
        { statementA: 'p', statementB: '', commentsA: [], commentsB: [] },
        { statementA: '', statementB: 'q', commentsA: [], commentsB: [] },
    ] };
    const parsed = core.parseExtractResponse(response, new Set([1, 2]));
    assert.equal(parsed.candidates.length, 1);
    assert.equal(parsed.candidates[0].statementA, 'p');
    assert.equal(parsed.candidates[0].statementB, 'q');
    assert.deepEqual(parsed.candidates[0].commentsA, [1]);
    assert.deepEqual(parsed.candidates[0].commentsB, [2]);
    assert.equal(parsed.warnings.length, 3);
});

test('parsers accept a bare top-level array as the payload and record a warning', () => {
    const extracted = core.parseExtractResponse([{ statementA: 'p', statementB: 'q', commentsA: [1], commentsB: [] }], new Set([1]));
    assert.equal(extracted.candidates.length, 1);
    assert.ok(extracted.warnings.some(warning => /bare array/.test(warning)));

    const consolidated = core.parseConsolidateResponse([{ statementA: 'x', statementB: 'not x' }]);
    assert.equal(consolidated.axes.length, 1);
    assert.ok(consolidated.warnings.some(warning => /bare array/.test(warning)));

    const scored = core.parseScoreResponse([{ comment: 5, axis: 1, stance: 'A' }], new Set([5]), [TOY_AXES[0]], false);
    assert.equal(scored.stances.get('5|1'), 'A');
    assert.ok(scored.warnings.some(warning => /bare array/.test(warning)));
});

test('parseScoreResponse accepts per-comment classification objects and records a warning', () => {
    const response = { classifications: [
        { id: '5', stances: { '1': 'A', '2': 'M' } },
        { id: 6, stances: {} },
        { id: 6, stances: { '2': 'B' } },
    ] };
    const parsed = core.parseScoreResponse(response, new Set([5, 6]), [TOY_AXES[0], TOY_AXES[1]], false);
    assert.equal(parsed.stances.get('5|1'), 'A');
    assert.equal(parsed.stances.get('5|2'), 'M');
    assert.equal(parsed.stances.get('6|2'), 'B');
    assert.equal(parsed.stances.size, 3);
    assert.ok(parsed.warnings.some(warning => /per-comment/.test(warning)));
});

test('parseScoreResponse flattens per-comment objects found in a bare array or under stances', () => {
    const bare = core.parseScoreResponse([{ id: 5, stances: { '1': 'A' } }, { id: 6, stances: { '2': 'B' } }], new Set([5, 6]), [TOY_AXES[0], TOY_AXES[1]], false);
    assert.equal(bare.stances.get('5|1'), 'A');
    assert.equal(bare.stances.get('6|2'), 'B');
    assert.equal(bare.warnings.filter(warning => /unknown comment id/.test(warning)).length, 0);
    const wrapped = core.parseScoreResponse({ stances: [{ id: 5, stances: { '1': 'M' } }] }, new Set([5]), [TOY_AXES[0]], false);
    assert.equal(wrapped.stances.get('5|1'), 'M');
    const axesKey = core.parseScoreResponse([{ id: 5, axes: { '1': 'B' } }, { id: 6, axes: {} }], new Set([5, 6]), [TOY_AXES[0]], false);
    assert.equal(axesKey.stances.get('5|1'), 'B');
    assert.equal(axesKey.warnings.filter(warning => /unknown comment id/.test(warning)).length, 0);
});

test('a response of unknown shape raises InvalidResponseError', () => {
    assert.throws(() => core.parseScoreResponse({ bogus: true }, new Set(), [], false), error => error instanceof core.InvalidResponseError);
    assert.throws(() => core.parseExtractResponse({ bogus: true }, new Set()), error => error instanceof core.InvalidResponseError);
    assert.throws(() => core.parseExtractResponse(undefined, new Set()), core.InvalidResponseError);
    assert.throws(() => core.parseExtractResponse({ candidates: [null, {}] }, new Set()), core.InvalidResponseError);
    assert.throws(() => core.parseConsolidateResponse({ axes: [null, {}] }), core.InvalidResponseError);
    assert.throws(() => core.parseScoreResponse({ stances: [null] }, new Set(), [], false), core.InvalidResponseError);
    assert.deepEqual(core.parseExtractResponse({ candidates: [] }, new Set()).candidates, [], 'an explicitly empty extraction remains valid');
});

test('runPipeline splits a scoring batch whose response has an unknown shape', async () => {
    const log = [];
    const thread = core.flattenThread(TOY_THREAD);
    const failWhen = call => call.stage === 'score' && call.meta.commentIds.length > 1 && call.meta.commentIds.includes(7);
    const callChat = makeFailingFake(log, failWhen, () => ({ json: { bogus: true }, usage: { promptTokens: 1, completionTokens: 1, cost: 0.001 } }));
    const result = await core.runPipeline({ thread, callChat, onProgress: () => {}, config: TOY_CONFIG });
    assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assert.ok(result.warnings.some(warning => /unknown shape.*split/.test(warning)));
});

test('parse errors name the missing array and quote an excerpt of the content', () => {
    assert.throws(() => core.parseExtractResponse({ nope: 1 }, new Set()), /candidates array.*\{"nope":1\}/);
    assert.throws(() => core.parseConsolidateResponse({ result: [] }), /axes array.*\{"result":\[\]\}/);
    assert.throws(() => core.parseScoreResponse({ stance: 'A' }, new Set(), [], false), /stances array.*\{"stance":"A"\}/);
    const long = { filler: 'x'.repeat(1000) };
    assert.throws(() => core.parseExtractResponse(long, new Set()), error => error.message.length < 500);
});

test('parseConsolidateResponse assigns sequential ids and drops axes missing a statement', () => {
    const response = { axes: [
        { statementA: 'x', statementB: 'not x' },
        { statementA: '', statementB: 'b' },
        { statementA: 'y', statementB: 'not y' },
    ] };
    const parsed = core.parseConsolidateResponse(response);
    assert.deepEqual(parsed.axes.map(axis => axis.id), [1, 2]);
    assert.equal(parsed.axes[1].statementA, 'y');
    assert.equal(parsed.axes[1].statementB, 'not y');
    assert.equal(parsed.warnings.length, 1);
});

test('parseScoreResponse maps presented axis numbers back and un-swaps poles', () => {
    const presented = [TOY_AXES[2], TOY_AXES[0], TOY_AXES[1]];
    const response = { stances: [
        { comment: 5, axis: 1, stance: 'A' },
        { comment: '6', axis: 2, stance: 'M' },
        { comment: 7, axis: 1, stance: 'B' },
        { comment: 5, axis: 9, stance: 'A' },
        { comment: 5, axis: 2, stance: 'Z' },
    ] };
    const parsed = core.parseScoreResponse(response, new Set([5, 6]), presented, true);
    assert.equal(parsed.stances.get('5|3'), 'B');
    assert.equal(parsed.stances.get('6|1'), 'M');
    assert.equal(parsed.stances.size, 2);
    assert.equal(parsed.warnings.length, 3);
});

test('parseScoreResponse keeps the first stance for a duplicated pair', () => {
    const response = { stances: [
        { comment: 5, axis: 1, stance: 'A' },
        { comment: 5, axis: 1, stance: 'B' },
    ] };
    const parsed = core.parseScoreResponse(response, new Set([5]), [TOY_AXES[0]], false);
    assert.equal(parsed.stances.get('5|1'), 'A');
    assert.equal(parsed.warnings.length, 1);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('mergePasses keeps only the stances both passes agree on', () => {
    const agreed = core.mergePasses(TOY_PASS1, TOY_PASS2);
    assert.equal(agreed.get('5|2'), 'A');
    assert.equal(agreed.get('6|2'), 'B');
    assert.equal(agreed.has('7|2'), false);
    assert.equal(agreed.has('12|2'), false);
    assert.equal(agreed.size, 13);
});

test('collectUnverifiedComments separates conflicts and one-pass classifications by axis', () => {
    const byAxis = core.collectUnverifiedComments(TOY_PASS1, TOY_PASS2);
    assert.deepEqual(byAxis.get(2), [
        { commentId: 7, pass1: 'M', pass2: 'B' },
        { commentId: 12, pass1: 'B', pass2: null },
    ]);
    assert.equal(byAxis.has(1), false);
});

test('aggregateByAuthor detects opposing sides before majority and middle ties', () => {
    const commentsById = new Map([
        [1, { id: 1, author: 'p' }], [2, { id: 2, author: 'p' }],
        [3, { id: 3, author: 'q' }], [4, { id: 4, author: 'q' }],
        [5, { id: 5, author: 'r' }], [6, { id: 6, author: 'r' }], [7, { id: 7, author: 'r' }],
    ]);
    const agreed = new Map(Object.entries({ '1|1': 'A', '2|1': 'A', '3|1': 'A', '4|1': 'B', '5|1': 'A', '6|1': 'M', '7|1': 'M' }));
    const byAuthor = core.aggregateByAuthor(agreed, commentsById);
    assert.equal(byAuthor.get(1).get('p'), 'A');
    assert.equal(byAuthor.get(1).get('q'), 'C');
    assert.equal(byAuthor.get(1).get('r'), 'M');
});

function toyRows() {
    const thread = core.flattenThread(TOY_THREAD);
    const commentsById = core.indexCommentsById(thread.comments);
    const agreed = core.mergePasses(TOY_PASS1, TOY_PASS2);
    const byAuthor = core.aggregateByAuthor(agreed, commentsById);
    return core.computeRows(TOY_AXES, byAuthor, agreed);
}

test('computeRows produces verified comment counts for the toy thread', () => {
    const rows = toyRows();
    const byId = new Map(rows.map(row => [row.axisId, row]));
    const portions = byId.get(1);
    assert.deepEqual(portions, {
        axisId: 1,
        statementA: 'Portions are adequate for the price',
        statementB: 'Portions are too small for the price',
        countA: 2,
        countB: 1,
        countM: 0,
        countC: 0,
        authors: 3,
        comments: 3,
        commentIdsA: [2, 3],
        commentIdsB: [1],
        commentIdsM: [],
        unverifiedComments: [],
    });
    const service = byId.get(5);
    assert.equal(service.countA, 2);
    assert.equal(service.countM, 1);
    assert.equal(service.authors, 3);
    assert.equal(service.comments, 3);
    const opening = byId.get(6);
    assert.equal(opening.countA, 1);
    assert.equal(opening.comments, 1);
});

test('computeRows excludes consolidated axes with no agreed scoring stance', () => {
    const thread = core.flattenThread(TOY_THREAD);
    const commentsById = core.indexCommentsById(thread.comments);
    const agreed = core.mergePasses(TOY_PASS1, TOY_PASS2);
    const byAuthor = core.aggregateByAuthor(agreed, commentsById);
    const emptyAxis = { id: 99, statementA: 'One claim', statementB: 'The rival claim' };
    const rows = core.computeRows([...TOY_AXES, emptyAxis], byAuthor, agreed);
    assert.equal(rows.some(row => row.axisId === emptyAxis.id), false);
});

test('axisMetaText names the agreed comments and commenters, and the middle count only when above zero', () => {
    assert.equal(core.axisMetaText({ comments: 77, authors: 70, countM: 2 }), '77 comments, 70 commenters, 2 middle');
    assert.equal(core.axisMetaText({ comments: 3, authors: 3, countM: 0 }), '3 comments, 3 commenters');
});

test('proportionShares splits the bar among side 1, middle, and side 2', () => {
    assert.deepEqual(core.proportionShares({ countA: 6, countM: 2, countB: 2 }), [0.6, 0.2, 0.2, 0]);
    assert.deepEqual(core.proportionShares({ countA: 0, countM: 0, countB: 0 }), [0, 0, 0, 0]);
    assert.deepEqual(core.proportionShares({ countA: 1, countM: 1, countB: 1, countC: 1 }), [0.25, 0.25, 0.25, 0.25]);
});

test('orientRows puts the larger side and its evidence on statement 1, keeping ties as they are', () => {
    const rows = [
        { axisId: 1, statementA: 'p', statementB: 'q', countA: 2, countB: 5, countM: 1, commentIdsA: [1], commentIdsB: [2, 3], unverifiedComments: [{ commentId: 4, pass1: 'A', pass2: null }] },
        { axisId: 2, statementA: 'r', statementB: 's', countA: 3, countB: 3, countM: 0 },
        { axisId: 3, statementA: 't', statementB: 'u', countA: 4, countB: 0, countM: 0 },
    ];
    const oriented = core.orientRows(rows);
    assert.deepEqual(oriented.map(row => [row.statementA, row.statementB, row.countA, row.countB]), [['q', 'p', 5, 2], ['r', 's', 3, 3], ['t', 'u', 4, 0]]);
    assert.deepEqual([oriented[0].commentIdsA, oriented[0].commentIdsB], [[2, 3], [1]]);
    assert.deepEqual(oriented[0].unverifiedComments, [{ commentId: 4, pass1: 'B', pass2: null }]);
    assert.equal(rows[0].statementA, 'p');
});

test('rankRows orders by polarized people, then statement text, and numbers the rows', () => {
    const ranked = core.rankRows(toyRows());
    assert.deepEqual(ranked.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assert.deepEqual(ranked.map(row => row.rank), [1, 2, 3, 4, 5, 6]);
});

test('opposing verified comments by one author count once as self contradiction', () => {
    const agreed = new Map([['1|1', 'A'], ['2|1', 'A'], ['3|1', 'B'], ['4|1', 'B'], ['5|1', 'M']]);
    const commentsById = new Map([1, 2, 3, 4, 5].map(id => [id, { id, author: 'same-author' }]));
    const rows = core.computeRows([TOY_AXES[0]], core.aggregateByAuthor(agreed, commentsById), agreed);
    assert.deepEqual([rows[0].countA, rows[0].countB, rows[0].countM, rows[0].countC, rows[0].authors], [0, 0, 0, 1, 1]);
    const repeated = new Map(Array.from({ length: 10 }, (_, index) => [`${index + 1}|1`, 'A']));
    const repeatedComments = new Map(Array.from({ length: 10 }, (_, index) => [index + 1, { author: 'same' }]));
    assert.equal(core.computeRows([TOY_AXES[0]], core.aggregateByAuthor(repeated, repeatedComments), repeated)[0].countA, 1);
    repeated.set('11|1', 'B');
    repeatedComments.set(11, { author: 'same' });
    assert.equal(core.computeRows([TOY_AXES[0]], core.aggregateByAuthor(repeated, repeatedComments), repeated)[0].countC, 1);
});

test('saved rows rebuild person counts and separate self contradiction evidence', () => {
    const saved = { axisId: 1, countA: 3, countB: 2, countM: 1, comments: 6, commentIdsA: [1, 2, 3, 4], commentIdsB: [5, 6, 7, 8], commentIdsM: [9] };
    const comments = new Map(Array.from({ length: 9 }, (_, index) => [index + 1, { author: index === 4 ? 'person1' : `person${index + 1}` }]));
    const row = core.withAuthorCounts(saved, comments);
    assert.deepEqual([row.countA, row.countB, row.countM, row.countC, row.authors], [3, 3, 1, 1, 8]);
    assert.deepEqual(row.evidenceIds.C, [1, 5]);
    assert.deepEqual(row.evidenceIds.A, [2, 3, 4]);
    assert.equal(saved.countA, 3);
    const smaller = { ...row, countA: 3, countB: 2, countM: 100, countC: 100, comments: 300, authors: 205, statementA: 'A' };
    const larger = { ...row, countA: 4, countB: 4, countM: 1, countC: 0, comments: 9, authors: 9, statementA: 'B' };
    assert.equal(core.rankRows([smaller, larger])[0].statementA, 'B');
    assert.equal(core.rankRows([{ ...larger, countA: 3, countB: 2 }, smaller])[0].statementA, 'A');
});

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

test('runPool preserves result order and limits concurrency', async () => {
    let running = 0;
    let peak = 0;
    const tasks = [5, 1, 4, 2, 3].map(value => async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, value));
        running -= 1;
        return value;
    });
    const results = await core.runPool(tasks, 2);
    assert.deepEqual(results, [5, 1, 4, 2, 3]);
    assert.equal(peak, 2);
});

test('runPool rejects with the first task error', async () => {
    const tasks = [async () => 1, async () => { throw new Error('boom'); }, async () => 3];
    await assert.rejects(core.runPool(tasks, 2), /boom/);
});

// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------

function fakeResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

function minimalRequest() {
    return { model: 'm', messages: [], schema: { name: 's', schema: {} }, sampling: { temperature: 0 }, maxTokens: 10 };
}

test('missing usage.cost recovers delayed generation billing without another paid call', async () => {
    const methods = [];
    const sleeps = [];
    const data = { id: 'gen/a', choices: [{ message: { content: '{"answer":42}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10 } };
    const result = await core.callOpenRouter({
        apiKey: 'k', request: { ...minimalRequest(), model: 'anthropic/claude-sonnet-5' },
        sleepImpl: async ms => sleeps.push(ms),
        fetchImpl: async (url, options) => {
            methods.push(options.method);
            if (options.method === 'POST') return fakeResponse(200, data);
            assert.ok(url.endsWith('id=gen%2Fa'));
            if (methods.length === 2) return fakeResponse(404, {});
            if (methods.length === 3) return fakeResponse(200, { data: { id: data.id, total_cost: null } });
            return fakeResponse(200, { data: { id: data.id, total_cost: 0.12 } });
        },
    });
    assert.deepEqual(methods, ['POST', 'GET', 'GET', 'GET']);
    assert.deepEqual(sleeps, [1000, 2000]);
    assert.deepEqual(result.json, { answer: 42 });
    assert.equal(result.usage.cost, 0.12);
    assert.equal(result.usage.costSource, 'generation');
});

test('unresolved billing persists output and retry resolves it without repeating generation', async () => {
    const entries = new Map();
    const store = { get: key => entries.get(key), set: (key, value) => entries.set(key, JSON.parse(JSON.stringify(value))) };
    let available = false;
    let posts = 0;
    let gets = 0;
    const callChat = request => core.callOpenRouter({
        apiKey: 'k', request, sleepImpl: async () => {},
        fetchImpl: async (_, options) => {
            if (options.method === 'POST') {
                posts++;
                return fakeResponse(200, { id: 'gen-1', choices: [{ message: { content: '{"answer":42}' }, finish_reason: 'stop' }] });
            }
            gets++;
            return available ? fakeResponse(200, { data: { id: 'gen-1', total_cost: 0.25 } }) : fakeResponse(503, {});
        },
    });
    await assert.rejects(core.makeCachedCallChat(callChat, store)(minimalRequest()), core.CostUnavailableError);
    assert.equal(gets, 3);
    assert.equal(entries.values().next().value.billingResponse.id, 'gen-1');
    available = true;
    const retry = core.makeCachedCallChat(callChat, store);
    const recovered = await retry(minimalRequest());
    assert.equal(recovered.usage.cost, 0.25);
    assert.deepEqual(recovered.json, { answer: 42 });
    assert.equal((await retry(minimalRequest())).usage.cached, true);
    assert.equal(posts, 1);
    assert.equal(gets, 4);
});

test('missing id and invalid costs remain unknown, but explicit zero is valid', async () => {
    for (const cost of [undefined, null, '0', -1, NaN, Infinity, 0]) {
        let calls = 0;
        const promise = core.callOpenRouter({
            apiKey: 'k', request: minimalRequest(), sleepImpl: async () => {},
            fetchImpl: async () => {
                calls++;
                return fakeResponse(200, { usage: { cost }, choices: [{ message: { content: '{}' } }] });
            },
        });
        if (cost === 0) assert.equal((await promise).usage.cost, 0);
        else await assert.rejects(promise, core.CostUnavailableError);
        assert.equal(calls, 1);
    }
});

test('pool waits for in-flight work to finish and stops queued work on failure', async () => {
    let release;
    let finished = false;
    let queued = false;
    const gate = new Promise(resolve => { release = resolve; });
    const promise = core.runPool([
        async () => { throw new Error('billing unavailable'); },
        async () => { await gate; finished = true; },
        async () => { queued = true; },
    ], 2);
    let settled = false;
    const checked = assert.rejects(promise, /billing unavailable/).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    release();
    await checked;
    assert.equal(finished, true);
    assert.equal(queued, false);
});

test('callOpenRouter sends a JSON-schema request with the requested sampling and parses the JSON content', async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, options });
        return fakeResponse(200, {
            choices: [{ message: { content: '{"answer": 42}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
        });
    };
    const result = await core.callOpenRouter({
        apiKey: 'k', fetchImpl, sleepImpl: async () => {},
        request: {
            model: 'm',
            messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
            schema: { name: 's', schema: { type: 'object' } },
            sampling: { temperature: 0 },
            reasoning: { max_tokens: 2000 },
            maxTokens: 100,
        },
    });
    assert.deepEqual(result.json, { answer: 42 });
    assert.equal(result.usage.cost, 0.0001);
    assert.equal(result.usage.promptTokens, 10);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, core.CONSTANTS.OPENROUTER_URL);
    assert.equal(seen[0].options.headers.Authorization, 'Bearer k');
    const body = JSON.parse(seen[0].options.body);
    assert.equal(body.model, 'm');
    assert.equal(body.temperature, 0);
    assert.equal('seed' in body, false, 'seed is only sent when sampling asks for it');
    assert.deepEqual(body.reasoning, { max_tokens: 2000 });
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.name, 's');
    assert.equal(body.usage.include, true);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content[0].text, 'sys');
    assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral' }, 'system prompt is marked cacheable');
    assert.equal(body.messages[1].content, 'hi', 'user content stays a string');
});

test('callOpenRouter omits sampling and reasoning fields when the request has none', async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push(options);
        return fakeResponse(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { cost: 0 } });
    };
    await core.callOpenRouter({
        apiKey: 'k', fetchImpl, sleepImpl: async () => {},
        request: { model: 'm', messages: [{ role: 'user', content: 'hi' }], schema: { name: 's', schema: {} }, sampling: null, reasoning: null, maxTokens: 10 },
    });
    const body = JSON.parse(seen[0].body);
    assert.equal('temperature' in body, false);
    assert.equal('seed' in body, false);
    assert.equal('reasoning' in body, false);
});

test('callOpenRouter retries on 429 and then succeeds', async () => {
    let calls = 0;
    const sleeps = [];
    const fetchImpl = async () => {
        calls += 1;
        if (calls === 1) {
            return fakeResponse(429, { error: { message: 'slow down' } });
        }
        return fakeResponse(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { cost: 0 } });
    };
    const result = await core.callOpenRouter({ apiKey: 'k', fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms); }, request: minimalRequest() });
    assert.deepEqual(result.json, {});
    assert.equal(calls, 2);
    assert.equal(sleeps.length, 1);
});

test('callOpenRouter does not retry on 400 and surfaces the error message', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return fakeResponse(400, { error: { message: 'bad request detail' } });
    };
    await assert.rejects(core.callOpenRouter({ apiKey: 'k', fetchImpl, sleepImpl: async () => {}, request: minimalRequest() }), /bad request detail/);
    assert.equal(calls, 1);
});

test('callOpenRouter throws a TruncationError carrying usage when the completion was truncated', async () => {
    const fetchImpl = async () => fakeResponse(200, { choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }], usage: { cost: 0.002, completion_tokens: 32000 } });
    await assert.rejects(
        core.callOpenRouter({ apiKey: 'k', fetchImpl, sleepImpl: async () => {}, request: minimalRequest() }),
        error => error instanceof core.TruncationError && /truncated/.test(error.message) && error.usage.cost === 0.002,
    );
});

// ---------------------------------------------------------------------------
// Pipeline integration with a fake model
// ---------------------------------------------------------------------------

const TOY_CANDIDATE_TABLE = {
    1: [['portions', 'B']], 2: [['portions', 'A']], 3: [['portions', 'A'], ['noise', 'A']], 4: [['noise', 'B']],
    5: [['tasting', 'A'], ['parking', 'A']], 6: [['tasting', 'B']], 7: [['tasting', 'A']],
    8: [['service', 'A']], 9: [['service', 'A']], 10: [['temporary', 'A']], 11: [['parking', 'B']], 12: [['prices', 'A']],
};

function makeFakeCallChat(log) {
    const fakeUsage = { promptTokens: 100, completionTokens: 10, cost: 0.001 };
    return async (call) => {
        log.push(call);
        if (call.stage === 'extract') {
            const grouped = new Map();
            for (const commentId of call.meta.commentIds) {
                for (const [key, pole] of TOY_CANDIDATE_TABLE[commentId]) {
                    if (!grouped.has(key)) {
                        grouped.set(key, { statementA: key + ' is so', statementB: key + ' is not so', commentsA: [], commentsB: [] });
                    }
                    grouped.get(key)[pole === 'A' ? 'commentsA' : 'commentsB'].push(commentId);
                }
            }
            return { json: { candidates: [...grouped.values()] }, usage: fakeUsage };
        }
        if (call.stage === 'consolidate') {
            return { json: { axes: TOY_AXES.map(axis => ({ statementA: axis.statementA, statementB: axis.statementB })) }, usage: fakeUsage };
        }
        if (call.stage === 'synthesize') {
            return { json: { sections: [{ text: 'Portion value divides the discussion[[axis:1]].', axisIds: [1] }], caveats: [] }, usage: fakeUsage };
        }
        if (call.stage === 'score') {
            const source = call.meta.swapPoles ? TOY_PASS2 : TOY_PASS1;
            const stances = [];
            for (const commentId of call.meta.commentIds) {
                for (const [key, stance] of source) {
                    const { commentId: keyComment, axisId: keyAxis } = core.parseStanceKey(key);
                    if (keyComment !== commentId) continue;
                    const presentedIndex = call.meta.presentedAxes.findIndex(axis => axis.id === keyAxis);
                    const letter = call.meta.swapPoles ? core.flipStance(stance) : stance;
                    stances.push({ comment: commentId, axis: presentedIndex + 1, stance: letter });
                }
            }
            return { json: { stances }, usage: fakeUsage };
        }
        throw new Error('unexpected stage ' + call.stage);
    };
}

test('synthesis uses consolidation settings, verified evidence, structured references and deterministic counts', async () => {
    const log = [];
    const progress = [];
    const result = await core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), callChat: makeFakeCallChat(log),
        onProgress: update => progress.push(update), config: { ...TOY_CONFIG, modelConsolidate: 'expensive-test-model' },
    });
    const call = log.at(-1);
    assert.equal(call.stage, 'synthesize');
    assert.equal(call.model, 'expensive-test-model');
    assert.equal(call.maxTokens, 16000);
    assert.equal(call.schema.name, 'thread_synthesis');
    assert.ok(progress.some(update => update.stage === 'synthesize' && update.inFlight === 1));
    assert.deepEqual(result.synthesis.sections[0].axisIds, [1]);
    const input = JSON.parse(call.messages[1].content);
    for (const axis of input.axes) {
        const row = result.rows.find(row => row.axisId === axis.axisId);
        assert.deepEqual(axis.people, { A: row.countA, B: row.countB, middle: row.countM, selfContradiction: row.countC });
        assert.ok(Object.values(axis.evidence).every(group => group.length <= 2));
    }
    assert.ok(!call.messages[1].content.includes('"author"'));
    assert.match(call.messages[0].content, /NOT consensus/);
});

test('synthesis rejects missing prose, unsupported references and malformed caveats', () => {
    for (const json of [
        {}, { sections: [], caveats: [] },
        { sections: [{ text: 'Claim', axisIds: [999] }], caveats: [] },
        { sections: [{ text: 'Claim', axisIds: ['1'] }], caveats: [] },
        { sections: [{ text: 'Claim', axisIds: [1] }], caveats: [null] },
    ]) assert.throws(() => core.parseSynthesisResponse(json, [1]), /Synthesis/);
});

test('synthesis requires exact, known, claim-local markers and rejects the old paragraph-end format', () => {
    const parse = (text, axisIds = [1]) => core.parseSynthesisResponse({ sections: [{ text, axisIds }], caveats: [] }, [1, 2]);
    const text = 'Cost divides opinion[[axis:1]], but reliability raises another trade-off[[axis:2]]. Neither implies consensus.';
    assert.equal(parse(text, [1, 2]).sections[0].text, text);
    assert.deepEqual(core.synthesisTextParts(text), [
        { text: 'Cost divides opinion' }, { axisId: 1 },
        { text: ', but reliability raises another trade-off' }, { axisId: 2 },
        { text: '. Neither implies consensus.' },
    ]);
    for (const [text, ids] of [
        ['Old plain prose.', [1]],
        ['Claim[[axis:999]].', [1]],
        ['Claim[[axis:1]]. Another claim[[axis:2]].', [1]],
        ['Claim[[axis:1]].', [1, 2]],
        ['Claim[[axis:2]]. Another claim[[axis:1]].', [1, 2]],
        ['Claim[[axis:1]]. Another claim[[axis:1]].', [1, 1]],
        ['[[axis:1]]Unsupported leading marker.', [1]],
        ['Claim[[axis:1]] [[axis:2]].', [1, 2]],
        ['Claim[[axis:1]][[axis:2]].', [1, 2]],
        ['Claim[[axis:9007199254740993]].', [1]],
        ...['[[axis:01]]', '[[axis:0]]', '[[axis:-1]]', '[[axis:1.0]]', '[[axis:1,2]]',
            '[[axis: 1]]', '[[Axis:1]]', '[axis:1]', '[[axis:1]', '[[axis:1]]]',
            '[[1]]', '[[axis:1]] trailing[[', '[[axis:1]] stray]'].map(marker => [`Claim${marker}.`, [1]]),
    ]) assert.throws(() => parse(text, ids), /citation marker/, text);
});

test('synthesis always enforces compact prose and references', () => {
    const paragraph = words => ({ text: Array(words).fill('interpretation').join(' ') + '[[axis:1]]', axisIds: [1] });
    const valid = { sections: [paragraph(75), paragraph(75), paragraph(75)], caveats: [] };
    assert.equal(core.parseSynthesisResponse(valid, [1]).sections.length, 3);
    assert.doesNotThrow(() => core.parseSynthesisResponse({ sections: [{ text: 'GPT-6 frames the discussion[[axis:1]].', axisIds: [1] }], caveats: [] }, [1]));
    for (const sections of [
        [paragraph(101)],
        Array.from({ length: 4 }, () => paragraph(76)),
        Array.from({ length: 5 }, () => paragraph(20)),
        [{ text: 'Interpretation[[axis:1]] of another view[[axis:2]] and a third[[axis:3]].', axisIds: [1, 2, 3] }],
        [{ text: 'First paragraph.\nSecond paragraph[[axis:1]].', axisIds: [1] }],
        [{ text: 'Supported by 64 people[[axis:1]]', axisIds: [1] }],
        [{ text: 'The split (64–18) suggests tension[[axis:1]].', axisIds: [1] }],
    ]) {
        assert.throws(() => core.parseSynthesisResponse({ sections, caveats: [] }, [1, 2, 3]), /concise/);
    }
    const prompt = core.buildSynthesisMessages('Title', [], new Map())[0].content;
    assert.match(prompt, /200–300 words/);
    assert.match(prompt, /3–4 concise paragraphs/);
    assert.match(prompt, /1–2 supporting axisIds/);
    assert.match(prompt, /splitting on whitespace/);
    assert.match(prompt, /Return ONLY a JSON object/);
    assert.match(prompt, /not Markdown or standalone prose/);
    assert.match(prompt, /immediately after the exact supported claim or sentence/);
    assert.match(prompt, /not in a reference list appended to the paragraph/);
    const outputSchema = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
    assert.deepEqual(outputSchema.required, ['sections', 'caveats']);
    assert.deepEqual(outputSchema.properties.sections.items.required, ['text', 'axisIds']);
});

test('oversized narrative reports measured violations and retains the rejected response', () => {
    const json = {
        sections: [163, 155, 178, 122, 136, 131].map(count => ({
            text: Array.from({ length: count }, (_, index) => 'argument' + (index < 5 ? `[[axis:${index + 1}]]` : '')).join(' '), axisIds: [1, 2, 3, 4, 5],
        })),
        caveats: [],
    };
    assert.throws(() => core.parseSynthesisResponse(json, [1, 2, 3, 4, 5]), error => {
        assert.match(error.message, /6 paragraphs \(maximum 4\)/);
        assert.match(error.message, /885 narrative words \(maximum 300\)/);
        assert.match(error.message, /paragraph 3: 178 words \(maximum 100\)/);
        assert.match(error.message, /5 axis references \(maximum 2\)/);
        assert.equal(error.response, json);
        return true;
    });
});

test('synthesis schema enforces the same paragraph boundary as validation', async () => {
    const calls = [];
    await core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG,
        onProgress: () => {}, callChat: makeFakeCallChat(calls),
    });
    const schema = calls.find(call => call.stage === 'synthesize').schema.schema;
    const textSchema = schema.properties.sections.items.properties.text;
    const pattern = new RegExp(textSchema.pattern);
    for (const count of [1, 75, 100]) {
        const text = Array(count).fill('word').join(' ') + '[[axis:1]]';
        assert.ok(pattern.test(text));
        assert.doesNotThrow(() => core.parseSynthesisResponse({ sections: [{ text, axisIds: [1] }], caveats: [] }, [1]));
    }
    for (const text of ['', ' ', 'unmarked prose', 'one[[axis:1]]\ntwo', 'one[[axis:1]]\r\ntwo', 'one[[axis:1]]\n', 'one[[axis:1]]\r', Array(101).fill('word').join(' ') + '[[axis:1]]']) {
        assert.equal(pattern.test(text), false, JSON.stringify(text));
    }
    assert.equal(schema.properties.sections.maxItems, 4);
    assert.equal(schema.properties.sections.items.properties.axisIds.maxItems, 2);
    assert.equal(textSchema.maxLength, 2400);
});

test('claim-local inline counts preserve surrounding prose and toggle only local normalized stance evidence safely', () => {
    const source = require('node:fs').readFileSync(require.resolve('../hn_polarization.html'), 'utf8');
    class Element {
        constructor(tag, text = '') { this.tagName = tag; this.textContent = text; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; }
        set innerHTML(value) { throw new Error('Unsafe HTML insertion'); }
        appendChild(node) { this.children.push(node); return node; }
        append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
        setAttribute(key, value) { this.attributes[key] = value; }
        getAttribute(key) { return this.attributes[key]; }
        addEventListener(name, handler) { this[name] = handler; }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [
                ...(selector === '.evidence-group' && child.className?.split(' ').includes('evidence-group') ? [child] : []),
                ...child.querySelectorAll(selector),
            ]);
        }
    }
    const sandbox = {
        document: { createTextNode: text => new Element('#text', text) },
        makeElement: (tag, options = {}) => Object.assign(new Element(tag, options.text || ''), { className: options.className || '' }),
        CONSTANTS: core.CONSTANTS,
        synthesisTextParts: core.synthesisTextParts,
    };
    const vm = require('node:vm');
    for (const [start, end] of [
        ['function evidenceToggle(', '// Each visible count'],
        ['function renderEvidenceGroup(', 'function stanceLabel('],
        ['function renderNarrativeSection(', 'function renderResults('],
    ]) vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), sandbox);
    const comments = core.indexCommentsById([
        { id: 1, author: 'alice', text: '<img src=x onerror=alert(1)>' }, { id: 2, author: 'alice', text: 'For again' },
        { id: 3, author: 'bob', text: 'Against' }, { id: 4, author: 'chris', text: 'Conditional' },
        { id: 5, author: 'dana', text: 'For' }, { id: 6, author: 'dana', text: 'Against' },
    ]);
    const raw = { axisId: 1, statementA: 'Keep it', statementB: 'Change it', countA: 999, commentIdsA: [1, 2, 5], commentIdsB: [3, 6], commentIdsM: [4] };
    const rows = [core.withAuthorCounts(raw, comments), core.withAuthorCounts({ ...raw, axisId: 2, commentIdsB: [], commentIdsM: [] }, comments)];
    const text = 'Interpretation <img src=x onerror=alert(1)>[[axis:1]], but a different claim[[axis:2]]. The conclusion follows.';
    const section = core.parseSynthesisResponse({ sections: [{ text, axisIds: [1, 2] }], caveats: [] }, [1, 2]).sections[0];
    const block = sandbox.renderNarrativeSection(section, rows, comments, 0);
    const [paragraph, evidence] = block.children;
    assert.equal(paragraph.textContent, '');
    assert.deepEqual(paragraph.children.map(child => child.tagName), ['#text', 'span', '#text', 'span', '#text']);
    assert.equal(paragraph.children[0].textContent, 'Interpretation <img src=x onerror=alert(1)>');
    assert.equal(paragraph.children[2].textContent, ', but a different claim');
    assert.equal(paragraph.children[4].textContent, '. The conclusion follows.');
    const content = node => node.textContent + node.children.map(content).join('');
    assert.equal(content(paragraph), 'Interpretation <img src=x onerror=alert(1)> (1–1–1; 1 self contradiction), but a different claim (2–0). The conclusion follows.');
    assert.doesNotMatch(content(paragraph), /\[\[axis:|999/);
    const counts = paragraph.children[1];
    const buttons = counts.children.filter(child => child.tagName === 'button');
    assert.deepEqual(buttons.map(button => button.textContent), ['1', '1', '1', '1 self contradiction']);
    assert.equal(evidence.hidden, true);
    assert.ok(buttons.every(button => !/blue|orange/i.test(button.getAttribute('aria-label'))));
    const visible = () => evidence.children.filter(group => !group.hidden);
    const commentsIn = group => group.children.filter(child => child.tagName === 'article').length;
    buttons[0].click();
    assert.equal(visible().length, 1);
    assert.equal(visible()[0].dataset.evidenceKind, '1-A');
    assert.equal(commentsIn(visible()[0]), 2);
    assert.match(visible()[0].children[0].textContent, /1 person, 2 verified comments/);
    assert.match(content(visible()[0]), /<img src=x onerror=alert\(1\)>/);
    buttons[1].click();
    assert.equal(visible()[0].dataset.evidenceKind, '1-B');
    assert.equal(buttons[0].getAttribute('aria-expanded'), 'false');
    buttons[2].click();
    assert.equal(visible()[0].dataset.evidenceKind, '1-M');
    buttons[3].click();
    assert.equal(visible()[0].dataset.evidenceKind, '1-C');
    assert.equal(commentsIn(visible()[0]), 2);
    buttons[3].click();
    assert.equal(evidence.hidden, true);
    const otherButtons = paragraph.children[3].children.filter(child => child.tagName === 'button');
    otherButtons[1].click();
    assert.equal(visible()[0].dataset.evidenceKind, '2-B');
    assert.match(visible()[0].children[0].textContent, /0 people, 0 verified comments/);
    assert.equal(visible().length, 1);
    const tags = node => [node.tagName, ...node.children.flatMap(tags)];
    assert.ok(!tags(block).some(tag => ['img', 'script'].includes(tag)));
    assert.ok(!/scrollIntoView|comparisons\.open|\.focus\(/.test(source.slice(source.indexOf('function renderNarrativeSection('), source.indexOf('function renderResults('))));
});

test('invalid JSON from the final provider call is charged and not silently retried', async () => {
    let calls = 0;
    await assert.rejects(core.callOpenRouter({
        apiKey: 'fake', request: { ...minimalRequest(), stage: 'synthesize' }, sleepImpl: async () => {},
        fetchImpl: async () => {
            calls += 1;
            return fakeResponse(200, { choices: [{ message: { content: '**On Nitter**, commenters disagree.' }, finish_reason: 'stop' }], usage: { cost: 0.02 } });
        },
    }), error => error instanceof core.InvalidResponseError && /not valid JSON/.test(error.message) && error.usage.cost === 0.02 && error.response === '**On Nitter**, commenters disagree.');
    assert.equal(calls, 1);
});

function validFormatResponse(stage) {
    return stage === 'consolidate'
        ? { axes: TOY_AXES.map(({ statementA, statementB }) => ({ statementA, statementB })) }
        : { sections: [{ text: 'Portion value divides the discussion[[axis:1]].', axisIds: [1] }], caveats: [] };
}

function formatFake(log, stage, original, repair, options = {}) {
    const fake = makeFakeCallChat(log);
    return async call => {
        if (call.stage !== stage) return fake(call);
        log.push(call);
        const repairing = !!call.meta.formatRepair;
        const content = repairing ? repair : original;
        const cost = repairing ? (options.repairCost ?? 0.03) : (options.originalCost ?? 0.02);
        return core.callOpenRouter({
            apiKey: 'fake', request: call, signal: call.signal, sleepImpl: async () => {},
            fetchImpl: async (_, request) => {
                assert.equal(request.method, 'POST', 'fixtures do not need billing lookups');
                if (options.onCall) options.onCall(call);
                return fakeResponse(200, {
                    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) },
                        finish_reason: !repairing && options.truncated ? 'length' : 'stop' }],
                    usage: { cost },
                });
            },
        });
    };
}

test('missing, malformed and unknown citation markers use bounded repair for fresh output and cached replay', async () => {
    for (const text of ['Unmarked claim.', 'Claim[[axis:1].', 'Claim[[axis:999]].']) {
        const original = { sections: [{ text, axisIds: [1] }], caveats: [] };
        const repaired = { sections: [{
            text: 'The portion trade-off divides opinion[[axis:1]], while noise is a separate concern[[axis:2]]. Context matters.',
            axisIds: [1, 2],
        }], caveats: [] };
        const { api } = mapStore();
        const log = [];
        const thread = core.flattenThread(TOY_THREAD);
        const run = callChat => core.runPipeline({ thread, config: TOY_CONFIG, onProgress: () => {}, callChat });
        const failed = await run(core.makeCachedCallChat(formatFake(log, 'synthesize', original, original), api));
        assert.equal(log.filter(call => call.stage === 'synthesize').length, 2);
        assert.equal(failed.synthesis, null);
        assert.equal(failed.rows.length, 6);
        assert.match(failed.synthesisError, /format repair failed.*citation marker/s);
        assert.deepEqual(failed.synthesisFailure, { response: original, repairResponse: original });
        const retries = [];
        const recovered = await run(core.makeCachedCallChat(formatFake(retries, 'synthesize', original, repaired), api));
        assert.deepEqual(recovered.synthesis, repaired);
        assert.equal(retries.length, 1, 'only the bounded repair is retried; analysis and original synthesis are cached');
        assert.equal(retries[0].meta.formatRepair, true);
        assert.match(retries[0].messages.at(-1).content, /citation marker/);
        const probe = await core.probeCache({ thread, config: TOY_CONFIG, store: api });
        assert.equal(probe.complete, true);
        const replay = await run(core.makeCachedCallChat(() => { throw new Error('No network'); }, api));
        assert.equal(replay.cost, 0);
        assert.deepEqual(replay.synthesis, repaired);
    }
});

for (const stage of ['consolidate', 'synthesize']) {
    test(`${stage} repairs Markdown and malformed shapes once, with shared fresh/cache validation`, async () => {
        const badShapes = ['**Main disagreement**\n\nSome support it; others disagree.', { wrong: true },
            stage === 'consolidate' ? { axes: [null, {}, 'prose'] } : { sections: [{ text: 'Missing references' }], caveats: [] }];
        for (const original of badShapes) {
            const { api, store } = mapStore();
            const log = [];
            const run = callChat => core.runPipeline({
                thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {}, callChat,
            });
            const result = await run(core.makeCachedCallChat(formatFake(log, stage, original, validFormatResponse(stage)), api));
            assert.ok(result.synthesis);
            assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
            const calls = log.filter(call => call.stage === stage);
            assert.equal(calls.length, 2);
            const [first, repair] = calls;
            assert.equal(repair.meta.formatRepair, true);
            for (const field of ['stage', 'model', 'schema', 'sampling', 'reasoning', 'maxTokens']) {
                assert.deepEqual(repair[field], first[field], field);
            }
            assert.deepEqual(repair.messages.slice(0, -2), first.messages);
            assert.equal(repair.messages.at(-2).content, typeof original === 'string' ? original : JSON.stringify(original));
            assert.match(repair.messages.at(-1).content, /failed validation:.*(?:not valid JSON|axes|narrative)/);
            assert.match(repair.messages.at(-1).content, /one attempt/);
            assert.notEqual(core.requestCacheKey(first), core.requestCacheKey(repair));
            assert.equal(store.size, result.calls, 'original and repair both persist');
            assertClose(result.cost, (result.calls - 2) * 0.001 + 0.05, 'all paid calls counted');
            assert.equal(result.calls, log.length);
            const probe = await core.probeCache({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, store: api });
            assert.equal(probe.complete, true);
            assert.deepEqual(probe.stages.find(item => item.stage === stage), { stage, hits: 2, total: 2 });
            const replay = await run(core.makeCachedCallChat(() => { throw new Error('No network'); }, api));
            assert.equal(replay.cost, 0);
            assert.equal(replay.stats.cachedCalls, replay.calls);
            assert.deepEqual(replay.rows, result.rows);
            assert.deepEqual(replay.synthesis, result.synthesis);
        }
    });

    test(`${stage} preserves safe fence and list normalization without repair`, async () => {
        const log = [];
        const valid = validFormatResponse(stage);
        const content = '```json\n' + JSON.stringify(stage === 'consolidate' ? valid.axes : valid) + '\n```';
        const result = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
            callChat: formatFake(log, stage, content, 'must not be used'),
        });
        assert.ok(result.synthesis);
        assert.equal(log.filter(call => call.stage === stage).length, 1);
        assert.ok(!log.some(call => call.meta.formatRepair));
    });

    test(`${stage} failed repair is capped, diagnostic output persists, explicit retry only repairs`, async () => {
        const { api, store } = mapStore();
        const log = [];
        const progress = [];
        const run = callChat => core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: event => progress.push(event), callChat,
        });
        const failing = run(core.makeCachedCallChat(formatFake(log, stage, '**Original prose**', '**Still prose**'), api));
        if (stage === 'synthesize') {
            const result = await failing;
            assert.equal(result.synthesis, null);
            assert.match(result.synthesisError, /format repair failed.*not valid JSON.*Original validation/s);
            assert.deepEqual(result.synthesisFailure, { response: '**Original prose**', repairResponse: '**Still prose**' });
            assert.equal(result.rows.length, 6);
        } else {
            await assert.rejects(failing, /format repair failed.*not valid JSON.*Original validation/s);
            assert.ok(!log.some(call => call.stage === 'score'));
        }
        const calls = log.filter(call => call.stage === stage);
        assert.equal(calls.length, 2);
        assertClose(progress.at(-1).cost, (log.length - 2) * 0.001 + 0.05, 'failed original and repair billed');
        assert.equal(progress.at(-1).calls, log.length);
        assert.equal(store.get(core.requestCacheKey(calls[0])).responseError.response, '**Original prose**');
        assert.equal(store.get(core.requestCacheKey(calls[1])).responseError.response, '**Still prose**');
        const probe = await core.probeCache({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, store: api });
        assert.equal(probe.complete, false);
        assert.deepEqual(probe.stages.at(-1), { stage, hits: 1, total: 2 });
        const retries = [];
        const recovered = await run(core.makeCachedCallChat(makeFakeCallChat(retries), api));
        assert.ok(recovered.synthesis);
        assert.deepEqual(retries.filter(call => call.stage === stage).map(call => call.meta.formatRepair), [true]);
    });

    test(`${stage} exhausted budget or cancellation prevents repair and retains original paid output`, async () => {
        for (const mode of ['budget', 'cancel']) {
            const { api, store } = mapStore();
            const log = [];
            const controller = new AbortController();
            const fake = makeFakeCallChat(log);
            const malformed = formatFake(log, stage, '**Original prose**', validFormatResponse(stage), {
                originalCost: 1,
                onCall: () => { if (mode === 'cancel') controller.abort(); },
            });
            const running = core.runPipeline({
                thread: core.flattenThread(TOY_THREAD), config: { ...TOY_CONFIG, budgetUsd: 1 }, signal: controller.signal, onProgress: () => {},
                callChat: core.makeCachedCallChat(async call => {
                    if (call.stage === stage) return malformed(call);
                    return { ...await fake(call), usage: { cost: 0 } };
                }, api),
            });
            if (stage === 'synthesize') {
                const result = await running;
                assert.equal(result.synthesis, null);
                assert.match(result.synthesisError, mode === 'budget' ? /Budget exhausted.*format repair/ : /Cancelled/);
                assert.equal(result.cost, 1);
                assert.equal(result.rows.length, 6);
            } else {
                await assert.rejects(running, mode === 'budget' ? /Budget exhausted.*format repair/ : /Cancelled/);
            }
            const calls = log.filter(call => call.stage === stage);
            assert.equal(calls.length, 1);
            assert.equal(store.get(core.requestCacheKey(calls[0])).responseError.response, '**Original prose**');
            const retries = [];
            const recovered = await core.runPipeline({
                thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
                callChat: core.makeCachedCallChat(makeFakeCallChat(retries), api),
            });
            assert.ok(recovered.synthesis);
            assert.deepEqual(retries.filter(call => call.stage === stage).map(call => call.meta.formatRepair), [true]);
        }
    });

    test(`${stage} truncated output is billed and repaired once using its saved raw response`, async () => {
        const log = [];
        const result = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
            callChat: formatFake(log, stage, '{"truncated":', validFormatResponse(stage), { truncated: true }),
        });
        assert.ok(result.synthesis);
        assert.equal(log.filter(call => call.stage === stage).length, 2);
        assert.match(log.find(call => call.meta.formatRepair).messages.at(-1).content, /truncated at max_tokens/);
        assertClose(result.cost, (log.length - 2) * 0.001 + 0.05, 'truncation and repair billed');
    });
}

test('unknown billing for original or repair stops spending and recovers only metadata before retry', async () => {
    for (const stage of ['consolidate', 'synthesize']) {
        for (const unknownOnRepair of [false, true]) {
            const { api } = mapStore();
            const fake = makeFakeCallChat([]);
            const posts = [];
            let billingReady = false;
            const callChat = async call => {
                if (call.stage !== stage) return fake(call);
                const repairing = !!call.meta.formatRepair;
                return core.callOpenRouter({
                    apiKey: 'fake', request: call, sleepImpl: async () => {},
                    fetchImpl: async (_, request) => {
                        if (request.method === 'GET') return fakeResponse(billingReady ? 200 : 404, { data: { id: 'pending', total_cost: 0.04 } });
                        posts.push(repairing);
                        return fakeResponse(200, {
                            id: 'pending',
                            choices: [{ message: { content: repairing ? JSON.stringify(validFormatResponse(stage)) : '**Original prose**' }, finish_reason: 'stop' }],
                            usage: repairing === unknownOnRepair ? {} : { cost: 0.02 },
                        });
                    },
                });
            };
            const run = () => core.runPipeline({
                thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
                callChat: core.makeCachedCallChat(callChat, api),
            });
            if (stage === 'synthesize') {
                const failed = await run();
                assert.equal(failed.synthesis, null);
                assert.match(failed.synthesisError, /cost is unknown.*not a zero-cost call/);
                assert.equal(failed.rows.length, 6);
            } else {
                await assert.rejects(run(), core.CostUnavailableError);
            }
            assert.deepEqual(posts, unknownOnRepair ? [false, true] : [false]);
            const probe = await core.probeCache({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, store: api });
            assert.equal(probe.complete, false);
            billingReady = true;
            const recovered = await run();
            assert.ok(recovered.synthesis);
            assert.deepEqual(posts, [false, true], 'one original and one repair generation across both runs');
            assert.ok(recovered.cost >= 0.04, 'recovered charge is not a free cache hit');
        }
    }
});

test('missing cost in a custom response or cache is never silently treated as free', async () => {
    const { api, store } = mapStore();
    const calls = [];
    const fake = makeFakeCallChat(calls);
    const run = callChat => core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {}, callChat,
    });
    const failed = await run(core.makeCachedCallChat(async call => {
        const response = await fake(call);
        return call.stage === 'synthesize' ? { ...response, usage: {} } : response;
    }, api));
    assert.match(failed.synthesisError, /cost is unknown/);
    assert.equal(calls.filter(call => call.stage === 'synthesize').length, 1);
    const synthesisKey = core.requestCacheKey(calls.find(call => call.stage === 'synthesize'));
    assert.deepEqual(store.get(synthesisKey).usage, {});
    const replay = await run(core.makeCachedCallChat(() => { throw new Error('No paid retry'); }, api));
    assert.match(replay.synthesisError, /cost is unknown/);
    assert.equal(replay.synthesis, null);
    assert.equal((await core.probeCache({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, store: api })).complete, false);
});

test('a format failure without known usage cannot start a repair or become a free cached response', async () => {
    const { api } = mapStore();
    const log = [];
    const fake = makeFakeCallChat(log);
    let attempts = 0;
    const run = callChat => core.runPipeline({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {}, callChat });
    const failed = await run(core.makeCachedCallChat(call => {
        if (call.stage !== 'synthesize') return fake(call);
        attempts++;
        throw new core.InvalidResponseError('malformed content', '**Original prose**');
    }, api));
    assert.match(failed.synthesisError, /cost is unknown.*not a zero-cost call/);
    assert.equal(attempts, 1);
    const retried = await run(core.makeCachedCallChat(() => { throw new Error('Must not repeat unknown-charge output'); }, api));
    assert.match(retried.synthesisError, /cost is unknown/);
    assert.equal(retried.synthesis, null);
});

test('missing completion content and choices retain their known charge without transport regeneration', async () => {
    for (const choices of [[], [{ message: {} }]]) {
        const { api } = mapStore();
        let posts = 0;
        const request = { ...minimalRequest(), stage: 'synthesize', meta: { axisIds: [1] } };
        const cached = core.makeCachedCallChat(call => core.callOpenRouter({
            apiKey: 'fake', request: call, sleepImpl: async () => {},
            fetchImpl: async () => {
                posts++;
                return fakeResponse(200, { choices, usage: { cost: 0.02 } });
            },
        }), api);
        await assert.rejects(cached(request), error => error instanceof core.InvalidResponseError && error.usage.cost === 0.02 && error.response === null);
        await assert.rejects(cached(request), error => error instanceof core.InvalidResponseError && error.usage.cached && error.usage.cost === 0);
        assert.equal(posts, 1);
    }
});

test('paid malformed extraction and scoring content split rather than repeating the original request', async () => {
    for (const stage of ['extract', 'score']) {
        const { api } = mapStore();
        const calls = [];
        const fake = makeFakeCallChat(calls);
        const run = callChat => core.runPipeline({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {}, callChat });
        const result = await run(core.makeCachedCallChat(async call => {
            if (call.stage !== stage || call.meta.commentIds.length === 1) return fake(call);
            calls.push(call);
            return core.callOpenRouter({
                apiKey: 'fake', request: call, sleepImpl: async () => {},
                fetchImpl: async () => fakeResponse(200, {
                    choices: [{ message: { content: 'Not JSON' } }], usage: { cost: 0.001 },
                }),
            });
        }, api));
        assert.ok(result.synthesis);
        assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
        assert.equal(new Set(calls.map(core.requestCacheKey)).size, calls.length);
        assert.ok(!calls.some(call => call.meta.formatRepair));
        assertClose(result.cost, calls.length * 0.001, 'malformed split parents still billed');
        const replay = await run(core.makeCachedCallChat(() => { throw new Error('No network'); }, api));
        assert.equal(replay.cost, 0);
        assert.equal(replay.stats.cachedCalls, replay.calls);
        assert.deepEqual(replay.rows, result.rows);
    }
});

test('a terminal batch error drains in-flight calls, stops all queued work, and permits explicit retry', async () => {
    for (const mode of ['network', 'shape']) {
        const { api, store } = mapStore();
        const log = [];
        const fake = makeFakeCallChat([]);
        const controller = new AbortController();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const config = { ...TOY_CONFIG, extractBatchChars: 1 };
        const progress = [];
        const running = core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config, signal: controller.signal, onProgress: event => progress.push(event),
            callChat: core.makeCachedCallChat(async call => {
                log.push(call);
                if (log.length === 1) {
                    if (mode === 'network') throw new Error('network unavailable');
                    return { json: { wrong: true }, usage: { cost: 0.02 } };
                }
                await gate;
                assert.equal(call.signal.aborted, false);
                return fake(call);
            }, api),
        });
        let settled = false;
        const checked = assert.rejects(running, mode === 'network' ? /network unavailable/ : /candidates array/).then(() => { settled = true; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(log.length, 2);
        assert.equal(settled, false);
        release();
        await checked;
        assert.equal(log.length, 2, 'no more requests scheduled after terminal failure');
        assert.equal(progress.at(-1).inFlight, 0);
        assertClose(progress.at(-1).cost, mode === 'network' ? 0.001 : 0.021, 'drained call and known failed charge recorded');
        assert.equal(store.get(core.requestCacheKey(log[1])).usage.cost, 0.001);
        const probe = await core.probeCache({ thread: core.flattenThread(TOY_THREAD), config, store: api });
        assert.equal(probe.complete, false);
        assert.equal(probe.stages[0].hits, 1, 'invalid singleton is a miss, not a permanently poisoned cache hit');
        const retries = [];
        const recovered = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config, onProgress: () => {},
            callChat: core.makeCachedCallChat(makeFakeCallChat(retries), api),
        });
        assert.ok(recovered.synthesis);
        assert.ok(retries.some(call => core.requestCacheKey(call) === core.requestCacheKey(log[0])));
        assert.ok(!retries.some(call => core.requestCacheKey(call) === core.requestCacheKey(log[1])));
    }
});

test('repair cancellation, over-budget completion, and transport failure preserve comparisons and accounted output', async () => {
    for (const mode of ['cancel', 'budget', 'network']) {
        const { api } = mapStore();
        const log = [];
        const controller = new AbortController();
        const malformed = formatFake(log, 'synthesize', '**Original prose**', validFormatResponse('synthesize'), {
            repairCost: mode === 'budget' ? 2 : 0.03,
            onCall: call => { if (mode === 'cancel' && call.meta.formatRepair) controller.abort(); },
        });
        const result = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, signal: controller.signal, onProgress: () => {},
            callChat: core.makeCachedCallChat(async call => {
                if (mode === 'network' && call.meta.formatRepair) {
                    log.push(call);
                    throw new Error('repair network unavailable');
                }
                return malformed(call);
            }, api),
        });
        assert.equal(log.filter(call => call.stage === 'synthesize').length, 2);
        assert.equal(result.synthesis, null);
        assert.equal(result.rows.length, 6);
        assert.match(result.synthesisError, mode === 'cancel' ? /Cancelled/ : mode === 'budget' ? /Budget/ : /repair network unavailable/);
        assert.equal(result.synthesisFailure.response, '**Original prose**');
        assertClose(result.cost, (log.length - 2) * 0.001 + 0.02 + (mode === 'budget' ? 2 : mode === 'cancel' ? 0.03 : 0), 'all completed output billed');
        const retries = [];
        const recovered = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
            callChat: core.makeCachedCallChat(makeFakeCallChat(retries), api),
        });
        assert.ok(recovered.synthesis);
        if (mode === 'network') {
            assert.deepEqual(retries.map(call => call.meta.formatRepair), [true]);
        } else {
            assert.equal(retries.length, 0, 'completed repair was cached despite cancellation/budget stop');
            assert.equal(recovered.cost, 0);
        }
    }
});

test('failed storage retains raw original in the cache wrapper and warns before a new run can repeat it', async () => {
    for (const throws of [false, true]) {
        const log = [];
        const failing = formatFake(log, 'synthesize', '**Original prose**', '**Invalid repair**');
        const good = makeFakeCallChat(log);
        let recovering = false;
        const cached = core.makeCachedCallChat(call => recovering ? good(call) : failing(call), {
            get: () => undefined,
            set: () => { if (throws) throw new Error('storage unavailable'); return false; },
        });
        const run = () => core.runPipeline({ thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {}, callChat: cached });
        const failed = await run();
        assert.equal(failed.synthesisFailure.response, '**Original prose**');
        assert.equal(failed.stats.cacheWriteFailures, failed.calls);
        assert.ok(failed.warnings.some(warning => /cache writes failed.*new run or reload/.test(warning)));
        const count = log.length;
        recovering = true;
        const recovered = await run();
        assert.ok(recovered.synthesis);
        assert.equal(log.length, count + 1);
        assert.equal(log.at(-1).meta.formatRepair, true);
        assertClose(recovered.cost, 0.001, 'retained original is not billed twice');
    }
});

test('synthesis samples each author once per class and keeps self contradiction separate', () => {
    const comments = [
        { id: 1, author: 'repeated-author', text: 'x'.repeat(1500) },
        { id: 2, author: 'repeated-author', text: 'Again' },
        { id: 3, author: 'contradicting-author', text: 'Yes' },
        { id: 4, author: 'contradicting-author', text: 'No' },
        { id: 5, author: 'minority-author', text: 'Minority reasoning' },
    ];
    const row = { axisId: 1, statementA: 'A', statementB: 'B', commentIdsA: [1, 2, 3], commentIdsB: [4, 5], commentIdsM: [] };
    const messages = core.buildSynthesisMessages('Title', [row], core.indexCommentsById(comments));
    const axis = JSON.parse(messages[1].content).axes[0];
    assert.deepEqual(axis.people, { A: 1, B: 1, middle: 0, selfContradiction: 1 });
    assert.deepEqual(axis.evidence.A.map(item => item.commentId), [1]);
    assert.equal(axis.evidence.A[0].excerpt.length, 703);
    assert.deepEqual(axis.evidence.B.map(item => item.commentId), [5]);
    assert.equal(axis.evidence.C.length, 1);
    assert.ok(!messages[1].content.includes('repeated-author'));
});

test('failed synthesis preserves comparisons and valid cached stages; retry and reopening are free for hits', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const fake = makeFakeCallChat([]);
    const run = callChat => core.runPipeline({ thread, config: TOY_CONFIG, onProgress: () => {}, callChat });
    const failed = await run(core.makeCachedCallChat(async call => {
        if (call.stage === 'synthesize') return { json: { sections: [{ text: 'Invented reference', axisIds: [999] }], caveats: [] }, usage: { cost: 0.002 } };
        return fake(call);
    }, api));
    assert.equal(failed.synthesis, null);
    assert.match(failed.synthesisError, /unsupported axis/);
    assert.equal(failed.synthesisFailure.response.sections[0].text, 'Invented reference');
    assert.match(failed.warnings.at(-1), /uncached calls may cost money/);
    assert.deepEqual(failed.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assertClose(failed.cost, (failed.calls - 2) * 0.001 + 0.004, 'invalid original and repair both billed');
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, false);
    assert.deepEqual(probe.stages.at(-1), { stage: 'synthesize', hits: 1, total: 2 });
    const log = [];
    const recovered = await run(core.makeCachedCallChat(makeFakeCallChat(log), api));
    assert.deepEqual(log.map(call => call.stage), ['synthesize']);
    assert.ok(recovered.synthesis);
    const reopened = await run(core.makeCachedCallChat(() => { throw new Error('No network allowed'); }, api));
    assert.equal(reopened.cost, 0);
    assert.deepEqual(reopened.synthesis, recovered.synthesis);
});

test('short synthesis refreshes only its model cache and ignores prior saved-result versions', async () => {
    const { store, api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const calls = [];
    const run = callChat => core.runPipeline({ thread, config: TOY_CONFIG, onProgress: () => {}, callChat });
    await run(core.makeCachedCallChat(makeFakeCallChat(calls), api));
    const synthesisCall = calls.find(call => call.stage === 'synthesize');
    const currentKey = core.requestCacheKey(synthesisCall);
    const previousCall = {
        ...synthesisCall,
        messages: synthesisCall.messages.map(message => ({
            ...message, content: message.content.replace(/^Short synthesis format v4\. /, 'Short synthesis format v3. '),
        })),
    };
    const previousKey = core.requestCacheKey(previousCall);
    assert.notEqual(currentKey, previousKey);
    store.set(previousKey, {
        json: { sections: [{ text: 'Previous paragraph-end citations.', axisIds: [1] }], caveats: [] },
        usage: { cost: 1 },
    });
    store.delete(currentKey);
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, false);
    assert.deepEqual(probe.stages.at(-1), { stage: 'synthesize', hits: 0, total: 1 });
    const refreshed = [];
    await run(core.makeCachedCallChat(makeFakeCallChat(refreshed), api));
    assert.deepEqual(refreshed.map(call => call.stage), ['synthesize']);
    assert.ok(store.has(previousKey), 'old data is not deleted');
    const source = require('node:fs').readFileSync(require.resolve('../hn_polarization.html'), 'utf8');
    assert.match(source, /const RESULT_CACHE_VERSION = 6;/);
    assert.match(source, /saved\.version === RESULT_CACHE_VERSION/);
    assert.match(source, /cachedRecord\.version === RESULT_CACHE_VERSION/);
    assert.doesNotMatch(source, /Read saved narrative|synthesisNeedsDisclosure|predates narrative synthesis/);
});

test('invalid synthesis cache is retained and only its format repair is retried on explicit rerun', async () => {
    const { store, api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const calls = [];
    const run = callChat => core.runPipeline({ thread, config: TOY_CONFIG, onProgress: () => {}, callChat });
    await run(core.makeCachedCallChat(makeFakeCallChat(calls), api));
    const key = core.requestCacheKey(calls.find(call => call.stage === 'synthesize'));
    const rejected = { sections: [{ text: Array(101).fill('argument').join(' ') + '[[axis:1]]', axisIds: [1] }], caveats: [] };
    store.set(key, { json: rejected, usage: { cost: 0.07 } });
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, false);
    assert.deepEqual(probe.stages.at(-1), { stage: 'synthesize', hits: 1, total: 2 });
    let attempts = 0;
    const failed = await run(core.makeCachedCallChat(async call => {
        assert.equal(call.stage, 'synthesize');
        assert.equal(call.meta.formatRepair, true);
        attempts += 1;
        return { json: rejected, usage: { cost: 0.07 } };
    }, api));
    assert.equal(attempts, 1, 'one repair, without repeating the original paid call');
    assert.equal(failed.synthesis, null);
    assert.deepEqual(failed.synthesisFailure.response, rejected);
    assert.match(failed.synthesisError, /101 words \(maximum 100\)/);
    assert.equal(failed.cost, 0.07);
    assert.equal(failed.stats.cachedCalls, failed.calls - 1);
    const retries = [];
    const recovered = await run(core.makeCachedCallChat(makeFakeCallChat(retries), api));
    assert.deepEqual(retries.map(call => call.stage), ['synthesize']);
    assert.ok(recovered.synthesis);
    assert.equal(recovered.synthesisFailure, null);
    const reopened = await run(core.makeCachedCallChat(() => { throw new Error('No network'); }, api));
    assert.equal(reopened.cost, 0);
    assert.ok(reopened.synthesis);
});

test('cancelled and truncated synthesis preserve comparisons and surface failure', async () => {
    for (const mode of ['cancel', 'truncate', 'network']) {
        const controller = new AbortController();
        const fake = makeFakeCallChat([]);
        const result = await core.runPipeline({
            thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, signal: controller.signal, onProgress: () => {},
            callChat: async call => {
                if (call.stage !== 'synthesize') return fake(call);
                assert.equal(call.signal, controller.signal);
                if (mode === 'cancel') controller.abort();
                if (mode === 'truncate') throw new core.TruncationError('truncated final output', { cost: 0.005 });
                throw new Error('network unavailable');
            },
        });
        assert.equal(result.rows.length, 6);
        assert.equal(result.synthesis, null);
        assert.match(result.synthesisError, mode === 'cancel' ? /Cancelled/ : mode === 'truncate' ? /truncated/ : /network/);
        assert.ok(result.warnings.some(warning => warning.includes('Summary unavailable')));
    }
});

test('budget exceeded by final call still returns usable comparisons and records final spend', async () => {
    const fake = makeFakeCallChat([]);
    const result = await core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), config: { ...TOY_CONFIG, budgetUsd: 1 }, onProgress: () => {},
        callChat: async call => {
            const response = await fake(call);
            return call.stage === 'synthesize' ? { ...response, usage: { cost: 2 } } : response;
        },
    });
    assert.match(result.synthesisError, /Budget/);
    assert.equal(result.rows.length, 6);
    assert.ok(result.cost > 2);
});

test('no verified rows skips synthesis without inventing a narrative', async () => {
    const fake = makeFakeCallChat([]);
    const log = [];
    const result = await core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), config: TOY_CONFIG, onProgress: () => {},
        callChat: async call => {
            log.push(call.stage);
            if (call.stage === 'score') return { json: { stances: [] }, usage: { cost: 0 } };
            return fake(call);
        },
    });
    assert.equal(result.rows.length, 0);
    assert.equal(result.synthesis, null);
    assert.equal(log.includes('synthesize'), false);
});

test('runPipeline reproduces the toy ranking end to end with a fake model', async () => {
    const log = [];
    const progress = [];
    const thread = core.flattenThread(TOY_THREAD);
    const result = await core.runPipeline({
        thread,
        callChat: makeFakeCallChat(log),
        onProgress: (update) => progress.push(update),
        config: TOY_CONFIG,
    });
    assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assert.equal(result.axes.length, 6);

    const stages = log.map(call => call.stage);
    assert.equal(stages.filter(stage => stage === 'consolidate').length, 1);
    assert.equal(stages.filter(stage => stage === 'score').length, 6);
    assert.ok(stages.filter(stage => stage === 'extract').length >= 1);
    const swapped = log.filter(call => call.stage === 'score' && call.meta.swapPoles);
    assert.equal(swapped.length, 3);
    assert.notDeepEqual(swapped[0].meta.presentedAxes.map(axis => axis.id), [1, 2, 3, 4, 5, 6], 'pass 2 shuffles axis order');
    assertClose(result.cost, log.length * 0.001, 'cost is the sum of usage cost');
    assert.ok(progress.length > 0);
    assert.equal(result.candidates.length > 0, true);
});

test('runPipeline validates extraction ids against the batch it sent, not the whole thread', async () => {
    const thread = core.flattenThread(TOY_THREAD);
    const inner = makeFakeCallChat([]);
    const callChat = async (call) => {
        const response = await inner(call);
        if (call.stage === 'extract' && response.json.candidates.length > 0) {
            const outsider = thread.comments.map(comment => comment.id).find(id => !call.meta.commentIds.includes(id));
            response.json.candidates[0].commentsA.push(outsider);
        }
        return response;
    };
    const result = await core.runPipeline({ thread, callChat, onProgress: () => {}, config: TOY_CONFIG });
    assert.ok(result.warnings.some(warning => /unknown comment id/.test(warning)), 'an id from another batch is dropped with a warning');
});

// Wraps the fake model so that calls matching failWhen get `failure(call)` instead: a thrown error or a bad response.
function makeFailingFake(log, failWhen, failure) {
    const inner = makeFakeCallChat(log);
    return async (call) => {
        if (failWhen(call)) {
            log.push(call);
            return failure(call);
        }
        return inner(call);
    };
}

function makeTruncatingFake(log, truncateWhen) {
    return makeFailingFake(log, truncateWhen, call => {
        throw new core.TruncationError(`fake truncated ${call.stage}`, { promptTokens: 100, completionTokens: 32000, cost: 0.001 });
    });
}

test('formatRunCost and formatRunSummary describe a run in plain words', () => {
    const result = { rows: [1, 2, 3, 4], cost: 0.0449, calls: 7, stats: { comments: 32, authors: 20, cachedCalls: 0, agreedStances: 10, classifiedPairs: 17, reviewedPairs: 12, conflictingStances: 2, singlePassStances: 5 } };
    assert.equal(core.formatRunCost(result), '$0.04, 7 model calls (0 cached)');
    assert.equal(core.formatRunCost(result, 0.081), '$0.04 ($0.08), 7 model calls (0 cached)');
    assert.equal(core.formatClockDuration(490), '8:10');
    assert.deepEqual(core.formatRunSummary(result), [
        '4 rows from 32 comments by 20 commenters.',
        '10 stances passed blind review. Of 12 comment-axis pairs classified by both passes, 10 agreed (83%); 2 conflicts and 5 single-pass classifications were excluded.',
    ]);
});

test('formatRunSummary reports unverified axes separately from verified rows', () => {
    const result = {
        rows: [1, 2],
        unverifiedAxes: [{ id: 3 }],
        stats: { comments: 32, authors: 20, agreedStances: 10, classifiedPairs: 17 },
    };
    assert.equal(core.formatRunSummary(result)[0], '2 verified rows and 1 unverified axis from 32 comments by 20 commenters.');
});

test('runPipeline distinguishes scoring conflicts from single-pass classifications', async () => {
    const thread = core.flattenThread(TOY_THREAD);
    const result = await core.runPipeline({ thread, callChat: makeFakeCallChat([]), onProgress: () => {}, config: TOY_CONFIG });
    assert.equal(result.stats.classifiedPairs, 15);
    assert.equal(result.stats.reviewedPairs, 14);
    assert.equal(result.stats.conflictingStances, 1);
    assert.equal(result.stats.singlePassStances, 1);
    assert.equal(result.stats.agreedStances, 13);
    assert.deepEqual(result.unverifiedAxes, []);
});

test('runPipeline reports calls in flight, never more than the concurrency', async () => {
    const progress = [];
    const thread = core.flattenThread(TOY_THREAD);
    await core.runPipeline({ thread, callChat: makeFakeCallChat([]), onProgress: update => progress.push(update), config: TOY_CONFIG });
    const inFlight = progress.map(update => update.inFlight);
    assert.ok(inFlight.some(count => count > 0), 'some report shows a call in flight');
    assert.ok(inFlight.every(count => count >= 0 && count <= 2), 'never more than the concurrency');
    assert.equal(progress[progress.length - 1].inFlight, 0);
    assert.equal(core.formatProgress({ stage: 'extract', done: 0, total: 38, inFlight: 30, calls: 40, cachedCalls: 0, cost: 0.2138 }),
        'extract: 0/38 done, 30 in flight, 40 calls (none from cache), $0.2138 spent');
});

test('formatProgress says all from cache only for nonzero fully cached calls', () => {
    const update = { stage: 'score', done: 41, total: 41, inFlight: 0, calls: 41, cachedCalls: 41, cost: 0 };
    assert.ok(core.formatProgress(update).includes('41 calls (all from cache)'));
    assert.ok(core.formatProgress({ ...update, cachedCalls: 40 }).includes('41 calls (40 from cache)'));
    assert.ok(core.formatProgress({ ...update, cachedCalls: 0 }).includes('41 calls (none from cache)'));
    assert.ok(core.formatProgress({ ...update, calls: 0, cachedCalls: 0 }).includes('0 calls (none from cache)'));
});

test('runPipeline splits a scoring batch that truncates and still completes', async () => {
    const log = [];
    const thread = core.flattenThread(TOY_THREAD);
    const truncateWhen = call => call.stage === 'score' && call.meta.commentIds.length > 1 && call.meta.commentIds.includes(7);
    const result = await core.runPipeline({
        thread,
        callChat: makeTruncatingFake(log, truncateWhen),
        onProgress: () => {},
        config: TOY_CONFIG,
    });
    assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assert.ok(result.warnings.some(warning => /split/.test(warning)), 'split is reported as a warning');
    const singleCommentSevenCalls = log.filter(call => call.stage === 'score' && call.meta.commentIds.length === 1 && call.meta.commentIds[0] === 7);
    assert.equal(singleCommentSevenCalls.length, 2, 'comment 7 ends up scored alone once per pass');
    assertClose(result.cost, log.length * 0.001, 'truncated calls are still charged');
    assert.equal(result.calls, log.length);
});

test('runPipeline splits an extraction batch that truncates', async () => {
    const log = [];
    const thread = core.flattenThread(TOY_THREAD);
    const truncateWhen = call => call.stage === 'extract' && call.meta.commentIds.length > 1 && call.meta.commentIds.includes(3);
    const result = await core.runPipeline({
        thread,
        callChat: makeTruncatingFake(log, truncateWhen),
        onProgress: () => {},
        config: TOY_CONFIG,
    });
    assert.deepEqual(result.rows.map(row => row.axisId), TOY_EXPECTED_ORDER);
    const singleCommentThreeCalls = log.filter(call => call.stage === 'extract' && call.meta.commentIds.length === 1 && call.meta.commentIds[0] === 3);
    assert.equal(singleCommentThreeCalls.length, 1);
});

test('runPipeline fails when a single-comment batch still truncates', async () => {
    const thread = core.flattenThread(TOY_THREAD);
    const truncateWhen = call => call.stage === 'score' && call.meta.commentIds.includes(7);
    await assert.rejects(core.runPipeline({
        thread,
        callChat: makeTruncatingFake([], truncateWhen),
        onProgress: () => {},
        config: TOY_CONFIG,
    }), /truncated/);
});

test('runPipeline passes per-stage sampling and reasoning settings to the model calls', async () => {
    const log = [];
    const thread = core.flattenThread(TOY_THREAD);
    await core.runPipeline({
        thread,
        callChat: makeFakeCallChat(log),
        onProgress: () => {},
        config: {
            ...TOY_CONFIG,
            samplingExtract: { temperature: 0 }, samplingConsolidate: null, samplingScore: { temperature: 0.5 },
            reasoningExtract: null, reasoningConsolidate: { effort: 'high' }, reasoningScore: null,
        },
    });
    const byStage = stage => log.find(call => call.stage === stage);
    assert.deepEqual(byStage('extract').sampling, { temperature: 0 });
    assert.equal(byStage('extract').reasoning, null);
    assert.equal(byStage('consolidate').sampling, null);
    assert.deepEqual(byStage('consolidate').reasoning, { effort: 'high' });
    assert.deepEqual(byStage('score').sampling, { temperature: 0.5 });
});

// ---------------------------------------------------------------------------
// Presets, comment share, cost estimate, front page
// ---------------------------------------------------------------------------

test('model choices exist per role with labels, config fragments, and per-character rates', () => {
    assert.equal(core.DEFAULT_VOLUME_KEY, 'lunaLow');
    assert.equal(core.DEFAULT_CONSOLIDATION_KEY, 'astraLow');
    for (const [key, choice] of Object.entries(core.VOLUME_MODELS)) {
        assert.ok(choice.label.length > 0, key + ' has a label');
        assert.ok(choice.config.modelExtract && choice.config.modelScore, key + ' names the extraction and scoring model');
        assert.equal(choice.config.modelConsolidate, undefined, key + ' does not set the consolidation model');
        assert.equal(typeof choice.usdPerMillionChars, 'number');
    }
    for (const [key, choice] of Object.entries(core.CONSOLIDATION_MODELS)) {
        assert.ok(choice.label.length > 0, key + ' has a label');
        assert.ok(choice.config.modelConsolidate, key + ' names the consolidation model');
        assert.equal(choice.config.modelScore, undefined, key + ' does not set the scoring model');
        assert.equal(typeof choice.usdPerMillionChars, 'number');
    }
    assert.equal(core.CONSOLIDATION_MODELS.glm53.config.maxTokensConsolidate, 128000);
});

test('buildStageConfig merges one volume choice with one consolidation choice', () => {
    const config = core.buildStageConfig('glmFlash', 'sonnet5');
    assert.equal(config.modelExtract, 'z-ai/glm-5.3-flash');
    assert.equal(config.modelScore, 'z-ai/glm-5.3-flash');
    assert.equal(config.modelConsolidate, 'anthropic/claude-sonnet-5');
    assert.equal(config.samplingConsolidate, null);
    assert.deepEqual(config.samplingScore, { temperature: 0, seed: 12345 });
    assert.throws(() => core.buildStageConfig('nope', 'sonnet5'), /volume/);
    assert.throws(() => core.buildStageConfig('haiku', 'nope'), /consolidation/);
    assert.deepEqual(core.buildStageConfig(core.DEFAULT_VOLUME_KEY, core.DEFAULT_CONSOLIDATION_KEY).modelConsolidate, core.DEFAULT_CONFIG.modelConsolidate);
});

test('option labels are built from the entry constants and quality record', () => {
    const haiku = core.VOLUME_MODELS.haiku;
    const usd = (haiku.usdPerMillionChars * core.CHARS_PER_COMMENT / 1000).toFixed(2);
    assert.equal(haiku.label, `Claude Haiku 4.5: $${usd} and ${core.formatDuration(haiku.secondsPerMillionChars * core.CHARS_PER_COMMENT / 1000)} per 1000 comments. 0.5 stances per comment; 3.5 two-sided rows per 100 comments; 59% of stances held under blind review, 12% wrong; clean output.`);
    const sonnet = core.CONSOLIDATION_MODELS.sonnet5;
    assert.equal(sonnet.label, `Claude Sonnet 5: $${(sonnet.usdPerMillionChars * core.CHARS_PER_COMMENT / 1000).toFixed(2)} and 3 minutes per 1000 comments. 81.82% of axes two-sided across 5 threads; Same 1,234 HN comments; Luna low extraction/scoring. Opus 5 reviewed consolidation. Coverage excludes legitimately dropped candidates; flags are model judgments, not an accuracy grade.`);
    assert.equal(core.CONSOLIDATION_MODELS.lunaMax.label.endsWith('. 56% of axes two-sided.'), true, 'no note, no runs');
});

test('extraction model metrics have clear columns and measured values', () => {
    assert.deepEqual(core.VOLUME_METRIC_COLUMNS.map(([, label]) => label), [
        'Model', 'Reasoning effort', 'Estimated cost / 1k comments', 'Estimated time / 1k comments',
        'Stances found / comment', 'Two-sided rows / 100 comments',
        'Stances held in blind review', 'Stances wrong in blind review',
    ]);
    assert.deepEqual(core.volumeMetrics(core.VOLUME_MODELS.lunaLow), {
        model: 'GPT-5.6 Luna',
        reasoning: 'low',
        cost: '$0.26',
        time: '2 minutes',
        stances: '0.5',
        rows: '6',
        consistency: '80%',
        wrong: '6%',
    });
    assert.equal(core.VOLUME_MODELS.opus5.effort, 'adaptive');
});

test('consolidation model metrics use role-specific columns', () => {
    assert.deepEqual(core.CONSOLIDATION_METRIC_COLUMNS.map(([, label]) => label), [
        'Model', 'Cost / 1k comments', 'Minutes / 1k comments',
        'Two-sided comparisons / 1k comments', 'Axes flagged in review', 'Candidates fully preserved in review',
    ]);
    assert.deepEqual(core.consolidationMetrics(core.CONSOLIDATION_MODELS.sonnet5), {
        model: 'Claude Sonnet 5 (adaptive)',
        reasoning: 'adaptive',
        cost: '$0.55',
        time: '3.2',
        twoSidedPer1k: '72.9',
        twoSided: '81.82%',
        flagged: '21.8% (24/110)',
        preserved: '75.2% (173/230)',
        measurement: '5 threads',
    });
    assert.equal(core.CONSOLIDATION_MODELS.glm53.effort, 'high');
});

test('combinedRate scales the consolidation rate by the volume model\'s candidate factor', () => {
    const opus = core.VOLUME_MODELS.opus5;
    const sonnet = core.CONSOLIDATION_MODELS.sonnet5;
    assertClose(core.combinedRate('opus5', 'sonnet5', 'usdPerMillionChars'), opus.usdPerMillionChars + sonnet.usdPerMillionChars * opus.candidateFactor + sonnet.synthesisRates.usdPerMillionChars, 'opus factor plus measured synthesis rate applied');
    assert.equal(core.VOLUME_MODELS.haiku.candidateFactor, 1, 'Haiku is the reference');
    for (const choice of Object.values(core.VOLUME_MODELS)) {
        assert.ok(choice.candidateFactor > 0);
    }
});

test('combinedRate sums the per-character rates and estimateRunSeconds never goes below the stage latency floor', () => {
    const expected = core.VOLUME_MODELS.haiku.usdPerMillionChars + core.CONSOLIDATION_MODELS.sonnet5.usdPerMillionChars + core.CONSOLIDATION_MODELS.sonnet5.synthesisRates.usdPerMillionChars;
    assertClose(core.combinedRate('haiku', 'sonnet5', 'usdPerMillionChars'), expected, 'combined rate');
    const seconds = core.estimateRunSeconds(416000, 'haiku', 'sonnet5');
    assertClose(seconds, (core.VOLUME_MODELS.haiku.secondsPerMillionChars + 2 * core.CONSOLIDATION_MODELS.sonnet5.secondsPerMillionChars) * 0.416, 'seconds for a large thread');
    const floor = 2 * core.VOLUME_MODELS.haiku.minimumSeconds + 2 * core.CONSOLIDATION_MODELS.sonnet5.minimumSeconds;
    assert.equal(core.estimateRunSeconds(0, 'haiku', 'sonnet5'), floor);
    assert.equal(core.estimateRunSeconds(8000, 'haiku', 'sonnet5'), floor, 'a small thread is bounded by latency');
    assert.equal(floor, 46, 'includes the additional synthesis latency');
    for (const choice of Object.values(core.VOLUME_MODELS).concat(Object.values(core.CONSOLIDATION_MODELS))) {
        assert.ok(choice.minimumSeconds > 0);
    }
});

test('largestShareWithinBudget returns the biggest share whose forecast fits, and 0 when nothing fits', () => {
    const comments = Array.from({ length: 10 }, (_, index) => fakeComment(index + 1, 0, 1));
    const rate = 1000000 / (1 + core.CONSTANTS.COMMENT_FRAME_CHARS); // $1 per comment: one character of text plus the frame
    assert.equal(core.largestShareWithinBudget(comments, rate, 10), 100);
    assert.equal(core.largestShareWithinBudget(comments, rate, 4.5), 40);
    assert.equal(core.largestShareWithinBudget(comments, rate, 0.5), 0);
    assert.equal(core.largestShareWithinBudget([], rate, 1), 100, 'an empty thread fits any budget');
});

test('threadShare restricts a thread to the top share of its comments and keeps its other fields', () => {
    const comments = Array.from({ length: 10 }, (_, index) => fakeComment(index + 1, 0, 1));
    const shared = core.threadShare({ id: 7, title: 'T', comments }, 30);
    assert.deepEqual(shared.comments.map(comment => comment.id), [1, 2, 3]);
    assert.equal(shared.id, 7);
    assert.equal(shared.title, 'T');
    assert.equal(comments.length, 10, 'the original is untouched');
});

test('selectCommentShare keeps the first share of the comments in thread order, rounding up', () => {
    const comments = Array.from({ length: 40 }, (_, index) => fakeComment(index + 1, 0, 1));
    const ids = list => list.map(comment => comment.id);
    assert.deepEqual(ids(core.selectCommentShare(comments, 100)), ids(comments), '100% keeps everything');
    assert.deepEqual(core.selectCommentShare(comments, 0), []);
    assert.deepEqual(ids(core.selectCommentShare(comments, 25)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(core.selectCommentShare(comments, 1).length, 1, 'rounds up so a small share is not empty');
    assert.throws(() => core.selectCommentShare(comments, 101), /percent/);
});

test('estimateRunCost applies a per-million-character rate to the selected comments', () => {
    const comments = [fakeComment(1, 0, 1000), fakeComment(2, 0, 1000)];
    const estimate = core.estimateRunCost(comments, 10);
    assert.equal(estimate.chars, 2000 + 2 * core.CONSTANTS.COMMENT_FRAME_CHARS);
    assertClose(estimate.usd, 10 * (estimate.chars / 1000000), 'estimate');
    assert.equal(core.estimateRunCost([], 10).usd, 0, 'nothing selected costs nothing');
});

test('storySearchUrl builds an Algolia story search for the encoded query', () => {
    const url = core.storySearchUrl('GoDaddy & SOPA');
    assert.ok(url.startsWith('https://hn.algolia.com/api/v1/search?'));
    assert.ok(url.includes('tags=story'));
    assert.equal(new URL(url).searchParams.get('hitsPerPage'), '30');
    assert.ok(url.includes('query=GoDaddy%20%26%20SOPA'));
});

test('parseFrontPage maps Algolia hits to id, title, comment count and date, skipping malformed hits', () => {
    const json = { hits: [
        { objectID: '49525378', title: 'Claude Fable 5.1', num_comments: 1297, created_at: '2026-09-01T17:53:53.000Z' },
        { objectID: '1', title: 'No count or date' },
        { title: 'No id', num_comments: 3 },
    ] };
    const stories = core.parseFrontPage(json);
    assert.deepEqual(stories, [
        { id: 49525378, title: 'Claude Fable 5.1', numComments: 1297, createdAt: '2026-09-01T17:53:53.000Z' },
        { id: 1, title: 'No count or date', numComments: 0, createdAt: null },
    ]);
    assert.throws(() => core.parseFrontPage({ nope: [] }), /hits/);
});

test('parseCurrentCommentCount reads and validates the live Hacker News descendants count', () => {
    assert.equal(core.parseCurrentCommentCount({ descendants: 1717 }, 49554643), 1717);
    assert.throws(() => core.parseCurrentCommentCount({}, 49554643), /no valid descendants count/);
    assert.throws(() => core.parseCurrentCommentCount({ descendants: -1 }, 49554643), /no valid descendants count/);
});

test('storyLabel shows title, comment count, posting date and id; sortStoriesNewestFirst orders by date descending', () => {
    const older = { id: 1, title: 'Older', numComments: 5, createdAt: '2026-08-30T10:00:00' };
    const newer = { id: 2, title: 'Newer', numComments: 7, createdAt: '2026-09-02T09:05:00' };
    const undated = { id: 3, title: 'Undated', numComments: 0, createdAt: null };
    assert.equal(core.storyLabel(newer), 'Newer (7 comments, 2026-09-02 09:05 AM, 2)');
    assert.equal(core.storyDetails(newer), '(7 comments, 2026-09-02 09:05 AM, 2)');
    assert.equal(core.storyDate(newer), '2026-09-02 09:05 AM');
    assert.equal(core.storyDate(undated), 'unknown date');
    assert.equal(core.storyLabel(undated), 'Undated (0 comments, unknown date, 3)');
    assert.deepEqual(core.sortStoriesNewestFirst([older, undated, newer]).map(story => story.id), [2, 1, 3]);
});

test('formatLocalDateTime uses a zero-padded local 12-hour clock without seconds', () => {
    assert.equal(core.formatLocalDateTime('2026-09-02T00:05:59'), '2026-09-02 12:05 AM');
    assert.equal(core.formatLocalDateTime('2026-09-02T13:07:59'), '2026-09-02 01:07 PM');
    assert.equal(core.formatLocalDateTime('not a date'), 'unknown date');
});

// ---------------------------------------------------------------------------
// OpenRouter PKCE sign-in
// ---------------------------------------------------------------------------

test('pkceChallenge matches the RFC 7636 example', async () => {
    const challenge = await core.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('makePkceVerifier produces a base64url string of the expected length', () => {
    const verifier = core.makePkceVerifier();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(verifier, core.makePkceVerifier());
});

test('openRouterAuthUrl carries the callback, the challenge and the method', () => {
    const url = new URL(core.openRouterAuthUrl('http://localhost:8791/page.html', 'abc'));
    assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth');
    assert.equal(url.searchParams.get('callback_url'), 'http://localhost:8791/page.html');
    assert.equal(url.searchParams.get('code_challenge'), 'abc');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('run page URLs carry every setting and use the snapshot time as the cache nonce', () => {
    const selection = {
        article: '49537553',
        snapshot: '2026-09-04T12:34:56.789Z',
        share: 50,
        volume: 'lunaLow',
        consolidation: 'sonnet5',
        budget: 1.5,
    };
    const value = core.makeRunPageUrl('https://example.test/hn.html?code=discarded#old', selection);
    const url = new URL(value);
    assert.equal(url.origin + url.pathname, 'https://example.test/hn.html');
    assert.equal(url.hash, '');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
        article: '49537553',
        snapshot: '2026-09-04T12:34:56.789Z',
        share: '50',
        volume: 'lunaLow',
        consolidation: 'sonnet5',
        budget: '1.5',
        summary: 'sonnet5',
    });
    assert.deepEqual(core.parseRunPageUrl(value), { ...selection, summary: 'sonnet5' });
    url.searchParams.delete('summary');
    assert.equal(core.runResultCacheKey(selection), url.search.slice(1));
});

test('parseRunPageUrl rejects incomplete or invalid run URLs', () => {
    assert.equal(core.parseRunPageUrl('https://example.test/hn.html?article=1'), null);
    assert.equal(core.parseRunPageUrl('https://example.test/hn.html?article=1&snapshot=no&share=50&volume=lunaLow&consolidation=sonnet5&budget=1'), null);
    assert.equal(core.parseRunPageUrl('https://example.test/hn.html?article=1&snapshot=2026-09-04T12%3A34%3A56Z&share=0&volume=lunaLow&consolidation=sonnet5&budget=1'), null);
    assert.equal(core.parseRunPageUrl('https://example.test/hn.html?article=1&snapshot=2026-09-04T12%3A34%3A56Z&share=50&volume=unknown&consolidation=sonnet5&budget=1'), null);
});

test('exchangeOpenRouterCode posts the code and verifier and returns the key', async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, options });
        return fakeResponse(200, { key: 'sk-or-v1-new' });
    };
    const key = await core.exchangeOpenRouterCode({ code: 'c1', verifier: 'v1', fetchImpl });
    assert.equal(key, 'sk-or-v1-new');
    assert.equal(seen[0].url, core.CONSTANTS.OPENROUTER_KEY_EXCHANGE_URL);
    assert.equal(seen[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(seen[0].options.body), { code: 'c1', code_verifier: 'v1', code_challenge_method: 'S256' });
});

test('exchangeOpenRouterCode surfaces HTTP errors and a missing key', async () => {
    const failing = async () => fakeResponse(400, { error: { message: 'bad code' } });
    await assert.rejects(core.exchangeOpenRouterCode({ code: 'c', verifier: 'v', fetchImpl: failing }), /400.*bad code/);
    const empty = async () => fakeResponse(200, {});
    await assert.rejects(core.exchangeOpenRouterCode({ code: 'c', verifier: 'v', fetchImpl: empty }), /no key/);
});

// ---------------------------------------------------------------------------
// Result cache
// ---------------------------------------------------------------------------

function baseCall() {
    return { stage: 'score', model: 'm', messages: [{ role: 'user', content: 'a' }], schema: { name: 's', schema: {} }, sampling: { temperature: 0 }, reasoning: null, maxTokens: 10 };
}

function mapStore() {
    const store = new Map();
    return { store, api: { get: key => store.get(key), set: (key, value) => { store.set(key, value); } } };
}

// The fake model behind the cache, as the page and the runner wire it.
function cachedFake(api) {
    return core.makeCachedCallChat(makeFakeCallChat([]), api);
}

// The cache key of the stored response whose payload holds the named array (one per stage in the toy run).
function storedKeyFor(store, payloadKey) {
    return [...store.entries()].find(([, value]) => Array.isArray(value.json[payloadKey]))[0];
}

test('requestCacheKey ignores meta and signal and changes with request content', () => {
    const base = baseCall();
    const same = { ...baseCall(), meta: { batchIndex: 3 }, signal: {} };
    const differentMessages = { ...baseCall(), messages: [{ role: 'user', content: 'b' }] };
    const differentModel = { ...baseCall(), model: 'other' };
    assert.equal(core.requestCacheKey(base), core.requestCacheKey(same));
    assert.notEqual(core.requestCacheKey(base), core.requestCacheKey(differentMessages));
    assert.notEqual(core.requestCacheKey(base), core.requestCacheKey(differentModel));
    assert.match(core.requestCacheKey(base), /^[0-9a-f-]+$/);
});

test('parseCacheExport accepts cache-only exports and rejects unrelated browser storage', () => {
    const callKey = core.CONSTANTS.CACHE_KEY_PREFIX + 'abc';
    const payload = core.parseCacheExport(JSON.stringify({
        exportedAt: '2026-09-04T12:00:00.000Z',
        origin: 'http://localhost:8791',
        entries: { [callKey]: { json: { ok: true }, usage: { cost: 0.01 } } },
    }));
    assert.deepEqual(payload.entries[callKey].json, { ok: true });
    assert.throws(
        () => core.parseCacheExport(JSON.stringify({ entries: { openrouter_api_key: { value: 'secret' } } })),
        /unsupported entry: openrouter_api_key/,
    );
    assert.throws(() => core.parseCacheExport('{'), /not valid JSON/);
    assert.throws(() => core.parseCacheExport('{}'), /entries object/);
});

test('makeCachedCallChat serves a repeated request from the store at zero cost', async () => {
    let innerCalls = 0;
    const json = { stances: [{ comment: 1, axis: 1, stance: 'A' }] };
    const inner = async () => {
        innerCalls += 1;
        return { json, usage: { promptTokens: 1, completionTokens: 1, cost: 0.01 } };
    };
    const { api } = mapStore();
    const cached = core.makeCachedCallChat(inner, api);
    const call = { ...baseCall(), meta: { commentIds: [1], presentedAxes: TOY_AXES, swapPoles: false } };
    const first = await cached(call);
    const second = await cached({ ...call, meta: { ...call.meta, batchIndex: 1 } });
    assert.equal(innerCalls, 1);
    assert.deepEqual(second.json, json);
    assert.equal(second.usage.cost, 0);
    assert.equal(second.usage.cached, true);
    assert.equal(first.usage.cached, undefined);
    assert.equal(first.usage.cost, 0.01);
});

test('makeCachedCallChat does not cache failures', async () => {
    let innerCalls = 0;
    const inner = async () => {
        innerCalls += 1;
        throw new core.TruncationError('t', { promptTokens: 0, completionTokens: 0, cost: 0 });
    };
    const { store, api } = mapStore();
    const cached = core.makeCachedCallChat(inner, api);
    await assert.rejects(cached(baseCall()));
    await assert.rejects(cached(baseCall()));
    assert.equal(innerCalls, 2);
    assert.equal(store.size, 0);
});

test('runPipeline reports cached calls and spends nothing on a fully cached rerun', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const first = await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    const second = await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    assert.ok(first.cost > 0);
    assert.equal(first.stats.cachedCalls, 0);
    assert.equal(second.cost, 0);
    assert.equal(second.stats.cachedCalls, second.calls);
    assert.deepEqual(second.rows.map(row => row.axisId), first.rows.map(row => row.axisId));
});

test('a refused cache write is counted by the pipeline and reported as a warning', async () => {
    const refusing = { get: () => undefined, set: () => false };
    const thread = core.flattenThread(TOY_THREAD);
    const result = await core.runPipeline({ thread, callChat: cachedFake(refusing), onProgress: () => {}, config: TOY_CONFIG });
    assert.equal(result.stats.cacheWriteFailures, result.calls);
    assert.ok(result.warnings.some(text => /cache writes failed/.test(text)), 'warning present');
    const accepting = mapStore().api;
    const clean = await core.runPipeline({ thread, callChat: cachedFake(accepting), onProgress: () => {}, config: TOY_CONFIG });
    assert.equal(clean.stats.cacheWriteFailures, 0);
    assert.equal(clean.warnings.length, 0);
});

test('formatNextRun gives the forecast, the cached-call sentence when some calls are cached, or the zero-cost statement', () => {
    const none = { stages: [{ stage: 'extract', hits: 0, total: 2 }], complete: false };
    const some = { stages: [{ stage: 'extract', hits: 2, total: 2 }, { stage: 'consolidate', hits: 0, total: 1 }], complete: false };
    const all = { stages: [{ stage: 'extract', hits: 2, total: 2 }, { stage: 'consolidate', hits: 1, total: 1 }, { stage: 'score', hits: 4, total: 4 }], complete: true };
    assert.equal(core.formatNextRun({ usd: 0.0449, seconds: 31, probe: null }), 'about $0.04 and about 31 seconds.');
    assert.equal(core.formatNextRun({ usd: 0.0449, seconds: 31, probe: none }), 'about $0.04 and about 31 seconds.');
    assert.equal(core.formatNextRun({ usd: 0.0449, seconds: 31, probe: some }), 'about $0.04 and about 31 seconds. Cached: 2 of 2 extraction, 0 of 1 consolidation calls, so it will cost and take less.');
    assert.equal(core.formatNextRun({ usd: 0.0449, seconds: 31, probe: all }), '$0 and 0 seconds, all 7 model calls are cached.');
});

test('runPipeline stops when the budget is exceeded', async () => {
    const thread = core.flattenThread(TOY_THREAD);
    await assert.rejects(core.runPipeline({
        thread,
        callChat: makeFakeCallChat([]),
        onProgress: () => {},
        config: { ...TOY_CONFIG, budgetUsd: 0.0015 },
    }), /budget/i);
});

test('unknown billing stops new pipeline work but drains and caches already in-flight calls', async () => {
    const { api } = mapStore();
    const log = [];
    const fake = makeFakeCallChat(log);
    let started = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const cached = core.makeCachedCallChat(async call => {
        started++;
        if (started === 1) throw new core.CostUnavailableError({ id: 'pending', choices: [] }, call.model);
        await gate;
        assert.equal(call.signal.aborted, false);
        return fake(call);
    }, api);
    const controller = new AbortController();
    const progress = [];
    const running = core.runPipeline({
        thread: core.flattenThread(TOY_THREAD), callChat: cached,
        onProgress: event => progress.push(event), signal: controller.signal,
        config: TOY_CONFIG,
    });
    let settled = false;
    const checked = assert.rejects(running, core.CostUnavailableError).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 2);
    assert.equal(settled, false);
    release();
    await checked;
    assert.equal(started, 2);
    assert.equal(log.length, 1);
    assert.equal((await api.get(core.requestCacheKey(log[0]))).usage.cost, 0.001);
    assert.equal(progress.at(-1).cost, 0.001);
    assert.equal(controller.signal.aborted, false);
    const probe = await core.probeCache({ thread: core.flattenThread(TOY_THREAD), store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, false);
    assert.equal(probe.stages[0].hits, 1);
});

test('unknown billing warns when persistent storage fails and retains the response in memory', async () => {
    let calls = 0;
    const raw = { id: 'pending', choices: [] };
    const cached = core.makeCachedCallChat(async call => {
        calls++;
        if (calls === 2) assert.equal(call.billingResponse, raw);
        throw new core.CostUnavailableError(raw, call.model);
    }, { get: () => null, set: () => false });
    await assert.rejects(cached(minimalRequest()), /could not be saved to persistent cache/);
    await assert.rejects(cached(minimalRequest()), /could not be saved to persistent cache/);
});

// ---------------------------------------------------------------------------
// Cache probe: how much of a run the store already holds
// ---------------------------------------------------------------------------

test('probeCache on an empty store reports only the extraction stage, with no hits', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    const batches = core.makeExtractBatches(thread.comments, TOY_CONFIG.extractBatchChars).length;
    assert.deepEqual(probe, { stages: [{ stage: 'extract', hits: 0, total: batches }], complete: false });
});

test('probeCache after a full run reports every stage fully cached without calling a model', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const run = await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, true);
    assert.deepEqual(probe.stages.map(stage => stage.stage), ['extract', 'consolidate', 'score', 'synthesize']);
    for (const stage of probe.stages) {
        assert.equal(stage.hits, stage.total, stage.stage);
    }
    assert.equal(probe.stages.reduce((sum, stage) => sum + stage.total, 0), run.calls);
});

test('probeCache counts a missing scoring call and stays incomplete', async () => {
    const { store, api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    const scoreKey = storedKeyFor(store, 'stances');
    store.delete(scoreKey);
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, false);
    const score = probe.stages.find(stage => stage.stage === 'score');
    assert.equal(score.hits, score.total - 1);
});

test('probeCache stops reporting after the first stage with a miss', async () => {
    const { store, api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    const consolidateKey = storedKeyFor(store, 'axes');
    store.delete(consolidateKey);
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.deepEqual(probe.stages.map(stage => stage.stage), ['extract', 'consolidate']);
    assert.deepEqual(probe.stages[1], { stage: 'consolidate', hits: 0, total: 1 });
});

test('formatCacheProbe gives a clause for a full cache, a sentence for a partial one, nothing for an empty one', () => {
    assert.equal(core.formatCacheProbe({ stages: [{ stage: 'extract', hits: 2, total: 2 }, { stage: 'consolidate', hits: 1, total: 1 }, { stage: 'score', hits: 4, total: 4 }], complete: true }),
        'all 7 model calls are cached');
    assert.equal(core.formatCacheProbe({ stages: [{ stage: 'extract', hits: 2, total: 2 }, { stage: 'consolidate', hits: 1, total: 1 }, { stage: 'score', hits: 3, total: 4 }], complete: false }),
        'Cached: 2 of 2 extraction, 1 of 1 consolidation, 3 of 4 scoring calls, so it will cost and take less.');
    assert.equal(core.formatCacheProbe({ stages: [{ stage: 'extract', hits: 1, total: 2 }], complete: false }),
        'Cached: 1 of 2 extraction calls, so it will cost and take less.');
    assert.equal(core.formatCacheProbe({ stages: [{ stage: 'extract', hits: 0, total: 2 }], complete: false }), '');
});
