'use client';

import { useState } from 'react';
import {
  clearSelection,
  setPlacement,
  tapSource,
  unplace,
  type DragSelection,
} from '@/lib/worksheet-drag';
import {
  readCategorizeItems,
  readCategorizeZones,
  type AnswerDraft,
} from '@/lib/worksheet-answer-value';
import type { WorksheetQuestionNode } from '@/lib/types';
import { usePointerDrag } from '../use-pointer-drag';
import styles from '../worksheet.module.css';

/**
 * 归类题的作答体（规格 §12 裁定 1：点选为主 + 真拖拽增强）。
 *
 * ── 屏幕上有三块 ─────────────────────────────────────────────────────────
 *   · **条目池**（还没放进任何框的条目）；
 *   · **框**（`data.zones`，每个框里画着已经放进来的条目）；
 *   · 已放进框的条目仍在它所在的框里（不是「看不见了」—— 学生要能再挪走它）。
 *
 * ── 点选那一条路（必然能用的那一层）──────────────────────────────────────
 *   点条目（池里或框里都行）⇒ 选中；点某个框 ⇒ `setPlacement` 把它放进去；
 *   点**条目池** ⇒ `unplace` 把它取回来（池子就是「不要它落在任何框里」这个落点）。
 * 点同一个条目 ⇒ 取消选中（`tapSource` 的往返）。
 *
 * ── 拖拽那一条路（叠上去的增强，**本机未验证**）───────────────────────────
 * 从条目按住拖到框上（或者拖回池子）。落位与点选共用同一份 `draft.assignment`。
 *
 * ⚠️ 条目池同时也是**落点**（`POOL_TARGET`），这是一个真实的目标 id 而不是空值：
 * 它必须是一个**字符串常量**，因为落点是从 DOM 的 `data-drop-id` 读回来的
 *（见 `use-pointer-drag.ts` 的 `findDropTarget`）—— 而空串会被 `closest` 与
 * 「没找到」两种情况混在一起。
 */
export interface CategorizeBodyProps {
  node: WorksheetQuestionNode;
  draft: Extract<AnswerDraft, { kind: 'categorize' }>;
  onChange: (next: AnswerDraft) => void;
  disabled: boolean;
}

/** 条目池的落点 id。⚠️ 不能与任何框的 id 相同 —— 框 id 来自库里，所以带两个下划线。 */
const POOL_TARGET = '__pool__';

export function CategorizeBody({ node, draft, onChange, disabled }: CategorizeBodyProps) {
  const [selection, setSelection] = useState<DragSelection>(clearSelection());
  const items = readCategorizeItems(node);
  const zones = readCategorizeZones(node);
  const assignment = draft.assignment;

  const textOf: Record<string, string> = {};
  items.forEach((entry) => { textOf[entry.id] = entry.text; });

  const place = (itemId: string, zoneId: string) => {
    setSelection(clearSelection());
    onChange({ kind: 'categorize', assignment: setPlacement(assignment, itemId, zoneId) });
  };
  const take = (itemId: string) => {
    setSelection(clearSelection());
    onChange({ kind: 'categorize', assignment: unplace(assignment, itemId) });
  };

  const drag = usePointerDrag({
    disabled,
    onTap: (id) => {
      // 点的是**池子**（或某个框）：把选中的那个条目放过去 / 取回来。
      if (id === POOL_TARGET || zones.some((zone) => zone.id === id)) {
        if (selection.kind !== 'item') return;
        if (id === POOL_TARGET) take(selection.id);
        else place(selection.id, id);
        return;
      }
      // 点的是**条目** ⇒ 选中 / 取消 / 改选（`tapSource` 的往返）。
      setSelection(tapSource(selection, id));
    },
    onDrop: (sourceId, targetId) => {
      // ★ 2026-09-26：`onDrop` 现在在「拖到空白处松手」（`targetId === null`）时**也会**被调用。
      // 这里什么都不做 —— ⚠️ 别把 `null` 当成条目池：池子是一个**明确的目标**、
      // 有自己的 id（`POOL_TARGET`），把 null 当池子会让「拖歪了」变成「把条目扔回池子」。
      if (targetId === null) return;
      if (targetId === POOL_TARGET) take(sourceId);
      else place(sourceId, targetId);
    },
  });

  if (items.length === 0 || zones.length === 0) {
    return <p className={styles.cardNote}>（这道题还没有条目或还没有框）</p>;
  }

  /** 一个条目长什么样。池子里与框里画的是同一个东西 —— 否则「拖走它」的目标就对不上。 */
  const chip = (itemId: string) => {
    const picked = selection.kind === 'item' && selection.id === itemId;
    const className = [
      styles.poolItem,
      styles.dragSource,
      picked ? styles.poolItemSelected : '',
      drag.draggingId === itemId ? styles.dragActive : '',
    ].filter(Boolean).join(' ');
    return (
      <div className={className} key={itemId} {...drag.sourceProps(itemId)}>
        {textOf[itemId] || <span className={styles.placeholder}>（这一条还没写）</span>}
      </div>
    );
  };

  const pool = items.filter((entry) => !assignment[entry.id]);

  return (
    <div className={styles.categorizeWrap}>
      <p className={styles.dragHint}>点一下条目，再点它该去的框（也可以直接把条目拖进框里；点条目池能把它取回来）。</p>
      <div
        className={`${styles.pool}${drag.hoverTargetId === POOL_TARGET ? ` ${styles.dropActive}` : ''}`}
        {...drag.targetProps(POOL_TARGET)}
      >
        <div className={styles.poolHead}>待归类</div>
        {pool.length === 0 ? <p className={styles.cardNote}>（都放好了）</p> : pool.map((entry) => chip(entry.id))}
      </div>
      <div className={styles.zoneGrid}>
        {zones.map((zone) => {
          const inside = items.filter((entry) => assignment[entry.id] === zone.id);
          const className = `${styles.zone}${drag.hoverTargetId === zone.id ? ` ${styles.dropActive}` : ''}`;
          return (
            <div className={className} key={zone.id} {...drag.targetProps(zone.id)}>
              <div className={styles.zoneHead}>{zone.text || <span className={styles.placeholder}>（这个框还没写名字）</span>}</div>
              {inside.length === 0 ? <p className={styles.cardNote}>（空的）</p> : inside.map((entry) => chip(entry.id))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
