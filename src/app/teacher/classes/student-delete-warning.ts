/**
 * 「删除学生」的后果说明 —— **两个入口共用这一份**（单人删除 / 批量删除）。
 *
 * 🔴 为什么必须共用：删学生**不只是从班级名册里去掉一行**。
 *    `Student` → `ClassroomStudent` → `Message` / `WorksheetResponse` 三条外键都是
 *    `onDelete: Cascade`（见 `server/prisma/schema.prisma`），所以删一个学生
 *    会级联删掉他**在全部课堂（含已结束的）**里的对话记录与学习单作答（含判分与奖励的派生源），
 *    且无法恢复。
 *
 *    ★ 2026-10-09 审计：两个入口原先各写一份，而两句都只说到「从当前班级中删除」
 *    （批量那句多一句「此操作不可撤销」）—— 教师按日常名册维护的预期点下去，
 *    上个学期的东西一起没了。两个入口各写一份还会漂移，所以只有这一处。
 *
 * ⚠️ 这里只**说明**后果，不改变服务端行为。要不要把「移出班级」与「彻底删除」拆成两件事，
 *    是产品决定（见审计报告：单纯加一道「有关联就不许删」的守卫会重演
 *    「班级删不掉、而提示让人去做一件做不到的事」那个 bug）。
 */

/**
 * ★ 2026-10-09（教师裁定「删学生拆两件事」）：名册上那个入口拆成两个动作，
 * 每个动作一句话说清**它自己**的后果。两份文案都在这里，四个入口（单人 / 批量 × 两个动作）
 * 全从这一处取 —— 各写一份必然漂移，而漂移的后果是教师按错的那句去判断代价。
 */

/** **彻底删除**时那句必须说出来的后果。单人 / 批量共用，避免两份漂移。 */
export const STUDENT_DELETE_CONSEQUENCE =
  '他在所有课堂（包括已结束的）中的对话记录与学习单作答也会一并删除，且无法恢复。';

/** **移出班级**时不动的那些东西（与上面那句正好相反：一句说会删，一句说不会删）。 */
export const STUDENT_REMOVE_CONSEQUENCE =
  '他在所有课堂（包括已结束的）中的对话记录与学习单作答都会保留（仍可在历史里查看），'
  + '之后需要时也可以把他重新加回班级。';

/** 单个学生：**彻底删除**确认弹窗的正文。 */
export function singleStudentDeleteMessage(name: string): string {
  return `学生「${name}」将被彻底删除（不只是移出班级）。${STUDENT_DELETE_CONSEQUENCE}`;
}

/** 批量**彻底删除**：确认弹窗的正文。 */
export function batchStudentDeleteMessage(count: number): string {
  return `选中的 ${count} 名学生将被彻底删除（不只是移出班级）。${STUDENT_DELETE_CONSEQUENCE}`;
}

/** 单个学生：**移出班级**确认弹窗的正文。 */
export function singleStudentRemoveMessage(name: string): string {
  return `学生「${name}」将从本班名册中移除。${STUDENT_REMOVE_CONSEQUENCE}`
    + '若他此刻正待在某个课堂里，仍然会留在那个课堂中。';
}

/** 批量**移出班级**：确认弹窗的正文。 */
export function batchStudentRemoveMessage(count: number): string {
  return `选中的 ${count} 名学生将从本班名册中移除。${STUDENT_REMOVE_CONSEQUENCE}`
    + '若他们此刻正待在某个课堂里，仍然会留在那个课堂中。';
}
