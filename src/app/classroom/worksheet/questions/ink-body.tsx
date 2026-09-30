'use client';

import { useState } from 'react';

import type { AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { INK_DEFAULT_TOOL, INK_TOOLS, clearStrokes, defaultInkBox, inkFormatOf, inkHint, undoStroke } from '@/lib/worksheet-ink';
import type { InkTool, InkValue } from '@/lib/worksheet-ink';
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
            title={item === 'select' ? '点一下图形选中它，再拖动或改大小' : `画${TOOL_LABELS[item]}`}
            onClick={() => changeTool(item)}
            style={tool === item ? { borderColor: '#527198', background: '#e9eff6', color: '#466384', fontWeight: 700 } : undefined}
          >
            {TOOL_LABELS[item]}
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
