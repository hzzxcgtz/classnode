import { readFile } from 'node:fs/promises';
import { resolveLocalPath } from './ai-proxy.js';
import type { AnalysisBatchProgress } from './analysis-operation.js';
import { layoutSheets, type AnalyzeEntry, type SheetKnobs } from './analysis-payload.js';
import { renderSheets } from './analysis-render.js';

export type AnalysisBatch = Pick<AnalysisBatchProgress, 'sectionId' | 'title' | 'index' | 'total' | 'responses'>;
export type AnalysisBatchSend = (prompt: string, images: Buffer[], audio: Array<{ url: string; label: string }>) =>
  Promise<{ success: boolean; content?: string; error?: string }>;
export type ScheduleAnalysisBatch = <T>(batch: AnalysisBatch, work: (send: AnalysisBatchSend) => Promise<T>) => Promise<T>;

/** Bound each request by both number of works and the size of its attachments/text. */
export function splitClassBatches(entries: AnalyzeEntry[]): AnalyzeEntry[][] {
  const batches: AnalyzeEntry[][] = [];
  let batch: AnalyzeEntry[] = [];
  let attachments = 0, audioCount = 0, audioMs = 0, chars = 0;
  for (const entry of entries) {
    const clips = entry.kind === 'audio' ? 1 : entry.fillAudios?.length ?? 0;
    const duration = entry.kind === 'audio' ? entry.durationMs ?? 0 : entry.fillAudios?.reduce((sum, clip) => sum + clip.durationMs, 0) ?? 0;
    const files = clips + Number(entry.kind === 'photo' || entry.kind === 'ink');
    const length = entry.text?.length ?? 0;
    if (batch.length && (batch.length >= 24 || attachments + files > 6 || audioCount + clips > 5
      || audioMs + duration > 180_000 || chars + length > 18_000)) {
      batches.push(batch);
      batch = [];
      attachments = audioCount = audioMs = chars = 0;
    }
    batch.push(entry);
    attachments += files;
    audioCount += clips;
    audioMs += duration;
    chars += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function classBatchMedia(entries: AnalyzeEntry[], labels: Map<string, string>, knobs: SheetKnobs) {
  const images: Buffer[] = [];
  const notes: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'photo' || !entry.photoUrl) continue;
    const path = resolveLocalPath(entry.photoUrl);
    if (!path) throw new Error('学生作答图片地址无效');
    images.push(await readFile(path));
    notes.push(`学生图片 ${images.length}：${labels.get(entry.studentId)}。`);
  }
  const ink = entries.filter(entry => entry.kind === 'ink');
  if (ink.length) {
    const layouts = layoutSheets(ink, labels, knobs);
    const rendered = await renderSheets(ink, layouts, knobs);
    if (!rendered || rendered.sheets.length !== layouts.length || !rendered.sheets.length) throw new Error('无法生成学生笔迹图');
    for (const [index, layout] of layouts.entries()) {
      images.push(rendered.sheets[index]);
      notes.push(`学生图片 ${images.length} 为笔迹拼图，按格序对应：${layout.cells.map(cell => cell.anonLabel).join('、')}。`);
    }
  }
  const audio = entries.flatMap(entry => {
    const label = labels.get(entry.studentId)!;
    return entry.audioUrl ? [{ url: entry.audioUrl, label }]
      : (entry.fillAudios ?? []).map(clip => ({ url: clip.url, label: `${label} · 第 ${clip.index + 1} 空` }));
  });
  return { images, audio, notes };
}

/** Settle in-flight batches before closing the operation, and preserve input order for the report. */
export async function collectAnalysisBatches<T>(batches: Promise<T>[]): Promise<T[]> {
  return (await Promise.allSettled(batches)).map(result => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}
