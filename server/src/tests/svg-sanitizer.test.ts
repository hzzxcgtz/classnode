import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSvg, safeAvatarView } from '../services/svg-sanitizer.js';
import { DEFAULT_AVATARS } from '../services/default-avatars.js';

const attacks = [
  '<svg><a href="&#106;avascript:alert(1)"><text>click</text></a></svg>',
  '<svg><image href="&#106;avascript:alert(1)"/></svg>',
  '<svg><image href="data:image/svg+xml,evil"/></svg>',
  '<svg><image href="//evil.test/x.png"/></svg>',
  '<svg><image href="/uploads/avatars/a.svg"/></svg>',
  '<svg><image href="/uploads/avatars/../a.png"/></svg>',
  '<svg><use href="https://evil.test/#x"/></svg>',
  '<svg><foreignObject><div>unsafe</div></foreignObject></svg>',
  '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><set attributeName="onload" to="alert(1)"/></svg>',
  '<svg xmlns="http://www.w3.org/1999/xhtml"><script>bad()</script></svg>',
  '<svg xmlns:a="http://www.w3.org/2000/svg"><a:script>bad()</a:script></svg>',
  '<svg><rect onload="alert(1)"/></svg>',
  '<svg><rect fill="url(&#104;ttps://evil.test/x)"/></svg>',
  '<svg><rect style="fill:u\\72l(https://evil.test/x)"/></svg>',
  '<svg><rect style="fill:u/**/rl(https://evil.test/x)"/></svg>',
  '<svg><rect style="background-image:url(https://evil.test/x)"/></svg>',
  '<svg><rect style="fill:expression(alert(1))"/></svg>',
  '<svg><style>@import "https://evil.test";</style></svg>',
  '<svg><?xml-stylesheet href="https://evil.test"?></svg>',
  '<svg><!DOCTYPE svg [<!ENTITY x "evil">]><text>&x;</text></svg>',
  '<svg><rect></svg>',
  '<svg></svg><svg></svg>',
];
for (const [index, svg] of attacks.entries()) {
  test(`SVG rejects decoded active/external content ${index + 1}`, () => assert.equal(sanitizeSvg(svg), null));
}
test('SVG retains gradients, clipping, local raster images, text and escaped attributes', () => {
  const svg = '<svg viewBox="0 0 40 40"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="c"><circle cx="20" cy="20" r="20"/></clipPath></defs><rect fill="url(#g)" style="stroke:#000;stroke-width:1"/><image href="/uploads/avatars/pic-12.png" clip-path="url(#c)"/><text aria-label="a&amp;&quot;b">&lt;hello&gt;</text></svg>';
  const safe = sanitizeSvg(svg);
  assert.ok(safe);
  assert.match(safe, /url\(#g\)/);
  assert.match(safe, /href="\/uploads\/avatars\/pic-12.png"/);
  assert.match(safe, /&lt;hello&gt;/);
  assert.equal(sanitizeSvg(safe), safe);
});
test('all 44 built-in avatars survive validation', () => {
  assert.equal(DEFAULT_AVATARS.length, 44);
  for (const avatar of DEFAULT_AVATARS) assert.ok(sanitizeSvg(avatar.svgContent));
});
test('legacy dangerous avatar renders inert placeholder without changing stored input', () => {
  const avatar = { id: 1, svgContent: attacks[0] };
  const safe = safeAvatarView(avatar);
  assert.equal(avatar.svgContent, attacks[0]);
  assert.doesNotMatch(safe.svgContent, /javascript|<a /);
  assert.ok(sanitizeSvg(safe.svgContent));
});
test('SVG rejects excessive size and nesting', () => {
  assert.equal(sanitizeSvg(`<svg>${'<g>'.repeat(101)}${'</g>'.repeat(101)}</svg>`), null);
  assert.equal(sanitizeSvg(`<svg><text>${'x'.repeat(200000)}</text></svg>`), null);
});
