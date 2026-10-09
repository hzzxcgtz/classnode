import { createRequire } from 'node:module';
import type { ServerResponse } from 'node:http';

interface XmlParser {
  onopentag: (tag: { name: string; attributes: Record<string, string> }) => void;
  onclosetag: (name: string) => void;
  ontext: (text: string) => void;
  oncdata: (text: string) => void;
  ondoctype: () => void;
  onprocessinginstruction: () => void;
  onerror: (error: Error) => void;
  write: (xml: string) => XmlParser;
  close: () => void;
}
const sax = createRequire(import.meta.url)('sax') as { parser: (strict: boolean) => XmlParser };
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'image', 'use',
  'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feComposite', 'feFlood', 'feMerge', 'feMergeNode',
]);
const ATTRIBUTES = new Set([
  'id', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'opacity',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'clip-path', 'clip-rule', 'mask', 'filter', 'color', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'letter-spacing', 'word-spacing',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity',
  'fx', 'fy', 'fr', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'filterUnits', 'primitiveUnits',
  'in', 'in2', 'result', 'stdDeviation', 'mode', 'type', 'values', 'operator', 'k1', 'k2', 'k3', 'k4',
  'flood-color', 'flood-opacity', 'color-interpolation-filters', 'role', 'aria-label',
]);
const STYLE_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'display', 'visibility', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'clip-path', 'mask', 'filter',
  'stop-color', 'stop-opacity',
]);
const FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.-]*$/;
const LOCAL_IMAGE = /^\/uploads\/(?:avatars|logos|chat)\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i;

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safePresentation(value: string): boolean {
  // Reject CSS escapes/comments and active/external URL syntax. The only URL
  // allowed in presentation attributes is a reference to this SVG's own defs.
  if (/[\\<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
    || /\/\*|\*\/|@|expression\s*\(|(?:java|vb)script\s*:/i.test(value)) return false;
  const withoutFragments = value.replace(/url\(\s*(['"]?)#[A-Za-z_][A-Za-z0-9_.-]*\1\s*\)/gi, '');
  return !/url\s*\(/i.test(withoutFragments);
}

function safeStyle(value: string): boolean {
  return value.split(';').every(declaration => {
    if (!declaration.trim()) return true;
    const colon = declaration.indexOf(':');
    if (colon < 0) return false;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    return STYLE_PROPERTIES.has(property) && safePresentation(declaration.slice(colon + 1));
  });
}

/** Parse, validate decoded attributes, and serialize only the allowed SVG tree. */
export function sanitizeSvg(svg: string): string | null {
  const input = svg.trim();
  if (!/^<svg[\s>]/.test(input) || input.length > 200_000) return null;
  const parser = sax.parser(true);
  const output: string[] = [];
  let depth = 0, roots = 0, elements = 0;
  const refuse = () => { throw new Error('Unsupported SVG content'); };
  parser.onerror = refuse;
  parser.ondoctype = refuse;
  parser.onprocessinginstruction = refuse;
  parser.onopentag = (tag) => {
    if (!ELEMENTS.has(tag.name) || ++elements > 5000 || ++depth > 100) refuse();
    if (depth === 1 && (tag.name !== 'svg' || ++roots !== 1)) refuse();
    const attributes = { ...tag.attributes };
    if (depth === 1 && !attributes.xmlns) attributes.xmlns = SVG_NS;
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'xmlns') { if (value !== SVG_NS) refuse(); }
      else if (name === 'xmlns:xlink') { if (value !== XLINK_NS) refuse(); }
      else if (name === 'href' || name === 'xlink:href') {
        if (!((tag.name === 'use' && FRAGMENT.test(value))
          || (tag.name === 'image' && (FRAGMENT.test(value) || LOCAL_IMAGE.test(value))))) refuse();
      } else if (name === 'style') { if (!safeStyle(value)) refuse(); }
      else if (!ATTRIBUTES.has(name) || !safePresentation(value)) refuse();
    }
    const serialized = Object.entries(attributes)
      .map(([name, value]) => ` ${name}="${escapeText(value).replace(/"/g, '&quot;')}"`).join('');
    output.push(`<${tag.name}${serialized}>`);
  };
  parser.onclosetag = (name) => { output.push(`</${name}>`); depth--; };
  const text = (value: string) => {
    if (depth === 0 && value.trim()) refuse();
    output.push(escapeText(value));
  };
  parser.ontext = text;
  parser.oncdata = text;
  try {
    parser.write(input).close();
    return roots === 1 && depth === 0 ? output.join('') : null;
  } catch { return null; }
}

export function safeAvatarView<T extends { svgContent: string }>(avatar: T): T {
  return {
    ...avatar,
    // Protect rendering of old rows too, without mutating the user's database.
    svgContent: sanitizeSvg(avatar.svgContent) ?? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#cbd5e1"/></svg>',
  };
}

/** Historical uploaded SVG files may predate validation. Keep direct viewing inert. */
export function protectSvgAsset(res: Pick<ServerResponse, 'setHeader'>, filename: string): void {
  if (!/\.svg$/i.test(filename)) return;
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
