import type { AnnotationStroke } from './temporary-annotations';
export type { AnnotationStroke } from './temporary-annotations';

// Page-session only: stable image or review keys keep marks across viewer mounts.
// Image coordinates use 1000 px fitted width; text coordinates use its saved viewport.
export interface AnnotationFrame { width: number; height: number; textSize: number; scroll: {top: number; left: number}[] }
export interface AnnotationDocument { version: 1; kind: 'image' | 'text'; strokes: AnnotationStroke[]; frame?: AnnotationFrame }
const images = new Map<string, AnnotationStroke[]>();

export function readImageAnnotations(key: string): AnnotationStroke[] {
  return images.get(key) ?? [];
}

export function writeImageAnnotations(key: string, strokes: AnnotationStroke[]): void {
  if (strokes.length) images.set(key, strokes);
  else images.delete(key);
}
