'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  INK_MAX_POINTS,
  INK_MIN_POINT_DISTANCE_PX,
  countPoints,
  inkLimitReason,
  isFarEnough,
  normalizeAxis,
  INK_TOOL_SELECT,
  INK_TOOL_TEXT,
  isInkShapeTool,
  hitTestText,
  isShapeTooSmall,
  moveStroke,
  moveText,
  pickInkHandle,
  pickInkStroke,
  resizeStroke,
  shapeOutline,
  strokeHandles,
  textBoxOf,
  strokeWidthPx,
  toPixel,
} from '@/lib/worksheet-ink';
// ⚠️ A1 已经导出一个**类型** `InkCanvas`（作答那一刻的框 `{ w, h }`），而本文件导出的是
// **组件** `InkCanvas`（文件叫 `ink-canvas.tsx`、props 叫 `InkCanvasProps`）。两者在同一个
// 模块里其实能共存（`import type` 只占类型名字空间），但那样 `InkCanvasProps.box` 的类型
// 会比它自己的名字更值得解释。⇒ 类型侧引入为 `InkCanvasBox`：**同一个类型**，只改本文件的
// 本地名，不是第二份定义。
import type { InkCanvas as InkCanvasBox, InkPoint, InkShapeKind, InkStroke, InkText, InkTool } from '@/lib/worksheet-ink';
import styles from './worksheet.module.css';

/**
 * 手写画布（M4b / C1）—— 绘图题与「作答方式 = 手写」的那些题在**学生端与教师端预览**上
 * 的同一个控件。它是**唯一只能真机验**的那一环：本仓没有 jsdom / testing-library，
 * 「指针 → 笔迹」这条链没有任何自动化能替它作证（Global Constraint 16）。
 *
 * ── 判据一行都不在这里 ────────────────────────────────────────────────────
 * 形状 / 上限 / 归一化 / 换算 / 撤销 / 清空全部来自 `@/lib/worksheet-ink`（A1，有用例）。
 * 本文件只做三件事：把指针事件变成点、把点画到 canvas 上、把**收笔**那一刻的结果交出去。
 * ⇒ 画布上「画出来的形状」与教师抽屉里（E1 的 SVG）用的是**同一个** `toPixel` ——
 * 各写一份的后果是两处画出来的形状不一样，而两边都「看起来正常」（A1 的注释同一条）。
 *
 * ── 🔴 三条硬纪律（M4a/D1+D2 栽过一次，逐条照抄；这一份与 `use-pointer-drag.ts` 的那一份
 *     是同一条清单的两个副本，**改一处必须改另一处**）────────────────────────
 *   ① `setPointerCapture`（`pointerdown` 里）—— 手指移出画布之后 `pointermove` / `pointerup`
 *      仍然送给它。不做的话「画到一半滑出画布」就再也收不到 `pointerup`，
 *      画布**永久卡在落笔态**（后续每一次落笔都被忽略 ⇒ 学生再也画不了，屏幕上无任何报错）。
 *      ⚠️ `try/catch` 吞掉：老 WebKit 会抛，而抛出去会让后面几行不执行 ——
 *      那正是「永久卡住」的来源（`use-pointer-drag.ts:159-164` 同一条）。
 *   ② **静态 CSS 里的 `touch-action: none`**（`.inkCanvas` 那个类）。这是**唯一的开关**：
 *      按 Pointer Events 规范，`touch-action` 在**手势开始那一刻**求值，事后再写**不影响
 *      已经在进行的那一次手势**，而 `pointerdown` 已经是那一刻之后。
 *      🔴 **M4a 曾因漏挂这个类让整层失效**（`worksheet.module.css:472-474` 记着：
 *      排序题那份漏了，而报告把「`touch-action: none`」列为已交付）。
 *      ⇒ 本文件的 `pointerdown` 里**也再写一次行内值**（收尾时还原成空串）：那不是开关，
 *      是「落笔态下不许滚动」这条语义在桌面浏览器与第二次手势上的落实。
 *   ③ `pointerup` **与** `pointercancel` **都要收尾** —— 只处理前者 ⇒ 一次被系统中断的手势
 *      （来电、多任务手势、滚动接管）把画布永久留在落笔态。
 *      ⚠️ ink 与拖拽有一处**刻意的差异**：`pointercancel` 时**丢掉那一笔**（不落位），
 *      与 `use-pointer-drag.ts` 的「中断不落位、也不点选」同一条口径。
 *      代价（如实记）：一次来电会让学生丢掉**正在画的那一笔**（已经收笔的都在）——
 *      比「把半截线留在屏幕上，而学生不知道为什么」好。
 *   ④（本条是 ink 新增的）**落笔过程中不写 draft** —— 只在**收笔**那一下调一次 `onChange`。
 *      每一帧都写会打爆 `use-worksheet-answers.ts` 的防抖队列（1.5s 防抖被每一帧重置，
 *      而每次 `setDraft` 都会 `buildAnswerValue` + 序列化进 `localStorage`）。
 *      ⇒ 进行中的那一笔住在 `useRef` 里，**不进 React state**（每帧一次 setState 会让
 *      老 iPad 掉帧，而这是手感问题里最要紧的那一档）。
 *
 * ── 本文件里这四条各自落在哪（行号是**写下这一刻**的，改代码后请重核）──────────
 *   ① `setPointerCapture`：`:210`；`releasePointerCapture`：`:244`（两处都 `try/catch` 吞掉）；
 *   ② `.inkCanvas` 的静态 `touch-action`：`worksheet.module.css:783`（`touch-action` 在 `:790`）
 *      + 落笔时补一次行内值 `:211`；③ `handlePointerUp`（`:261`）与 `handlePointerCancel`（`:266`）
 *      都在，且都走 `endStroke`（`:239`）；④ 点只进 `liveRef`（`:212`），`onChange` 只在
 *      `endStroke` 收笔那一条路上出现（`:257`，**全文件唯一**一处）。
 */

