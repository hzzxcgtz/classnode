'use client';

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { TrashIcon } from './editor-icons';
import { scoreSummary } from './worksheet-editor-core';

/**
 * ★ 2026-09-25：**任务容器**（规格 §六 的两级信息架构）。
 *
 * 🔴 它存在的理由是第 2 步的迁移：库里的学习单已经全被包进任务，而编辑页当时只画
 * **顶层** `nodes` ⇒ 整个任务被画成**一张**卡（题型显示生串 `task`、题干框里是「任务一」），
 * **所有小题在编辑器里看不见**；而删掉那张卡 = 删掉顶层唯一节点 = **清空整份学习单**。
 *
 * ── 两级各有自己的操作，**不挤在同一排**（§六 的第 2 条）────────────────
 *   · 任务级：改名（就是那个输入框）· 上移 / 下移 / 删除 —— 只在这个头行上；
 *   · 小题级：题型 / 上移 / 下移 / 删除 —— 在每张小题目卡自己的头行上（`question-card.tsx`）。
 * 挤在一排的后果不是难看，是**教师点错**：两个「删除」相邻，删掉的可能是整个任务。
 *
 * ── 三层「面」（简报的取值，别自创）──────────────────────────────────
 *   页面底 `#f8fafc` · 任务容器 `#f8fafc` + `1px #e2e8f0` + 圆角 12 ·
 *   小题卡 `#fff` + `1px #e2e8f0` + 圆角 12。
 *   ⇒ 容器与页面底同色，靠**边框**立起来；而**最亮的 `#fff` 留给小题卡** ——
 *   题干是这一页唯一的主角，容器不该比它更抢眼。
 *
 * ⚠️ 本组件**不碰 reducer**：改名 / 上下移 / 删除 / 加小题全部由 `page.tsx` 传进来。
 */

export function TaskCard({
  index,
  total,
  node,
  onTitleChange,
  onDescriptionChange,
  onMove,
  onRemove,
  onAddQuestion,
  onDragStart,
  inheritedPoints,
  children,
}: {
  /** 这是第几个任务（0-based）。只用于「上移/下移」的边界与无障碍标签。 */
  index: number;
  total: number;
  node: WorksheetQuestionNode;
  onTitleChange: (prompt: string) => void;
  /** 任务的**描述**（`data.description`）—— 学生端会显示在标题下面。 */
  onDescriptionChange: (description: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onAddQuestion: () => void;
  /** ★ 2026-09-26（spec 第 5 步）：指针落在把手上 ⇒ 开始拖。 */
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  /** ★ 2026-09-26：任务头上那两个数（几道题 / 满分）要用它算逐题分值。 */
  inheritedPoints: { full: number; half: number };
  /** 这个任务里的小题目卡（由页面渲染 —— 它要传一堆各自的回调）。 */
  children: ReactNode;
}) {
  // ⚠️ `Array.isArray` 守卫：节点的 `children` 是外部输入（手改过的库行 / 旧草稿）。
  // 直接读 `.length` 会在一个坏形状上抛 TypeError ⇒ **整页白屏**（本仓没有 error.tsx）。
  // ⚠️ 变量名用 `kids` 而不是 `children` —— `children` 是本组件的 prop（下面那堆卡片）。
  const kids = Array.isArray(node.children) ? node.children : [];
  const hasChildren = kids.length > 0;

  return (
    <section
      className="worksheet-editor-task"
      aria-label={`任务 ${index + 1}`}
      /* ★ 2026-09-26（spec 第 5 步）：任务自己也在**顶层**那一层（与散题同级）⇒ `data-layer=""`。 */
      data-row-id={node.id}
      data-layer=""
    >
      <header className="worksheet-editor-task-head">
        {/*
          🔴 任务的 `prompt` **就是它的标题**（教师裁定 ①a 的口径 + 迁移写下的「任务一」）。
          学生端的题号前缀、看板列头、抽屉、导出全都读它，所以这里改一个字，
          那四处一起改 —— 这是「改名」这个动作的**唯一**入口。
          ⚠️ 允许**留空**：留空 ⇒ 学生端题号没有前缀（`flattenAnswerable` 的规则），
          所以 placeholder 说的是「可以留空」，不是「必填」。
        */}
        <input
          className="worksheet-editor-task-title"
          value={node.prompt}
          onChange={event => onTitleChange(event.target.value)}
          placeholder="任务标题（可以留空）"
          aria-label={`任务 ${index + 1} 的标题`}
        />
        {/*
          ★ 2026-09-26（spec 第 4 步）：任务容器要有**自己的身份** —— 折起来时教师只看得见
          一行标题，而「这一组几道题、多少分」是他扫全卷时最需要的两个数。
          ⚠️ 数的是**可作答的题**，满分只算会判分的那几道（与页面头同一个函数）。
        */}
        <span className="worksheet-editor-task-totals">
          {scoreSummary(node.children, inheritedPoints).questions} 道 · 满分 {scoreSummary(node.children, inheritedPoints).maxScore}
        </span>
        <div className="worksheet-editor-task-tools">
          {/* ★ 2026-09-26（spec 第 5 步）：任务级的拖拽把手（与小题级同一个手势）。 */}
          <button
            type="button"
            className="worksheet-editor-drag-handle"
            onPointerDown={onDragStart}
            title="拖这个任务调整顺序"
            aria-label={`拖动任务 ${index + 1} 调整顺序`}
          >
            ⠿
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title={index === 0 ? '已经是第一个任务' : '整个任务上移一位'}
            aria-label="整个任务上移一位"
          >
            ▲
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title={index === total - 1 ? '已经是最后一个任务' : '整个任务下移一位'}
            aria-label="整个任务下移一位"
          >
            ▼
          </button>
          <button
            type="button"
            className="worksheet-editor-icon-button is-danger"
            onClick={onRemove}
            title="删除整个任务"
            aria-label="删除整个任务"
          >
            <TrashIcon />
          </button>
        </div>
      </header>

      {/*
        ★ 2026-09-25（教师裁定）：任务的**描述** —— 例如「读下面的材料，回答 1–3 题」。
        ⚠️ 与上面那个标题框**是两件事，别合并**：标题是任务的**名字**（学生会看到它作为
        题号前缀：`任务一 · 1`），描述是那一段的说明。裁定 ①a 的原话是
        「任务 = 分组 + **一段说明**」，这个框就是那句话里的「说明」。
        ⚠️ 用 `textarea` 而不是 `input`：描述常常是完整的一两句，单行会把后半句藏起来。
      */}
      <label className="worksheet-editor-task-desc-field">
        <textarea
          className="worksheet-editor-task-desc"
          rows={2}
          value={typeof node.data.description === 'string' ? node.data.description : ''}
          onChange={event => onDescriptionChange(event.target.value)}
          placeholder="给这个任务写一句说明（可留空）—— 学生会看到这段话"
        />
      </label>

      <div className="worksheet-editor-task-body">
        {/*
          ⚠️ 空任务是**合法**的（教师 2026-09-25 裁定：点「+ 添加任务」之后还没放小题时
          保存不该撞 400）。所以这里给一句**看得见**的说明，而不是让容器空着 ——
          空容器在屏幕上与「渲染坏了」长得一样。
        */}
        {hasChildren ? (
          <div className="worksheet-editor-task-questions">{children}</div>
        ) : (
          <p className="worksheet-editor-task-empty">这个任务还没有小题</p>
        )}
        <button type="button" className="worksheet-editor-task-add" onClick={onAddQuestion}>
          ＋ 添加小题
        </button>
      </div>
    </section>
  );
}
