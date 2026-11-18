'use client';
import type { WorksheetQuestionNode } from '@/lib/types';
import { readRatingTextRuns, type RatingTextRun } from '@/lib/worksheet-rating';
import { PromptEditor } from '../prompt-editor';

/** Reuse the existing selection, IME and undo handling for rating text fields. */
export function RatingTextEditor({ id, label, text, runs, limit, onChange, toolbarTarget, onEditingFocus }: {
  id: string; label: string; text: string; runs?: RatingTextRun[]; limit: number;
  toolbarTarget?: HTMLElement | null;
  onEditingFocus?: () => void;
  onChange: (text: string, runs: RatingTextRun[]) => void;
}) {
  const node: WorksheetQuestionNode = { id, type: 'short-answer', prompt: text, inputMode: 'keyboard', data: { promptRuns: runs }, children: [] };
  return <PromptEditor node={node} fieldLabel={label} basicFormatting toolbarTarget={toolbarTarget} onEditingFocus={onEditingFocus}
    onPromptChange={(next, patch) => {
      const value = next.slice(0, limit);
      onChange(value, readRatingTextRuns(patch?.promptRuns, value));
    }}
    onDataChange={patch => onChange(text, readRatingTextRuns(patch.promptRuns, text))}
    onRequestPaste={() => {}} onNotice={() => {}} />;
}
