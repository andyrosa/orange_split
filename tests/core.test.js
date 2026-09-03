// Unit and integration tests for the core script block of hn_polarization.html.
// Run with: node --test tests
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('../scripts/load_core');

const FLOAT_TOLERANCE = 0.001;

// HN_POLARIZATION_HTML (read by loadCore) overrides the page under test, used for mutation checks.
const core = loadCore();

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
const TOY_CONFIG = { extractBatchTokens: 200, scoreBatchComments: 5, concurrency: 2 };

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

// Order by agreed comments, then commenters, then axis id: axes 1 and 5 have 3 comments by 3 commenters each.
const TOY_EXPECTED_ORDER = [1, 5, 2, 3, 4, 6];

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
    assert.deepEqual(thread.comments.map(comment => comment.id), [10, 11, 13, 20]);
    assert.deepEqual(thread.comments.map(comment => comment.parentId), [1, 10, 12, 1]);
    assert.deepEqual(thread.comments.map(comment => comment.depth), [0, 1, 3, 0]);
    assert.deepEqual(thread.comments.map(comment => comment.author), ['a', 'b', 'd', 'e']);
});

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

function fakeComment(id, depth, tokenCount) {
    return { id, author: 'u' + id, parentId: 0, depth, text: 'x'.repeat(tokenCount * core.CONSTANTS.CHARS_PER_TOKEN) };
}

test('estimateTokens rounds characters up by CHARS_PER_TOKEN', () => {
    const charsPerToken = core.CONSTANTS.CHARS_PER_TOKEN;
    assert.equal(core.estimateTokens('x'.repeat(charsPerToken * 3)), 3);
    assert.equal(core.estimateTokens('x'.repeat(charsPerToken * 3 + 1)), 4);
    assert.equal(core.estimateTokens(''), 0);
});

