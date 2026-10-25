export type RecordingState = Record<string, { worksheetId: string; questionId: string; expiresAt: number }>;
type RecordingEvent = { participantId: string; worksheetId: string; questionId: string; recording: boolean };

/** 5 秒一次心跳，容许两次间隔；停止事件只结束对应题目的录音。 */
export function applyRecording(state: RecordingState, event: RecordingEvent, now: number): RecordingState {
  const current = state[event.participantId];
  if (!event.recording && (current?.worksheetId !== event.worksheetId || current.questionId !== event.questionId)) return state;
  const next = { ...state };
  if (event.recording) next[event.participantId] = { worksheetId: event.worksheetId, questionId: event.questionId, expiresAt: now + 12_000 };
  else delete next[event.participantId];
  return next;
}
export function expireRecordings(state: RecordingState, now: number): RecordingState {
  const expired = Object.keys(state).filter(id => state[id].expiresAt <= now);
  if (!expired.length) return state;
  const next = { ...state };
  for (const id of expired) delete next[id];
  return next;
}
