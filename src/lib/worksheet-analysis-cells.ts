/**
 * 「这个学生是**第几格**、代号是什么」—— 教师核对 AI 评分用的。
 *
 * ★ 2026-10-07（教师：40 人一起交给智能体）—— 这一条补的是一个**静默**的坑：
 *   模型看串格时，分会**贴到别人头上**（解析只要求「代号在名单里」，认错了也照收），
 *   而教师能核对的那张「代号 ↔ 真名 ↔ 第几格」对照表藏在「查看发送数据」折叠区里 ——
 *   不看就无从核对，两边也都不报错。
 *
 * ⚠️ 格号就是**载荷里条目的序号**（+1）：联系表按同一个顺序排版（`layoutSheets` 逐片切），
 *    所以这里的号与图上的「第 N 格」是同一个号。另立一套编号必然对不上。
 */
export function cellNumberOf(
  entries: ReadonlyArray<{ studentId: string; anonLabel: string }>,
  studentId: string,
): { cell: number; anonLabel: string } | null {
  const index = entries.findIndex((entry) => entry.studentId === studentId);
  if (index < 0) return null;
  return { cell: index + 1, anonLabel: entries[index].anonLabel };
}

/** 评分行旁边那句话：「第 3 格 · User_003」。读不出来时回 `null`（宁可不说，也不编一个号）。 */
export function cellLabelOf(
  entries: ReadonlyArray<{ studentId: string; anonLabel: string }>,
  studentId: string,
): string | null {
  const hit = cellNumberOf(entries, studentId);
  return hit ? `第 ${hit.cell} 格 · ${hit.anonLabel}` : null;
}
