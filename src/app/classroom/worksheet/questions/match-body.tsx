'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSelection,
  setPair,
  tapItem,
  type DragSelection,
} from '@/lib/worksheet-drag';
import {
  readMatchLeft,
  readMatchRight,
  type AnswerDraft,
} from '@/lib/worksheet-answer-value';
import { Fragment } from 'react';

import { CorrectAnswerNote } from './correct-answer-note';
import type { WorksheetQuestionNode } from '@/lib/types';
import { usePointerDrag, type DragPoint } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 连线题的作答体（规格 §12 裁定 1：点选为主 + 真拖拽增强）。
 *
 * ── 点选那一条路（必然能用的那一层）──────────────────────────────────────
 * 点左项 ⇒ 选中（高亮）；再点右项 ⇒ 连上，**并清空选择**。
 *   · 点**同一列**的项 ⇒ 改选；点中已选那一项本身 ⇒ 取消选中；
 *   · 一次点击的规则全在 `tapItem` 里（`lib/worksheet-drag.ts`，有用例）：
 *     没选左项 + 点已连的右项 ⇒ **断开**（★ 2026-09-26 教师第 2 条「点一下就能删」，
 *     在此之前那条路径是死路 —— 删一条线要「先点左项 → 再点右项」两步）；
 *     选着左项 + 连的正是这一对 ⇒ 断开；否则 ⇒ 连上（右项被占则**顶掉**旧的）。
 *   🔴 这就是「连错了，撤掉」的入口。少了它，连错一条只能改连到别处，
 *     而改连会顶掉别的那条（`setPair` 的不变量）。
 *
 * ── 拖拽那一条路（叠上去的增强，**本机未验证**）─────────────────────────────
 * 从左项按住拖到右项。落位同样调 `setPair` —— 两条路共用同一份 `draft.links`。
 * ★ 拖动中还有一条**跟手的线**（见 `FollowAnchor`），那是教师第 1 条要的反馈。
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
  /**
   * ★ 2026-09-28：答错时要给的正确答案（下标 → 一整句「《绝句》 → 《望庐山瀑布》」）。
   * ⚠️ 与填空共用同一个 prop 名与形状 —— 服务端 `wrongAnswers` 两个题型发的是同一个
   * `Record<index, string>`（那条窄口只发**没连对**的那几条）。
   */
  correctBlanks?: Record<string, string>;
}

