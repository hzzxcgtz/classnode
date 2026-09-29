import { Fragment, type CSSProperties, type ReactNode } from 'react';

import { blankAriaLabel, blankValueStyle, type PromptRun } from './worksheet-prompt-marks.ts';

/**
 * 「落点槽」—— 等着被拖入一个词的那个空。
 *
 * ── 🔴 为什么单独成文件 ────────────────────────────────────────────────────
 * 2026-09-28（教师）：「表格里的空也应该可以设置三种方式，跟普通填空域一样：
 * 手工填、右侧选、下方选。」⇒ 槽从「只在题干里」变成「题干里 + 表格里」，
 * 而**两处的槽必须是同一个东西** —— 各写一份的症状是「题干里的空与表格里的空
 * 长得不一样」，屏幕上不会报任何错（`blankAnswerStyle` 那条注释记着同一个教训：
 * 此前两条路各写一套，教师看到「同一个空、换个模式粗细就变了」）。
 * ⇒ 一份实现、两个调用方（`worksheet-prompt-text.tsx` 与 `worksheet-table-view.tsx`）。
 * ⚠️ 它**不能**住在 `worksheet-prompt-text.tsx` 里：那个文件要 import 表格视图
 *（表格域），而表格视图要 import 它 ⇒ 环。所以它自己一个文件，两边都 import 它。
 *
 * ⚠️ 颜色 / 字重那些全在这一个对象里，**调用方只给宽度与状态**：
 *   · 题干里的槽宽度取自那一段占位（`Nch`）；
 *   · 表格里的槽跟着格子走（`100%`）。
 *   差别只允许有这一处（宽度），别的都得一样。
 */
export interface BlankSlotProps {
  /** 那一段分段 —— `blankAnswerStyle` 从它取字重与颜色（与打字那条路共用一条规则）。 */
  run: PromptRun;
  /** 槽的宽度：题干里是 `Nch`，表格里是 `100%`。 */
  width: string;
  /** 槽里显示的值（空 ⇒ 一个不换行空格，撑住高度）。 */
  value: string;
  /** 读屏要能说清这是哪一格（题干里是「第 2 空」，表格里是「第 2 行第 3 格」）。 */
  label: string;
  /**
   * ★ 2026-09-29（教师）：答错的槽 ⇒ 槽里的**字**改成暗红 + 删除线。
   * ⚠️ 它**不再**在槽后面多画一枚红叉 —— 那个形状整体退休了（四个填空渲染点一起换）。
   * ⚠️ 它同时决定读屏名字（`blankAriaLabel`）：删除线对读屏是无声的。
   */
  wrong: boolean;
  disabled: boolean;
  /** 拖拽时指针正经过它 / 手里拿着词（点亮它告诉学生「可以放这儿」）。 */
  active: boolean;
  /** 手里拿着的那个词（有值且槽还空着 ⇒ 槽里的字变蓝，提示「会填在这儿」）。 */
  pending: string | null;
  /** 写进 `data-drop-id`（拖拽那一层按它找落点）。⚠️ 没有它就不是落点。 */
  dropId?: string;
  onPlace?: () => void;
  /** 紧跟在槽后面的内容（「右侧选词」那一串候选词由调用方给）。 */
  children?: ReactNode;
}

export function BlankSlot({
  run, width, value, label, wrong, disabled, active, pending, dropId, onPlace, children,
}: BlankSlotProps) {
  const filled = value !== '';
  return (
    <Fragment>
      <span
        data-drop-id={dropId}
        aria-label={blankAriaLabel(label, wrong)}
        onClick={disabled ? undefined : onPlace}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: width,
          minHeight: '34px',
          padding: '3px 8px 1px',
          margin: '-3px 3px -4px',
          borderBottom: active ? '2px solid #2563eb' : '1.5px solid #94a3b8',
          background: active ? '#eaf2ff' : filled ? '#f1f5f9' : '#f8fafc',
          boxShadow: active ? 'inset 0 0 0 1px rgba(37, 99, 235, .22)' : 'none',
          borderRadius: '4px 4px 2px 2px',
          // ★ 2026-09-27：字重不写死 600 —— 与打字那条路**共用同一条规则**
          //（`blankAnswerStyle`）。此前两处各写一套，教师看到「同一个空、换个模式粗细就变了」。
          // ★ 2026-09-29：走 `blankValueStyle` —— 答错那层由它叠（顺序在那里面有测试）。
          ...(blankValueStyle(run, wrong) as CSSProperties),
          // 🔴 **必须在上面那次展开之后**：`blankAnswerStyle` 里含 `promptRunStyle` 的 `color`，
          //    写在它前面会被整个盖掉（2026-09-27 教师看到「打字那条红了、待选区那条没红」就是这一条）。
          color: pending && !filled ? '#2563eb' : undefined,
          textAlign: 'center',
          verticalAlign: 'baseline',
          cursor: disabled ? 'default' : 'pointer',
          transition: 'background-color .16s ease-out, border-color .16s ease-out',
        }}
      >
        {filled ? value : ' '}
      </span>
      {children}
    </Fragment>
  );
}
