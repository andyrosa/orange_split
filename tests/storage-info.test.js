const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPage } = require('../scripts/load_core');

function storageHarness(snapshots = []) {
    const source = readPage();
    const elements = Object.fromEntries([
        'cachedCallCount', 'cachedThreadsToggle', 'cachedResultCount', 'cachedDateRange',
        'cachedThreadsList', 'exportCache', 'deleteCached',
    ].map(name => [name, { replaceChildren() {}, setAttribute() {} }]));
    const sandbox = {
        elements,
        CONSTANTS: { THREAD_KEY_PREFIX: 'thread:' },
        snapshotStore: {
            keys: () => snapshots.map((_, index) => `thread:${index}`),
            get: id => snapshots[Number(id)],
            count: () => snapshots.length,
        },
        cacheStore: { count: () => 2502 },
        resultStore: { count: () => 13 },
        storedThread: () => ({ title: 'Example', commentCount: 10 }),
        formatLocalDateTime: value => value,
        makeElement: () => ({ addEventListener() {}, appendChild() {} }),
        activeController: null,
        importActive: false,
    };
    const start = source.indexOf('function counted(');
    const end = source.indexOf('function cacheExportPayload(', start);
    assert.ok(start > 0 && end > start);
    vm.runInNewContext(source.slice(start, end), sandbox);
    return sandbox;
}

test('cache summary shows snapshot extremes in local YYYY/MM/DD HH:mm and keeps counts', () => {
    const snapshots = [
        { fetchedAt: new Date(2026, 8, 12, 9, 4).toISOString() },
        { fetchedAt: new Date(2026, 8, 2, 19, 21).toISOString() },
        ...Array.from({ length: 27 }, () => ({ fetchedAt: new Date(2026, 8, 3, 12, 0).toISOString() })),
    ];
    const page = storageHarness(snapshots);
    page.refreshStorageInfo();
    const { elements } = page;
    const summary = `Cached locally: ${elements.cachedThreadsToggle.textContent}, ${elements.cachedCallCount.textContent}, ${elements.cachedResultCount.textContent}${elements.cachedDateRange.textContent}`;
    assert.equal(summary, 'Cached locally: 29 threads, 2502 AI calls, 13 summaries 2026/09/02 19:21 to 2026/09/12 09:04');
    assert.equal(elements.exportCache.disabled, false);
    assert.equal(elements.deleteCached.hidden, false);
    assert.match(readPage(), /id="storage-info">Cached locally: /);
    assert.match(readPage(), /id="cached-date-range"[^>]*><\/span><\/span>/);
    assert.match(readPage(), /cachedDateRange: document\.getElementById\('cached-date-range'\)/);
});

test('cache summary updates its range after snapshots are removed', () => {
    const snapshots = [{ fetchedAt: new Date(2026, 8, 12, 9, 5).toISOString() }];
    const page = storageHarness(snapshots);
    page.refreshStorageInfo();
    assert.equal(page.elements.cachedDateRange.textContent, ' 2026/09/12 09:05 to 2026/09/12 09:05');
    snapshots.length = 0;
    page.refreshStorageInfo();
    assert.equal(page.elements.cachedDateRange.textContent, '');
    assert.equal(page.elements.cachedThreadsToggle.textContent, '0 threads');
    assert.equal(page.elements.cachedThreadsToggle.disabled, true);
});

test('cache summary labels handle singular and zero counts', () => {
    const page = storageHarness();
    for (const count of [0, 1, 2]) {
        page.cacheStore.count = () => count;
        page.resultStore.count = () => count;
        page.refreshStorageInfo();
        assert.equal(page.elements.cachedCallCount.textContent, `${count} AI call${count === 1 ? '' : 's'}`);
        assert.equal(page.elements.cachedResultCount.textContent, `${count} ${count === 1 ? 'summary' : 'summaries'}`);
    }
});

test('held key shows only its label, with storage scope in its tooltip', () => {
    const source = readPage();
    assert.match(source, /id="key-stored" hidden>OpenRouter key <button id="wipe-key"/);
    assert.doesNotMatch(source, /id="key-scope"/);
    const start = source.indexOf('function refreshKeyState(');
    const end = source.indexOf('function fillModelOptions(', start);
    assert.ok(start > 0 && end > start);
    for (const held of [true, false]) {
        for (const scope of ['remembered in this browser', 'held until reload']) {
            const page = {
                currentApiKey: () => held ? 'test-key' : null,
                keyScopeText: () => scope,
                elements: { keyEntry: {}, keyStored: {} },
            };
            vm.runInNewContext(source.slice(start, end), page);
            page.refreshKeyState();
            assert.equal(page.elements.keyEntry.hidden, held);
            assert.equal(page.elements.keyStored.hidden, !held);
            assert.equal(page.elements.keyStored.title, scope);
        }
    }
});

test('snapshot ranges compare actual instants and explicitly report invalid dates', () => {
    const page = storageHarness();
    const sameInstant = [
        { fetchedAt: '2026-09-12T10:00:00+02:00' },
        { fetchedAt: '2026-09-12T08:00:00Z' },
    ];
    assert.equal(page.cachedSnapshotDateRange(sameInstant), page.cachedSnapshotDateRange(sameInstant.slice(0, 1)));
    for (const fetchedAt of [null, '', 'invalid']) {
        assert.equal(page.cachedSnapshotDateRange([{ fetchedAt }]), ' (snapshot date range unavailable)');
    }
});
