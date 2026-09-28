'use client';

import { RewardIcon } from '@/components/worksheet-reward-icon';
import { rewardAmount, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

function RewardAmount({ scale, amount }: { scale: RewardScale; amount: number }) {
  return <span className={styles.rewardCount}>{scale.style === 'points' ? '+' : '×'}{amount}</span>;
}
/** 画几个图标就不再画数字的上限（再多就回落到 `×N`）。 */
const REWARD_ICON_CAP = 5;
/** 图标边长。★ 2026-09-28（教师）：「火箭的大小可以再缩小一点」—— 50 ⇒ 34。 */
const REWARD_ICON_SIZE = 34;

/**
 * 一道题判分后的静态奖励。图标不自带入场动画，避免刷新页面时重复庆祝。
 *
 * ★ 2026-09-28（教师三条）：
 *   ① 「如果只有一个，就不要写成『1』了」⇒ **一个就是一枚图标**，不写 `×1`；
 *   ② 「如果得到的是两个火箭，就直接画两个火箭」⇒ 2…5 个就画那么多个图标；
 *   ③ 「火箭的大小可以再缩小一点」⇒ 50 ⇒ 34。
 * ⚠️ 超过 `REWARD_ICON_CAP` 才回落到 `×N`：一屏摆十几个图标会跟题目正文抢眼，
 *   而那个数字本来就说清了（`RewardAmount` 一直留着，只是前几档不显示）。
 */
export function QuestionReward({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  if (score === null) return null;
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return <span className={styles.questionRewardWrong}>暂未获得</span>;
  const drawn = Math.min(amount, REWARD_ICON_CAP);
  return (
    <span className={styles.questionReward} data-style={scale.style}>
      {Array.from({ length: drawn }, (_, index) => (
        <RewardIcon key={index} kind={scale.style} state="earned" size={REWARD_ICON_SIZE} />
      ))}
      {amount > REWARD_ICON_CAP && <RewardAmount scale={scale} amount={amount} />}
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
