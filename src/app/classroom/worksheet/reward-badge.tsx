'use client';

import { RewardIcon } from '@/components/worksheet-reward-icon';
import { rewardAmount, rewardAmountLabel, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

/**
 * 奖励数量那几个字（`×N` / 分数档是 `+N`）。
 *
 * ★ 2026-09-29：**导出**给教师看板那一格用（教师：「箭头所指的地方要用图标，『×3』字要小一点」）。
 * 🔴 那个 `×` / `+` 的分别只在**这一处**：看板那一格自己拼一遍的话，某天改动这里
 *（比如分数档也换成 `×`）就会出现「学生端写 +3、教师端写 ×3」，而两边都不报错。
 */
export function RewardAmount({ scale, amount }: { scale: RewardScale; amount: number }) {
  // ★ 2026-09-29：`×N` / `+N` 那条规则搬去了 `@/lib/worksheet-reward`（教师看板那一格
  // 也要它，而那边不能引本文件 —— 本文件 import 了学生端学习单整张 CSS module）。
  return <span className={styles.rewardCount}>{rewardAmountLabel(scale.style, amount)}</span>;
}
/**
 * 角标里那枚图标的边长。
 * ★ 2026-09-29（教师 ⑤-②）：「把火箭图标**适当缩小**一点」—— 34 ⇒ 22（角标只有那么大）。
 */
const REWARD_BADGE_ICON_SIZE = 22;

/**
 * 一道题判分后的静态奖励 —— **判定那一格右上角的一枚小角标**。
 *
 * ★ 2026-09-29（教师 ⑤，原话）：「我感觉这个地方的火箭符号还是有点占位置，能不能做以下
 * 调整：① 将它**叠加在「全部答对」这个框的右上角**；② 把火箭图标**适当缩小**一点；
 * ③ 如果超过一个的话，加上一个小小的 **×N**」。
 *
 * 🔴 **这一版反转了 2026-09-28 图 56 的两条**（那次的原话逐字记在
 * `worksheet.module.css` 的 `.resultReward` 上）：
 *   · 「火箭和 ×1 **不需要框在圆角矩形里**」+「保证左边两个框的高度一致」
 *     ⇒ 它当时搬到框**外面**当兄弟。这次搬回框上，而**那次要保的东西仍然保住了**：
 *       角标是绝对定位，**不占行内空间** ⇒ 两格的高度一个字都没变；
 *   · 「一个就是一枚图标，不写 ×1」「得到两个就直接画两个」
 *     ⇒ 这次只画**一枚** + `×N` —— 理由就是 ① 本身：角标只有那么大，画不下五个。
 *
 * ⚠️ **图标本身不自带入场动画**（刷新页面不该重复庆祝）—— 那条规矩没动，
 *    动效仍然只在 `RewardBurst`（一次新的全对响应到达时挂载）里。
 */
export function QuestionReward({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  if (score === null) return null;
  const amount = rewardAmount(score, scale);
  // ⚠️ 0 ⇒ **什么都不画**。这里原来写的是「暂未获得」四个字，而角标放不下那句话；
  //    而那一支**由构造不可达**：全对的分值 `full >= 1` ⇒ 分恒 > 0。
  //    （部分给分拿的是教师配的 `half`，可以是 0 —— 那时也确实没有奖励可显示，
  //      画一枚图标反而是在说学生拿到了东西。）
  if (amount <= 0) return null;
  return (
    <span className={styles.questionReward} data-style={scale.style}>
      <RewardIcon kind={scale.style} state="earned" size={REWARD_BADGE_ICON_SIZE} />
      {/* ⚠️ `×N` **只在多于一个时**出现（教师 ⑤-③）。分值是整数
          （服务端 `normalizePointValue` 走 `Math.round`）⇒ `> 1` 与 `≠ 1` 等价。 */}
      {amount > 1 && <RewardAmount scale={scale} amount={amount} />}
    </span>
  );
}

/** 顶栏累计：始终是一枚图标加数量，数量大时也不会挤成一串。 */
export function RewardTotal({ scale, amount }: { scale: RewardScale; amount: number }) {
  if (amount <= 0) return null;
  return (
    <span className={styles.rewardTotal} aria-label={`已获得 ${amount}`}>
      <RewardIcon kind={scale.style} state="earned" size={24} />
      <RewardAmount scale={scale} amount={amount} />
    </span>
  );
}

/** 只在一次新的“全部答对”响应到达时挂载，结束后淡出，静态得奖信息仍留在反馈框。 */
export function RewardBurst({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return null;
  return (
    <span className={styles.rewardBurst} aria-live="polite" aria-label={`答对了，获得 ${amount} 个奖励`}>
      <span className={styles.rewardBurstHalo} aria-hidden="true" />
      <RewardIcon kind={scale.style} state="earned" size={54} />
      <RewardAmount scale={scale} amount={amount} />
    </span>
  );
}