/**
 * ⚠️ 工具栏（撤销 / 清空）**不在这里**，在 `questions/ink-body.tsx`：那两个按钮调的是 A1 的
 * `undoStroke` / `clearStrokes`，而它们要一份 `InkValue` —— 那个形状多一个 `format` 字段
 * （`inkFormatOf(node)`），而本组件的入参里**没有 node**（`InkCanvasProps` 逐字如此：
 * 画布只认框与笔画）。硬凑一个 `format` 占位值会在这里留下一个**谁都不读**的假字段，
 * 而那正是「下一个人以为它是这道题的 format」的来源。⇒ 分工：本组件管**指针与像素**，
 * `ink-body.tsx` 管**题型与作答值**。
 */
export interface InkCanvasProps {
  /** 空输入态时的**名义**框（`defaultInkBox(node)`）。它的 `h` 同时是元素的高度。 */
  box: InkCanvasBox;
  strokes: readonly InkStroke[];
  /** 画布下面那句提示语（`inkHint(node)`）。 */
  hint: string;
  /** 一笔结束 / 撤销 / 清空时调一次。`box` 是**这一刻量出来的**框。 */
  onChange: (next: { box: InkCanvasBox; strokes: InkStroke[]; texts?: InkText[] }) => void;
  disabled: boolean;
  /**
   * ★ 2026-09-30（基本图形工具）：这一档画什么。
   * ⚠️ `pen` 是**默认**，且手写那条路一个像素都没变 —— 老习惯的学生进题目直接画。
   */
  tool: InkTool;
  /** ★ 2026-09-30：新画的那一笔用多粗（`ink-body` 的粗细档给的）。 */
  width: number;
  /** ★ 2026-09-30：新画的那一笔用什么颜色（`ink-body` 的八色板给的）。 */
  color: string;
  /** ★ 2026-09-30 第二轮：画布上的**文字**（没有就不传）。 */
  texts: readonly InkText[];
  /** ★ 第二轮：新文字的**字号**跟着笔的粗细档（`textSizeForWidth` 算好给这里）。 */
  textSize: number;
  /**
   * ★ 2026-09-30：被选中的**元素**（`null` = 没选中）。
   * 🔴 它**住在 `ink-body`**（不是这里）：删除按钮在那边那条工具栏上，而两处各存一份
   *    「谁被选中」必然分叉（症状是「删掉的不是屏幕上圈着的那一个」）。
   */
  selected: InkSelection | null;
  onSelect: (next: InkSelection | null) => void;
}

/**
 * ★ 2026-09-30 第二轮：被选中/正在拖的**是哪种元素**。
 * 🔴 在这一轮之前它只是一个**笔画下标**（一个 `number`）—— 而文字是第二种元素，
 *    一个下标说不清它指的是哪一边（症状是「删掉的不是屏幕上圈着的那一个」）。
 */
export interface InkSelection { kind: 'stroke' | 'text'; index: number }

