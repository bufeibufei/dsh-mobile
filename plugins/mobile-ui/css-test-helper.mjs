import assert from 'node:assert/strict';

// Dependency-free parser for this stylesheet's flat declarations and nested
// @media blocks. Keep media ancestry and source order rather than matching raw
// text; quoted strings (including braces/semicolons) are not delimiters.
export function parseCSS(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let offset = 0;
  const until = delimiters => {
    const start = offset;
    let quote = '', depth = 0;
    while (offset < css.length) {
      const char = css[offset];
      if (quote) {
        if (char === '\\') { offset += 2; continue; }
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth--;
      else if (!depth && delimiters.includes(char)) break;
      offset++;
    }
    return css.slice(start, offset).trim();
  };
  const block = (media = [], nested = false) => {
    while (offset < css.length) {
      const header = until('{}');
      if (css[offset] === '}') {
        assert.ok(nested && !header, 'unexpected closing brace');
        offset++;return;
      }
      if (!header) break;
      assert.equal(css[offset++], '{');
      if (header.startsWith('@')) {
        assert.ok(header.startsWith('@media '), `unsupported at-rule: ${header}`);
        block([...media, header.slice(7).trim()], true);
        continue;
      }
      const declarations = {};
      while (offset < css.length) {
        const declaration = until(';}');
        if (declaration) {
          const colon = declaration.indexOf(':');
          assert.ok(colon > 0, `invalid declaration: ${declaration}`);
          declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
        }
        if (css[offset++] === '}') break;
      }
      // The checked selectors contain no comma inside functional pseudo classes.
      rules.push({selectors: header.split(',').map(s => s.trim()), declarations, media});
    }
    assert.ok(!nested, 'unclosed media block');
  };
  block();
  return rules;
}
