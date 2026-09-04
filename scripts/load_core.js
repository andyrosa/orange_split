// Loads the <script id="core"> block out of the page and evaluates it as a CommonJS module.
// This is the project's only packaging seam: the page stays a single file with no build step,
// and Node consumers (the runner, the tests) share the exact same code.
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', 'hn_polarization.html');
const CORE_SCRIPT_PATTERN = /<script id="core">([\s\S]*?)<\/script>/;

function readPage() {
    return fs.readFileSync(HTML_PATH, 'utf8');
}

// The text between a block's open and close tags, which `pattern` captures.
function blockText(html, pattern) {
    const match = html.match(pattern);
    if (!match) {
        throw new Error(`inline block ${pattern} not found in ${HTML_PATH}`);
    }
    return match[1];
}

function loadCore() {
    const moduleShim = { exports: {} };
    new Function('module', blockText(readPage(), CORE_SCRIPT_PATTERN))(moduleShim);
    return moduleShim.exports;
}

module.exports = { HTML_PATH, CORE_SCRIPT_PATTERN, readPage, blockText, loadCore };
