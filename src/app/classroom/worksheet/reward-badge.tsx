'use client';

import { rewardMark, rewardTotalText, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

/**
 * 奖励徽章 —— **得分**的呈现，不是数据（规格 §9.1）。
 *
 * ⊘ 2026-09-24（M4a）更正：这句原先写的是「`isCorrect` 的**呈现**」。M4a 把奖励层换成
 * **绝对值模型**之后，本文件**一个字节都不读 `isCorrect`**（它读的是 `score`，
 * 见 `rewardAmount` 的入参与 D3 的接线）—— 那句话会让人以为「改 `isCorrect` 就能改徽章」，
 * 从而找不到真正的输入。判分结论（`gradeState`）本文件同样不读。
 *
 * 🔴 **绝不把星星 / 花朵 / 分数存进数据库**：一旦落库，教师端「哪道题错得多」、导出、
 * P4 的分析型智能体都要面对一个「⭐ 是什么数」的问题。本文件一个字节都不写库，
 * 它拿到的是一份**算出来的**配置（`RewardScale`）与一份**服务端刚判出来的**得分。
 *
 * ── 显示值 = 得分本身（规格 §12 的绝对值模型）────────────────────────────────
 *
 * 取值函数是 `lib/worksheet-reward.ts` 的 `rewardAmount(score, scale)`：
 * 画出来的个数**就是 `score`**（对错档例外，那一档一次只画一枚 ✓/✗）；
 * `score = null` ⇒ 不画、`score = 0` ⇒ 不画（对错档画 ✗）。
 * 得分是教师逐题填的**绝对数**（全对给几 / 半对给几），所以「半对」不是一个固定比例 ——
 * 它给 2 分就画两颗星。完整理由（含旧乘法模型的那个反例）写在 `rewardAmount` 的注释里。
 *
 * ⚠️ ★ M4a/I1：对错档那条「有分就画 ✓」的分界是 `score >= 1`，也就是它**默认**
 * 「答对 ⇒ 至少 1 分」。这个前提由**写入口**保证（`full` 的域是 1..99，
 * 见 `POINTS_FULL_MIN`）—— 本文件这一层拿不到题目的满分，也没法自己判对错。
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
