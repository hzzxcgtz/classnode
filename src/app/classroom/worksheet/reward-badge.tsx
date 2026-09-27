'use client';

import { RewardIcon } from '@/components/worksheet-reward-icon';
import { rewardAmount, type RewardScale } from '@/lib/worksheet-reward';
import type { WorksheetScore } from './use-worksheet-answers';
import styles from './worksheet.module.css';

function RewardAmount({ scale, amount }: { scale: RewardScale; amount: number }) {
  return <span className={styles.rewardCount}>{scale.style === 'points' ? '+' : '×'}{amount}</span>;
}
/** 一道题判分后的静态奖励。图标不自带入场动画，避免刷新页面时重复庆祝。 */
export function QuestionReward({ scale, score }: { scale: RewardScale; score: WorksheetScore }) {
  if (score === null) return null;
  const amount = rewardAmount(score, scale);
  if (amount <= 0) return <span className={styles.questionRewardWrong}>暂未获得</span>;
  return (
    <span className={styles.questionReward} data-style={scale.style}>
      <RewardIcon kind={scale.style} state="earned" size={50} />
      <RewardAmount scale={scale} amount={amount} />
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
