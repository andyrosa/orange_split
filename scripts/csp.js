// Content-Security-Policy for hn_polarization.html.
// The page's policy names the SHA-256 hash of each inline block (the two script blocks and the style
// block), so an edit to any of them changes the hash the browser expects, and a stale policy makes the
// browser refuse to run the block. This script recomputes the policy:
//   node scripts/csp.js          reports whether the policy in the page is current; exit code 1 when not
//   node scripts/csp.js --write  rewrites the policy in the page
// tests/csp.test.js runs the same comparison, so a stale policy fails the test suite.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HTML_PATH = path.join(__dirname, '..', 'hn_polarization.html');
const WRITE_FLAG = '--write';

// The only hosts the page connects to; the browser refuses every other connection.
const CONNECT_HOSTS = ['https://openrouter.ai', 'https://hn.algolia.com'];

// The inline blocks the policy names, each hashed over the text between its open and close tags,
// which is what the browser hashes.
const INLINE_BLOCKS = [
    { directive: 'script-src', pattern: /<script id="core">([\s\S]*?)<\/script>/ },
    { directive: 'script-src', pattern: /<script id="page">([\s\S]*?)<\/script>/ },
    { directive: 'style-src', pattern: /<style>([\s\S]*?)<\/style>/ },
];

const META_PATTERN = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;

function sha256Base64(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('base64');
}

function blockText(html, block) {
    const match = html.match(block.pattern);
    if (!match) {
        throw new Error(`inline block ${block.pattern} not found in ${HTML_PATH}`);
    }
    return match[1];
}

// The policy the page should carry for its current content.
function expectedPolicy(html) {
    const hashesByDirective = {};
    for (const block of INLINE_BLOCKS) {
        const hash = `'sha256-${sha256Base64(blockText(html, block))}'`;
        hashesByDirective[block.directive] = (hashesByDirective[block.directive] || []).concat(hash);
    }
    return [
        "default-src 'none'",
        `script-src ${hashesByDirective['script-src'].join(' ')}`,
        `style-src ${hashesByDirective['style-src'].join(' ')}`,
        `connect-src ${CONNECT_HOSTS.join(' ')}`,
        'img-src data:',
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ');
}

// The policy the page carries now.
function currentPolicy(html) {
    const match = html.match(META_PATTERN);
    if (!match) {
        throw new Error(`Content-Security-Policy meta tag not found in ${HTML_PATH}`);
    }
    return match[1];
}

function readPage() {
    return fs.readFileSync(HTML_PATH, 'utf8');
}

function withPolicy(html, policy) {
    return html.replace(META_PATTERN, `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
}

function main() {
    const html = readPage();
    const expected = expectedPolicy(html);
    const current = currentPolicy(html);
    if (current === expected) {
        console.log('Content-Security-Policy is current.');
        return 0;
    }
    if (process.argv.includes(WRITE_FLAG)) {
        fs.writeFileSync(HTML_PATH, withPolicy(html, expected), 'utf8');
        console.log('Content-Security-Policy rewritten.');
        return 0;
    }
    console.log(`Content-Security-Policy is stale.\n  page:     ${current}\n  expected: ${expected}\nRun: node scripts/csp.js ${WRITE_FLAG}`);
    return 1;
}

module.exports = { HTML_PATH, expectedPolicy, currentPolicy, readPage };

if (require.main === module) {
    process.exitCode = main();
}
