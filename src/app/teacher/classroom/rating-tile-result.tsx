'use client';

import type { WorksheetQuestionNode } from '@/lib/types';
import { ratingConfig, ratingDimensionName, ratingLeafDimensions, readRatingAnswer } from '@/lib/worksheet-rating';
import { normalizeRewardStyle, type RewardStyle } from '@/lib/worksheet-reward';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import styles from './rating-tile-result.module.css';

export function RatingTileResult({ node, value, rewardStyle }: {
  node: WorksheetQuestionNode; value: unknown; rewardStyle?: RewardStyle;
}) {
  const answer = readRatingAnswer(node.data, value);
  if (!answer) return null;
  const config = ratingConfig(node.data);
  const leaves = ratingLeafDimensions(config);
  const rated = leaves.filter(d => answer.ratings[d.id]);
  const kind = normalizeRewardStyle(rewardStyle);
  const missing = leaves.length - rated.length;
  return <div className={styles.result}>
    {rated.length > 0 && <dl className={styles.ratings} aria-label="各维度评价">
      {rated.map(d => <div className={styles.item} key={d.id} title={d.path}>
        <dt>{ratingDimensionName(d.text)}</dt>
        <dd aria-label={`${ratingDimensionName(d.text)}：${answer.ratings[d.id]} / ${config.maxStars}`}>
          <RewardIcon kind={kind} size={15} />
          <span aria-hidden="true">× <b>{answer.ratings[d.id]}</b></span>
        </dd>
      </div>)}
    </dl>}
    {missing > 0 && <div className={styles.missing}>{missing} 项未评价</div>}
    {answer.text.trim() && <div className={styles.comment}>
      <div className={styles.label}>感想</div>
      <div className={styles.text}>{answer.text}</div>
    </div>}
  </div>;
}
