import { RewardIcon } from '@/components/worksheet-reward-icon';
import type { RewardStyle } from '@/lib/worksheet-reward';

export function EditorRewardUnit({ style, unit }: { style?: RewardStyle; unit: string }) {
  return style && style !== 'points'
    ? <RewardIcon kind={style} state="earned" size={22} label={unit} />
    : <span>{unit}</span>;
}
