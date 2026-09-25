'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPair,
  clearSelection,
  setPair,
  tapSource,
  type DragSelection,
} from '@/lib/worksheet-drag';
import {
  readMatchLeft,
  readMatchRight,
  type AnswerDraft,
} from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { usePointerDrag, type DragPoint } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 连线题的作答体（规格 §12 裁定 1：点选为主 + 真拖拽增强）。
 *
 * ── 点选那一条路（必然能用的那一层）──────────────────────────────────────
 * 点左项 ⇒ 选中（高亮）；再点右项 ⇒ 连上（`setPair`），**并清空选择**。
 *   · 点同一个左项 ⇒ 取消选中（`tapSource` 的往返）；
 *   · 点已经连过的**那一对** ⇒ 拆掉（`clearPair`）—— 这是学生唯一的「连错了，撤掉」入口，
 *     少了它，连错一条只能改连到别处（而改连会**顶掉**别的那条 —— `setPair` 的不变量）。
 *
 * ── 拖拽那一条路（叠上去的增强，**本机未验证**）─────────────────────────────
 * 从左项按住拖到右项。落位同样调 `setPair` —— 两条路共用同一份 `draft.links`。
 *
 * ── 为什么还要画线 ─────────────────────────────────────────────────────
 * 每一条连线在两个端点各画一个同号的圆形徽标（① / ②…），**并在两列之间画一条 SVG 线**。
 * 徽标是**永远正确**的那一份（不需要测量、不会因为布局变化失准）；线是让它「一眼看明白」
 * 的那一份。测量失准时线会画歪 / 不画，而徽标仍然把信息完整地交代清楚 ——
 * 这是刻意的冗余：一个纯测量出来的东西在本机**没有任何自动化能验证**。
 *
 * ⚠️ 线的坐标是在 `useEffect` 里量的（不是 `useLayoutEffect`）：静态导出会把客户端组件
 * 预渲染成 HTML，而 `useLayoutEffect` 在服务端渲染时会告警。晚一帧出现，肉眼看不出来。
 */
export interface MatchBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'match' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

interface MatchLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * ★ 2026-09-26（教师第 1 条）：「从左侧一个选项中开始向右拖动，**并出现一条连线跟随**」。
 *
 * ── 这条线为什么不是 React state ────────────────────────────────────────────
 * 它**每帧都在动**。放进 state ⇒ 每帧一次 setState ⇒ 整个作答面板每帧重渲一次
 *（老 iPad 上直接掉帧）。所以它的四个坐标全部**直接写 DOM 属性**，一个 state 都不碰。
 * 代价：React **不认识**这四个属性 —— 所以 JSX 里刻意**不声明** `x1/y1/x2/y2`，
 * 由下面那个 `onDragMove` 独占它们（React 只改它从 props 知道的东西，
 * 不声明就不会被下一次渲染擦掉）。
 * ⚠️ 「可见 / 不可见」同理走**内联 `style.visibility`**（类里那份 `hidden` 是初值，
 * 内联优先）—— 不能写成 SVG 的 `visibility` 属性：**表现属性打不过类选择器**。
 *
 * ── 只量一次 ───────────────────────────────────────────────────────────────
 * 起点（左项的右缘中点）与容器原点在**第一次回调**那一刻量一次就够 ——
 * 左项在拖动过程中不动。⚠️ 那一刻 DOM **还是拖动前的布局**（`use-pointer-drag.ts`
 * 的 `onDragMove` 注释写着为什么），所以量到的正是我们要的那份坐标。
 * 锚点带 `id`：换了拖拽源就重新量，于是**不需要**在手势结束时清它（少一处会漏的收尾）。
 */
interface FollowAnchor {
  id: string;
  x1: number;
  y1: number;
  originX: number;
  originY: number;
}

