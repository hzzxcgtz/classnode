export const WORKSHEET_AUDIO_URL = /^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:worksheet|chat))\/chat-[0-9a-f-]+\.ogg$/i;
export interface AudioAnswer { format: 'audio/v1'; url: string; durationMs: number }
export function readAudioAnswer(value: unknown): AudioAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.format === 'audio/v1' && typeof row.url === 'string' && WORKSHEET_AUDIO_URL.test(row.url)
    && typeof row.durationMs === 'number' && Number.isFinite(row.durationMs) && row.durationMs >= 500 && row.durationMs <= 300_000
    ? { format: 'audio/v1', url: row.url, durationMs: row.durationMs } : null;
}
export function findAudioValueError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || (value as { format?: unknown }).format !== 'audio/v1') return null;
  return readAudioAnswer(value) ? null : '语音作答无效，请重新录音并保存（最长 5 分钟）';
}
