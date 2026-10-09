import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./matrix-overlay.tsx', import.meta.url), 'utf8');

test('学习单查看只挂一层工作区，不再由课堂页叠矩阵、抽屉、题目统计和 AI 浮层', () => {
  assert.match(page, /worksheetWorkspace && \(\s*<MatrixOverlay/);
  assert.doesNotMatch(page, /<WorksheetDrawer/);
  assert.doesNotMatch(page, /<QuestionStatsOverlay/);
  assert.doesNotMatch(page, /<AnalysisOverlay/);
});

test('统一工作区提供总览、按学生、按题目三个平级视图', () => {
  assert.match(workspace, /\['overview', '学习单总览'\]/);
  assert.match(workspace, /\['student', '按学生查看'\]/);
  assert.match(workspace, /\['question', '按题目查看'\]/);
});

test('矩阵以参与者为行、题目为列，并让交叉格直达对应学生与题目', () => {
  const participantRows = workspace.indexOf('participants.map((participant) => {');
  const questionCells = workspace.indexOf('visibleRows.map((row) => {', participantRows);
  assert.ok(participantRows >= 0 && questionCells > participantRows);
  assert.match(workspace, /onOpenParticipant\(participant\.participantId, row\.questionId\)/);
});

test('题目统计和 AI 分析以内嵌模式呈现，不再产生第二层业务浮窗', () => {
  assert.match(workspace, /<QuestionStatsOverlay[\s\S]*?embedded/);
  assert.match(workspace, /<AnalysisOverlay[\s\S]*?embedded/);
});