/** 选择档下正在做的手势（移动 / 改大小）。⚠️ 与 `LiveStroke` 同一条纪律：不进 state。 */
interface LiveSelect {
  kind: 'select';
  el: HTMLCanvasElement;
  pointerId: number;
  box: InkCanvasBox;
  /** 被拖的那个元素。 */
  target: InkSelection;
  /** 拖的是框内（移动）还是某个控制点（改大小）。 */
  mode: 'move' | 'resize';
  handle: number;
  /** 按下那一刻的那个点（归一化）。 */
  from: InkPoint;
  /** 按下那一刻那一笔的原样 —— 每次移动都**从它**算起（否则增量会累积、拖起来发飘）。 */
  origin: InkStroke | InkText;
  /** 这一帧要画成什么样。 */
  current: InkStroke | InkText;
}

/** 图形小到这个尺寸（像素）就不成形 —— 松手时丢掉（判据在 `isShapeTooSmall`）。 */
const MIN_SHAPE_PX = 8;

/** 选中框的颜色（与工具栏上当前档的高亮同一个主色）。 */
const SELECT_COLOR = '#527198';
/** 控制点的半径（像素）。⚠️ 画得小是**有意**的：它只是个记号。 */
const HANDLE_RADIUS_PX = 5;
/**
 * 点选图形 / 点控制点的**像素**宽容度。
 * 🔴 手指比线粗得多 —— 不给宽容度就点不中（而 `hitTestStroke` 对闭合图形内部也算命中，
 *    所以「点得中」这件事对矩形这类还算宽，对直线才真要宽容度）。
 */
const HANDLE_HIT_TOLERANCE_PX = 14;

/** 一组归一化点的**像素**外接框（`[x, y, w, h]`，喂 `strokeRect`）。 */
function boundsOf(points: readonly InkPoint[], box: InkCanvasBox): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    const [x, y] = toPixel(point, box);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

/** 正在画的那一笔。⚠️ **不进 React state**（纪律 ④）—— 它每一帧都在变。 */
interface LiveStroke {
  kind: 'stroke';
  el: HTMLCanvasElement;
  pointerId: number;
  box: InkCanvasBox;
  points: InkPoint[];
  /** ★ 2026-09-30：正在拖出来的图形（缺省 = 手写，那时 `points` 是**一串采样点**）。 */
  shape?: InkShapeKind;
}

