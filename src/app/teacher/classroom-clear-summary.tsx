import { IconCircleCheck, IconTrash, IconUsers } from '@tabler/icons-react';
import styles from './classroom-clear-summary.module.css';

export function ClassroomClearSummary({ title }: { title: string }) {
  return <div className={styles.summary}>
    <p className={styles.classroom}>{title}</p>
    <div className={styles.section}>
      <strong className={styles.remove}><IconTrash size={15} aria-hidden="true" />将清除</strong>
      <p>学习单作答与评分、AI 分析、对话、通知、批注及互动记录</p>
    </div>
    <div className={styles.section}>
      <strong className={styles.keep}><IconCircleCheck size={15} aria-hidden="true" />保留内容</strong>
      <p>课堂、互动码、名单、学习单和教学材料配置</p>
    </div>
    <p className={styles.note}><IconUsers size={16} aria-hidden="true" /><span>此操作不可撤销，已连接的学生需要重新选择姓名。</span></p>
  </div>;
}
