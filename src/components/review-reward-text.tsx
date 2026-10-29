import { Fragment } from 'react';
import { RewardIcon } from './worksheet-reward-icon';
import { inlineReviewReward } from '@/lib/review-inline-reward';

export function ReviewRewardText({ text }: {text:string}) {
  return <>{text.split('\n').map((line,index) => {
    const reward = inlineReviewReward(line);
    return <Fragment key={index}>{index > 0 && <br/>}{reward ? <>{reward.prefix} <span role="img" aria-label={reward.label} title={reward.label} style={{display:'inline-flex',alignItems:'center',gap:3,verticalAlign:'middle'}}>
      {Array.from({length:reward.count > 0 && reward.count <= 10 ? reward.count : 1},(_,i)=><RewardIcon key={i} kind={reward.kind} state={reward.count ? 'earned' : 'empty'} size={24}/>)}
      {(reward.count === 0 || reward.count > 10) && <span>×{reward.count}</span>}
    </span>{reward.suffix}</> : line}</Fragment>;
  })}</>;
}
