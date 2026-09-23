'use client';

import { rewardMark, rewardTotalText, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

/**
 * 奖励徽章 —— `isCorrect` 的**呈现**，不是数据（规格 §9.1）。
 *
 * 🔴 **绝不把星星 / 花朵 / 分数存进数据库**：一旦落库，教师端「哪道题错得多」、导出、
 * P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。本文件一个字节都不写库，
 * 它拿到的是一份**算出来的**配置（`RewardScale`）与一份**服务端刚判出来的**得分。
 *
 * ── 显示值由「得分」算，不由 `isCorrect` 布尔算 ─────────────────────────────
 *
 * 取值函数是 `lib/worksheet-reward.ts` 的 `rewardAmount(score, scale)`：
 *   `score = 1` ⇒ 全对档步长；`score = 0.5` ⇒ 半对档；`score = 0` ⇒ 0；`null` ⇒ 不画。
 * **今天得分只可能是 0 或 1**（第一批没建 `score` 字段，规格 §3-S），所以行为与
 * 「`isCorrect ? step : 0`」逐字相同 —— 但接口按得分写。理由（2026-09-23 用户裁定）
 * 在 `rewardAmount` 的注释里：M4 引入部分得分后教师可配两档步长（原话「全对给两朵小花，
 * 半对半错给一朵」），那时只改判分与多一行配置，不必回头改这里。
 * 若现在写成布尔，将来还要改一次，且学生会看到累计值跳变。
 *
 * 关掉自动判分 ⇒ 没有得分 ⇒ 没有奖励 —— 不需要第二个开关。
 *
 * ── 两处出现（规格 §9.3），教师端一处都没有（§3-U）─────────────────────────
 *
 * `QuestionReward` 挂在每题旁（交完立刻出现），`RewardTotal` 挂在顶栏。
 * 🔴 **教师端不出现**：这个组件只被学生端的作答面板引用；教师端的「学生端预览」
 * 渲染的是同一个题目列表组件，但它**不传** `reward` / `scores` 两个 prop，
 * 而且列表那一侧还有一道 `interactive` 的闸门（见 `worksheet-panel.tsx`）。
 * 看板 / 抽屉 / 按题看则完全不经过本文件。
 *
 * 动画（星星飞入）属 P3 视觉打磨，第一批是**静态图标 + 出现即显示**。
 */

/** 一道题旁的奖励。`null` 的两种情况（没判分 / 这一档下 0 个）都不画东西。 */
export function QuestionReward({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  const mark = rewardMark(scale, score);
  if (mark === null) return null;
  return (
    <span
      className={styles.questionReward}
      data-style={scale.style}
      // 对错档要能分色（✓ 绿 / ✗ 红），符号档只有一种颜色。属性选择器而不是拼类名：
      // 样式跟着唯一的那份判据走，JSX 里不必再算一次「这是不是答对」。
      data-right={score !== null && score >= 1 ? '1' : '0'}
    >
      {mark}
    </span>
  );
}

/** 顶栏的累计（规格 §9.3 的 `⭐×3`）。`null` = 一个都还没有，不画。 */
export function RewardTotal({ scale, amount }: { scale: RewardScale; amount: number }) {
  const text = rewardTotalText(scale, amount);
  if (text === null) return null;
  return <span className={styles.rewardTotal}>{text}</span>;
}