export function MatchBody({ node, draft, onChange, disabled }: MatchBodyProps) {
  const [selection, setSelection] = useState<DragSelection>(clearSelection());
  const left = readMatchLeft(node);
  const right = readMatchRight(node);
  // ⚠️ 这两个判据在下面那两段手势回调里都要用，而回调声明在 `usePointerDrag` 的参数里
  // —— 先定义再使用（不是风格问题：写在 hook 之后会在「第一次渲染就触发回调」时踩 TDZ）。
  const leftIds = left.map((entry) => entry.id);
  const isLeftId = (id: string) => leftIds.includes(id);

  const containerRef = useRef<HTMLDivElement | null>(null);
  /** 每个端点的 DOM 节点（键带 `l:` / `r:` 前缀，两栏的 id 各自独立编号，可能重名）。 */
  const itemEls = useRef<Record<string, HTMLElement | null>>({});
  const [lines, setLines] = useState<MatchLine[]>([]);
  /** 跟手的那条线（见 `FollowAnchor` 上面那一段）。 */
  const ghostRef = useRef<SVGLineElement | null>(null);
  const anchorRef = useRef<FollowAnchor | null>(null);

  // ⚠️ 依赖是空的：这个回调**只碰 ref**（`itemEls` / `containerRef` / `ghostRef` /
  // `anchorRef`），一个 state 都不读 —— 所以它不需要跟着任何一次渲染换身份，
  // 也不会读到旧的 state（这正是「跟手的线」不能走 state 的那条约束的副产品）。
  const onDragMove = useCallback((point: DragPoint) => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    let anchor = anchorRef.current;
    if (!anchor || anchor.id !== point.id) {
      // ⚠️ `l:` 前缀：只有**左项**才是连线的起点。右项是落点、不是拖拽源，
      // 在它上面按下去拖时这里找不到元素 ⇒ 不画线（而不是画一条从 (0,0) 出发的假线）。
      const el = itemEls.current[`l:${point.id}`];
      const box = containerRef.current;
      if (!el || !box) {
        anchorRef.current = null;
        ghost.style.visibility = 'hidden';
        return;
      }
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      anchor = {
        id: point.id,
        x1: Math.round(a.right - b.left),
        y1: Math.round(a.top + a.height / 2 - b.top),
        originX: b.left,
        originY: b.top,
      };
      anchorRef.current = anchor;
    }
    ghost.setAttribute('x1', String(anchor.x1));
    ghost.setAttribute('y1', String(anchor.y1));
    ghost.setAttribute('x2', String(Math.round(point.x - anchor.originX)));
    ghost.setAttribute('y2', String(Math.round(point.y - anchor.originY)));
    ghost.style.visibility = 'visible';
  }, []);


  const links = draft.links;
  const measure = useCallback(() => {
    const box = containerRef.current;
    if (!box) return;
    const base = box.getBoundingClientRect();
    const next: MatchLine[] = [];
    links.forEach((link) => {
      const leftEl = itemEls.current[`l:${link.leftId}`];
      const rightEl = itemEls.current[`r:${link.rightId}`];
      // 端点节点不在 ⇒ 这一条画不出来（条目被删过 / 还没挂上）。**跳过**而不是给一个
      // 默认坐标：画一条指向 (0,0) 的线比不画更糟 —— 那是在撒谎。
      if (!leftEl || !rightEl) return;
      const a = leftEl.getBoundingClientRect();
      const b = rightEl.getBoundingClientRect();
      next.push({
        key: `${link.leftId}:${link.rightId}`,
        x1: Math.round(a.right - base.left),
        y1: Math.round(a.top + a.height / 2 - base.top),
        x2: Math.round(b.left - base.left),
        y2: Math.round(b.top + b.height / 2 - base.top),
      });
    });
    setLines(next);
  }, [links]);

  useEffect(() => { measure(); }, [measure]);
  // 转屏 / 键盘 / 分屏之后坐标系全变了。`orientationchange` 在老 WebKit 上不一定伴随
  // 一次 `resize`（那个 120ms settle 的补偿就是为它加的），所以两个都听。
  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [measure]);

  const setRef = (key: string) => (el: HTMLElement | null) => {
    itemEls.current[key] = el;
  };

  const drag = usePointerDrag({
    disabled,
    onDragMove,
    onTap: (id) => {
      const leftId = selection.kind === 'item' ? selection.id : null;
      if (!leftId) {
        // 还没选左项时点右项：什么都不做（左项才是「源」，右项是落点）。
        if (!isLeftId(id)) return;
        setSelection(tapSource(selection, id));
        return;
      }
      if (isLeftId(id)) {
        // 点另一个左项 ⇒ 改选；点同一个 ⇒ 取消（`tapSource` 的往返）。
        setSelection(tapSource(selection, id));
        return;
      }
      // 点右项 ⇒ 落位。⚠️ 连的正是已经连过的那一对 ⇒ 拆掉（学生唯一的撤销入口）。
      const already = links.some((link) => link.leftId === leftId && link.rightId === id);
      setSelection(clearSelection());
      onChange(already ? { kind: 'match', links: clearPair(links, leftId) } : { kind: 'match', links: setPair(links, leftId, id) });
    },
    onDrop: (sourceId, targetId) => {
      setSelection(clearSelection());
      onChange({ kind: 'match', links: setPair(links, sourceId, targetId) });
    },
  });

  // 手势结束（松手 / 被系统中断）⇒ 把跟手的线收掉。
  // ⚠️ 不能只靠 `onDrop`：`pointercancel` 那条路**不落位**，只走这一个 effect；
  // 少了它，一次被来电/多任务手势打断的拖拽会把线**永远留在屏幕上**。
  // ⚠️ 依赖是 `drag.draggingId`：它每**次手势**才变一次（不是每帧），
  // 所以这一个 effect 不会跟着指针走。
  useEffect(() => {
    if (drag.draggingId) return;
    const ghost = ghostRef.current;
    if (ghost) ghost.style.visibility = 'hidden';
  }, [drag.draggingId]);

  if (left.length === 0 || right.length === 0) {
    return <p className={styles.cardNote}>（这道题还没有条目）</p>;
  }

  /** 徽标号：按 `draft.links` 的顺序（同一条线在两端是同一个号）。`0` = 这个端点没连。 */
  const badgeOf = (leftId: string, rightId: string): number =>
    links.findIndex((link) => link.leftId === leftId && link.rightId === rightId) + 1;
  const leftBadge = (leftId: string): number => {
    const link = links.filter((item) => item.leftId === leftId)[0];
    return link ? badgeOf(link.leftId, link.rightId) : 0;
  };
  const rightBadge = (rightId: string): number => {
    const link = links.filter((item) => item.rightId === rightId)[0];
    return link ? badgeOf(link.leftId, link.rightId) : 0;
  };
  /** 左项连到了哪个右项（一句话交代，不依赖任何测量）。 */
  const linkedText = (leftId: string): string | null => {
    const link = links.filter((item) => item.leftId === leftId)[0];
    if (!link) return null;
    const target = right.filter((entry) => entry.id === link.rightId)[0];
    return target ? (target.text || '（这一条还没写）') : null;
  };

  return (
    <div className={styles.matchWrap}>
      <p className={styles.dragHint}>点一下左边的条目，再点右边它对应的那一条（也可以直接把左边拖过去）。</p>
      <div className={styles.matchGrid} ref={containerRef}>
        <div className={styles.matchColumn}>
          {left.map((entry) => {
            const picked = selection.kind === 'item' && selection.id === entry.id;
            const badge = leftBadge(entry.id);
            const className = [
              styles.matchItem,
              styles.dragSource,
              picked ? styles.matchItemSelected : '',
              badge > 0 ? styles.matchItemLinked : '',
              drag.draggingId === entry.id ? styles.dragActive : '',
            ].filter(Boolean).join(' ');
            return (
              <div className={className} key={entry.id} ref={setRef(`l:${entry.id}`)} {...drag.sourceProps(entry.id)}>
                <span className={styles.matchSide}>左</span>
                <span className={styles.matchText}>{entry.text || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
                {badge > 0 ? <span className={styles.matchBadge}>{badge}</span> : null}
                {linkedText(entry.id) ? <span className={styles.matchChip}>→ {linkedText(entry.id)}</span> : null}
              </div>
            );
          })}
        </div>
        <div className={styles.matchColumn}>
          {right.map((entry) => {
            const badge = rightBadge(entry.id);
            const className = [
              styles.matchItem,
              badge > 0 ? styles.matchItemLinked : '',
              drag.hoverTargetId === entry.id ? styles.dropActive : '',
            ].filter(Boolean).join(' ');
            return (
              <div className={className} key={entry.id} ref={setRef(`r:${entry.id}`)} {...drag.targetProps(entry.id)}>
                <span className={styles.matchSide}>右</span>
                <span className={styles.matchText}>{entry.text || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
                {badge > 0 ? <span className={styles.matchBadge}>{badge}</span> : null}
              </div>
            );
          })}
        </div>
        {/* 连线层：`pointer-events: none`，否则它会挡住下面的落点（`elementFromPoint`
            返回的是这条路线上最上面那个元素）。 */}
        <svg className={styles.matchLines} aria-hidden="true">
          {lines.map((line) => (
            <line className={styles.matchLine} key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          ))}
          {/* 跟手的那条线。🔴 **刻意不声明** `x1/y1/x2/y2`：那四个属性由 `onDragMove`
              每帧直接写（见 `FollowAnchor` 上面那一段）。React 只改它从 props 知道的
              属性，这里不声明，它就不会在下一次渲染时把写进去的坐标擦掉。 */}
          <line ref={ghostRef} className={styles.matchGhostLine} />
        </svg>
      </div>
    </div>
  );
}
