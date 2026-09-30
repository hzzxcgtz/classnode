'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSelection,
  dragShifts,
  moveInOrder,
  reorder,
  slotIndexAt,
  tapSource,
  type DragSelection,
} from '@/lib/worksheet-drag';
import { readOrderItems, type AnswerDraft } from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { DROP_TARGET_ATTR, usePointerDrag, type DragPoint } from '../use-pointer-drag';
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
 *
 * ── ★ 2026-09-26（教师第 3 条）：拖动动画 ─────────────────────────────────
 * 拖起来那一项**跟手**（每帧写它的 `transform`），其余项**让位**（各挪一格）。
 * 两条都**直接写 DOM**，一个 state 都不碰 —— 每帧一次 setState 会让整个面板每帧重渲。
 *
 * 🔴 **判据（落第几格）用一开始量下的那份静止坐标**，不问 DOM。其余项这时候正在让位，
 * 而 transform 会一并改变命中测试的位置 ⇒「谁在手指底下」与「谁该让位」互为因果、
 * 会来回抖。这条回路断在 `slotIndexAt` 收的是**静止**的 `centers` 上。
 *
 * ⚠️ 已知边界（都不影响正常拖动，记下来免得下一个人以为是 bug）：
 *   · 拖动**过程中**列表被滚动（页面别处滑了一下）或转屏 ⇒ 那份静止坐标就过期了，
 *     落点会偏。手势中途的滚动在老 iPad 上只能靠 `touch-action: none` 挡住；
 *   · 条目里有一项还没挂上 DOM ⇒ 这一次手势整个不动（宁可不动也不画一份错位的让位）。
 *
 * ── ★ 2026-09-30（教师）：**条目前面不再有序号** ───────────────────────────
 * 教师原话：「排序题的每一个选项前面不需要加数字编号，**会误导学生**。
 * 加普通的列表符号或者什么都不加都可以」。⇒ 取了「什么都不加」。
 *
 * 🔴 为什么是「什么都不加」而不是一个圆点：那个位置**本来就是序位槽** ——
 *    一个数字是「这是第几条」，一个圆点读者也会当成同一个意思（只是没写数字）。
 *    而这道题的全部意义就是「学生给的顺序」，任何暗示「1 就是第一步」的符号都是在给答案。
 *    ▲▼ 与拖动带来的位移已经足够说清「它现在排第几」。
 *
 * 🔴 **连带删掉了 `writeSlots` 那一整套**（`numEls` / 每帧写槽位 / 松手再写回 /
 *    每次渲染都跑的那个补偿 effect）：它存在的**唯一**理由是拖动中那个数字会写错
 *    （让位之后原来第 3 条跑到第 2 格，而它身上还写着「3」）。没有数字就没有这件事，
 *    **别再把它加回来** —— 除非同时把序号也加回来。
 * ⚠️ 老师那一侧**照旧有序号**：编辑页「选项顺序」与「正确顺序」两栏的数字是给教师看
 *    顺序用的（`bodies/order-body.tsx`），学生看不到那一屏。
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

  /** 每一项的 `<li>`（跟手与让位都要直接写它的 `transform`）。 */
  const itemEls = useRef<Record<string, HTMLElement | null>>({});
  /** 这一次手势开始时量下的静止坐标（中线 y）与拖起来那一项的位置。**一次手势只量一次**。 */
  const geomRef = useRef<{ from: number; centers: number[] } | null>(null);
  /** 上一次真正写进 DOM 的让位量（不变的那些项就不必再写一遍）。 */
  const appliedRef = useRef<number[]>([]);
  /** 松手那一刻要落到第几格 —— 由**让位**算出来的那一个，不是 `elementFromPoint` 那个。 */
  const toRef = useRef(-1);

  /**
   * 把跟手与让位写下的行内样式全部收掉。
   * 🔴 `transition` 也要收：跟手那一项在拖动中必须**没有**过渡（有的话它会慢半拍地追手指），
   * 而它的类名要到 React 重渲之后才挂上 —— 第一帧写 `transform` 时元素上还只有
   * `.orderItem`（带过渡）。所以那一帧必须**同步**写行内 `transition: none` 把它盖掉。
   */
  const clearDragStyles = useCallback(() => {
    const els = itemEls.current;
    Object.keys(els).forEach((id) => {
      const el = els[id];
      if (!el) return;
      // ⚠️ 只写**非空**的那些：收尾那个 effect 每渲染都会跑一遍，
      // 而给已经空着的 `style.transform` 再赋一次空串会让浏览器白标一次脏。
      if (el.style.transform !== '') el.style.transform = '';
      if (el.style.transition !== '') el.style.transition = '';
    });
    appliedRef.current = [];
    geomRef.current = null;
    toRef.current = -1;
  }, []);

  // ⚠️ 依赖是 `shown`：这一次手势里它不会变（拖动中不写 draft），但渲染之间会，
  // 所以它必须进依赖 —— 否则回调闭包里留着的是上一份顺序。
  const onDragMove = useCallback((point: DragPoint) => {
    const from = shown.indexOf(point.id);
    if (from < 0) return;
    if (!geomRef.current || geomRef.current.from !== from) {
      // ⚠️ 只在**第一次**回调那一刻量：那会儿 DOM 还是拖动前的布局
      //（`use-pointer-drag.ts` 的 `onDragMove` 注释写着为什么），量到的正是我们要的静止坐标。
      const centers = shown.map((id) => {
        const el = itemEls.current[id];
        if (!el) return Number.NaN;
        const rect = el.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      // 量不全 ⇒ 这一次手势整个不动（宁可不动，也不画一份错位的让位）。
      if (centers.some((center) => !Number.isFinite(center))) return;
      geomRef.current = { from, centers };
    }
    const geom = geomRef.current;
    // ① 跟手：被拖的那一项整条跟着手指走。
    const dragged = itemEls.current[point.id];
    if (dragged) {
      dragged.style.transform = `translateY(${Math.round(point.dy)}px)`;
      dragged.style.transition = 'none';
    }
    // ② 让位：落点是「被拖那一项的**中线**此刻压在第几格」。
    // ⚠️ 用 `centers[from] + dy`（虚拟中线）而不是 `point.y`：手指按在条目的哪一处
    // 是不确定的，拿指尖当判据会让「按在边缘拖」偏半格。这样写与按在哪儿无关。
    const to = slotIndexAt(geom.centers, geom.centers[from] + point.dy);
    const shifts = dragShifts(geom.centers, from, to);
    shown.forEach((id, index) => {
      if (id === point.id) return;
      const el = itemEls.current[id];
      if (!el) return;
      // 没变的那一项不必再写一遍（每帧给二十项各写一次 style 是白做功）。
      if (appliedRef.current[index] === shifts[index]) return;
      el.style.transform = shifts[index] === 0 ? '' : `translateY(${shifts[index]}px)`;
    });
    appliedRef.current = shifts;
    toRef.current = to;
  }, [shown]);

  const drag = usePointerDrag({
    disabled,
    onDragMove,
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
    onDrop: (sourceId) => {
      // 🔴 落点用**让位算出来的那个**（`toRef`），不用 `elementFromPoint` 那个 `targetId`：
      // 屏幕上让位让到哪一格，松手就该落在哪一格。两个值一旦不同，学生看到的是
      // 「明明让到这儿了，却落到别处」。
      const from = shown.indexOf(sourceId);
      const to = toRef.current;
      const next = reorder(shown, from, to);
      setSelection(clearSelection());
      // 收掉跟手与让位写下的行内样式（不清的话，重排之后被让位过的那几项
      // 还带着上一次的偏移 —— 它们的 key 没变，React 不会重建它们）。
      clearDragStyles();
      write(next);
    },
  });

  // 手势被系统中断（来电、多任务手势、滚动接管）时 `onDrop` **不会被调用** ——
  // 少了这一个 effect，那几项会**永远停在让位后的位置上**。
  // ⚠️ 依赖是 `drag.draggingId`：它每**次手势**才变一次，不是每帧。
  useEffect(() => {
    if (drag.draggingId) return;
    clearDragStyles();
  }, [drag.draggingId, clearDragStyles]);

  if (entries.length === 0) {
    return <p className={styles.cardNote}>（这道题还没有条目）</p>;
  }

  return (
    <ol className={styles.orderList}>
      {shown.map((id, index) => {
        const picked = selection.kind === 'item' && selection.id === id;
        const dragging = drag.draggingId === id;
        // ★ 2026-09-26：**不再画「落点高亮」**（原 `orderItemOver`）。
        // 让位之后，被拖那一项的**原槽位是空的** —— 那个空位本身就是「会落到这里」
        // 的指示，而 `hoverTargetId`（手指底下是谁，`elementFromPoint` 算的）与
        // `toRef`（让位算出来的落点）是**两份各自独立的判据**，它们会对不上。
        // 与其画一个可能与落点不符的高亮，不如只留让位这一份真相。
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
        ].filter(Boolean).join(' ');
        return (
          <li className={styles.orderRow} key={id}>
            <div
            className={className}
            ref={(el) => { itemEls.current[id] = el; }}
            // ⚠️ 排序题的条目**既是拖拽源又是落点**（把它拖到另一条上 = 移到那个位置），
            // 所以这里两个工厂都用：`sourceProps` 给手势，`dropTarget` 那个属性
            // 单独补上（`targetProps` 只挂点击、不能当源，用它就拖不动了）。
            {...drag.sourceProps(id)}
            {...{ [DROP_TARGET_ATTR]: id }}
          >
            {/* ⚠️ 这里**不再有序号**（★ 2026-09-30，理由见文件头那一段）——
                条目左边那个槽位已经整个删掉，别再补一个数字或圆点回来。 */}
            <span className={styles.orderText}>{byId[id] || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
            </div>
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
