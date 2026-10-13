/** 同进程内串行化材料修改；登记发送请求在任何异步查询之前完成。 */
const edits = new Set<string>();
const requests = new Map<string, number>();
export function beginMaterialEdit(id: string): boolean {
  if (edits.has(id)) return false;
  edits.add(id);
  return true;
}
export function endMaterialEdit(id: string): void { edits.delete(id); }
export function hasClassroomRequests(id: string): boolean { return (requests.get(id) ?? 0) > 0; }
export function beginClassroomRequest(id: string): boolean {
  if (edits.has(id)) return false;
  requests.set(id, (requests.get(id) ?? 0) + 1);
  return true;
}
export function endClassroomRequest(id: string): void {
  const count = (requests.get(id) ?? 1) - 1;
  if (count > 0) requests.set(id, count); else requests.delete(id);
}

export function agentContextStart(value: unknown, scope: string): Date | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)[scope];
  if (typeof raw !== 'string') return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

/** 旧课堂沿用原上下文；发生切换后只取本次切换以来、由当前学伴产生的消息。 */
export function agentHistoryWhere(studentId: string, agentId: string, contextStart: Date | undefined) {
  return { studentId, ...(contextStart ? { createdAt: { gt: contextStart }, agentId } : {}) };
}
