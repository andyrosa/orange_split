const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readPage, loadCore } = require('../scripts/load_core');

function pageHarness() {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.text = ''; }
        set textContent(value) { this.text = String(value); this.children = []; }
        get textContent() { return this.text + this.children.map(c => c.textContent).join(' '); }
        replaceChildren(...children) { this.text = ''; this.children = children; }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.append(child); return child; }
        prepend(child) { this.children.unshift(child); }
        querySelector(tag) { return this.children.find(c => c.tag === tag); }
    }
    const elements = { warnings: new Element('details'), results: new Element('main'), unverifiedAxes: new Element('details') };
    elements.warnings.append(new Element('summary'), new Element('ul'));
    const sandbox = { ...loadCore(), elements, renderedArticle: null,
        document: { createElement: tag => new Element(tag) },
        renderArticleSource: () => new Element('section'), renderUnverifiedAxes() {},
    };
    const source = readPage();
    for (const [start, end] of [['function makeElement(', '// Latest-request-wins'], ['function emptyComparisonMessage(', '// PKCE sign-in']]) {
        vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), sandbox);
    }
    return sandbox;
}

test('attribution exclusions show a specific explanation and both warning texts', () => {
    const page = pageHarness();
    const warnings = [
        '1 paraphrased or unresolved passages are shown separately and do not add counted voices.',
        'Comparison analysis did not run: no directly attributable passages were accepted for scoring.',
    ];
    const result = { article: {}, comments: [], rows: [], warnings, emptyReason: warnings[1] };
    page.renderResults(result, []);
    assert.match(page.elements.results.textContent, /Comparison analysis did not run/);
    assert.doesNotMatch(page.elements.results.textContent, /No verified comparisons were found|Entire article analyzed/);
    const warningList = page.elements.warnings.querySelector('ul');
    assert.deepEqual(Array.from(warningList.children, child => child.textContent), warnings);
    assert.equal(page.elements.warnings.querySelector('summary').textContent, '2 warnings');
    assert.equal(page.elements.warnings.hidden, false);
    assert.equal(page.elements.warnings.open, false);
});

test('older article results explain attribution exclusion while analyzed empty results retain their reason', () => {
    const page = pageHarness();
    assert.match(page.emptyComparisonMessage({ article: {}, comments: [] }), /does not establish that the text contains no comparisons/);
    assert.equal(page.emptyComparisonMessage({ article: {}, comments: [{ id: 1 }], emptyReason: 'No comparisons passed the check for incompatible opposing claims.' }), 'No comparisons passed the check for incompatible opposing claims.');
    assert.equal(page.emptyComparisonMessage({ rows: [] }), 'No verified comparisons were found in this selection.');
});
