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

/** 删学生时那句必须说出来的后果。单人 / 批量共用，避免两份漂移。 */
export const STUDENT_DELETE_CONSEQUENCE =
  '他在所有课堂（包括已结束的）中的对话记录与学习单作答也会一并删除，且无法恢复。';

/** 单个学生：删除确认弹窗的正文。 */
export function singleStudentDeleteMessage(name: string): string {
  return `学生「${name}」将从当前班级中删除。${STUDENT_DELETE_CONSEQUENCE}`;
}

/** 批量删除：删除确认弹窗的正文。 */
export function batchStudentDeleteMessage(count: number): string {
  return `选中的 ${count} 名学生将从当前班级中删除。${STUDENT_DELETE_CONSEQUENCE}`;
}
