'use client';

import { useState } from 'react';
import {
  clearSelection,
  moveInOrder,
  reorder,
  tapSource,
  type DragSelection,
} from '@/lib/worksheet-drag';
import { readOrderItems, type AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { DROP_TARGET_ATTR, usePointerDrag } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 排序题的作答体（规格 §12 裁定 1：点选为主 + 真拖拽增强）。
 *
 * ── 三条路都能改顺序，且**顺序是同一份数据** ─────────────────────────────
 *   ① ▲▼ 按钮 —— 点选那一层里**最稳**的一条（键盘、读屏、手指再笨也点得中）；
 *   ② 点条目 → 点另一个条目 —— 「把它移到那一条的位置」（与连线/归类共用的那套选中态）；
 *   ③ 拖拽 —— 手指按住一条拖到目标位置（本机**未验证**，见 `use-pointer-drag.ts` 文件头）。
 * 三者最终都调 `onChange({ kind: 'order', order })`，所以不存在「按钮改了、拖拽没改」这种
 * 两条路各维护一份状态的可能（顺序**只有** `draft.order` 一处）。
 *
 * ⚠️ 界面上显示的 id 列**以题目当下的条目表为准**：`draft.order` 里已经不存在的 id 丢掉、
 * 题目里有而 draft 里没有的补在后面。正常情况下两者恒等（读回那一侧已经对齐过），
 * 但少了这道防线，一次「教师改题 + 学生屏幕没刷新」就会画出一列**永远交不出的**顺序。
 */
export interface OrderBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'order' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

export function OrderBody({ node, draft, onChange, disabled }: OrderBodyProps) {
  const [selection, setSelection] = useState<DragSelection>(clearSelection());
  const entries = readOrderItems(node);
  const byId: Record<string, string> = {};
  entries.forEach((entry) => { byId[entry.id] = entry.text; });

  const known = draft.order.filter((id) => byId[id] !== undefined);
  const shown = known.concat(entries.map((entry) => entry.id).filter((id) => !known.includes(id)));

  const write = (order: string[]) => {
    // ⚠️ 只有真的变了才回调：`reorder` / `moveInOrder` 在空操作时返回**原数组**，
    // 拿它去 setState 会被 React 跳过（那是我们要的），但回调一次会白写一条队列。
    if (order === shown) return;
    onChange({ kind: 'order', order });
  };

  const drag = usePointerDrag({
    disabled,
    onTap: (id) => {
      // 已经选了一条、又点了**另一条** ⇒ 把选中的那条移到这一条的位置（落位），
      // 然后清空选择 —— 与连线 / 归类是同一套手感。
      if (selection.kind === 'item' && selection.id !== id) {
        const from = shown.indexOf(selection.id);
        const to = shown.indexOf(id);
        setSelection(clearSelection());
        write(reorder(shown, from, to));
        return;
      }
      // 点同一条 ⇒ 取消（`tapSource` 的往返：点 A → 点 A 取消 → 点 B 改选）。
      setSelection(tapSource(selection, id));
    },
    onDrop: (sourceId, targetId) => {
      setSelection(clearSelection());
      write(reorder(shown, shown.indexOf(sourceId), shown.indexOf(targetId)));
    },
  });

  if (entries.length === 0) {
    return <p className={styles.cardNote}>（这道题还没有条目）</p>;
  }

  return (
    <ol className={styles.orderList}>
      {shown.map((id, index) => {
        const picked = selection.kind === 'item' && selection.id === id;
        const dragging = drag.draggingId === id;
        const over = drag.hoverTargetId === id;
        const className = [
          styles.orderItem,
          // 🔴 `dragSource` 给的是**静态**的 `touch-action: none` —— 拖拽能不能起作用
          // 全看它（`use-pointer-drag.ts` 文件头第 ② 条：浏览器在手势开始的那一刻就定了
          // 这条手势归谁，`pointerdown` 里再设已经晚了）。少了它，iPad 上一按就变成滚动，
          // 学生看到的只是「拖不动」。⚠️ 2026-09-24 审查抓出：这里**曾经漏了这一行**，
          // 而报告把「touch-action: none」列为已交付 —— 三个拖拽源里只有两个真的拿到了。
          styles.dragSource,
          picked ? styles.orderItemSelected : '',
          dragging ? styles.orderItemDragging : '',
          over ? styles.orderItemOver : '',
        ].filter(Boolean).join(' ');
        return (
          <li
            className={className}
            key={id}
            // ⚠️ 排序题的条目**既是拖拽源又是落点**（把它拖到另一条上 = 移到那个位置），
            // 所以这里两个工厂都用：`sourceProps` 给手势，`dropTarget` 那个属性
            // 单独补上（`targetProps` 只挂点击、不能当源，用它就拖不动了）。
            {...drag.sourceProps(id)}
            {...{ [DROP_TARGET_ATTR]: id }}
          >
            <span className={styles.orderIndex}>{index + 1}</span>
            <span className={styles.orderText}>{byId[id] || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
            <span
              className={styles.orderButtons}
              // ⚠️ 这一层把事件**拦在这里**：条目本身挂了拖拽/点选手势，而按 ▲▼ 是
              // 另一件事 —— 不拦的话按一下 ▲ 会顺带把这一条**选中**（手感和预期不符），
              // 手指在按钮上稍微一滑还会把整条拖起来。
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.orderButton}
                disabled={disabled || index === 0}
                aria-label="上移"
                onClick={() => write(moveInOrder(shown, id, -1))}
              >
                ▲
              </button>
              <button
                type="button"
                className={styles.orderButton}
                disabled={disabled || index === shown.length - 1}
                aria-label="下移"
                onClick={() => write(moveInOrder(shown, id, 1))}
              >
                ▼
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
