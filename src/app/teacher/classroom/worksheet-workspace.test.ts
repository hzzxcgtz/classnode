import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('./matrix-overlay.tsx', import.meta.url), 'utf8');
const questionStats = readFileSync(new URL('./question-stats-overlay.tsx', import.meta.url), 'utf8');
const questionStatsStyles = readFileSync(new URL('./question-stats-overlay.module.css', import.meta.url), 'utf8');

test('顶部学习单菜单挂完整工作区，学生卡片挂单人抽屉', () => {
  assert.match(page, /worksheetWorkspace && \(\s*<MatrixOverlay/);
  assert.match(page, /worksheetDrawer && \(\s*<WorksheetDrawer/);
  assert.match(page, /openWorksheetParticipantDrawer\(cs\.id\)/);
  assert.match(page, /item === 'overview'[^\n]*openWorksheetWorkspace\(\{ view: 'overview' \}\)/);
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

test('按题目查看采用常驻题目导航与右侧详情，不再先开题目列表再进入详情页', () => {
  assert.match(workspace, /questionSplit/);
  assert.match(workspace, /questionSidebar/);
  assert.match(workspace, /questionDetailPanel/);
  assert.match(workspace, /questionOptions\.filter/);
  assert.match(workspace, /options\.map/);
  assert.doesNotMatch(workspace, /<QuestionList/);
});

test('按题详情不再提供看某人的作答下拉入口', () => {
  assert.doesNotMatch(questionStats, /看某人的作答/);
  assert.doesNotMatch(questionStats, /pickedId/);
});

test('按题详情使用紧凑摘要和等高双栏', () => {
  assert.match(questionStats, /<VerdictDonut[\s\S]*?size=\{80\}[\s\S]*?centerFontSize="1\.08rem"/);
  assert.match(questionStatsStyles, /\.metric div \{[^}]*font-size: 1\.38rem/);
  assert.match(questionStatsStyles, /\.insightGrid \{[\s\S]*?align-items: stretch/);
  assert.match(questionStatsStyles, /\.insightGrid > \.section \{[\s\S]*?height: 100%/);
});

test('打开学习单界面只压入一层浏览器历史，返回按钮关闭工作区或单人抽屉', () => {
  assert.match(page, /window\.history\.pushState\(\{ \.\.\.base, classnodeWorksheetWorkspace: token \}/);
  assert.match(page, /window\.addEventListener\('popstate', handlePopState\)/);
  assert.match(page, /if \(worksheetWorkspaceHistoryTokenRef\.current === null\) return;[\s\S]*?setWorksheetWorkspace\(null\);[\s\S]*?setWorksheetDrawer\(null\)/);
});

test('Escape 与关闭按钮共用同一个返回课堂动作', () => {
  assert.match(page, /if \(!worksheetWorkspace && !worksheetDrawer\) return;[\s\S]*?if \(event\.key !== 'Escape'\) return;[\s\S]*?closeWorksheetLayer\(\)/);
  assert.match(page, /<WorksheetDrawer[\s\S]*?onClose=\{closeWorksheetLayer\}/);
  assert.match(page, /<MatrixOverlay[\s\S]*?onClose=\{closeWorksheetLayer\}/);
});
