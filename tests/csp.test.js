// The page's Content-Security-Policy names the hash of each inline block. These tests fail when an edit
// to a block was not followed by `node scripts/csp.js --write`, and when the page is not CRLF throughout.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { HTML_PATH, readPage } = require('../scripts/load_core');
const { expectedPolicy, currentPolicy } = require('../scripts/csp');

test('the page has CRLF line endings throughout', () => {
    const html = readPage();
    assert.ok(!/(?<!\r)\n/.test(html), `${HTML_PATH} has a line ending without CR`);
    assert.ok(!/\r(?!\n)/.test(html), `${HTML_PATH} has a CR without LF`);
});

test('the policy hashes the LF text the browser hashes, so CRLF and LF copies get one policy', () => {
    const html = readPage();
    assert.equal(expectedPolicy(html), expectedPolicy(html.replace(/\r\n/g, '\n')));
});

test('the Content-Security-Policy in the page matches its inline blocks and its hosts', () => {
    const html = readPage();
    assert.equal(currentPolicy(html), expectedPolicy(html), 'the policy is stale; run: node scripts/csp.js --write');
});
