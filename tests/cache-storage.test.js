const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPage, loadCore } = require('../scripts/load_core');
const source = readPage();
const core = loadCore();
const older = '2026-09-11T10:00:00.000Z';
const newer = '2026-09-12T10:00:00.000Z';

function loadStoragePage(cacheStorage) {
    const context = { ...core, cacheStorage, location: { origin: 'https://example.test' } };
    for (const [start, end] of [
        ['function makePrefixedStore(', '// Finish loading'],
        ['function cacheExportPayload()', 'function downloadCacheExport()'],
        ['async function importCacheEntries(', 'async function importCacheFile('],
    ]) {
        vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
    }
    context.CACHE_EXPORT_PREFIXES = ['hn_polarization_thread:', 'hn_polarization_cache:', 'hn_polarization_result:'];
    return context;
}

test('page script parses after asynchronous storage initialization', () => {
    new vm.Script(source.match(/<script id="page">([\s\S]*?)<\/script>/)[1]);
});

test('cache writes await persistence and report refusals without losing existing values', async () => {
    const entries = new Map([['thread:1', '{"title":"before"}']]);
    let resolveWrite;
    const storage = { entries, write(values) { return new Promise(resolve => {
        resolveWrite = () => { for (const [key, value] of values) entries.set(key, JSON.stringify(value)); resolve(); };
    }); } };
    const page = loadStoragePage(storage);
    const store = page.makePrefixedStore('thread:', storage);
    const pending = store.set('1', { title: 'after' });
    assert.equal(store.get('1').title, 'before');
    resolveWrite();
    assert.equal(await pending, true);
    assert.equal(store.get('1').title, 'after');
    storage.write = async () => { throw new Error('Quota exceeded'); };
    assert.equal(await store.set('1', { title: 'lost' }), false);
    assert.equal(store.get('1').title, 'after');
    assert.equal(store.get('absent'), null);
});

test('import merges accepted entries in one awaited write and exports the original format', async () => {
    const key = 'hn_polarization_thread:49554643';
    const storage = { entries: new Map([[key, JSON.stringify({ title: 'old', fetchedAt: older })], ['unrelated', '"private"']]) };
    let resolveWrite;
    let writes = 0;
    storage.write = (values, removed, selectValue) => new Promise(resolve => {
        writes++;
        resolveWrite = () => {
            for (const [key, value] of values) {
                const raw = storage.entries.get(key);
                const selected = selectValue(key, raw === undefined ? undefined : JSON.parse(raw));
                if (selected !== undefined) storage.entries.set(key, JSON.stringify(selected));
            }
            resolve();
        };
    });
    const page = loadStoragePage(storage);
    const imported = { [key]: { title: 'new', fetchedAt: newer, text: 'x'.repeat(6 * 1024 * 1024) }, 'hn_polarization_thread:2': { title: 'second' } };
    const pending = page.importCacheEntries(imported);
    assert.equal(JSON.parse(storage.entries.get(key)).title, 'old');
    resolveWrite();
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { added: 1, updated: 1, keptNewer: 0, keptUncertain: 0 });
    assert.equal(writes, 1);
    const payload = page.cacheExportPayload();
    assert.deepEqual(JSON.parse(JSON.stringify(payload.entries)), imported);
    assert.equal(loadCore().parseCacheExport(JSON.stringify(payload)).entries[key].title, 'new');
});

test('import ignores identical content, field order, and save metadata without hiding data changes', () => {
    const key = core.CONSTANTS.CACHE_KEY_PREFIX + '1';
    const existing = { json: { a: [1, null, { b: true }], c: 'text' }, usage: { cost: 1 }, savedAt: older };
    const incoming = { savedAt: newer, usage: { cost: 1 }, json: { c: 'text', a: [1, null, { b: true }] } };
    assert.equal(core.cacheImportDecision(key, incoming, existing), 'identical');
    assert.equal(core.cacheImportDecision(key, { ...incoming, json: { ...incoming.json, a: [null, 1, { b: true }] } }, existing), 'updated');
    assert.equal(core.cacheImportDecision(key, { ...incoming, usage: { cost: 2 } }, existing), 'updated');
    assert.equal(core.cacheImportDecision(key, { ...incoming, semanticRejected: true }, existing), 'updated');
});

