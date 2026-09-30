'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import {
  INK_DEFAULT_COLOR, INK_DEFAULT_TOOL, INK_DEFAULT_WIDTH, INK_PALETTE, INK_TOOLS, INK_WIDTH_OPTIONS,
  clearStrokes, defaultInkBox, inkFormatOf, inkHint, undoStroke,
} from '@/lib/worksheet-ink';
import type { InkTool, InkValue, InkWidth } from '@/lib/worksheet-ink';
import { InkCanvas } from '../ink-canvas';
import styles from '../worksheet.module.css';

/**
 * 画布题的作答体（M4b / C1）：**绘图题**与**作答方式 = 手写**的那些题走这一支。
 *
 * 它是分派器（`./index.tsx` 的 ink 支）与画布组件（`../ink-canvas.tsx`）之间**唯一的**
 * 那一层，管两件事：
 *   · **题型 → 形状**：名义框（`defaultInkBox`）、提示语（`inkHint`）、作答值的 `format`
 *     （`inkFormatOf`）。这三样都只跟 `node` 有关，而画布组件拿不到 `node`（它只认框与笔画）。
 *   · **撤销 / 清空**：两条路都调 A1 的纯函数（`undoStroke` / `clearStrokes`），
 *     再走**同一个** `onChange`（一样是一次写）—— 与 M4a 那三个条目型题型的「三条路改同一份
 *     数据」同一条纪律：不存在「按钮改了、别处没改」的可能。
 *
 * 🔴 **「清空」不是可选的便利按钮**（规格 §12 裁定 4 的代价那一栏）：画到上限的学生
 * 必须有**一条出路**，否则他只能一笔一笔撤销 400 次。删掉它等于把那个学生堵死。
 *
 * ⚠️ 只读态（教师端预览渲染的是**同一个组件**，`disabled`）：画布不响应指针、两个按钮
 * 带 `disabled` 属性，但**形状一个都不少** —— 那句「教师看到的就是学生看到的宽度」
 * 说的是看到的东西一样，不是「能操作」（`questions/index.tsx` 文件头同一条）。
 */
export interface InkBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'ink' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

/**
 * 每一档在按钮上写什么。
 *
 * ⚠️ **用文字不用图标**（★ 2026-09-30 实施时定的）：九个图形的图标要画九个小 SVG，
 *    而文字标签**更准确**（「平行四边形」五个字不可能被认成别的），也天然满足
 *    「图标按钮必须有 aria-label」那条纪律。真机上看着挤的话再换成图标。
 * 🔴 顺序跟着 `INK_TOOLS`（判据层），这里只是一个「名字 → 中文」的查表。
 */
const TOOL_LABELS: Record<InkTool, string> = {
  pen: '手写',
  line: '直线',
  arrow: '箭头',
  rect: '矩形',
  ellipse: '圆',
  triangle: '三角形',
  'right-triangle': '直角三角形',
  parallelogram: '平行四边形',
  trapezoid: '梯形',
  angle: '角',
  select: '选择',
};

/**
 * ★ 2026-09-30（教师：「UI 你不考虑的吗？」）：每个档的图标。
 *
 * 🔴 **每个图标就是那个形状的缩略图** —— 用的观感与画布上画出来的**一致**
 *（同一个 `20×20` 的坐标系里摆一遍那些几何）。教师认的是「形状」，不是文字。
 * ⚠️ 图标按钮**必须**有 `aria-label`（本仓的设计规范明写；这里由 `TOOL_LABELS` 供）。
 */
const TOOL_ICONS: Record<InkTool, ReactNode> = {
  pen: <path d="M3.5 16.5 5 12l7-6.8 2.8 2.8-7 6.8z" />,
  line: <path d="M3.5 16.5 16.5 3.5" />,
  arrow: (
    <>
      <path d="M3.5 16.5 16.5 3.5" />
      <path d="M10.5 3.5h6v6" />
    </>
  ),
  rect: <rect x="3.5" y="5.5" width="13" height="9" rx="0.8" />,
  ellipse: <ellipse cx="10" cy="10" rx="6.5" ry="4.8" />,
  triangle: <path d="M10 4 17 15.5H3z" />,
  'right-triangle': <path d="M4.5 5v10.5h11" />,
  parallelogram: <path d="M7.5 5h9l-4 10.5h-9z" />,
  trapezoid: <path d="M7 5h6l4 10.5H3z" />,
  angle: (
    <>
      <path d="M4 15.5h12" />
      <path d="M4 15.5 14.5 5" />
    </>
  ),
  select: (
    <>
      <path d="M4 6.5V4h2.5M13.5 4H16v2.5M16 13.5V16h-2.5M6.5 16H4v-2.5" />
      <rect x="7.5" y="7.5" width="5" height="5" rx="0.6" />
    </>
  ),
};

/** 粗细三档的名字（顺序与 `INK_WIDTH_OPTIONS` 一致）。 */
const WIDTH_LABELS = ['细', '中', '粗'] as const;
/** 当前档的高亮（与设计规范里「选中项」同一个观感：底色 + 一圈描边）。 */
const ACTIVE_STYLE = { borderColor: '#527198', background: '#e9eff6', color: '#466384' } as const;

