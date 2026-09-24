/*
 * The API reference (#348). RapiDoc is vendored as one file — see
 * vendor/rapidoc/README.md for why and how to update it — and api-docs.html
 * points it at /api/openapi.json, the contract the server runs. Nothing here
 * is imported by the app: it is the second Vite entry, and the SPA's page load
 * pays nothing for it.
 */
import "../vendor/rapidoc/rapidoc-min.js";

/*
 * The guide's tables on a phone. docs/API.md has four-column tables (the
 * event catalogue, the doors outside the contract) whose code cells cannot
 * wrap, so at phone width they ran off the right edge with the last columns
 * clipped — and the text columns, squeezed to a word a line, stretched every
 * row a screen tall. Below the width where RapiDoc itself folds its nav away,
 * each row becomes a card instead: the first cell is its title and every
 * other cell carries its column's header as a label. The rules sit inside
 * RapiDoc's shadow root (a stylesheet outside cannot reach its markdown), and
 * the labels are written onto the cells as the markdown is rendered, since
 * the focused style re-renders it on every navigation.
 */
const narrowTables = `
@media (max-width: 767px) {
  .m-markdown table,
  .m-markdown tbody,
  .m-markdown tr,
  .m-markdown td {
    display: block;
    width: auto;
  }
  .m-markdown table {
    border: 0;
  }
  .m-markdown thead {
    display: none;
  }
  .m-markdown tr {
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    margin: 0 0 10px;
    padding: 8px 12px;
  }
  .m-markdown td {
    border: 0;
    padding: 3px 0;
    line-height: 1.45;
  }
  .m-markdown td:first-child {
    font-weight: 600;
    padding-bottom: 6px;
  }
  .m-markdown td[data-label]:not(:first-child)::before {
    content: attr(data-label);
    display: block;
    font-size: var(--font-size-small);
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--light-fg);
  }
  .m-markdown td code {
    overflow-wrap: anywhere;
  }
}
`;

function labelCells(root: ParentNode) {
  for (const table of root.querySelectorAll<HTMLTableElement>(
    ".m-markdown table:not([data-labelled])",
  )) {
    const headers = [...table.querySelectorAll("thead th")].map((th) =>
      th.textContent?.trim() ?? "",
    );
    for (const row of table.querySelectorAll("tbody tr")) {
      [...row.children].forEach((cell, i) => {
        if (headers[i]) cell.setAttribute("data-label", headers[i]);
      });
    }
    table.setAttribute("data-labelled", "");
  }
}

const doc = document.querySelector("rapi-doc");
const root = doc?.shadowRoot;
if (root) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(narrowTables);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  labelCells(root);
  new MutationObserver(() => labelCells(root)).observe(root, {
    childList: true,
    subtree: true,
  });
}
