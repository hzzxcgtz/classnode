import { RewardIcon } from './worksheet-reward-icon';
import { pointsUnitLabel, REWARD_STYLE_OPTIONS } from '@/lib/worksheet-reward';

/** 收藏型奖励用同一套图标，分数和未知单位保留文字。 */
export function RewardUnit({ unit }: { unit: string }) {
  const reward = REWARD_STYLE_OPTIONS.find(option => option.value !== 'points' && pointsUnitLabel(option.value) === unit);
  return reward ? <span style={{ display: 'inline-flex', verticalAlign: 'middle' }} title={unit}><RewardIcon kind={reward.value} size={20} label={unit} /></span> : <>{unit}</>;
}