test('import compares entry dates for every cache type and retains older, tied, or undated conflicts', () => {
    for (const [prefix, field] of [
        [core.CONSTANTS.THREAD_KEY_PREFIX, 'fetchedAt'],
        [core.CONSTANTS.CACHE_KEY_PREFIX, 'savedAt'],
        [core.CONSTANTS.RESULT_KEY_PREFIX, 'savedAt'],
    ]) {
        const key = prefix + '1';
        const existing = { value: 'local', [field]: older };
        assert.equal(core.cacheImportDecision(key, { value: 'import', [field]: newer }, existing), 'updated');
        assert.equal(core.cacheImportDecision(key, { value: 'import', [field]: older }, { ...existing, [field]: newer }), 'keptNewer');
        for (const date of [older, '2026-09-11T12:00:00+02:00', undefined, null, '', 'invalid', 123]) {
            assert.equal(core.cacheImportDecision(key, { value: 'import', [field]: date }, existing), 'keptUncertain');
        }
        assert.equal(core.cacheImportDecision(key, { value: 'import', [field]: newer }, { value: 'legacy' }), 'keptUncertain');
        assert.equal(core.cacheImportDecision(key, { value: 'import' }, undefined), 'added');
    }
    assert.equal(core.cacheImportDecision(core.CONSTANTS.THREAD_KEY_PREFIX + '1',
        { item: { title: 'import' }, fetchedAt: older, savedAt: newer },
        { item: { title: 'local' }, fetchedAt: newer, savedAt: older }), 'keptNewer');
    assert.equal(core.cacheImportDecision(core.CONSTANTS.RESULT_KEY_PREFIX + '1',
        { version: 5, savedAt: newer }, { version: 6, savedAt: older }), 'keptUncertain');
    const exported = core.parseCacheExport(JSON.stringify({ exportedAt: newer, entries: {
        [core.CONSTANTS.CACHE_KEY_PREFIX + '1']: { value: 'undated import' },
    } }));
    assert.equal(core.cacheImportDecision(core.CONSTANTS.CACHE_KEY_PREFIX + '1', Object.values(exported.entries)[0], { value: 'local', savedAt: older }), 'keptUncertain');
});

test('import status reports changes and protected conflicts without counting identical entries', () => {
    const empty = { added: 0, updated: 0, keptNewer: 0, keptUncertain: 0 };
    assert.equal(core.formatCacheImport(empty, 'cache.json'), 'No cache content changes from cache.json.');
    const status = core.formatCacheImport({ added: 237, updated: 2, keptNewer: 3, keptUncertain: 4 }, 'cache.json');
    assert.match(status, /Imported 237 new cache entries/);
    assert.match(status, /Updated 2 existing entries with newer copies/);
    assert.match(status, /Kept 3 newer local entries/);
    assert.match(status, /Kept 4 differing entries because the import was not provably newer/);
    assert.doesNotMatch(status, /identical|replaced/);
});

test('new AI calls get an exportable save date and cache hits preserve it', async () => {
    let saved;
    const store = { get: () => saved, set: (key, entry) => { saved = entry; } };
    const cached = core.makeCachedCallChat(async () => ({ json: { answer: true }, usage: { cost: 0.01 } }), store);
    const call = { model: 'test', messages: [], schema: {}, maxTokens: 10 };
    await cached(call);
    assert.ok(Number.isFinite(Date.parse(saved.savedAt)));
    const original = saved;
    assert.equal((await cached(call)).usage.cached, true);
    assert.equal(saved, original);
});

