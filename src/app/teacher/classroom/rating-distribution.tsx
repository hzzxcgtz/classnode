'use client';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import { normalizeRewardStyle, type RewardStyle } from '@/lib/worksheet-reward';
import { ratingDimensionName } from '@/lib/worksheet-rating';
import type { QuestionDistribution } from './worksheet-question-stats';
import styles from './rating-distribution.module.css';

type RatingDistribution = Extract<NonNullable<QuestionDistribution>, { kind: 'rating' }>;
const colors = ['#c5d7e6', '#83aacb', '#42789f', '#315f85', '#24476a'];
export function RatingDistributionTable({ data, max, unit, rewardStyle }: { data: RatingDistribution; max: number; unit: string; rewardStyle?: RewardStyle }) {
  const kind = normalizeRewardStyle(rewardStyle);
  return <div className={styles.scroll}>
    <table className={styles.table}>
      <thead><tr><th scope="col">评价维度</th><th scope="col">平均评价</th><th scope="col">
        <div className={styles.distributionHeading}><span>评价分布</span><div className={styles.legend}>
          {Array.from({ length: max }, (_, i) => <span key={i}><i style={{ background: colors[i] }} />{i + 1}{kind === 'points' ? '级' : <RewardIcon kind={kind} size={14} />}</span>)}
        </div></div>
      </th><th scope="col">已评价</th></tr></thead>
      <tbody>{data.dimensions.map(d => d.isLeaf === false
        ? <tr key={d.id} className={styles.groupRow}><th colSpan={4} style={{ paddingLeft: 16 + (d.depth ?? 0) * 16 }}>{ratingDimensionName(d.label)}</th></tr>
        : <tr key={d.id}>
        <th scope="row" style={{ paddingLeft: 16 + (d.depth ?? 0) * 16 }}>{ratingDimensionName(d.label)}</th>
        <td className={styles.average}>
          {d.average === null ? <span className={styles.empty}>暂无</span> : <div className={styles.averageInner} aria-label={`平均 ${d.average.toFixed(1)}，满值 ${max}`}>
            {kind !== 'points' && <span className={styles.stars} aria-hidden="true">
              <span>{Array.from({ length: max }, (_, i) => <RewardIcon key={i} kind={kind} state="empty" size={18} />)}</span>
              <span className={styles.filled} style={{ width: `${d.average / max * 100}%` }}>{Array.from({ length: max }, (_, i) => <RewardIcon key={i} kind={kind} state="earned" size={18} />)}</span>
            </span>}<strong>{d.average.toFixed(1)}</strong>{kind === 'points' && <span className={styles.empty}> / {max}</span>}
          </div>}
        </td>
        <td className={styles.distribution}>
          <div className={styles.track} role="img" aria-label={d.bars.map((bar, i) => `${i + 1}级 ${bar.count}${unit}，${d.count ? Math.round(bar.count / d.count * 100) : 0}%`).join('；')}>
            {d.bars.map((bar, i) => {
              const percent = d.count ? bar.count / d.count * 100 : 0;
              return percent > 0 ? <span key={i} style={{ width: `${percent}%`, background: colors[i], color: i < 2 ? '#25445e' : '#fff' }}
                title={`${i + 1}级：${bar.count}${unit}（${Math.round(percent)}%）`}>{percent >= 12 ? `${Math.round(percent)}%` : ''}</span> : null;
            })}
          </div>
          <div className={styles.counts}>{d.bars.map((bar, i) => <span key={i}><i style={{ background: colors[i] }} />{i + 1}{kind === 'points' ? '级' : <RewardIcon kind={kind} size={12} />} <b>{bar.count}</b>{unit}</span>)}</div>
        </td>
        <td className={styles.total}>{d.count}<span>{unit}</span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
