'use client';
import styles from './review-evidence-panel.module.css';
export interface TeacherReviewEvidence {
  version: 1; summary: string;
  criteria: Array<{requirement:string;status:'met'|'partial'|'unmet'|'uncertain';evidence:string}>;
  limitations: string[];
}
const labels={met:'达成',partial:'部分达成',unmet:'未达成',uncertain:'无法确认'};
export function ReviewEvidencePanel({evidence}:{evidence?:TeacherReviewEvidence|null}){
 return <details className={styles.panel} onToggle={event=>event.stopPropagation()}>
  <summary>查看分析依据{!evidence && <span> · 历史记录未提供</span>}</summary>
  {evidence ? <div className={styles.content}>
   <p><strong>作答摘要</strong>{evidence.summary}</p>
   {evidence.criteria.map((item,index)=><div key={index} className={styles.criterion}><div><strong>{item.requirement}</strong><span data-status={item.status}>{labels[item.status]}</span></div><p>{item.evidence}</p></div>)}
   {evidence.limitations.length>0 && <div className={styles.limitations}><strong>识别局限</strong>{evidence.limitations.map((text,index)=><p key={index}>{text}</p>)}</div>}
   <small>本次评价的作答依据，用于班级汇总；请结合学生原始作答核对。</small>
  </div> : <p className={styles.content}>这次历史评价没有保存详细作答依据。班级分析可参考已有评价与建议，并说明证据局限。</p>}
 </details>;
}
