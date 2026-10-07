'use client';

import { api } from './api';
import type { WorksheetAnalysisPayload } from './types';

export const WORKSHEET_ANALYSIS_NOTICE_EVENT = 'classnode:worksheet-analysis-notice';

export interface WorksheetAnalysisNotice {
  type: 'success' | 'error';
  message: string;
  classroomId: string;
  worksheetId: string;
  questionId: string;
}

type AnalysisResult = {
  narrative: string;
  perStudent: WorksheetAnalysisPayload['perStudent'];
  agentId: string;
  model: string;
};
export type BackgroundAnalysisStage = 'preparing' | 'sending' | 'analyzing' | 'finalizing';

export interface BackgroundAnalysisTask {
  key: string;
  startedAt: number;
  stage: BackgroundAnalysisStage;
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
  classroomId: string;
  worksheetId: string;
  questionId: string;
  questionLabel: string;
}): BackgroundAnalysisTask {
  const { classroomId, worksheetId, questionId, questionLabel } = input;
  const key = taskKey(classroomId, worksheetId, questionId);
  const existing = tasks.get(key);
  if (existing) return existing;

  const task = {
    key,
    startedAt: Date.now(),
    stage: 'preparing' as BackgroundAnalysisStage,
    promise: null as unknown as Promise<AnalysisResult>,
  };
  const promise = api.computeWorksheetAnalysis(classroomId, worksheetId, questionId)
    .then((payload) => {
      if (!payload.canSend.ok) throw new Error(payload.canSend.reason);
      task.stage = 'sending';
      window.setTimeout(() => {
        if (tasks.get(key) === task && task.stage === 'sending') task.stage = 'analyzing';
      }, 900);
      return api.runWorksheetAnalysis(classroomId, worksheetId, questionId, input.only);
    })
    .then(async (result) => {
      task.stage = 'finalizing';
      // 给“正在保存结果”一个可见但很短的阶段；结果已经由服务端落库，这里只等待界面呈现。
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      announce({
        type: 'success', classroomId, worksheetId, questionId,
        message: `${questionLabel || '本题'}的 AI 分析已完成并自动保存`,
      });
      completed.add(key);
      return result;
    })
    .catch((error: unknown) => {
      announce({
        type: 'error', classroomId, worksheetId, questionId,
        message: `${questionLabel || '本题'}的 AI 分析失败：${error instanceof Error ? error.message : '请求异常'}`,
      });
      throw error;
    })
    .finally(() => {
      if (tasks.get(key) === task) tasks.delete(key);
    });
  task.promise = promise;
  tasks.set(key, task);
  return task;
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