// Drive the IndexedDB request/commit boundary explicitly; the production storage code
// performs every read, decision, write, and memory-index update under test.
async function openStorageHarness() {
    const transactions = [];
    const db = { transaction(name, mode) {
        const transaction = {
            mode, reads: [], writes: [],
            objectStore() { return {
                openCursor() {
                    const request = { result: null };
                    queueMicrotask(() => { request.onsuccess(); transaction.oncomplete(); });
                    return request;
                },
                get(key) { const request = { key }; transaction.reads.push(request); return request; },
                put(value, key) { transaction.writes.push([key, value]); },
            }; },
            abort() { transaction.onabort(); },
        };
        transactions.push(transaction);
        return transaction;
    } };
    const context = { indexedDB: { open() {
        const request = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
    } } };
    vm.runInNewContext(source.slice(source.indexOf('async function openCacheStorage('), source.indexOf('function makePrefixedStore(')), context);
    return { storage: await context.openCacheStorage(), transactions };
}

test('import protects another tab\'s newer persisted value and refreshes the index only on commit', async () => {
    const { storage, transactions } = await openStorageHarness();
    const key = core.CONSTANTS.THREAD_KEY_PREFIX + '1';
    const stale = JSON.stringify({ fetchedAt: older, value: 'stale tab' });
    const latest = JSON.stringify({ fetchedAt: newer, value: 'other tab' });
    storage.entries.set(key, stale);
    const page = loadStoragePage(storage);
    const incoming = { [key]: { fetchedAt: '2026-09-12T09:00:00Z', value: 'import' },
        [core.CONSTANTS.CACHE_KEY_PREFIX + 'new']: { json: {}, usage: { cost: 1 } } };
    const pending = page.importCacheEntries(incoming);
    const transaction = transactions.at(-1);
    assert.equal(transaction.mode, 'readwrite');
    for (const request of transaction.reads) {
        request.result = request.key === key ? latest : undefined;
        request.onsuccess();
    }
    assert.equal(transaction.writes.length, 1);
    assert.equal(transaction.writes[0][0], core.CONSTANTS.CACHE_KEY_PREFIX + 'new');
    assert.equal(storage.entries.get(key), stale);
    transaction.oncomplete();
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { added: 1, updated: 0, keptNewer: 1, keptUncertain: 0 });
    assert.equal(storage.entries.get(key), latest);
    assert.equal(page.cacheExportPayload().entries[key].value, 'other tab');
});

test('identical older imports issue no puts and report no replacements', async () => {
    const { storage, transactions } = await openStorageHarness();
    const key = core.CONSTANTS.CACHE_KEY_PREFIX + '1';
    const existing = { json: { a: 1, b: 2 }, savedAt: newer };
    storage.entries.set(key, JSON.stringify(existing));
    const page = loadStoragePage(storage);
    const pending = page.importCacheEntries({ [key]: { savedAt: older, json: { b: 2, a: 1 } } });
    const transaction = transactions.at(-1);
    transaction.reads[0].result = JSON.stringify(existing);
    transaction.reads[0].onsuccess();
    assert.equal(transaction.writes.length, 0);
    transaction.oncomplete();
    assert.equal(core.formatCacheImport(await pending, 'cache.json'), 'No cache content changes from cache.json.');
    assert.equal(storage.entries.get(key), JSON.stringify(existing));
});

