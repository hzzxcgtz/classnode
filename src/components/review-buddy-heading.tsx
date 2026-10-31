import { RewardIcon } from './worksheet-reward-icon';

/** 评价与建议共用支点博士形象，字号和布局由所在页面控制。 */
export function ReviewBuddyHeading({ advice = false, size = 32 }: { advice?: boolean; size?: number }) {
  return <span style={{display:'inline-flex',alignItems:'center',gap:10,minWidth:0}}>
    <span aria-hidden="true" style={{display:'inline-flex',flexShrink:0}}><RewardIcon kind="classnode" size={size}/></span>
    <span>{advice ? '支点博士给你的建议' : '支点博士对你的评价'}</span>
  </span>;
}
