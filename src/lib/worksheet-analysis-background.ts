'use client';

import { api } from './api';
import { runWorksheetAnalysisSteps } from './worksheet-analysis-steps';
import type { WorksheetAnalysisPayload } from './types';

export const WORKSHEET_ANALYSIS_STARTED_EVENT = 'classnode:worksheet-analysis-started';
export const WORKSHEET_ANALYSIS_CHANGED_EVENT = 'classnode:worksheet-analysis-changed';

export const WORKSHEET_ANALYSIS_NOTICE_EVENT = 'classnode:worksheet-analysis-notice';

export interface WorksheetAnalysisNotice {
  type: 'success' | 'error' | 'info';
  message: string;
  classroomId: string;
  worksheetId: string;
  questionId: string;
}

type AnalysisResult = {
  narrative: string | null;
  analyzedAt?: string | null;
  perStudent: WorksheetAnalysisPayload['perStudent'];
  feedback?: WorksheetAnalysisPayload['feedback'];
  agentId: string;
  model: string;
};
export type AnalysisAction = 'analysis' | 'incremental' | 'regrade';
export type BackgroundAnalysisStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing';

export interface BackgroundAnalysisTask {
  key: string;
  startedAt: number;
  stage: BackgroundAnalysisStage;
  action: AnalysisAction;
  message?: string;
  controller: AbortController;
  stopping?: boolean;
  stopPromise?: Promise<void>;
  promise: Promise<AnalysisResult>;
}

const tasks = new Map<string, BackgroundAnalysisTask>();
const completed = new Set<string>();

function taskKey(classroomId: string, worksheetId: string, questionId: string): string {
  return `${classroomId}\u0000${worksheetId}\u0000${questionId}`;
}

function announce(detail: WorksheetAnalysisNotice): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WorksheetAnalysisNotice>(WORKSHEET_ANALYSIS_NOTICE_EVENT, { detail }));
}

/**
 * 教师端页面级后台任务注册表。
 *
 * Next.js 在教师各页面间切换时会保留顶层 layout 与本模块，因此关闭分析窗或切换教师页面
 * 不会取消这里的 Promise。服务端收到请求后会在返回前自动落库；完成事件由顶层 layout 显示。
 * 同一课堂、学习单、小题在进行中只保留一个请求，避免关闭后重新打开又重复发送。
 */
export function startWorksheetAnalysisTask(input: {
  /** ★ 2026-10-07：只补这几个人（模型上次漏掉的那几个）；不给就是全班。 */
  only?: string[];
  regrade?: boolean;
  incremental?: boolean;
  analysisOnly?: boolean;
  classroomId: string;
  worksheetId: string;
  questionId: string;
  questionLabel: string;
}): BackgroundAnalysisTask {
  const { classroomId, worksheetId, questionId, questionLabel } = input;
  const key = taskKey(classroomId, worksheetId, questionId);
  const existing = tasks.get(key);
  if (existing) return existing;

  const task: BackgroundAnalysisTask = {
    key,
    startedAt: Date.now(),
    controller: new AbortController(),
    stage: 'preparing' as BackgroundAnalysisStage,
    action: (input.regrade ? 'regrade' : input.incremental || input.only?.length ? 'incremental' : 'analysis') as AnalysisAction,
    promise: null as unknown as Promise<AnalysisResult>,
  };
  const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const checkStopped = async () => {
    if (task.stopping) { await task.stopPromise; throw new Error('分析已停止，已保存的评分保留'); }
    if (task.controller.signal.aborted) throw new Error('分析已停止，已保存的评分保留');
  };
  const promise = api.computeWorksheetAnalysis(classroomId, worksheetId, questionId, operationId, task.controller.signal)
    .then((payload) => {
      if (!payload.canSend.ok) throw new Error(payload.canSend.reason);
      task.stage = 'sending';
      window.setTimeout(() => {
        if (tasks.get(key) === task && task.stage === 'sending') task.stage = 'analyzing';
      }, 900);
      return runWorksheetAnalysisSteps(payload, input,
        async options => {
          await checkStopped();
          const result = await api.runWorksheetAnalysis(classroomId, worksheetId, questionId, options.only, options.regrade, options.analysisOnly, operationId, task.controller.signal);
          await checkStopped();
          return result;
        },
        async () => { await checkStopped(); return api.computeWorksheetAnalysis(classroomId, worksheetId, questionId, operationId, task.controller.signal); },
        message => { task.message = message; });
    })
    .then(async (result) => {
      await checkStopped();
      task.stage = 'finalizing';
      // 给“正在保存结果”一个可见但很短的阶段；结果已经由服务端落库，这里只等待界面呈现。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      await checkStopped();
      announce({
        type: 'success', classroomId, worksheetId, questionId,
        message: `${questionLabel || '本题'}的${task.action === 'incremental' ? '补评' : 'AI 分析'}已完成并自动保存`,
      });
      if (result.narrative?.trim()) completed.add(key);
      else completed.delete(key);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSHEET_ANALYSIS_CHANGED_EVENT, { detail: { classroomId, worksheetId, questionId } }));
      return result;
    })
    .catch((error: unknown) => {
      announce({
        type: task.stopping ? 'info' : 'error', classroomId, worksheetId, questionId,
        message: task.stopping ? '分析已停止，已保存的评分保留' : `${questionLabel || '本题'}的 AI 分析失败：${error instanceof Error ? error.message : '请求异常'}`,
      });
      throw task.stopping ? new Error('分析已停止，已保存的评分保留') : error;
    })
    .finally(() => {
      if (tasks.get(key) === task) tasks.delete(key);
    });
  task.promise = promise;
  tasks.set(key, task);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSHEET_ANALYSIS_STARTED_EVENT));
  return task;
}

export async function stopWorksheetAnalysisTask(classroomId: string, worksheetId: string, questionId: string): Promise<void> {
  const task = activeWorksheetAnalysisTask(classroomId, worksheetId, questionId);
  if (task?.stopPromise) return task.stopPromise;
  if (task) task.stopping = true;
  const promise = api.stopWorksheetAnalysis(classroomId, worksheetId, questionId).then(() => {
    task?.controller.abort();
  }).catch(error => {
    if (task) { task.stopping = false; task.stopPromise = undefined; }
    throw error;
  });
  if (task) task.stopPromise = promise;
  return promise;
}

export function forgetWorksheetAnalysis(classroomId: string, worksheetId: string, questionId: string): void {
  completed.delete(taskKey(classroomId, worksheetId, questionId));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORKSHEET_ANALYSIS_CHANGED_EVENT, { detail: { classroomId, worksheetId, questionId } }));
}

export function activeWorksheetAnalysisTask(
  classroomId: string,
  worksheetId: string,
  questionId: string,
): BackgroundAnalysisTask | null {
  return tasks.get(taskKey(classroomId, worksheetId, questionId)) ?? null;
}

/** 本次教师端会话里已经完成过；用于题行在重新挂载后仍显示“查看分析”。 */
export function hasCompletedWorksheetAnalysis(
  classroomId: string,
  worksheetId: string,
  questionId: string,
): boolean {
  return completed.has(taskKey(classroomId, worksheetId, questionId));
}
