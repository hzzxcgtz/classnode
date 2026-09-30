import { INK_STROKE_COLOR, strokePath, strokeWidthPx, textBoxOf, type InkValue } from './ink-path.js';
import type { AnalyzeEntry, SheetKnobs, SheetLayout } from './analysis-payload.js';

/**
 * ★ M7a：载荷 → PNG。**本文件是本批唯一碰 sharp 的** —— 与 `ink-path.ts` / `ink-render.ts`
 * 那条分界纪律逐字相同（见 `ink-render.ts:8-14`：分界线就是「有没有碰 sharp」）。
 *
 * 🔴 **标签会静默消失**：打包后的应用可能带着**没有 fontconfig 的 sharp 构建**，
 * 那时 SVG `<text>` **无声地画不出来** —— 图是真的、格子都在、构建不报错，
 * 只是没有标签，而 AI 因此**认不出哪幅是谁的** ⇒ 分析结果整体错位，比没有分析更坏。
 * ⇒ `labelsRenderOk()` 是运行期探针：渲染一张含已知标签的极小图与一张不含的对照，
 *   比对非白像素比例。探针说不 ok 时调用方退化为「无标签网格 + 附编号对照文本」。
 *
 * ⚠️ 本机（macOS / arm64）实测 `<text>` 与中文都能渲染（`User_001` 非白 4.720% /
 * `张三` 2.382% / 空白对照 0.000%），**但那是开发机** —— 所以探针是**运行期**的，
 * 不是构建期的。
 *
 * 🔴 **学生数据只经两条路进 SVG**：笔画颜色（`safeColor` 白名单）与文本（`esc`）。
 * 颜色是学生可控的字符串，直接拼进 SVG 就能闭合标签注脚本；坐标同理（非有限数会产出
 * `NaN`，让整张图渲不出来 ⇒ 教师看到「分析失败」，而故障只在某一个学生身上）。
 */

type SharpModule = typeof import('sharp').default;
let _sharp: SharpModule | null = null;

/** 与 `ink-render.ts` 同一条写法：动态 import + try/catch，拿不到**不抛**。 */
async function getSharp(): Promise<SharpModule | null> {
  if (!_sharp) {
    try {
      _sharp = (await import('sharp')).default;
    } catch (e) {
      console.warn('[analysis-render] sharp not available, sheets disabled:', e);
      _sharp = null;
    }
  }
  return _sharp;
}

const PROBE_W = 120;
const PROBE_H = 40;
const PROBE_TEXT = 'User_001';

function probeSvg(withText: boolean): string {
  const text = withText
    ? `<text x="4" y="28" font-size="20" font-family="sans-serif" fill="#000000">${PROBE_TEXT}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PROBE_W}" height="${PROBE_H}"><rect width="100%" height="100%" fill="#ffffff"/>${text}</svg>`;
}

/** 非白像素占比（%）。0 = 整张纯白，也就是「什么都没画上去」。 */
async function inkRatio(sharp: SharpModule, svg: string): Promise<number> {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const stats = await sharp(buf).greyscale().stats();
  return 100 - stats.channels[0].mean / 255 * 100;
}

/**
 * 标签能不能渲染出来。**不抛** —— 拿不到 sharp 时回 `false`（调用方按「不能」处理）。
 *
 * 判据是「含文字的图比不含的更黑」，而不是某个绝对阈值：绝对阈值会随字体、抗锯齿、
 * 渲染尺寸漂，而**两者之差**才是「文字被画上去了」这件事本身。
 */
export async function labelsRenderOk(): Promise<boolean> {
  const sharp = await getSharp();
  if (!sharp) return false;
  try {
    const [withText, blank] = await Promise.all([
      inkRatio(sharp, probeSvg(true)),
      inkRatio(sharp, probeSvg(false)),
    ]);
    return withText > blank + 0.05;
  } catch (e) {
    console.warn('[analysis-render] label probe failed:', e);
    return false;
  }
}

/** 格子底板色与描边（与标签条区分开，教师一眼能看出格子边界）。 */
const CELL_BG = '#f8fafc';
const CELL_BORDER = '#cbd5e1';
const LABEL_FILL = '#334155';
const PLACEHOLDER_FILL = '#94a3b8';

/** XML 文本转义 —— 标签与占位文案都进 SVG 字符串拼接，`&` / `<` 会让整张图渲不出来。 */
function esc(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** `#rgb` / `#rrggbb` 之外的**一律回落**常量色：颜色是学生数据，不该进 SVG 的字符串拼接。 */
function safeColor(raw: unknown): string {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)
    ? raw
    : INK_STROKE_COLOR;
}

