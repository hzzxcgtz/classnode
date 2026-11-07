import type { ReactNode } from 'react';
import { RewardIcon } from '@/components/worksheet-reward-icon';
import type { RewardStyle } from '@/lib/worksheet-reward';

export function EditorRewardUnit({ style, unit }: { style?: RewardStyle; unit: string }) {
  return style && style !== 'points'
    ? <RewardIcon kind={style} state="earned" size={22} label={unit} />
    : <span>{unit}</span>;
}


/** Reward counts always read icon × amount; points retain their numeric unit. */
export function EditorRewardAmount({ style, unit, amount }: { style?: RewardStyle; unit: string; amount: ReactNode }) {
  return <span className="worksheet-editor-reward-amount">{style && style !== 'points'
    ? <><EditorRewardUnit style={style} unit={unit} /><span aria-hidden="true">×</span><span>{amount}</span></>
    : <><span>{amount}</span><EditorRewardUnit style={style} unit={unit} /></>}</span>;
}
