'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TeacherEmptyState, TeacherLoadingState, Toast } from '@/lib/components';
import type { AgentSummary, WorksheetQuestionNode, WorksheetSettings } from '@/lib/types';
import { api } from '@/lib/api';
// 奖励形式的取值域 / 可选步长只有一份（`src/lib/worksheet-reward.ts`）—— 教师端这四行
// 与学生端那个徽章用的是同一份，加一档只改那一处。
import { HALF_STEPS, REWARD_STEPS, REWARD_STYLE_OPTIONS } from '@/lib/worksheet-reward';
import { QuestionCard } from './question-card';
import { TaskCard } from './task-card';
import { editorRenderBlocks } from './worksheet-editor-core';
import { TASK_TYPE } from '@/lib/worksheet-questions';
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
  /**
   * 加题弹窗现在要知道**加到哪儿**（★ 2026-09-25）：
   *   `null`      = 弹窗没开；
   *   `{ parentId }` = 开着，`parentId` 为 `null` 表示加到顶层（散题，老数据形态）。
   * 迁移之后顶层的题都在任务里，所以绝大多数情况 `parentId` 是一个任务 id ——
   * 旧写法（没有这个参数）会让教师新加的题永远落在任务**外面**。
   */
  const [pickerFor, setPickerFor] = useState<{ parentId: string | null } | null>(null);

  const { content, worksheetId, usage, saveStatus, draftFound } = editor;
  // ★ 2026-09-25：页面只做**哑映射** —— 切段与题号在核心里（纯函数、有测试）。
  const blocks = editorRenderBlocks(content.nodes);

  /**
   * 学习单级的**两档**（逐题留空的题继承的就是它们）—— 传给每张卡片当占位符。
   *
   * ⚠️ 只做**显示**与「部分给分 0 分」那条提示的判据，**绝不**拿它去预填逐题的输入框：
   * 预填等于把「跟随学习单」拍成一份副本，教师之后改这两档时已保存的题不会跟随，
   * 而他看不到任何提示（规格 §12 裁定 4 的理由）。
   *
   * `useMemo` 只是让每张卡片拿到同一个引用（值不变时不造新对象）；
   * ⚠️ 必须在下面那两个提前 return **之前**调用（Hooks 的调用顺序不许跳）。
   */
  const inheritedPoints = useMemo(
    () => ({ full: editor.settings.rewardStep, half: editor.settings.halfStep }),
    [editor.settings.rewardStep, editor.settings.halfStep],
  );

  /**
   * 删题确认（规格 §6.4）。文案里必须含**已收到的作答份数** —— 不说的后果是教师
   * 以为「只是删一道题」，而学生已经写下的答案会变成看板与导出里的孤立数据。
   *
   * ⚠️ `usage.responseCount` 是**整卷**的作答份数（`WorksheetResponse` 行数），
   * 不是「这道题被答了多少次」—— 服务端没有按题统计的字段。所以措辞刻意分开：
   * 一个数字讲整卷，一句话讲这道题的答案会怎样，不能把它们说成同一件事。
   */
  const requestRemove = useCallback(async (node: WorksheetQuestionNode, heading: string) => {
    // 🔴 任务是**一整块**，而它的删除按钮就在任务头行上 —— 与小题的删除按钮只隔几十像素。
    // 说成「确定删除第 1 题吗？」的后果是：教师以为在删一道题，实际删掉了整个任务
    // （在那之前更糟：迁移之后顶层往往只有一个任务，删它 = **清空整份学习单**）。
    const isTask = node.type === TASK_TYPE;
    const count = node.children.length;
    const lines = [
      isTask
        ? (count > 0 ? `确定删除这个任务吗？它里面的 ${count} 道小题会一起删掉。` : '确定删除这个任务吗？')
        : `确定删除第 ${heading} 题吗？`,
    ];
    if (!editor.worksheetId) {
      lines.push(isTask ? '这个任务还没保存过，删掉之后本机草稿里也不会再有它。' : '这道题还没保存过，删掉之后本机草稿里也不会再有它。');
    } else {
      const usageNow = await editor.ensureUsage();
      if (usageNow === null) {
        lines.push(isTask ? '这次没能读到作答情况，无法确认这个任务里有没有学生答过的题。' : '这次没能读到作答情况，无法确认这道题是否已经被学生作答过。');
      } else if (usageNow.responseCount > 0) {
        lines.push(`这份学习单已经收到 ${usageNow.responseCount} 份作答；删除后，学生${isTask ? '在这个任务里' : `在第 ${heading} 题上`}写下的答案会在看板与导出里变成孤立数据。`);
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
          ⚠ {usageHead} · 学生需刷新或重新进入学习单才能看到新内容
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

      {blocks.length === 0 ? (
        <div className="worksheet-editor-empty">
          还没有题目。点下面的「＋ 添加任务」开始。
        </div>
      ) : (
        <div className="worksheet-editor-questions">
          {/*
            ★ 2026-09-25（第二轮终审 F2/F3）：这里**只做哑映射** —— 切段与题号全在
            `editorRenderBlocks`（纯函数、有测试）。判据写进 JSX 就没有回归网（本仓没有前端测试框架）。

            块有两种：任务（`TaskCard` 包着它的小题）与散题（各自成块）。
            散题是老数据 / 手工改过的库才有的形态，仍然画得出来。
          */}
          {blocks.map((block, blockIndex) => {
            const questionCards = block.questions.map((row) => (
              <QuestionCard
                key={row.node.id}
                // 🔴 显示的是**两级题号**（`任务一 · 2`）—— 与看板 / 抽屉 / 导出 / 保存报错同一份。
                // `index` / `total` 只服务 ▲▼ 的边界（换位是**同层内**的）。
                heading={row.heading}
                index={row.index}
                total={row.total}
                node={row.node}
                inheritedPoints={inheritedPoints}
                rejectedPointInput={editor.rejectedPoints[row.node.id]}
                onPromptChange={prompt => editor.updatePrompt(row.node.id, prompt)}
                onDataChange={patch => editor.updateData(row.node.id, patch)}
                onPointsInputChange={input => editor.setPointsInput(row.node.id, input)}
                onPointsChange={points => editor.updatePoints(row.node.id, points)}
                onInputModeChange={inputMode => editor.updateInputMode(row.node.id, inputMode)}
                onMove={delta => editor.moveQuestion(row.node.id, delta)}
                onRemove={() => void requestRemove(row.node, row.heading)}
              />
            ));
            if (!block.task) return questionCards;
            // ⚠️ `key` 挂在**外层数组**上：React 要求 map 的每一项有 key，而散题那一支
            // 返回的是一个数组（每一项自己带 key）。
            return (
              <TaskCard
                key={block.task.node.id}
                index={block.task.index}
                total={block.task.total}
                node={block.task.node}
                onTitleChange={prompt => editor.updatePrompt(block.task!.node.id, prompt)}
                // 描述走 `updateData`（同一个 reducer ⇒ 同样进撤销栈、同样同值去重）。
                onDescriptionChange={description => editor.updateData(block.task!.node.id, { description })}
                onMove={delta => editor.moveQuestion(block.task!.node.id, delta)}
                onRemove={() => void requestRemove(block.task!.node, '')}
                onAddQuestion={() => setPickerFor({ parentId: block.task!.node.id })}
              >
                {questionCards}
              </TaskCard>
            );
          })}
        </div>
      )}

      {/* 页面级只有这一个入口：**添加任务**（§六 第 3 条：入口醒目且分层）。
          「添加小题」在任务内部 —— 两个按钮长得一样就分不出层级了。 */}
      <button type="button" className="worksheet-editor-add" onClick={() => editor.addTask()}>
        ＋ 添加任务
      </button>

      {pickerFor && (
        <AddQuestionPicker
          onPick={questionType => {
            editor.addQuestion(questionType, pickerFor.parentId);
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
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
        {/* ★ 2026-09-25：这句话原来写的是「题目会加到这份学习单的最后」—— 现在**加到
            你点的那个任务里**（`pickerFor.parentId`），▲▼ 也只在**同层内**换位。
            一句说错的帮助文字比没有更糟：教师会按它去找一个不存在的行为。 */}
        <p className="worksheet-editor-dialog-note">题目会加到这个任务的最后，之后可以用每题右上角的 ▲▼ 在任务内调整顺序。</p>
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
 * 「设置」面板（规格 §6.3）。装的是**这一张单**的设置：
 *   · 描述（标题在顶栏直接编 —— 它改得最勤）
 *   · 自动判分（学习单级开关，规格 §3-L）
 *   · 提交后可否修改（`allowResubmit`，规格 §8.4）
 *   · 奖励形式 + **两档**步长（规格 §9.2 与 §12 裁定 3 —— 2026-09-23 用户裁定：奖励是
 *     **学习单级**的，不做全局设置。「这堂课用得分制还是发小花」是这一张单的事。
 *     两档是 M4a 的「全对给几 / 部分给分给几」，它们同时是**逐题留空的题的默认值**，
 *     所以下面那两行必须说清这层关系 —— 见那一段注释）
 * 输入方式**不做 UI**（规格 §3-V，第一批恒为 keyboard），`settings.defaultInputMode`
 * 只是原样带着走，不在这里改。
 *
 * 每一项都写明了**关掉 / 改了之后会怎样**，因为它们的后果都不在教师眼前：
 * 一个让看板失去正确率，一个会让学生的修改请求被服务端拒绝，而奖励形式教师自己
 * **根本看不到**（规格 §3-U：教师端只有对错与正确率，一个星星都不出现）——
 * 所以那一行必须说清「这是给学生看的」。
 */
function SettingsModal({ description, onDescriptionChange, settings, onSettingsChange, onClose }: {
  description: string;
  onDescriptionChange: (value: string) => void;
  settings: WorksheetSettings;
  onSettingsChange: (patch: Partial<WorksheetSettings>) => void;
  onClose: () => void;
}) {
  // 每个形式的符号与量词都从那一份取值域里取（规格 §9.2：星星/花朵论「个/朵」、
  // 分数论「分」、对错没有步长）。这里**不写**任何一档的字面量。
  const currentStyle = REWARD_STYLE_OPTIONS.find(option => option.value === settings.rewardStyle)
    ?? REWARD_STYLE_OPTIONS[0];

  // ★ M7b：分析型智能体的候选。**在模态挂载时按需取**（`{settingsOpen && <SettingsModal/>}`
  // ⇒ 挂载 = 打开）—— 这个列表只有打开设置才用得上，跟着页面一起取是白取。
  // ⚠️ 取失败**不阻断**：下拉退回只剩「（不指定）」那一项，教师仍能编辑别的设置。
  // 与「学习单列表加载失败不阻断创建」那条既有判断同形（`classroom/new/page.tsx`）。
  const [analysisAgents, setAnalysisAgents] = useState<AgentSummary[]>([]);
  useEffect(() => {
    let alive = true;
    api.getAgents('analysis')
      .then(list => { if (alive) setAnalysisAgents(list); })
      .catch(() => { if (alive) setAnalysisAgents([]); });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="worksheet-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="worksheet-settings-title" style={{ width: 480 }}>
        <h3 id="worksheet-settings-title">学习单设置</h3>
        <p className="worksheet-editor-dialog-note">标题在顶栏直接改。这里的每一项都要按「保存」才会生效。</p>

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

        {/* ★ M7b：分析型智能体（学习单级 —— 用户 2026-09-25 裁定 4）。
            🔴 候选只列 `purpose === 'analysis'` 的，而且**由服务端过滤**（`?purpose=analysis`）。
            🔴 **默认是「不指定」**：默认指定一个等于「默认把全班作业发给第三方 AI」。
            🔴 平台提示必须**在配的时候就**看到 —— 否则教师会在用的那一刻才发现绘图题发不出去。 */}
        <label className="worksheet-editor-field">
          <span>分析型智能体（用于看板里的「发给 AI 分析」）</span>
          <select
            className="input"
            value={settings.analysisAgentId ?? ''}
            onChange={event => onSettingsChange({ analysisAgentId: event.target.value || null })}
          >
            <option value="">（不指定 —— 分析按钮不可用）</option>
            {analysisAgents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}（{agent.platform}）</option>
            ))}
          </select>
          <em style={{ display: 'block', marginTop: 4, fontSize: '0.78rem', color: '#64748b' }}>
            没配到候选？去「智能体管理」新建一个、或把某个的**用途**改成「分析」。
            ⚠️ 本版的分析**只接了 Coze 平台**（绘图题更是只有它收得了图）。
          </em>
        </label>

        {/* 奖励形式（规格 §9.2）。🔴 它是**这一张单**的配置，不是全局设置 ——
            用户 2026-09-23 的裁定：「教师在编辑学习单时可以选择得分制还是奖励小花、五角星」。
            放在「自动判分」下面也是刻意的：关掉自动判分就没有判分，也就没有奖励
            （规格 §9.3），两行挨着才看得出这层依赖。 */}
        {/* `fieldset` + `legend` 而不是「一段标签 + 四个按钮」：这是一组单选，读屏要能
            念出「奖励形式」这个组名。四个选项各自是 `label`，所以点文字也能选中。 */}
        <fieldset className="worksheet-editor-reward">
          <legend className="worksheet-editor-reward-legend">奖励形式</legend>
          <div className="worksheet-editor-reward-options">
            {REWARD_STYLE_OPTIONS.map(option => (
              <label key={option.value} className="worksheet-editor-reward-option">
                <input
                  type="radio"
                  name="worksheet-reward-style"
                  checked={settings.rewardStyle === option.value}
                  onChange={() => onSettingsChange({ rewardStyle: option.value })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <em className="worksheet-editor-switch-note">{currentStyle.hint}</em>
        </fieldset>

        {/* 步长**两行**：选了「对错」时**两行都不出现** —— 对错档没有步长（规格 §9.2 的原话）。
            ★ M4a（C3）补的是第二行（部分给分档）。在它之前，学习单级的部分给分档在服务端与内核里
            都通了、却**没有 UI** ⇒ 它只能是默认值 0 ⇒ 逐题留空的题一律「部分给分 0 分」，
            而 `shouldWarnZeroHalfCredit`（规格 §12 裁定 3 的连带要求）**到处都会响** ——
            教师只要在多选卡上选一次「漏选算部分给分」，`effectiveHalfStep` 就是那个恒为 0 的
            学习单级档 ⇒ 提示条一概弹出来，**信号被稀释成噪音**（一张卡一句，说的都是同一件
            他没做过的事）。补上这一行之后它才回到本意：只在部分给分档**实际为 0** 时才响
            —— ⚠️ **不是**「只在教师真的把部分给分配成 0 时才响」：新建学习单的 `halfStep`
            默认就是 0，而下面那两行的注释自己写着「它恰好是新单的默认值」。加一道多选、
            选「漏选算部分给分」、部分给分留空 ⇒ 提示照样出现（判据是「这题**实际用到**的部分给分档」，
            见 `effectiveHalfStep`）。
            （判据是 `shouldWarnZeroHalfCredit(multi, { full: 1, half: 0 }) === true`，
            `worksheet-editor-core.test.ts` 里那条用例在 `a4b1a11` 就已存在。）
            两行放在一起也是刻意的：它们是**同一件事的两个数**，
            拆开摆会让人以为部分给分档与奖励形式无关。

            ⚠️ 两个下拉的选项来自同一个文件的**两个不同数组**：`REWARD_STEPS`（1/2/3/5）与
            `HALF_STEPS`（**多一个 0**）。这里不许写任何字面量 —— 写成两处硬编码的
            `[1,2,3,5]` 就会把「部分给分 0」这个合法档从界面上抹掉，而它恰好是新单的默认值。 */}
        {settings.rewardStyle === 'correctness' ? null : (
          <>
            <label className="worksheet-editor-field">
              <span>每答对一题得几{currentStyle.unit}</span>
              <select
                className="input"
                value={settings.rewardStep}
                onChange={event => onSettingsChange({ rewardStep: Number(event.target.value) })}
              >
                {REWARD_STEPS.map(step => <option key={step} value={step}>{step}</option>)}
              </select>
            </label>

            <label className="worksheet-editor-field">
              {/* ⚠️ 与上一行「每答对一题得几」**句式对称**：改写时两行一起看，
                  别让一行成了「每 X 一题得几」、另一行成了别的话。 */}
              <span>每答对一部分得几{currentStyle.unit}</span>
              <select
                className="input"
                value={settings.halfStep}
                onChange={event => onSettingsChange({ halfStep: Number(event.target.value) })}
              >
                {HALF_STEPS.map(step => <option key={step} value={step}>{step}</option>)}
              </select>
            </label>

            {/* 这两行与**逐题**那两个数不是同一件事（规格 §12 裁定 4）：学习单级是
                「默认值 + 兜底」，逐题留空的题才用它。这句话不能省 —— 不说，教师会以为
                改这里能改全班已经逐题填过的题，**而它不会**（那些题甚至不会重新保存）。
                「0」那句同理：部分给分填 0 是一个合法的选择（不给部分分），但它在屏幕上
                与「忘了配」长得一样，所以要说清它是**什么意思**。 */}
            <em className="worksheet-editor-switch-note">
              这两档是<b>默认值</b>：只有逐题<b>留空</b>的题用它们。题干上自己填过「全对 / 部分给分」的题按它自己的数，改这里不会动它。
              部分给分档填 0 = 这一单不给部分分（答对才算全对）。
            </em>
          </>
        )}

        <p className="worksheet-editor-dialog-note" style={{ margin: '12px 0 16px' }}>
          奖励只在<b>学生端</b>显示（每道题旁边 + 顶栏累计）。教师看板、抽屉与「按题看」始终是对错与正确率，不会出现星星。
          关掉自动判分之后没有判分，也就没有奖励；主观题不判分，同样没有奖励。
        </p>

        <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
      </div>
    </>
  );
}
