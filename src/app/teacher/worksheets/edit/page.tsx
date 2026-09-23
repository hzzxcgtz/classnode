'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeacherEmptyState, TeacherLoadingState, Toast } from '@/lib/components';
import type { WorksheetQuestionNode } from '@/lib/types';
import { QuestionCard } from './question-card';
import { WorksheetPreviewModal } from './preview-modal';
// 纯符号（常量与类型）**一律从内核取**，不从 `use-worksheet-editor` 转手。
// `use-worksheet-editor.ts` 里有 `export * from './worksheet-editor-core'`，所以同一个
// `QUESTION_TYPE_OPTIONS` 有**两条 import 路径**。那不是一个假想的风险：`question-card.tsx`
// 与 `preview-modal.tsx` 已经改指内核了，而这一页还指着 hook —— 下一次给题型加一个字段时，
// 只更新一处就会让两边的标签表分叉，且没有任何编译期信号。
// ⚠️ 只把**内核里的**符号改成从内核取：`useWorksheetEditor` 是 hook（本身就在 hook 文件里），
// `SaveStatus` 是 hook 的状态类型（内核里没有），这两个留在原处。
import { useWorksheetEditor, type SaveStatus } from './use-worksheet-editor';
import {
  QUESTION_TYPE_OPTIONS,
  type QuestionType,
  type WorksheetDraft,
} from './worksheet-editor-core';

/**
 * 学习单编辑页（`/teacher/worksheets/edit/?id=xxx`）。
 *
 * `id` 走查询参数、缺省即空白编辑器（规格 §6.1）：静态导出没有动态路由（§3-X），
 * 全仓同类跳转都是这个写法。本页与 C1 的列表页共用同一个地址形状，
 * 「新建」与「编辑」是同一个页面。
 *
 * 版式分三层（规格 §6.2 方案乙）：
 *   顶栏（返回 / 标题 / 保存状态 / 撤销重做 / 设置 / 预览 / 复制 / 保存）
 *   —— 题流（每题一张卡片，直接编辑题干、选项、正确答案）
 *   —— 底部的「＋ 添加题目」。
 *
 * `useSearchParams` 必须被 Suspense 包住（静态导出预渲染的硬要求）——
 * 与 `teacher/classroom/page.tsx` 同一写法。
 */