export function InkCanvas({ box, strokes, texts, textSize, hint, onChange, disabled, tool, width, color, selected, onSelect }: InkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 已经收笔的笔画。`pointerup` 那一刻必须读到**当下**的值（state 是异步的）——
   *  与 `use-pointer-drag.ts:99-100` 的 `hoverRef` 同一条理由。 */
  const strokesRef = useRef<readonly InkStroke[]>(strokes);
  strokesRef.current = strokes;
  /** ★ 第二轮：文字的最新一份（与 `strokesRef` 同一条理由：`redraw` 是闭包）。 */
  const textsRef = useRef<readonly InkText[]>(texts);
  textsRef.current = texts;              // 每次渲染同步（不在 effect 里：`pointerup` 可能先到）
  const liveRef = useRef<LiveStroke | LiveSelect | null>(null);
  /**
   * 落笔**被拦**那一刻记下的原因。它只是上限提示的**第二个来源** ——
   * 主来源是每次渲染重算的 `inkLimitReason(strokes)`（见下面 `limitReason` 那一段）。
   */
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  /**
   * ★ 2026-09-30 第二轮：**正在打的那一段文字**（`null` = 没在打）。
   *
   * 🔴 用一个**真的 `<input>` 浮在画布上**（而不是往 canvas 里画光标）：canvas 没有文本编辑，
   *    自己实现光标 / 选区 / 输入法等于重写一个输入框 —— 而这一屏跑在老 iPad 上。
   * ⚠️ `at` 是归一化坐标（与文字元素同一套），落定时才换算。
   */
  const [draftText, setDraftText] = useState<{ at: InkPoint; value: string } | null>(null);

  // 一帧的全量重绘是**廉价**的：上限 2000 个点（A1）保证了这个循环最多 2000 次 lineTo。
  // 🔴 不要为了「优化」改成增量绘制 —— 增量绘制在「撤销 / 清空 / 水合」三条路上都要
  // 自己算该擦掉哪一段，而算错的表现是**屏幕上留着一条已经撤销掉的线**（学生以为没撤销成功）。
  const redraw = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    // ⚠️ 量框**只能**用 `getBoundingClientRect()`，**不许**用 `event.offsetX/offsetY`：
    // `offsetX` 在滚动 / 页面缩放 / 键盘弹起后的老 WebKit 上会错位，而它的表现是
    // 「整幅画偏移一个固定的量」—— 只在某些设备上出现（**未验证**），本机复现不了。
    const rect = el.getBoundingClientRect();
    // 🔴 宽高两件事分开：**CSS 框**由样式决定（宽 100%、高 = `box.h`），
    // **位图**由这里按 DPR 放大。不乘 DPR 的话在老 iPad 上（DPR=2）线是糊的。
    const dpr = window.devicePixelRatio || 1;
    const bitmapW = Math.max(1, Math.round(rect.width * dpr));
    const bitmapH = Math.max(1, Math.round(rect.height * dpr));
    if (el.width !== bitmapW || el.height !== bitmapH) {
      el.width = bitmapW;
      el.height = bitmapH;
    }
    // ⚠️ 顺序：赋 `width` / `height` 会把画布整个清掉**并重置变换**，所以是「先定尺寸、
    // 再设变换、再清」；清的范围用 CSS 像素（变换已经把 DPR 乘进去了）。
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    // 画的时候用的框 = **当下量出来的 CSS 框**。🔴 不能拿 `box` 那个 prop 顶替：
    // 元素的宽是 CSS 的 100%，而 `box.w` 是**名义**宽（320），两者在 720px 的容器上差一倍。
    // 归一化那一侧（`normalizeAxis`）用的也正是这个框，两边必须是同一个。
    const scale = { w: rect.width, h: rect.height };
    const drawStroke = (stroke: InkStroke) => {
      if (stroke.points.length === 0) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = strokeWidthPx(stroke, scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // ★ 2026-09-30（基本图形工具）：图形走**折线** —— `shapeOutline` 与教师端 SVG
      //    （`ink-preview.tsx` 的 `strokePath`）用的是**同一份几何**，所以「学生画的」
      //    与「教师看到的」在结构上不可能不一样。手写仍然走下面那条老路，一个像素不变。
      const outlines = shapeOutline(stroke, scale);
      if (outlines.length > 0) {
        for (const outline of outlines) {
          if (outline.points.length === 0) continue;
          ctx.beginPath();
          outline.points.forEach((point, index) => {
            const [x, y] = toPixel(point, scale);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          if (outline.closed && outline.points.length >= 3) ctx.closePath();
          ctx.stroke();
        }
        return;
      }
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const [x, y] = toPixel(point, scale);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      // 单点笔画（学生在屏幕上点了一下）必须画出一个点。理由与 A1 的 `strokePath` 逐字相同：
      // 零长度子路径在 Safari 上画不画得出来各家不同，补一段极短的线段最稳。
      if (stroke.points.length === 1) {
        const [x, y] = toPixel(stroke.points[0], scale);
        ctx.lineTo(x + 0.01, y);
      }
      ctx.stroke();
    };
    // 🔴 选择手势进行中时，**被拖的那一笔画 `current`**（而不是库里那一份）——
    //    与手写那条「进行中的一笔走同一个 drawStroke」同一条理由：松手的一瞬间不该跳一下。
    const liveSelect = liveRef.current?.kind === 'select' ? liveRef.current : null;
    strokesRef.current.forEach((stroke, index) => {
      const dragging = liveSelect && liveSelect.target.kind === 'stroke' && liveSelect.target.index === index;
      drawStroke(dragging ? liveSelect.current as InkStroke : stroke);
    });
    // ★ 2026-09-30 第二轮：**文字**。⚠️ 用的是与教师端 SVG **同一个** `textBoxOf`
    //（估算框）⇒ 两边画在同一处，不可能分叉。
    // ⚠️ `textBaseline = 'top'`：canvas 默认是 `alphabetic`（基线），而我们的框是左上角 ——
    //    不改的话文字会整体上浮一个字高（屏幕上只是「位置有点怪」）。
    for (const text of textsRef.current) {
      const [x, y, , h] = textBoxOf(text, scale);
      ctx.fillStyle = text.color;
      ctx.font = `${h / 1.3}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(text.text, x, y);
    }
    // ★ 2026-09-30：选中态的画法（虚线外框 + 控制点）。**只有图形有控制点**
    //（手写选不中，判据在 `hitTestStroke` / `shapeOutline`）。
    // ★ 2026-09-30（复审）：**只读态不画选中框** —— 锁住之后点不动、删不掉、
    //    取消不了，一个留在屏幕上的虚线框就是「叫学生做他做不到的事」。
    if (selected !== null && !disabled) {
      const dragging = liveSelect && liveSelect.target.kind === selected.kind && liveSelect.target.index === selected.index;
      const current = dragging ? liveSelect.current : undefined;
      if (selected.kind === 'text') {
        // ★ 第二轮：文字**没有控制点**（教师定的「字号跟着粗细档」）⇒ 只画一圈虚线框。
        const chosenText = (current ?? textsRef.current[selected.index]) as InkText | undefined;
        if (chosenText) {
          const [tx, ty, tw, th] = textBoxOf(chosenText, scale);
          ctx.save();
          ctx.strokeStyle = SELECT_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(tx, ty, tw, th);
          ctx.restore();
        }
      } else {
        const chosen = (current ?? strokesRef.current[selected.index]) as InkStroke | undefined;
        const handles = chosen ? strokeHandles(chosen) : [];
        if (handles.length > 0) {
          ctx.save();
          ctx.strokeStyle = SELECT_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(...boundsOf(handles, scale));
          ctx.setLineDash([]);
          for (const handle of handles) {
            const [hx, hy] = toPixel(handle, scale);
            ctx.beginPath();
            ctx.arc(hx, hy, HANDLE_RADIUS_PX, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    // 进行中的那一笔照**收笔后会用到的同一份样式**画（同一个常量），否则收笔的一瞬间
    // 线的颜色 / 粗细会跳一下。
    const live = liveRef.current;
    if (live && live.kind === 'stroke') drawStroke({ color, width, points: live.points, shape: live.shape });
  }, [selected, width, color, disabled]);

  // ★ 水合 / 撤销 / 清空 / 收笔后回填都走它。
  // ⚠️ 依赖里有 `selected`：选中态是**画上去的**，它变了必须重画。
  useEffect(() => { redraw(); }, [redraw, strokes, texts, selected]);

  /**
   * 上限提示的**第一个来源**（主来源）：当下就在上限上时它自己就在屏幕上。
   *
   * 🔴 为什么这一条不能省：只在「落笔那一刻」显示的话，学生**看不到它为什么画不上**
   * —— 他会反复戳屏幕。而画布上此刻一笔都加不进去这件事，在**渲染期**就是可判的
   *（`inkLimitReason(strokes)`），所以提示不该等到下一次落笔才出现。
   * ⚠️ 这一条与 `blockedReason` 是**同一个 `useState` 的两个来源**，不是两套提示：
   * 下面 `limitReason` 把两者合成一句；`blockedReason` 在上限解除后清掉，否则学生会
   * 看到一句过期的话（他明明已经撤销了几笔）。
   */
  useEffect(() => {
    if (inkLimitReason(strokes) === null) setBlockedReason(null);
  }, [strokes]);

  // 卸载也要收尾：画到一半切走模块 / 面板被卸载时 `pointerup` 永远等不到
  // —— 与 `use-pointer-drag.ts:127` 的 `useEffect(() => endGesture, …)` 同一条。
  useEffect(() => () => { liveRef.current = null; }, []);

  /**
   * 落笔。
   *
   * ⚠️ `disabled` 的闸门在**每个 handler 的入口**（不是「不挂 handler」）：判据因此只有一处，
   * 而不是「挂 / 不挂」那种两处写法。
   */
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // 多点触控 / 手掌误触：已经有一根手指在画 ⇒ **忽略这一次**（不做多指同时画）。
    // ⚠️ 手掌误触本身**本机验不了**（Global Constraint 16）：这一行只能保证
    // 「第二根手指不会打乱正在画的那一笔」，不能证明「手掌压上来时不会画出一条线」。
    if (liveRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const liveBox = { w: rect.width, h: rect.height };
    const point: InkPoint = [
      normalizeAxis(event.clientX - rect.left, rect.width),
      normalizeAxis(event.clientY - rect.top, rect.height),
    ];
    // ★ 2026-09-30（教师选「甲」）：**选择档** —— 点图形选中它、拖框内移动、拖控制点改大小。
    // ⚠️ 它**不经过上限闸**（没有新笔画产生），也不做采样过滤（那不是画线）。
    // ★ 2026-09-30 第二轮：**文字档** —— 点一下在那里放一个文本框（真的 `<input>` 浮上来）。
    // ⚠️ 它不经过上限闸、也不落笔画：文字是**另一种元素**，上限由服务端那条单独拦。
    if (tool === INK_TOOL_TEXT) {
      setDraftText({ at: point, value: '' });
      event.stopPropagation();
      return;
    }
    if (tool === INK_TOOL_SELECT) {
      const filled = strokesRef.current;
      // 🔴 **顺序不能反**（2026-09-30 复审抓出来的真缺陷）：
      //   ① **先**看「已选中那一笔」的控制点 —— 控制点是**画出来的**，
      //      按它就必须抓得住。而五个图形的控制点（外接框的角）落在**轮廓外面很远**
      //      （椭圆 ≈30px、三角形 ≈75px，320×240 实测）⇒ 用轮廓命中去找它们**永远找不到**，
      //      学生按下那个白点会 `onSelect(null)` —— 选中被丢掉、什么都没拖起来。
      //   ② **再**看有没有点中某个图形（从后往前，后画的在上）。
      //   ③ 都没中 ⇒ 点空白，取消选中。
      const filledTexts = textsRef.current;
      // ① 已选中那个**图形**的控制点（文字没有控制点 ⇒ 跳过这一档）。
      if (selected?.kind === 'stroke') {
        const selectedStroke = filled[selected.index];
        if (selectedStroke) {
          const handle = pickInkHandle(point, selectedStroke, liveBox, HANDLE_HIT_TOLERANCE_PX);
          if (handle >= 0) {
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 纪律 ① */ }
            event.currentTarget.style.touchAction = 'none';
            liveRef.current = {
              kind: 'select', el: event.currentTarget, pointerId: event.pointerId, box: liveBox,
              target: selected, mode: 'resize', handle, from: point,
              origin: selectedStroke, current: selectedStroke,
            };
            redraw();
            event.stopPropagation();
            return;
          }
        }
      }
      // ② 点中了某个**图形**（从后往前：后画的在上）
      const strokeIndex = pickInkStroke(point, filled, liveBox, HANDLE_HIT_TOLERANCE_PX);
      // ③ 点中了某段**文字**（同样从后往前）——★ 第二轮：文字也能选中/拖动
      let textIndex = -1;
      for (let i = filledTexts.length - 1; i >= 0; i -= 1) {
        if (hitTestText(point, filledTexts[i], liveBox, HANDLE_HIT_TOLERANCE_PX)) { textIndex = i; break; }
      }
      // 🔴 两者都命中时取**下标更大的**那一侧：两个数组各自按画的先后排，而屏幕上层级
      //    只能用一个粗略规则 —— 后加进来的那一类在上（与「后画的在上」同一个意思）。
      let target: InkSelection | null = null;
      if (strokeIndex >= 0 && textIndex >= 0) {
        // 两个数组没有共同的时序 ⇒ 用长度近似（后加的那一类通常更长的一方更晚）。
        target = textIndex >= strokeIndex ? { kind: 'text', index: textIndex } : { kind: 'stroke', index: strokeIndex };
      } else if (textIndex >= 0) target = { kind: 'text', index: textIndex };
      else if (strokeIndex >= 0) target = { kind: 'stroke', index: strokeIndex };
      if (!target) { onSelect(null); return; }               // 点空白 ⇒ 取消选中
      onSelect(target);
      const chosen: InkStroke | InkText = target.kind === 'text' ? filledTexts[target.index] : filled[target.index];
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 纪律 ① */ }
      event.currentTarget.style.touchAction = 'none';
      liveRef.current = {
        kind: 'select', el: event.currentTarget, pointerId: event.pointerId, box: liveBox,
        target, mode: 'move', handle: -1, from: point,
        origin: chosen, current: chosen,
      };
      redraw();
      event.stopPropagation();
      return;
    }
    const filled = strokesRef.current;
    const reason = inkLimitReason(filled);
    if (reason) { setBlockedReason(reason); return; }        // ★ 到上限：不落笔，把提示留在屏幕上
    setBlockedReason(null);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 纪律 ① */ }
    event.currentTarget.style.touchAction = 'none';        // 纪律 ②
    // ★ 2026-09-30：图形档 ⇒ 这一笔**只有两个点**（外接框的两个对角），拖动时**换掉第二个点**
    //    而不是往后追加 —— 见 `handlePointerMove`。手写档一行都没变。
    liveRef.current = {
      kind: 'stroke',
      el: event.currentTarget, box: liveBox, pointerId: event.pointerId, points: [point],
      ...(isInkShapeTool(tool) ? { shape: tool } : {}),
    };
    redraw();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || live.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const liveBox = { w: rect.width, h: rect.height };
    const point: InkPoint = [
      normalizeAxis(event.clientX - rect.left, rect.width),
      normalizeAxis(event.clientY - rect.top, rect.height),
    ];
    // ★ 图形档：**换掉第二个点**（形状恒是两点定义几何），也不做采样过滤 ——
    //   采样过滤会把「拖到一半的手」判成没动，而形状只需要那两个点。
    if (live.kind === 'stroke' && live.shape) {
      live.points = [live.points[0], point];
      redraw();
      event.stopPropagation();
      return;
    }
    // ★ 选择手势：从**按下那一刻的原样**算起（不是增量累加 —— 累加会飘）。
    if (live.kind === 'select') {
      live.box = liveBox;
      // ★ 第二轮：移动按**元素种类**分派（文字走 `moveText`，它按估算框夹取）。
      live.current = live.target.kind === 'text'
        ? moveText(live.origin as InkText, point[0] - live.from[0], point[1] - live.from[1])
        : live.mode === 'move'
          ? moveStroke(live.origin as InkStroke, point[0] - live.from[0], point[1] - live.from[1])
          : resizeStroke(live.origin as InkStroke, live.handle, point);
      redraw();
      event.stopPropagation();
      return;
    }
    const last = live.points[live.points.length - 1];
    // 🔴 采样过滤（A1 的 `isFarEnough`）：不过滤的话一次涂鸦就是上千个点，
    //    学生几乎一落笔就撞上 2000 点的上限，而他以为是自己画得太多。
    if (!isFarEnough(last, point, liveBox, INK_MIN_POINT_DISTANCE_PX)) return;
    // 点数预算用尽 ⇒ **冻住这一笔**（继续收点会让收笔时整笔被 `appendStroke` 丢掉，
    // 而学生看到的是「我画的最后一笔没了」）。冻住时屏幕上那一笔是完整的。
    if (countPoints(strokesRef.current) + live.points.length >= INK_MAX_POINTS) return;
    live.points.push(point);
    redraw();
    event.stopPropagation();
  };

  /** 收笔：**唯一**写 draft 的地方（纪律 ④）。`commit` 为 false 时丢掉这一笔。 */
  const endStroke = (commit: boolean) => {
    const live = liveRef.current;
    liveRef.current = null;
    if (live?.el) {
      live.el.style.touchAction = '';
      try { live.el.releasePointerCapture(live.pointerId); } catch { /* 纪律 ① */ }
    }
    if (!live || !commit) { redraw(); return; }
    // ★ 2026-09-30：选择手势 —— **只在这一刻写库**（拖到一半不写）。
    //    🔴 那是刻意的：`selected` 是**下标**，而移动中途写库会让 `strokes` 换一份新数组
    //    ⇒ 下标与屏幕上的图形对不上（症状是「拖着拖着选中了别的图形」）。
    if (live.kind === 'select') {
      if (live.current !== live.origin) {
        // ★ 第二轮：写回**它所在的那个数组**（文字与笔画是两个数组，写错一边 = 拖了没反应）。
        if (live.target.kind === 'text') {
          const nextTexts = textsRef.current.map((item, index) => (index === live.target.index ? live.current as InkText : item));
          onChange({ box: live.box, strokes: [...strokesRef.current], texts: nextTexts });
        } else {
          const nextStrokes = strokesRef.current.map((stroke, index) => (index === live.target.index ? live.current as InkStroke : stroke));
          onChange({ box: live.box, strokes: nextStrokes, texts: [...textsRef.current] });
        }
      } else {
        redraw();                       // 按了没动（或拖回原地）⇒ 不写库，只重画掉高亮
      }
      return;
    }
    // ★ 2026-09-30：图形档**手指抖一下不该留下一个看不见的图形**。
    // 🔴 判据在 `isShapeTooSmall`（判据层、有用例）—— 这里原来是一段内联的像素算术，
    //    而它与 spec、与自己的注释**三份说法打架**（复审抓出来的）。线 / 角 / 外接框图形
    //    各按各自的几何判，不在这里一刀切。
    if (live.shape && isShapeTooSmall({ color: '', width: 0, points: live.points, shape: live.shape }, live.box, MIN_SHAPE_PX)) {
      redraw();
      return;
    }
    const stroke: InkStroke = {
      color, width, points: live.points,
      ...(live.shape ? { shape: live.shape } : {}),
    };
    // ⚠️ 这里**不**走 A1 的 `appendStroke`，两个理由：
    //   ① 它要一份 `InkValue`（多一个 `format` 字段，而本组件**拿不到 node** —— 与工具栏
    //      不在本文件的那条理由逐字相同，见 `InkCanvasProps` 上面那段）；
    //   ② 它的「超上限时原样返回」在**收笔那一下**会把学生刚画的一整笔**静默丢掉**
    //      （屏幕上少一条完整的线，而没有任何提示）。本组件的两道闸（落笔前
    //      `inkLimitReason`、落笔中按 `INK_MAX_POINTS` 冻结）已经保证这一笔落在预算内；
    //      真的越界时宁可让它画上，也不要让它无声消失 —— 上限提示由 `limitReason` 那一行给。
    // ⇒ 代价如实记：A1 的 `appendStroke` 在本文件里**没有消费者**（它自己有用例钉着，
    //   服务端 B1 的写入口是另一条路）。
    onChange({ box: live.box, strokes: [...strokesRef.current, stroke] });
  };

  /**
   * ★ 第二轮：把正在打的那段文字**落定**（回车 / 失焦）。
   * ⚠️ 空白串**不落**（点一下没打字不该留下一个看不见的空文字元素）；
   *    落定时把 `at` 夹到 0..1（与 `moveText` 同一把尺子）。
   */
  const commitText = (value: string) => {
    const draft = draftText;
    setDraftText(null);
    const text = value.trim();
    if (!draft || text === '') return;
    const next: InkText = {
      text, at: [normalizeAxis(draft.at[0], 1), normalizeAxis(draft.at[1], 1)],
      color, size: textSize,
    };
    onChange({ box, strokes: [...strokesRef.current], texts: [...textsRef.current, next] });
  };

  // ★ 纪律 ③：**两条都要**。少任何一条都会让一次被系统中断的手势留下状态。
  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (liveRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    endStroke(true);                       // 收笔 ⇒ 落一笔
  };
  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (liveRef.current?.pointerId !== event.pointerId) return;
    event.stopPropagation();
    endStroke(false);                      // 中断 ⇒ **丢掉这一笔**（与拖拽的「中断不落位」同一条口径）
  };

  /**
   * 上限提示的**第二个来源** + 合成：`inkLimitReason(strokes)` 优先（它在上限解除后自己消失，
   * 不需要任何清理），它为空时再看有没有一次「刚才被拦下」的记录。
   */
  const limitReason = inkLimitReason(strokes) ?? blockedReason;

  return (
    <div className={styles.inkFrame}>
      {draftText && (
        /* ★ 第二轮：文字输入框。**绝对定位浮在画布上**（画布是 `<canvas>`，它没有文本编辑）。
           ⚠️ `fontSize` 按**像素**算（与落定后 `textBoxOf` 的行高同一个换算）——
              两者不一致的话，打字时与落定后会跳一下。 */
        <input
          autoFocus
          value={draftText.value}
          aria-label="输入文字"
          placeholder="在这里输入"
          onChange={(event) => setDraftText({ ...draftText, value: event.target.value })}
          onBlur={(event) => commitText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitText(draftText.value); }
            // Esc = 放弃这一段（与其它弹层的习惯一致）。
            if (event.key === 'Escape') { event.preventDefault(); setDraftText(null); }
          }}
          style={{
            position: 'absolute',
            left: `${draftText.at[0] * box.w}px`,
            top: `${draftText.at[1] * box.h}px`,
            minWidth: 90,
            padding: '2px 4px',
            font: `${(textSize * Math.min(box.w, box.h) * 1.3).toFixed(1)}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`,
            color,
            border: '1px dashed #8da6c4',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.92)',
            zIndex: 2,
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        className={styles.inkCanvas}
        // 高 = `box.h`（`defaultInkBox` 那两个数是**界面上看得见的**），宽由 CSS 给 100%。
        style={{ height: box.h }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
      {/* ★ 2026-09-28：**只读态不显示这句提示。**
          🔴 它说的是「用手指在画布上作图（画错了可以点「撤销」或「清空」）」——
          而定稿（已提交 + 不许重交）与教师端预览时，画布不响应指针、那两个按钮也是
          `disabled`。**一行叫学生做他做不到的事的提示，就是一句假话**，而且学生会
          反复去点那两个按钮。
          ⚠️ 定稿态**不另加一句解释**：教师明确删掉了原来那句
          （「这道题已经完成，老师设置为不能再修改」），而状态本身在结果栏里已经读得出来。 */}
      {!disabled && <p className={styles.inkHint}>{hint}</p>}
      {/* 🔴 上限提示：到上限时它**在屏幕上等着**，不是等到学生再戳一次才出现。
          文案由 A1 的 `inkLimitReason` 给（带上限数字与两条出路）。 */}
      {limitReason ? (
        <p className={styles.inkLimit} role="status">⚠️ {limitReason}</p>
      ) : null}
    </div>
  );
}
