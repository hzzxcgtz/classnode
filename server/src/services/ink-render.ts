import { INK_STROKE_COLOR, strokePath, strokeWidthPx, type InkCanvas, type InkValue } from './ink-path.js';

/**
 * 笔迹 → PNG（M6a）。**本文件是全仓唯一 import `sharp` 的导出相关模块。**
 *
 * 🔴 为什么把「画成 SVG」与「光栅化成 PNG」拆成两个文件：
 *   · `ink-path.ts` 必须能被 `src/lib/worksheet-ink-parity.test.ts` **跨工程加载**
 *     （对拍「服务端画的线与前端是不是同一条」），而那条用例跑在前端的 runner 里 ——
 *     一旦 `ink-path.ts` import 了 `sharp` 这个**原生依赖**，它就可能解析不到；
 *   · 本文件反过来**不参与对拍**：路径字符串对不对是上一条的事，这里只管
 *     「这条路径有没有变成一张真 PNG」。
 * ⇒ 分界就是「有没有碰 sharp」。
 *
 * ⚠️ **本机验不了「图长得像不像那幅画」**（没有能看图的渲染环境，也没有 Word）。
 * 能验的只有：出来的是不是真 PNG、尺寸在不在上限内、两种边界各走哪条路。
 */

/** 出图的长边上限。与既有 `scaleImageSize(imgWidth, imgHeight, 400, 400)` 同值。 */
export const INK_PNG_MAX = 400;

/**
 * 画布框量不出来（`{ w: 0, h: 0 }`）时用的**默认框**。
 *
 * 🔴 为什么是「用默认框出图」而不是回 `null`：**量不出框不等于没作答** ——
 * 值本身是合法的（学生确实画了），只是量框那一次失败了（老 iPad 上布局还没稳定）。
 * 回 `null` 的后果是报告里那一格写「本机无法渲染成图片」，而屏幕上**明明有那幅画**。
 *
 * ⚠️ 框只决定**宽高比**（`toPixel` 是 `x * box.w` / `y * box.h`），所以用一个
 * 「像画布」的比例即可 —— 这里取 4:3（绘图题的默认框就是 `320 × 240`）。
 */
const FALLBACK_BOX: InkCanvas = { w: 320, h: 240 };

/** `#rgb` / `#rrggbb` 之外的**一律回落**常量色：颜色是学生数据，不该进 SVG 的字符串拼接。 */
function safeColor(raw: string): string {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw) ? raw : INK_STROKE_COLOR;
}

type SharpModule = typeof import('sharp').default;
let _sharp: SharpModule | null = null;

/**
 * 与 `export-service.ts` 里同名函数**同一条写法**：动态 import + try/catch。
 *
 * 🔴 拿不到 `sharp` 时**不抛**，回 `null` —— 调用方据此印那句降级文案
 * （`REPORT_TEXT.inkFallback`）。今天 `sharp` 只是 WebP 转换的可选件，
 * 本批之后它**承重**：没有它就没有笔迹图。降级必须**说一句话**，不是留空。
 */
async function getSharp(): Promise<SharpModule | null> {
  if (!_sharp) {
    try {
      _sharp = (await import('sharp')).default;
    } catch (e) {
      console.warn('[ink-render] sharp not available, ink images disabled:', e);
      _sharp = null;
    }
  }
  return _sharp;
}

/**
 * 一份笔迹值 → PNG。**渲染不出来回 `null`，绝不抛。**
 *
 * ⚠️ 抛出去的后果不是「少一张图」：它会让**整份报告导不出来**，而教师只看到
 * 「导出失败」四个字 —— 一道手工改过的题能让一整节课的报告导不出来。
 */
export async function inkToPng(ink: InkValue): Promise<Buffer | null> {
  // ⚠️ 空笔画回 `null`（不是一张纯白图）：报告里「没有笔画」与「没作答」必须分得开。
  if (ink.strokes.length === 0) return null;
  const box: InkCanvas = ink.canvas.w > 0 && ink.canvas.h > 0 ? ink.canvas : FALLBACK_BOX;

  const paths = ink.strokes
    .map((stroke) => {
      const d = strokePath(stroke.points, box);
      if (!d) return '';
      const width = strokeWidthPx(stroke, box).toFixed(2);
      return `<path d="${d}" stroke="${safeColor(stroke.color)}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .filter(Boolean)
    .join('');
  if (!paths) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;

  const sharp = await getSharp();
  if (!sharp) return null;
  try {
    return await sharp(Buffer.from(svg))
      // ⚠️ `fit: 'inside'` + `withoutEnlargement`：只收上限，**不放大**
      //    （放大只会让笔迹糊掉，而小画布本来就够清楚）。
      .resize({ width: INK_PNG_MAX, height: INK_PNG_MAX, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (e) {
    // sharp 对畸形 SVG 会抛。与上面同一条纪律：收成 `null`，让报告说一句实话。
    console.warn('[ink-render] sharp failed to rasterize ink:', e);
    return null;
  }
}
