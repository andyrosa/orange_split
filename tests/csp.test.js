// The page's Content-Security-Policy names the hash of each inline block. These tests fail when an edit
// to a block was not followed by `node scripts/csp.js --write`, and when the file carries CR characters,
// which would change the hashes the browser computes.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { HTML_PATH, readPage } = require('../scripts/load_core');
const { expectedPolicy, currentPolicy } = require('../scripts/csp');

test('the page has LF line endings, since CRLF would change every hash', () => {
    assert.ok(!readPage().includes('\r'), `${HTML_PATH} contains CR characters`);
});

test('the Content-Security-Policy in the page matches its inline blocks and its hosts', () => {
    const html = readPage();
    assert.equal(currentPolicy(html), expectedPolicy(html), 'the policy is stale; run: node scripts/csp.js --write');
});