test('identical content silently retains the newest valid metadata date for every cache type', async () => {
    for (const [prefix, field, content] of [
        [core.CONSTANTS.THREAD_KEY_PREFIX, 'fetchedAt', { item: { id: 1, title: 'same', children: [] } }],
        [core.CONSTANTS.CACHE_KEY_PREFIX, 'savedAt', { json: { answer: true }, usage: { cost: 0.01 } }],
        [core.CONSTANTS.RESULT_KEY_PREFIX, 'savedAt', { version: 6, result: { rows: [] } }],
    ]) {
        for (const [localDate, incomingDate, expectedDate, writes] of [
            [older, newer, newer, 1],
            [newer, older, newer, 0],
            [newer, newer, newer, 0],
            [newer, '2026-09-12T12:00:00+02:00', newer, 0],
            [undefined, newer, newer, 1],
            ['invalid', newer, newer, 1],
            [newer, undefined, newer, 0],
            [newer, 'invalid', newer, 0],
            [undefined, undefined, undefined, 0],
        ]) {
            const { storage, transactions } = await openStorageHarness();
            const key = prefix + '1';
            const existing = { ...content, [field]: localDate };
            const incoming = { [field]: incomingDate, ...content };
            const originalRaw = JSON.stringify(existing);
            storage.entries.set(key, originalRaw);
            const page = loadStoragePage(storage);
            const pending = page.importCacheEntries({ [key]: incoming });
            const transaction = transactions.at(-1);
            transaction.reads[0].result = originalRaw;
            transaction.reads[0].onsuccess();
            assert.equal(transaction.writes.length, writes, `${key}: ${localDate} <- ${incomingDate}`);
            assert.equal(storage.entries.get(key), originalRaw, 'date changes await persistence');
            transaction.oncomplete();
            const counts = await pending;
            assert.deepEqual(JSON.parse(JSON.stringify(counts)), { added: 0, updated: 0, keptNewer: 0, keptUncertain: 0 });
            assert.equal(core.formatCacheImport(counts, 'cache.json'), 'No cache content changes from cache.json.');
            const exported = page.cacheExportPayload().entries[key];
            assert.equal(exported[field], expectedDate);
            delete exported[field];
            assert.deepEqual(JSON.parse(JSON.stringify(exported)), content);
        }
    }
});

test('identical thread content merges fetch and save dates independently using the persisted copy', async () => {
    const { storage, transactions } = await openStorageHarness();
    const key = core.CONSTANTS.THREAD_KEY_PREFIX + '1';
    const item = { id: 1, title: 'same', children: [] };
    const existing = { item, fetchedAt: older, savedAt: newer };
    const incoming = { item, fetchedAt: newer, savedAt: older };
    storage.entries.set(key, JSON.stringify({ item, fetchedAt: older, savedAt: older }));
    const page = loadStoragePage(storage);
    const pending = page.importCacheEntries({ [key]: incoming });
    const transaction = transactions.at(-1);
    transaction.reads[0].result = JSON.stringify(existing);
    transaction.reads[0].onsuccess();
    assert.deepEqual(JSON.parse(transaction.writes[0][1]), { item, fetchedAt: newer, savedAt: newer });
    transaction.oncomplete();
    assert.equal(core.formatCacheImport(await pending, 'cache.json'), 'No cache content changes from cache.json.');
    assert.deepEqual(JSON.parse(storage.entries.get(key)), { item, fetchedAt: newer, savedAt: newer });
    assert.equal(incoming.savedAt, older, 'import input is not mutated');
});

test('aborted import never exposes accepted writes or retained values in the memory index', async () => {
    const { storage, transactions } = await openStorageHarness();
    const key = core.CONSTANTS.THREAD_KEY_PREFIX + '1';
    const existing = JSON.stringify({ fetchedAt: older, value: 'local' });
    storage.entries.set(key, existing);
    const pending = loadStoragePage(storage).importCacheEntries({ [key]: { fetchedAt: newer, value: 'import' } });
    const transaction = transactions.at(-1);
    transaction.reads[0].result = existing;
    transaction.reads[0].onsuccess();
    assert.equal(transaction.writes.length, 1);
    transaction.error = new Error('Quota exceeded');
    transaction.onabort();
    await assert.rejects(pending, /Existing cache entries were kept.*Quota exceeded/);
    assert.equal(storage.entries.get(key), existing);
});

test('failed import leaves the previous cache intact and reports the failure', async () => {
    const storage = { entries: new Map([['hn_polarization_thread:1', '{"title":"old"}']]), async write() { throw new Error('Quota exceeded'); } };
    const page = loadStoragePage(storage);
    await assert.rejects(page.importCacheEntries({ 'hn_polarization_thread:1': { title: 'new' } }), /Existing cache entries were kept.*Quota exceeded/);
    assert.equal(page.cacheExportPayload().entries['hn_polarization_thread:1'].title, 'old');
});
