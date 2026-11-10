/** One cancellable class-analysis operation per classroom/worksheet/question. */
export interface AnalysisBatchProgress {
  sectionId: string;
  title: string;
  index: number;
  total: number;
  responses: number;
  phase: 'queued' | 'preparing' | 'sending' | 'analyzing' | 'completed' | 'failed';
  agentName?: string;
  accountLabel?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}
export interface AnalysisOperation { id: string; controller: AbortController; startedAt: number; batches?: AnalysisBatchProgress[] }
const operations = new WeakMap<object, Map<string, AnalysisOperation>>();
export const analysisOperationKey = (classroomId: string, worksheetId: string, questionId: string) => JSON.stringify([classroomId, worksheetId, questionId]);
export function beginAnalysisOperation(database: object, key: string, id: string): AnalysisOperation {
  let map = operations.get(database);
  if (!map) { map = new Map(); operations.set(database, map); }
  const previous = map.get(key);
  if (previous?.id === id) { previous.controller.signal.throwIfAborted(); return previous; }
  previous?.controller.abort(new Error('分析已停止'));
  const operation = { id, controller: new AbortController(), startedAt: Date.now() };
  map.set(key, operation);
  return operation;
}
export function resumeAnalysisOperation(database: object, key: string, id: string): AnalysisOperation {
  const operation = operations.get(database)?.get(key);
  if (!operation || operation.id !== id) throw new Error('分析已停止，请重新开始');
  operation.controller.signal.throwIfAborted();
  return operation;
}
export function stopAnalysisOperation(database: object, key: string): void {
  operations.get(database)?.get(key)?.controller.abort(new Error('分析已停止'));
}
export function readAnalysisBatches(database: object, key: string) {
  const operation = operations.get(database)?.get(key);
  if (!operation?.batches || operation.controller.signal.aborted) return undefined;
  return { batchProgress: operation.batches, batchRunStartedAt: operation.startedAt };
}
