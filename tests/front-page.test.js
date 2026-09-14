const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadCore, readPage } = require('../scripts/load_core');

test('front-page suggestions use the first 60 HN IDs and restore ranking after the metadata lookup', async t => {
    const core = loadCore();
    const rankedIds = Array.from({ length: 90 }, (_, index) => 1000 + index);
    const requests = [];
    t.mock.method(globalThis, 'fetch', async url => {
        requests.push(url);
        if (url === core.CONSTANTS.HN_TOP_STORIES_URL) {
            return { ok: true, json: async () => rankedIds };
        }
        const params = new URL(url).searchParams;
        assert.equal(params.get('hitsPerPage'), '60');
        assert.equal(params.get('tags'), `story,(${rankedIds.slice(0, 60).map(id => `story_${id}`).join(',')})`);
        return { ok: true, json: async () => ({ hits: rankedIds.slice(0, 60).reverse().map(id => ({
            objectID: String(id), title: `Story ${id}`, num_comments: id, created_at: '2026-09-13T12:00:00Z',
        })) }) };
    });
    const stories = await core.fetchFrontPageStories();
    assert.deepEqual(stories.map(story => story.id), rankedIds.slice(0, 60));
    assert.equal(stories[59].title, 'Story 1059');
    assert.equal(stories[59].numComments, 1059);
    assert.equal(requests.length, 2);
});

test('front-page loading reports invalid or failed responses', async t => {
    const core = loadCore();
    const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
    await assert.rejects(core.fetchFrontPageStories(), /top stories response has no ID array/);
    fetch.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
    await assert.rejects(core.fetchFrontPageStories(), /HTTP 503/);
});

function pageHarness(fetchFrontPageStories) {
    class Control extends EventTarget {
        constructor() { super(); this.value = ''; this.attributes = {}; }
        setAttribute(name, value) { this.attributes[name] = value; }
        focus() {}
    }
    const elements = { frontPageScope: new Control(), searchAllScope: new Control(), threadId: new Control() };
    const page = {
        elements, activeController: null, importActive: false, articleModeSelected: false,
        isThreadId: loadCore().isThreadId, fetchFrontPageStories,
        SEARCH_MIN_CHARS: 3, minimum: 0, visible: [], header: '', open: false,
        searchLatest: { cancel() {} },
        resetLoadedSource() {}, updateEstimate() {},
        showArticleMode(show) { page.articleModeSelected = show; },
        closeList() { page.open = false; },
        listIsOpen() { return page.open; },
        showList(stories, header) {
            page.visible = Array.from(stories).filter(story => story.numComments >= page.minimum);
            page.header = header(page.visible);
            page.open = true;
        },
        scheduleStorySearch() { throw new Error('Search should not run for the front page'); },
        setStatus(message) { page.status = message; },
    };
    const source = readPage();
    const context = vm.createContext(page);
    for (const [start, end] of [
        ["const HEADER_HOME_PAGE =", 'function storyResultSelection('],
        ['function refreshList(', '// Keeps the current rows under'],
        ["elements.frontPageScope.addEventListener('click'", '// The list opens on focus'],
    ]) {
        const offset = source.indexOf(start);
        assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
        vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
    }
    page.selectStoryScope('front', { focus: false });
    page.clickFront = () => elements.frontPageScope.dispatchEvent(new Event('click'));
    return page;
}

test('Front page toggles 30 / 60 / 30, with filters applied within the selected range', async () => {
    const stories = Array.from({ length: 60 }, (_, index) => ({
        id: index + 1, title: `Story ${index + 1}`, numComments: index % 2 ? 200 : 50,
    }));
    let fetches = 0;
    const page = pageHarness(async () => { fetches += 1; return stories; });
    await page.populateFrontPage();
    page.refreshList();
    assert.equal(page.visible.length, 30);
    page.clickFront();
    assert.equal(page.elements.frontPageScope.textContent, 'Front page +1');
    assert.equal(page.header, 'Front page +1');
    assert.equal(page.visible.length, 60);
    assert.equal(page.elements.frontPageScope.attributes['aria-pressed'], 'true');
    assert.equal(page.elements.searchAllScope.attributes['aria-pressed'], 'false');
    page.clickFront();
    assert.equal(page.elements.frontPageScope.textContent, 'Front page');
    assert.equal(page.visible.length, 30);
    page.minimum = 100;
    page.refreshList();
    assert.equal(page.visible.length, 15, 'minimum comments must not pull stories from the second page');
    page.elements.threadId.value = 'Story 60';
    page.refreshList();
    assert.equal(page.visible.length, 0);
    page.clickFront();
    assert.deepEqual(page.visible.map(story => story.id), [60]);
    page.clickFront();
    assert.equal(page.visible.length, 0);
    assert.equal(page.elements.threadId.value, 'Story 60');
    assert.equal(fetches, 1, 'toggling reuses the fetched list');

    page.elements.threadId.value = '';
    page.minimum = 0;
    page.selectStoryScope('search');
    page.clickFront();
    assert.equal(page.visible.length, 30, 'returning from search selects the first page');
    page.clickFront();
    page.articleModeSelected = true;
    page.clickFront();
    assert.equal(page.visible.length, 30, 'returning from articles selects the first page');
    for (const busy of ['activeController', 'importActive']) {
        page[busy] = busy === 'activeController' ? {} : true;
        page.clickFront();
        assert.equal(page.visible.length, 30, 'busy controls cannot change the scope');
        page[busy] = busy === 'activeController' ? null : false;
    }
});

test('a front-page response uses the latest toggle and does not reopen a closed list', async () => {
    let resolve;
    const page = pageHarness(() => new Promise(done => { resolve = done; }));
    const loading = page.populateFrontPage();
    page.clickFront();
    page.clickFront();
    resolve(Array.from({ length: 60 }, (_, index) => ({ id: index, title: 'Story', numComments: 100 })));
    await loading;
    assert.equal(page.header, 'Front page');
    assert.equal(page.visible.length, 30);

    const closedLoading = page.populateFrontPage();
    page.closeList();
    resolve([]);
    await closedLoading;
    assert.equal(page.open, false);
});