/** 一个工具按钮里那个 20×20 的小图标。 */
function ToolIcon({ tool }: { tool: InkTool }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {TOOL_ICONS[tool]}
    </svg>
  );
}

export function InkBody({ node, draft, onChange, disabled }: InkBodyProps) {
  /**
   * ★ 2026-09-30：当前档。**默认恒是「手写」**（`INK_DEFAULT_TOOL`）——
   * 老习惯的学生进题目直接画；默认成别的档他会以为画布坏了。
   * ⚠️ 它**不进 draft**（不是作答数据的一部分）：换档不该写库、也不该进撤销栈。
   */
  const [tool, setTool] = useState<InkTool>(INK_DEFAULT_TOOL);
  /**
   * ★ 2026-09-30：被选中的图形（下标）。**住在这一层**（不是画布）——
   * 删除按钮在这条工具栏上，而两处各存一份「谁被选中」必然分叉。
   */
  const [selected, setSelected] = useState<number | null>(null);
  /**
   * ★ 2026-09-30（教师：「笔的粗细」+「要能选」）：**新画的那一笔**用多粗。
   * ⚠️ 已经画下去的那些**不受影响**（粗细是每一笔各自的字段，这是数据的形状决定的）。
   * 默认档 = `INK_DEFAULT_WIDTH`，而它**就是**改动前的那个常量值 ⇒ 默认手感没变。
   */
  const [width, setWidth] = useState<InkWidth>(INK_DEFAULT_WIDTH);
  /**
   * ★ 2026-09-30（教师：「还缺少颜色工具」+「八色固定色板」）：**新元素**用什么颜色。
   * ⚠️ 与粗细同一条纪律：**只影响新画的**；已经画下去的那些各自带着自己的颜色
   *（`color` 是每个元素各自的字段）。
   */
  const [color, setColor] = useState<string>(INK_DEFAULT_COLOR);

  /**
   * 点一个色块。🔴 **选中了东西的时候它是「改那个元素的颜色」**（教师选的八色板那一条）——
   * 专业绘图工具都是这个行为，而少了它，学生想改一个画错的颜色只能删掉重画。
   */
  const applyColor = (next: string) => {
    setColor(next);
    if (tool !== 'select' || selected === null) return;
    const strokes = draft.strokes.map((stroke, index) => (index === selected ? { ...stroke, color: next } : stroke));
    onChange({ kind: 'ink', box, strokes });
  };

  /**
   * ★ 2026-09-30（复审）：**被锁住时把选中清掉**。
   * 🔴 提交/锁定之后画布 `disabled` ⇒ 点不动、删不掉、点空白也取消不了（`handlePointerDown`
   *    在入口就 return）⇒ 留着那个下标，屏幕上就永远挂着一个**取消不掉的虚线框**。
   *    那与本文件那条纪律直接冲突：「一行叫学生做他做不到的事的提示，就是一句假话」。
   */
  useEffect(() => { if (disabled) setSelected(null); }, [disabled]);

  /**
   * 换档。🔴 **离开「选择」档就把选中清掉**：留着的话，学生切回手写继续画，
   * 屏幕上还圈着刚才那个图形，而删除按钮还在 —— 他点一下会删掉一个自己没在看的图形。
   */
  const changeTool = (next: InkTool) => {
    setTool(next);
    if (next !== 'select') setSelected(null);
  };
  /**
   * 🔴 **不直接信任 `draft.box`**：`draftFromValue` 对「读不出宽高」的笔迹值会给出
   * `box: { w: 0, h: 0 }`（A1 的 `readCanvas` **刻意**不编一个默认框 —— 逐字段回落的
   * `{ w: 0, h: 240 }` 会把学生的每一个点压到 x = 0，画出来是一条贴在左边的竖线）。
   * 而 `InkCanvasProps.box.h` **同时是元素的高度** ⇒ 直接用 `h = 0` 会让画布变成 0 高：
   * 学生看到一片空白，而代码**不报错**。
   * ⇒ 不是正数时回落到 `defaultInkBox(node)`（「还没量过框」的那个名义框）。
   * ⚠️ 回落**只在量不出框时**发生：真量过框的时候换成默认框是另一回事 ——
   * 那会把学生的图按错误的宽高比画出来（A1 的 `readCanvas` 注释同一条）。
   */
  const usable = draft.box.w > 0 && draft.box.h > 0;
  const box = usable ? draft.box : defaultInkBox(node);

  /**
   * 交给 A1 的那份值。`format` 由题型给（裁定 6：`drawing` 恒 `drawing/v1`，其余 `ink/v1`），
   * 框与笔画取**当下**这一份。
   *
   * ⚠️ 它**只**给 `undoStroke` / `clearStrokes` 用，而那两个函数对 `format` **一个字节都不读**
   * （只改 `strokes`、把 `format` / `canvas` 原样带过去）。写 `inkFormatOf(node)` 而不是写死一个
   * 字面量，是因为这个对象**恰好**也是 `buildAnswerValue` 那一侧的形状 —— 将来若有人顺手把它
   * 当成「要提交的值」用，它至少是**对的**那一份，而不是一个只在演示里成立的猜测。
   */
  const transform = (apply: (value: InkValue) => InkValue) => {
    const next = apply({ format: inkFormatOf(node), canvas: box, strokes: draft.strokes });
    onChange({ kind: 'ink', box: next.canvas, strokes: next.strokes });
  };

  const empty = draft.strokes.length === 0;

  return (
    <>
      <InkCanvas
        box={box}
        strokes={draft.strokes}
        hint={inkHint(node)}
        disabled={disabled}
        tool={tool}
        width={width}
        color={color}
        selected={selected}
        onSelect={setSelected}
        onChange={(next) => onChange({ kind: 'ink', box: next.box, strokes: next.strokes })}
      />
      {/* ★ 2026-09-30（教师选「甲」）：**工具档**。默认「手写」，九个图形，最后是「选择」。
          只读态（教师端预览渲染同一个组件）时整排禁用，但**一个都不少**。 */}
      <div className={styles.inkToolbar} role="group" aria-label="画图工具">
        {INK_TOOLS.map((item) => (
          <button
            key={item}
            type="button"
            className={styles.inkButton}
            disabled={disabled}
            aria-pressed={tool === item}
            // 🔴 图标按钮**必须**有可读的名字（设计规范）—— `aria-label` 给读屏，
            //    `title` 给鼠标悬停。两处用的是同一个词，不会漂。
            aria-label={TOOL_LABELS[item]}
            title={item === 'select' ? '点一下图形选中它，再拖动或改大小' : `画${TOOL_LABELS[item]}`}
            onClick={() => changeTool(item)}
            style={tool === item ? ACTIVE_STYLE : undefined}
          >
            <ToolIcon tool={item} />
          </button>
        ))}
      </div>
      {/* ★ 2026-09-30（教师：「笔的粗细」+「要能选」）：**三档**。
          ⚠️ 只影响**新画的那一笔**；已经画下去的不动（粗细是每一笔各自的字段）。
          ⚠️ 用的是**圆点的大小**而不是数字 —— 教师选的时候要**看见**它有多粗。 */}
      <div className={styles.inkToolbar} role="group" aria-label="笔的粗细">
        {INK_WIDTH_OPTIONS.map((option, index) => (
          <button
            key={option}
            type="button"
            className={styles.inkButton}
            disabled={disabled}
            aria-pressed={width === option}
            aria-label={`${WIDTH_LABELS[index]}笔`}
            title={`${WIDTH_LABELS[index]}笔`}
            onClick={() => setWidth(option)}
            style={width === option ? ACTIVE_STYLE : undefined}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'block', width: 6 + index * 4, height: 6 + index * 4,
                borderRadius: '50%', background: 'currentColor', margin: '0 auto',
              }}
            />
          </button>
        ))}
      </div>
      {/* ★ 2026-09-30：**八色板**。⚠️ 颜色值是十六进制 —— 教师用卷导出那边只认它
          （`ink-render.ts` 的 `safeColor`），别的写法会在那张图上被回落成黑。 */}
      <div className={styles.inkToolbar} role="group" aria-label="颜色">
        {INK_PALETTE.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            className={styles.inkButton}
            disabled={disabled}
            aria-pressed={color === swatch.value}
            aria-label={`${swatch.label}色`}
            title={`${swatch.label}色`}
            onClick={() => applyColor(swatch.value)}
            style={color === swatch.value ? ACTIVE_STYLE : undefined}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'block', width: 16, height: 16, margin: '0 auto',
                borderRadius: 4, background: swatch.value, border: '1px solid rgba(15,23,42,0.18)',
              }}
            />
          </button>
        ))}
      </div>
      {/* ★ 2026-09-30：**删掉选中的那个图形**。只在「选择」档且真的选中了东西时出现 ——
          一个永远在、点了没反应的删除按钮，会让学生以为它坏了。 */}
      {tool === 'select' && selected !== null && (
        <div className={styles.inkToolbar}>
          <button
            type="button"
            className={styles.inkButton}
            disabled={disabled}
            onClick={() => {
              const next = draft.strokes.filter((_, index) => index !== selected);
              setSelected(null);
              onChange({ kind: 'ink', box, strokes: next });
            }}
          >
            删除选中的图形
          </button>
        </div>
      )}
      <div className={styles.inkToolbar}>
        <button
          type="button"
          className={styles.inkButton}
          disabled={disabled || empty}
          onClick={() => { setSelected(null); transform(undoStroke); }}
        >
          撤销
        </button>
        <button
          type="button"
          className={styles.inkButton}
          disabled={disabled || empty}
          onClick={() => { setSelected(null); transform(clearStrokes); }}
        >
          清空
        </button>
      </div>
    </>
  );
}