export default function WorksheetEditPage() {
  return (
    <Suspense fallback={<TeacherLoadingState label="正在打开编辑器…" />}>
      <WorksheetEditorBody />
    </Suspense>
  );
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function describeSaveStatus(saveStatus: SaveStatus, dirty: boolean, hasId: boolean): string {
  if (saveStatus.kind === 'saving') return '保存中…';
  if (saveStatus.kind === 'error') return '保存失败';
  if (dirty) return '未保存';
  if (saveStatus.kind === 'saved' && saveStatus.at) return `已保存 ${formatClock(saveStatus.at)}`;
  // 一次都没保存过、也没有改动 ⇒ 这是一份还没落库的新学习单。
  if (!hasId) return '新学习单 · 还没保存过';
  return '已保存';
}

function WorksheetEditorBody() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || null;

  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });
  const toastTimerRef = useRef<number | null>(null);
  const notify = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ show: true, msg: message, type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(previous => ({ ...previous, show: false })), 3000);
  }, []);
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const editor = useWorksheetEditor({ id, onNotice: notice => notify(notice.message, notice.type) });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { content, worksheetId, usage, saveStatus, draftFound } = editor;

  /**
   * 删题确认（规格 §6.4）。文案里必须含**已收到的作答份数** —— 不说的后果是教师
   * 以为「只是删一道题」，而学生已经写下的答案会变成看板与导出里的孤立数据。
   *
   * ⚠️ `usage.responseCount` 是**整卷**的作答份数（`WorksheetResponse` 行数），
   * 不是「这道题被答了多少次」—— 服务端没有按题统计的字段。所以措辞刻意分开：
   * 一个数字讲整卷，一句话讲这道题的答案会怎样，不能把它们说成同一件事。
   */
  const requestRemove = useCallback(async (node: WorksheetQuestionNode, index: number) => {
    const lines = [`确定删除第 ${index + 1} 题吗？`];
    if (!editor.worksheetId) {
      lines.push('这道题还没保存过，删掉之后本机草稿里也不会再有它。');
    } else {
      const usageNow = await editor.ensureUsage();
      if (usageNow === null) {
        lines.push('这次没能读到作答情况，无法确认这道题是否已经被学生作答过。');
      } else if (usageNow.responseCount > 0) {
        lines.push(`这份学习单已经收到 ${usageNow.responseCount} 份作答；删除后，学生在第 ${index + 1} 题上写下的答案会在看板与导出里变成孤立数据。`);
      } else {
        lines.push('这份学习单还没有收到过作答，删掉不影响任何学生。');
      }
    }
    lines.push('（删错了可以用「撤销」找回来。）');
    if (!window.confirm(lines.join('\n'))) return;
    editor.removeQuestion(node.id);
  }, [editor]);

  if (editor.loading) {
    return <TeacherLoadingState label="正在加载学习单…" />;
  }

  if (editor.loadError) {
    return (
      <TeacherEmptyState
        icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>}
        title="这份学习单没有加载出来"
        description={`${editor.loadError}。它本身没有丢，稍后重试即可（返回列表前请先回来重试，否则会看到一份空白的编辑器）。`}
        action={<button className="btn btn-secondary" onClick={editor.retryLoad}>重试</button>}
      />
    );
  }

  /**
   * 顶栏那句「被使用时警告」（规格 §6.4）。数字全部来自 `/usage`，
   * 前端不重新拼「是否在用」这个判据（`used` 已经由服务端算好）。
   */
  const usageHead = usage && usage.used
    ? [
      usage.classroomCount > 0 ? `本单正在被 ${usage.classroomCount} 堂课使用` : null,
      usage.responseCount > 0 ? `已收到 ${usage.responseCount} 份作答` : null,
    ].filter((part): part is string => part !== null).join(' · ') || '本单正在被使用'
    : null;

  return (
    <div className="worksheet-editor">
      <div className="worksheet-editor-topbar">
        <button type="button" className="btn btn-ghost" onClick={editor.goBack}>← 返回</button>
        <input
          className="worksheet-editor-title"
          value={editor.title}
          onChange={event => editor.setTitle(event.target.value)}
          maxLength={200}
          placeholder="未命名学习单"
          aria-label="学习单标题"
        />
        <span className={`worksheet-editor-status${editor.dirty ? ' is-dirty' : ''}${saveStatus.kind === 'error' ? ' is-error' : ''}`}>
          {describeSaveStatus(saveStatus, editor.dirty, Boolean(worksheetId))}
        </span>

        <div className="worksheet-editor-topbar-actions">
          <button type="button" className="btn btn-secondary" onClick={editor.undo} disabled={!editor.canUndo} title="撤销（Ctrl/Cmd+Z）">撤销</button>
          <button type="button" className="btn btn-secondary" onClick={editor.redo} disabled={!editor.canRedo} title="重做（Ctrl/Cmd+Shift+Z）">重做</button>
          <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>设置</button>
          <button type="button" className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>预览</button>
          <button type="button" className="btn btn-secondary" onClick={() => void editor.duplicate()} disabled={editor.duplicating}>
            {editor.duplicating ? '复制中…' : '复制一份'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void editor.save()} disabled={saveStatus.kind === 'saving'}>
            {saveStatus.kind === 'saving' ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {usageHead && (
        <div className="worksheet-editor-banner is-warning" role="status">
          ⚠ {usageHead} · 保存后学生端会立即看到变化
        </div>
      )}

      {draftFound && (
        <DraftBanner
          draft={draftFound.draft}
          onAccept={editor.acceptDraft}
          onDiscard={editor.discardDraft}
        />
      )}

      {saveStatus.kind === 'error' && saveStatus.message && (
        <div className="worksheet-editor-banner is-danger" role="alert">
          <strong>保存失败：</strong>{saveStatus.message}
          <div className="worksheet-editor-banner-note">
            改动都还在，修好上面的问题再按一次保存即可。也可以随时用「预览」看看学生那边会看到什么。
          </div>
        </div>
      )}

      {content.nodes.length === 0 ? (
        <div className="worksheet-editor-empty">
          还没有题目。点下面的「＋ 添加题目」开始。
        </div>
      ) : (
        <div className="worksheet-editor-questions">
          {content.nodes.map((node, index) => (
            <QuestionCard
              key={node.id}
              index={index}
              total={content.nodes.length}
              node={node}
              onPromptChange={prompt => editor.updatePrompt(node.id, prompt)}
              onDataChange={patch => editor.updateData(node.id, patch)}
              onMove={delta => editor.moveQuestion(node.id, delta)}
              onRemove={() => void requestRemove(node, index)}
            />
          ))}
        </div>
      )}

      <button type="button" className="worksheet-editor-add" onClick={() => setPickerOpen(true)}>
        ＋ 添加题目
      </button>

      {pickerOpen && (
        <AddQuestionPicker
          onPick={questionType => { editor.addQuestion(questionType); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          description={editor.description}
          onDescriptionChange={editor.setDescription}
          settings={editor.settings}
          onSettingsChange={editor.updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {previewOpen && (
        <WorksheetPreviewModal title={editor.title} content={content} onClose={() => setPreviewOpen(false)} />
      )}

      {toast.show && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

/**
 * 「发现未保存的草稿」（规格 §6.4）。草稿**只在本机**（`localStorage`），
 * 所以这里必须说清「本机」与「那一刻」，教师才能判断它值不值得恢复。
 */
function DraftBanner({ draft, onAccept, onDiscard }: {
  draft: WorksheetDraft;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="worksheet-editor-banner is-info" role="status">
      <div>
        发现未保存的草稿（本机、{formatClock(draft.savedAt)} 存入，{draft.content.nodes.length} 题）。它是上一次在这台电脑上编辑、但没保存成功的内容。
      </div>
      <div className="worksheet-editor-banner-actions">
        <button type="button" className="btn btn-primary" onClick={onAccept}>恢复</button>
        <button type="button" className="btn btn-secondary" onClick={onDiscard}>丢弃</button>
      </div>
    </div>
  );
}

/** 题型选择（规格 §6.2：「加题 = 点底部『＋ 添加题目』，弹出题型选择后追加到末尾」）。 */
function AddQuestionPicker({ onPick, onClose }: {
  onPick: (questionType: QuestionType) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="worksheet-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-add-question-title" style={{ width: 420 }}>
        <h3 id="worksheet-add-question-title">添加题目</h3>
        <p className="worksheet-editor-dialog-note">题目会加到这份学习单的最后，之后可以用每题右上角的 ▲▼ 调整顺序。</p>
        <div className="worksheet-editor-type-list">
          {QUESTION_TYPE_OPTIONS.map(option => (
            <button key={option.value} type="button" className="worksheet-editor-type-option" onClick={() => onPick(option.value)}>
              <span className="worksheet-editor-type-option-label">{option.label}</span>
              <span className="worksheet-editor-type-option-hint">{option.hint}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-lg" style={{ width: '100%' }} onClick={onClose}>取消</button>
      </div>
    </>
  );
}

/**
 * 「设置」面板（规格 §6.3）。只装三样里能改的两样 + 描述：
 *   · 描述（标题在顶栏直接编 —— 它改得最勤）
 *   · 自动判分（学习单级开关，规格 §3-L）
 *   · 提交后可否修改（`allowResubmit`，规格 §8.4）
 * 输入方式**不做 UI**（规格 §3-V，第一批恒为 keyboard），`settings.defaultInputMode`
 * 只是原样带着走，不在这里改。
 *
 * 两个开关都写明了**关掉之后会怎样**，因为它们的后果都不在教师眼前：
 * 一个让看板失去正确率，一个会让学生的修改请求被服务端拒绝。
 */
function SettingsModal({ description, onDescriptionChange, settings, onSettingsChange, onClose }: {
  description: string;
  onDescriptionChange: (value: string) => void;
  settings: { allowResubmit: boolean; autoGrade: boolean };
  onSettingsChange: (patch: { allowResubmit?: boolean; autoGrade?: boolean }) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="worksheet-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-settings-title" style={{ width: 480 }}>
        <h3 id="worksheet-settings-title">学习单设置</h3>
        <p className="worksheet-editor-dialog-note">标题在顶栏直接改。这里的三项要按「保存」才会生效。</p>

        <label className="worksheet-editor-field">
          <span>描述（只给教师看）</span>
          <textarea
            className="input"
            rows={3}
            value={description}
            maxLength={2000}
            onChange={event => onDescriptionChange(event.target.value)}
            placeholder="这份学习单打算怎么用、和第几课配套。学生看不到这段文字。"
          />
        </label>

        <label className="worksheet-editor-switch">
          <input type="checkbox" checked={settings.autoGrade} onChange={event => onSettingsChange({ autoGrade: event.target.checked })} />
          <span>
            <strong>自动判分</strong>
            <em>单选题与填空题自动判对错。关掉之后看板只统计作答进度，没有正确率 —— 想看对错就把它打开。</em>
          </span>
        </label>

        <label className="worksheet-editor-switch">
          <input type="checkbox" checked={settings.allowResubmit} onChange={event => onSettingsChange({ allowResubmit: event.target.checked })} />
          <span>
            <strong>提交后可以修改</strong>
            <em>关掉之后，学生点了「提交本题」就定稿，再改会被拒绝（由服务端拦下，不是只做个提示）。</em>
          </span>
        </label>

        <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
      </div>
    </>
  );
}