/** 一个采样点是不是两个有限数。⚠️ `NaN` 会让 path 变成 `M NaN NaN` ⇒ sharp 抛 ⇒ **整张图**渲染失败。 */
function isFinitePoint(point: unknown): boolean {
  return Array.isArray(point) && point.length >= 2
    && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/** 一格里的笔迹路径。`box` 就是这一格的框（`strokePath` 把归一化点映射进去）。 */
function cellInk(ink: InkValue | undefined, cell: SheetLayout['cells'][number]): string {
  if (!ink || !Array.isArray(ink.strokes)) return '';
  const box = { w: cell.w, h: cell.h };
  const paths = ink.strokes
    .filter((stroke) => stroke && Array.isArray(stroke.points) && stroke.points.every(isFinitePoint))
    .map((stroke) => {
      // ★ 2026-09-30：同上 —— 这一处**自己拼 `<path>`**，是四处渲染里最容易漏的。
      const d = strokePath(stroke.points, box, stroke.shape);
      if (!d) return '';
      const width = strokeWidthPx(stroke, box);
      const safeWidth = Number.isFinite(width) && width > 0 ? width.toFixed(2) : '1';
      return `<path d="${d}" stroke="${safeColor(stroke.color)}" stroke-width="${safeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .filter(Boolean)
    .join('');
  // ★ 2026-09-30 第二轮：**文字**。这是**四处渲染里最容易漏的一处**（它自己拼 SVG）。
  // ⚠️ 与 `ink-render.ts` 同一条：学生的字是不可信数据，必须转义。
  // ⚠️ 这一处**不判空**：调用方按整格取，空串就什么都不画（与其他几种作答一致）。
  const texts = (ink.texts ?? [])
    .map((text) => {
      const [x, y, , h] = textBoxOf(text, box);
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${(h / 1.3).toFixed(2)}" fill="${safeColor(text.color)}" dominant-baseline="hanging" font-family="sans-serif">${escape(text.text)}</text>`;
    })
    .join('');
  return paths + texts;
}

/** 一块底板 + 可选的一段文本。 */
function plate(cell: SheetLayout['cells'][number]): string {
  return `<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="${CELL_BG}" stroke="${CELL_BORDER}" stroke-width="1"/>`;
}

/**
 * 把一张联系表画成 SVG。`labeled` 为假时**一个 `<text>` 都不画**（画了也是白画，
 * 而且会让人误以为标签在）。
 *
 * ★ **导出是为了可测**：这条退化路径（打包环境缺 fontconfig）**没有任何办法在本机
 * 真实触发** —— 除非把它做成一个纯函数直接验。本仓的纪律是「判断放可测的纯模块」，
 * 而 SVG 构造恰好是判断（画不画标签、空格子写什么）与拼装的混合体，所以显式分开。
 * ⚠️ 它**不做**光栅化、不碰 sharp —— 那个才是本文件的分界线所在。
 */
export function buildSheetSvg(entries: AnalyzeEntry[], layout: SheetLayout, labeled: boolean): string {
  const parts: string[] = [];
  for (const cell of layout.cells) {
    const entry = entries[cell.index];
    parts.push(plate(cell));
    if (labeled) {
      parts.push(`<text x="${cell.labelX}" y="${cell.labelY + 16}" font-size="15" font-family="sans-serif" fill="${LABEL_FILL}">${esc(cell.anonLabel)}</text>`);
    }
    if (!cell.hasInk) {
      // 没有画可渲：说出原因，别留一块神秘的空底（教师与模型都得知道那是「空白」而不是「画布是白的」）
      if (labeled) {
        // 🔴 三态，不是两态：`mixed` 里**文字作答**那一格原先落进「（空白）」——
        // 而他答了字，答案就在同一屏的文档里。这张图将来是发给模型的那份东西，
        // 「（空白）」会让模型读到「这几位没答」。
        const why = entry?.kind === 'unknown' ? '（形状认不出）'
          : entry?.kind === 'text' ? '（文字作答，见文档）'
            : '（空白）';
        parts.push(`<text x="${cell.x + 8}" y="${cell.y + Math.round(cell.h / 2)}" font-size="14" font-family="sans-serif" fill="${PLACEHOLDER_FILL}">${esc(why)}</text>`);
      }
      continue;
    }
    // 笔迹要把原点挪到这一格的左上角（`strokePath` 给的是相对这一格的坐标）
    parts.push(`<g transform="translate(${cell.x}, ${cell.y})">${cellInk(entry?.ink, cell)}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/**
 * 把排版光栅化成 PNG。**渲不出来回 `null`，绝不抛** —— 同 `inkToPng` 的纪律：
 * 抛出去的后果不是「少一张图」，而是整条链路 500，教师只看到「分析失败」四个字。
 *
 * `labeled` 由 `labelsRenderOk()` **算一次**并随结果返回，界面据此决定要不要给编号对照表。
 * ⚠️ 它**必须**与真正画图时用的是同一个答案（用例钉着这一条）：
 * 两处各算一次就会分叉，而分叉的表现是「界面说有标签、图上没有」。
 */
export async function renderSheets(
  entries: AnalyzeEntry[], layouts: SheetLayout[], _knobs: SheetKnobs,
): Promise<{ sheets: Buffer[]; labeled: boolean } | null> {
  const sharp = await getSharp();
  if (!sharp) return null;
  const labeled = await labelsRenderOk();
  try {
    const sheets: Buffer[] = [];
    for (const layout of layouts) {
      sheets.push(await sharp(Buffer.from(buildSheetSvg(entries, layout, labeled))).png().toBuffer());
    }
    return { sheets, labeled };
  } catch (e) {
    console.warn('[analysis-render] failed to rasterize sheet:', e);
    return null;
  }
}
