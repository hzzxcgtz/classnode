'use client';

import type { ReactNode } from 'react';
import type { WorksheetQuestionNode } from '@/lib/types';
import { tableDescription, withTableDescription } from '@/lib/worksheet-fill-layout';
import { readPromptRuns } from '@/lib/worksheet-prompt-marks';
import { PromptEditor } from './prompt-editor';
import { TableBody } from './bodies/table-body';
import { EditorIcon } from './editor-icons';

export function TableFillEditor({ node, onPromptChange, onDataChange, onNotice, onBlankSelect, selectedBlankId, inspector }: {
  node: WorksheetQuestionNode;
  onPromptChange: (text: string, data?: Record<string, unknown>) => void;
  onDataChange: (patch: Record<string, unknown>) => void;
  onNotice: (message: string, type: 'success' | 'error') => void;
  onBlankSelect: (id: string | null) => void;
  selectedBlankId: string | null;
  inspector: ReactNode;
}) {
  const description = tableDescription(node);
  const descriptionNode = { ...node, prompt: description.text, data: { ...node.data, promptRuns: description.runs } };
  return <div className="worksheet-editor-visual-fill worksheet-editor-table-fill">
    <div className="worksheet-editor-table-top">
    <div className="worksheet-editor-table-description">
      <PromptEditor heading={<h4><EditorIcon kind="prompt" />任务描述</h4>} node={descriptionNode} descriptionOnly onRequestPaste={() => {}} onPromptChange={(text, patch) => {
        const full = withTableDescription(text, readPromptRuns(patch?.promptRuns, text));
        onPromptChange(full.text, { ...patch, promptRuns: full.runs });
      }} onDataChange={onDataChange} onNotice={onNotice} />
    </div>
    <aside className="worksheet-editor-blank-inspector">{inspector}</aside>
    </div>
      <div className="worksheet-editor-table-task">
        <h4>作答表格</h4><p>直接填写单元格内容；选中格子可设为填空。</p>
        <TableBody standalone node={node} onDataChange={onDataChange} onBlankSelect={onBlankSelect} selectedBlankId={selectedBlankId} />
      </div>
  </div>;
}
