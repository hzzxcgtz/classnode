import type { WorksheetQuestionNode } from './types.ts';
import { blankStarterFor, readDrawingStarter } from './worksheet-drawing-starter.ts';

export type MathBackgroundSource = 'upload' | 'draw';

export function mathBackgroundSource(node: WorksheetQuestionNode): MathBackgroundSource {
  return readDrawingStarter(node)?.tool === 'math' ? 'draw' : 'upload';
}

/** Each change writes both sides of the exclusive choice in one patch. */
export function mathBackgroundPatch(node: WorksheetQuestionNode, source: MathBackgroundSource): Record<string, unknown> {
  if (source === 'upload') return { drawingStarter: undefined };
  const starter = readDrawingStarter(node);
  return {
    drawingStarter: starter?.tool === 'math' ? starter : blankStarterFor('math'),
    drawingBackgroundPreset: undefined,
    drawingBackgroundImageUrl: undefined,
  };
}