interface MatchLine {
  key: string;
  leftId: string;
  rightId: string;
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

export function MatchBody({ node, draft, onChange, disabled, correctBlanks }: MatchBodyProps) {
  const [selection, setSelection] = useState<DragSelection>(clearSelection());
  const left = readMatchLeft(node);
  const right = readMatchRight(node);
  // ⚠️ 这两个判据在下面那两段手势回调里都要用，而回调声明在 `usePointerDrag` 的参数里
  // —— 先定义再使用（不是风格问题：写在 hook 之后会在「第一次渲染就触发回调」时踩 TDZ）。
  const leftIds = left.map((entry) => entry.id);
  const rightIds = right.map((entry) => entry.id);
  const isLeftId = (id: string) => leftIds.includes(id);
  /**
   * 这一项在哪一列（★ 2026-09-28）。`tapItem` 靠它判「点的是相反那一列吗」——
   * 两个方向（左→右 / 右→左）用的就是这一条判据。
   * ⚠️ 认不出来的 id ⇒ `null`（`tapItem` 会当成空操作，不连线）。
   */
  const sideOf = (id: string) => (isLeftId(id) ? 'left' as const : rightIds.includes(id) ? 'right' as const : null);

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
      // ⚠️ 找不到元素就不画线（而不是画一条从 (0,0) 出发的假线）—— 条目被删过、
      // 或者还没挂上时会这样。
      // ★ 2026-09-28（教师：右往左也能连）：**两边都可能是起点** —— 从右项起手拖时
      // 锚点就是那个右项。原来这里只认 `l:` 前缀（那时的注释写着「只有左项才是连线的
      // 起点」—— 在一对一 + 只能左起手的年代是对的，现在是旧话）。
      const el = itemEls.current[`l:${point.id}`] ?? itemEls.current[`r:${point.id}`];
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
        leftId: link.leftId,
        rightId: link.rightId,
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

  /* ⊘ 2026-09-28 删掉：`activeLeftId`（此刻选中的左项）。
     它原来喂给 `tapTarget`（那一下的含义取决于「选中的是哪个左项」）。改成 `tapItem`
     之后判据收在纯逻辑里、由它自己从 `selection` 取 id ⇒ 这个变量**没有任何读者**
     （eslint 的 no-unused-vars 当场点出来）。 */
  /**
   * 点**这一条右项**会不会**断开**（而不是连上、也不是什么都不做）。
   * 🔴 判据必须与 `tapItem` **逐字同源** —— ✕ 出现在哪里，点下去就在哪里断开；
   * 两者一旦走岔，画出来的就是一个**撒谎的**图标（比不画更糟）。
   */

  const drag = usePointerDrag({
    disabled,
    onDragMove,
    onTap: (id) => {
      // ★ 2026-09-28（教师裁定甲）：「左框连到右框，也支持右框连到左框。」
      // ⇒ 一次点击的判据收成一条：**点相反那一列 = 连线、点同一列 = 改选/取消**。
      //    「从哪边起手」不再是特殊情况（那条规则两个方向都成立）——
      //    判据在 `tapItem`（纯逻辑、有用例），这里只把它算出来的两个值放回去。
      const next = tapItem(links, selection, id, sideOf);
      setSelection(next.selection);
      // ⚠️ 只在**真的变了**的时候回调 —— 空操作时返回原数组，
      // 而白回调一次会白写一条上传队列（与排序题的 `write` 同一条）。
      if (next.links !== links) onChange({ kind: 'match', links: next.links });
    },
    onDrop: (sourceId, targetId) => {
      // ★ 2026-09-26：`onDrop` 现在在「拖到空白处松手」（`targetId === null`）时**也会**被调用。
      // 连线题在这里什么都不做（松手前的那一次拖拽本来就没连上任何东西）——
      // 选择态也留着，学生可以直接接着点右项。
      if (targetId === null) return;
      setSelection(clearSelection());
      // ★ 2026-09-28：拖拽也可能是**从右项起手拖到左项** ⇒ 按**列**归一化，
      // 不能像原来那样把 `sourceId` 直接当成左项（那会把右项写进 leftId，判分全错）。
      const sourceIsLeft = isLeftId(sourceId);
      const targetIsLeft = isLeftId(targetId);
      if (sourceIsLeft === targetIsLeft) return;   // 同一列 ⇒ 不连
      const leftId = sourceIsLeft ? sourceId : targetId;
      const rightId = sourceIsLeft ? targetId : sourceId;
      onChange({ kind: 'match', links: setPair(links, leftId, rightId) });
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

  return (
    <div className={styles.matchWrap}>
      <p className={styles.dragHint}>点任一条目，再点对面那一列的对应项即可连线；也可以直接拖。连错的点一下就能删。</p>
      <div className={styles.matchGrid} ref={containerRef}>
        <div className={styles.matchColumn}>
          {left.map((entry) => {
            const picked = selection.kind === 'item' && selection.id === entry.id;
            const linked = links.some(item => item.leftId === entry.id);
            const className = [
              styles.matchItem,
              styles.dragSource,
              picked ? styles.matchItemSelected : '',
              linked ? styles.matchItemLinked : '',
              drag.draggingId === entry.id ? styles.dragActive : '',
            ].filter(Boolean).join(' ');
            return (
              // ★ 2026-09-28：**两边都用 `bothProps`** —— 左项与右项都能起手拖、也都是落点
              // （教师：「支持左框连到右框，也支持右框连到左框」）。同列互相拖由 `onDrop`
              // 里那道「源与落点必须分属两列」的闸判掉。
              <div className={className} key={entry.id} ref={setRef(`l:${entry.id}`)} {...drag.bothProps(entry.id)}>
                <span className={styles.matchText}>{entry.text || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.matchColumn}>
          {right.map((entry) => {
            const pickedRight = selection.kind === 'item' && selection.id === entry.id;
            const linked = links.some(item => item.rightId === entry.id);
            const className = [
              styles.matchItem,
              // 🔴 **右项也必须带 `.dragSource`**（★ 2026-09-28）—— 那是一条**静态** CSS
              // （`touch-action: none`），而它才是「能不能起拖」的真正开关：
              // `handlePointerDown` 里那句 `el.style.touchAction = 'none'` 来得太晚
              // （手势开始的那一刻浏览器已经决定了这一下是滚动还是拖动）。
              // 少了它，手指按在右项上被当成**滚动** ⇒ 右项永远拖不动
              //（左项一直能拖就是因为它有这个类）。
              styles.dragSource,
              pickedRight ? styles.matchItemSelected : '',
              linked ? styles.matchItemLinked : '',
              drag.draggingId === entry.id ? styles.dragActive : '',
              drag.hoverTargetId === entry.id ? styles.dropActive : '',
            ].filter(Boolean).join(' ');
            return (
              <div className={className} key={entry.id} ref={setRef(`r:${entry.id}`)} {...drag.bothProps(entry.id)}>
                <span className={styles.matchText}>{entry.text || <span className={styles.placeholder}>（这一条还没写）</span>}</span>
              </div>
            );
          })}
        </div>
        {/* 连线层：`pointer-events: none`，否则它会挡住下面的落点（`elementFromPoint`
            返回的是这条路线上最上面那个元素）。 */}
        <svg className={styles.matchLines} aria-label="已连接的配对">
          {lines.map((line) => {
            // 删除叉沿线段方向离开左端 22px，而不是只改 x 坐标。
            // 斜线若仍使用 y1，叉会浮在线上方，看起来像贴在选项框边缘。
            const dx = line.x2 - line.x1;
            const dy = line.y2 - line.y1;
            const length = Math.max(Math.hypot(dx, dy), 1);
            const deleteX = line.x1 + (dx / length) * 22;
            const deleteY = line.y1 + (dy / length) * 22;
            return (
              <g
                className={styles.matchLineGroup}
                key={line.key}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label="删除这条连线"
                onClick={() => {
                  if (disabled) return;
                  onChange({ kind: 'match', links: links.filter(item => item.leftId !== line.leftId || item.rightId !== line.rightId) });
                }}
                onKeyDown={(event) => {
                  if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  onChange({ kind: 'match', links: links.filter(item => item.leftId !== line.leftId || item.rightId !== line.rightId) });
                }}
              >
                <line className={styles.matchLineHit} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                <line className={styles.matchLine} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                <text className={styles.matchLineDelete} x={deleteX} y={deleteY}>×</text>
              </g>
            );
          })}
          {/* 跟手的那条线。🔴 **刻意不声明** `x1/y1/x2/y2`：那四个属性由 `onDragMove`
              每帧直接写（见 `FollowAnchor` 上面那一段）。React 只改它从 props 知道的
              属性，这里不声明，它就不会在下一次渲染时把写进去的坐标擦掉。 */}
          <line ref={ghostRef} className={styles.matchGhostLine} />
        </svg>
      </div>
      {/* ★ 2026-09-28（教师：「批改有错误的没有显示正确答案」）——
          服务端那道窄口只发**学生没连对**的那几条（`wrongMatchAnswers`），每条一句话
          「《绝句》 → 《望庐山瀑布》」。全对时它是空对象 ⇒ 这里什么都不画。 */}
      {(() => {
        const items = Object.keys(correctBlanks ?? {})
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => correctBlanks?.[key])
          .filter((line): line is string => typeof line === 'string' && line !== '');
        if (items.length === 0) return null;
        return (
          <CorrectAnswerNote>
            {items.map((line, position) => (
              <Fragment key={line}>
                {position > 0 && <br />}
                <strong>{line}</strong>
              </Fragment>
            ))}
          </CorrectAnswerNote>
        );
      })()}
    </div>
  );
}
