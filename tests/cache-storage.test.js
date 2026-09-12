const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPage, loadCore } = require('../scripts/load_core');
const source = readPage();

function loadStoragePage(cacheStorage) {
    const context = { cacheStorage, location: { origin: 'https://example.test' } };
    for (const [start, end] of [
        ['function makePrefixedStore(', '// Finish loading'],
        ['function cacheExportPayload()', 'function downloadCacheExport()'],
        ['async function importCacheEntries(', 'async function importCacheFile('],
    ]) {
        vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
    }
    context.CACHE_EXPORT_PREFIXES = ['hn_polarization_thread:', 'hn_polarization_call:', 'hn_polarization_result:'];
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

test('import merges all entries in one awaited write and exports the original format', async () => {
    const key = 'hn_polarization_thread:49554643';
    const storage = { entries: new Map([[key, '{"title":"old"}'], ['unrelated', '"private"']]) };
    let resolveWrite;
    storage.write = values => new Promise(resolve => {
        resolveWrite = () => { for (const [key, value] of values) storage.entries.set(key, JSON.stringify(value)); resolve(); };
    });
    const page = loadStoragePage(storage);
    const imported = { [key]: { title: 'new', text: 'x'.repeat(6 * 1024 * 1024) }, 'hn_polarization_thread:2': { title: 'second' } };
    const pending = page.importCacheEntries(imported);
    assert.equal(JSON.parse(storage.entries.get(key)).title, 'old');
    resolveWrite();
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { imported: 2, overwritten: 1 });
    const payload = page.cacheExportPayload();
    assert.deepEqual(JSON.parse(JSON.stringify(payload.entries)), imported);
    assert.equal(loadCore().parseCacheExport(JSON.stringify(payload)).entries[key].title, 'new');
});

test('failed import leaves the previous cache intact and reports the failure', async () => {
    const storage = { entries: new Map([['hn_polarization_thread:1', '{"title":"old"}']]), async write() { throw new Error('Quota exceeded'); } };
    const page = loadStoragePage(storage);
    await assert.rejects(page.importCacheEntries({ 'hn_polarization_thread:1': { title: 'new' } }), /Existing cache entries were kept.*Quota exceeded/);
    assert.equal(page.cacheExportPayload().entries['hn_polarization_thread:1'].title, 'old');
});