test('makeExtractBatches keeps subtrees together, splits oversized subtrees, isolates oversized comments', () => {
    const frame = core.CONSTANTS.COMMENT_FRAME_TOKENS;
    const budget = 100;
    // Each comment costs text tokens + frame. Text sizes are chosen so that:
    //   S1: three comments of 32 tokens each -> 96 total, fits alone.
    //   S2: two comments of 32 -> 64, does not fit with S1.
    //   S3: five comments of 42 -> 210, oversized -> split 2, 2, 1.
    //   S4: one comment of 32 -> joins the last S3 chunk (42 + 32 = 74).
    //   S5: one comment of 162 -> alone, exceeds the budget by itself.
    const textTokens32 = 32 - frame;
    const textTokens42 = 42 - frame;
    const textTokens162 = 162 - frame;
    assert.ok(textTokens32 > 0, 'frame must be below 32 tokens for this fixture');
    const comments = [
        fakeComment(1, 0, textTokens32), fakeComment(2, 1, textTokens32), fakeComment(3, 2, textTokens32),
        fakeComment(4, 0, textTokens32), fakeComment(5, 1, textTokens32),
        fakeComment(6, 0, textTokens42), fakeComment(7, 1, textTokens42), fakeComment(8, 1, textTokens42), fakeComment(9, 2, textTokens42), fakeComment(10, 1, textTokens42),
        fakeComment(11, 0, textTokens32),
        fakeComment(12, 0, textTokens162),
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

test('aggregateByAuthor takes the majority stance per author and M on ties', () => {
    const commentsById = new Map([
        [1, { id: 1, author: 'p' }], [2, { id: 2, author: 'p' }],
        [3, { id: 3, author: 'q' }], [4, { id: 4, author: 'q' }],
        [5, { id: 5, author: 'r' }], [6, { id: 6, author: 'r' }], [7, { id: 7, author: 'r' }],
    ]);
    const agreed = new Map(Object.entries({ '1|1': 'A', '2|1': 'A', '3|1': 'A', '4|1': 'B', '5|1': 'A', '6|1': 'M', '7|1': 'M' }));
    const byAuthor = core.aggregateByAuthor(agreed, commentsById);
    assert.equal(byAuthor.get(1).get('p'), 'A');
    assert.equal(byAuthor.get(1).get('q'), 'M');
    assert.equal(byAuthor.get(1).get('r'), 'M');
});

function toyRows() {
    const thread = core.flattenThread(TOY_THREAD);
    const commentsById = core.indexCommentsById(thread.comments);
    const agreed = core.mergePasses(TOY_PASS1, TOY_PASS2);
    const byAuthor = core.aggregateByAuthor(agreed, commentsById);
    return core.computeRows(TOY_AXES, byAuthor, agreed);
}

test('computeRows produces per-commenter counts and the comment count for the toy thread', () => {
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
        authors: 3,
        comments: 3,
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

test('barCells splits a fixed number of cells by largest remainder so they always sum exactly', () => {
    assert.deepEqual(core.barCells(9, 1, 14, 20), [7, 1, 12]);
    assert.deepEqual(core.barCells(21, 19, 0, 20), [11, 9, 0], 'half-way ties go to the earlier side');
    assert.deepEqual(core.barCells(0, 0, 0, 20), [0, 0, 0]);
    assert.deepEqual(core.barCells(3, 0, 0, 20), [20, 0, 0]);
});

test('splitBar draws < for side 1, - for middle, > for side 2', () => {
    assert.equal(core.splitBar({ countA: 9, countM: 1, countB: 14 }, 20), '<<<<<<<->>>>>>>>>>>>');
    assert.equal(core.splitBar({ countA: 0, countM: 0, countB: 0 }, 20), ' '.repeat(20));
});

test('sideShare is the share of one side among the two, one half when neither has a commenter', () => {
    assert.equal(core.sideShare(14, 3), 14 / 17);
    assert.equal(core.sideShare(0, 5), 0);
    assert.equal(core.sideShare(0, 0), 0.5);
});

test('proportionShares splits the bar among side 1, middle, and side 2', () => {
    assert.deepEqual(core.proportionShares({ countA: 6, countM: 2, countB: 2 }), [0.6, 0.2, 0.2]);
    assert.deepEqual(core.proportionShares({ countA: 0, countM: 0, countB: 0 }), [0, 0, 0]);
});

test('orientRows puts the larger side on statement 1, keeping ties as they are', () => {
    const rows = [
        { axisId: 1, statementA: 'p', statementB: 'q', countA: 2, countB: 5, countM: 1 },
        { axisId: 2, statementA: 'r', statementB: 's', countA: 3, countB: 3, countM: 0 },
        { axisId: 3, statementA: 't', statementB: 'u', countA: 4, countB: 0, countM: 0 },
    ];
    const oriented = core.orientRows(rows);
    assert.deepEqual(oriented.map(row => [row.statementA, row.statementB, row.countA, row.countB]), [['q', 'p', 5, 2], ['r', 's', 3, 3], ['t', 'u', 4, 0]]);
    assert.equal(rows[0].statementA, 'p');
});

test('rankRows orders by agreed comments, then commenters, then axis id, and numbers the rows', () => {
    const ranked = core.rankRows(toyRows());
    assert.deepEqual(ranked.map(row => row.axisId), TOY_EXPECTED_ORDER);
    assert.deepEqual(ranked.map(row => row.rank), [1, 2, 3, 4, 5, 6]);
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
    const result = { rows: [1, 2, 3, 4], cost: 0.0449, calls: 7, stats: { comments: 32, authors: 20, cachedCalls: 0, agreedStances: 10, classifiedPairs: 17 } };
    assert.equal(core.formatRunCost(result), '$0.04, 7 model calls (0 cached)');
    assert.deepEqual(core.formatRunSummary(result), [
        '4 rows from 32 comments by 20 commenters.',
        '10 of 17 classifications matched between the two scoring passes; only matching ones count.',
    ]);
});

test('runPipeline counts the comment-row pairs classified by either pass', async () => {
    const thread = core.flattenThread(TOY_THREAD);
    const result = await core.runPipeline({ thread, callChat: makeFakeCallChat([]), onProgress: () => {}, config: TOY_CONFIG });
    assert.equal(result.stats.classifiedPairs, 15, 'pass 1 has 15 pairs, pass 2 a subset of them');
    assert.equal(result.stats.agreedStances, 13);
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
        'extract: 0/38 done, 30 in flight, 40 calls (0 from cache), $0.2138 spent');
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

test('model choices exist per role with labels, config fragments, and per-token rates', () => {
    assert.equal(core.DEFAULT_VOLUME_KEY, 'haiku');
    assert.equal(core.DEFAULT_CONSOLIDATION_KEY, 'sonnet5');
    for (const key of ['haiku', 'glmFlash', 'geminiFlash', 'opus5']) {
        const choice = core.VOLUME_MODELS[key];
        assert.ok(choice.label.length > 0, key + ' has a label');
        assert.ok(choice.config.modelExtract && choice.config.modelScore, key + ' names the extraction and scoring model');
        assert.equal(choice.config.modelConsolidate, undefined, key + ' does not set the consolidation model');
        assert.equal(typeof choice.costPerThousandTokensUsd, 'number');
    }
    for (const key of ['sonnet5', 'glm53', 'geminiFlash', 'opus5']) {
        const choice = core.CONSOLIDATION_MODELS[key];
        assert.ok(choice.label.length > 0, key + ' has a label');
        assert.ok(choice.config.modelConsolidate, key + ' names the consolidation model');
        assert.equal(choice.config.modelScore, undefined, key + ' does not set the scoring model');
        assert.equal(typeof choice.costPerThousandTokensUsd, 'number');
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

test('combinedRate sums the per-token rates and estimateRunSeconds never goes below the stage latency floor', () => {
    const expected = core.VOLUME_MODELS.haiku.costPerThousandTokensUsd + core.CONSOLIDATION_MODELS.sonnet5.costPerThousandTokensUsd;
    assertClose(core.combinedRate('haiku', 'sonnet5', 'costPerThousandTokensUsd'), expected, 'combined rate');
    const seconds = core.estimateRunSeconds(104000, 'haiku', 'sonnet5');
    assertClose(seconds, (core.VOLUME_MODELS.haiku.secondsPerThousandTokens + core.CONSOLIDATION_MODELS.sonnet5.secondsPerThousandTokens) * 104, 'seconds for a large thread');
    // Three stages in sequence: extraction and scoring each take at least one volume call, consolidation one consolidation call.
    const floor = 2 * core.VOLUME_MODELS.haiku.minimumSeconds + core.CONSOLIDATION_MODELS.sonnet5.minimumSeconds;
    assert.equal(core.estimateRunSeconds(0, 'haiku', 'sonnet5'), floor);
    assert.equal(core.estimateRunSeconds(2000, 'haiku', 'sonnet5'), floor, 'a small thread is bounded by latency');
    assert.ok(floor >= 20 && floor <= 40, 'the Claude pair took 28 seconds on the 38-comment smoke test');
    for (const choice of Object.values(core.VOLUME_MODELS).concat(Object.values(core.CONSOLIDATION_MODELS))) {
        assert.ok(choice.minimumSeconds > 0);
    }
});

test('largestShareWithinBudget returns the biggest share whose forecast fits, and 0 when nothing fits', () => {
    const comments = Array.from({ length: 10 }, (_, index) => fakeComment(index + 1, 0, 1));
    const rate = 1000 / (1 + core.CONSTANTS.COMMENT_FRAME_TOKENS); // $1 per comment: one text token plus the frame
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

test('estimateRunCost applies a per-thousand-token rate to the selected comments', () => {
    const comments = [fakeComment(1, 0, 1000), fakeComment(2, 0, 1000)];
    const estimate = core.estimateRunCost(comments, 0.01);
    assert.equal(estimate.tokens, 2000 + 2 * core.CONSTANTS.COMMENT_FRAME_TOKENS);
    assertClose(estimate.usd, 0.01 * (estimate.tokens / 1000), 'estimate');
    assert.equal(core.estimateRunCost([], 0.01).usd, 0, 'nothing selected costs nothing');
});

test('storySearchUrl builds an Algolia story search for the encoded query', () => {
    const url = core.storySearchUrl('GoDaddy & SOPA');
    assert.ok(url.startsWith('https://hn.algolia.com/api/v1/search?'));
    assert.ok(url.includes('tags=story'));
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

test('storyLabel shows title, comment count, posting date and id; sortStoriesNewestFirst orders by date descending', () => {
    const older = { id: 1, title: 'Older', numComments: 5, createdAt: '2026-08-30T10:00:00.000Z' };
    const newer = { id: 2, title: 'Newer', numComments: 7, createdAt: '2026-09-02T09:00:00.000Z' };
    const undated = { id: 3, title: 'Undated', numComments: 0, createdAt: null };
    assert.equal(core.storyLabel(newer), 'Newer (7 comments, 2026-09-02, 2)');
    assert.equal(core.storyDetails(newer), '(7 comments, 2026-09-02, 2)');
    assert.equal(core.storyDate(newer), '2026-09-02');
    assert.equal(core.storyDate(undated), 'unknown date');
    assert.equal(core.storyLabel(undated), 'Undated (0 comments, unknown date, 3)');
    assert.deepEqual(core.sortStoriesNewestFirst([older, undated, newer]).map(story => story.id), [2, 1, 3]);
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

test('exchangeOpenRouterCode posts the code and verifier and returns the key', async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, options });
        return { ok: true, status: 200, json: async () => ({ key: 'sk-or-v1-new' }) };
    };
    const key = await core.exchangeOpenRouterCode({ code: 'c1', verifier: 'v1', fetchImpl });
    assert.equal(key, 'sk-or-v1-new');
    assert.equal(seen[0].url, core.CONSTANTS.OPENROUTER_KEY_EXCHANGE_URL);
    assert.equal(seen[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(seen[0].options.body), { code: 'c1', code_verifier: 'v1', code_challenge_method: 'S256' });
});

test('exchangeOpenRouterCode surfaces HTTP errors and a missing key', async () => {
    const failing = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad code' } }) });
    await assert.rejects(core.exchangeOpenRouterCode({ code: 'c', verifier: 'v', fetchImpl: failing }), /400.*bad code/);
    const empty = async () => ({ ok: true, status: 200, json: async () => ({}) });
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

test('makeCachedCallChat serves a repeated request from the store at zero cost', async () => {
    let innerCalls = 0;
    const inner = async () => {
        innerCalls += 1;
        return { json: { ok: innerCalls }, usage: { promptTokens: 1, completionTokens: 1, cost: 0.01 } };
    };
    const { api } = mapStore();
    const cached = core.makeCachedCallChat(inner, api);
    const first = await cached(baseCall());
    const second = await cached({ ...baseCall(), meta: { batchIndex: 1 } });
    assert.equal(innerCalls, 1);
    assert.deepEqual(second.json, { ok: 1 });
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

// ---------------------------------------------------------------------------
// Cache probe: how much of a run the store already holds
// ---------------------------------------------------------------------------

test('probeCache on an empty store reports only the extraction stage, with no hits', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    const batches = core.makeExtractBatches(thread.comments, TOY_CONFIG.extractBatchTokens).length;
    assert.deepEqual(probe, { stages: [{ stage: 'extract', hits: 0, total: batches }], complete: false });
});

test('probeCache after a full run reports every stage fully cached without calling a model', async () => {
    const { api } = mapStore();
    const thread = core.flattenThread(TOY_THREAD);
    const run = await core.runPipeline({ thread, callChat: cachedFake(api), onProgress: () => {}, config: TOY_CONFIG });
    const probe = await core.probeCache({ thread, store: api, config: TOY_CONFIG });
    assert.equal(probe.complete, true);
    assert.deepEqual(probe.stages.map(stage => stage.stage), ['extract', 'consolidate', 'score']);
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
