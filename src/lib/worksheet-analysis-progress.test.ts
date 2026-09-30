import test from 'node:test';
import assert from 'node:assert/strict';
import { worksheetAnalysisProgressLabel } from './worksheet-analysis-progress.ts';

test('分析按钮依次说明整理、发送、分析与保存四个真实阶段', () => {
  assert.equal(worksheetAnalysisProgressLabel('preparing', 0), '整理数据…');
  assert.equal(worksheetAnalysisProgressLabel('sending', 1), '正在发送…');
  assert.equal(worksheetAnalysisProgressLabel('analyzing', 8), 'AI 分析中 8s');
  assert.equal(worksheetAnalysisProgressLabel('finalizing', 9), '保存结果…');
});

test('分析耗时只显示非负整数', () => {
  assert.equal(worksheetAnalysisProgressLabel('analyzing', -3), 'AI 分析中 0s');
  assert.equal(worksheetAnalysisProgressLabel('analyzing', 2.9), 'AI 分析中 2s');
});
