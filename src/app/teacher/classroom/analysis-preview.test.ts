/**
 * ★ M7b：**「本次将发什么」那几行** —— 用户裁定 3 的实现。
 *
 * 🔴 它是**承重的**：教师据此决定发不发（而发出去的是学生的作业）。所以它值得一个
 * 纯模块 + 用例，而不是散在 JSX 里 —— 本仓没有 jsdom ⇒ 散进 JSX 的判据**没有任何回归网**。
 *
 * ⚠️ 量词走调用方算好的 `unit`（= `moduleCountUnit(mode)`）：分组 / 高级模式下参与者是**组**。
 * 本项目在「N 人 vs N 组」上被咬过两次（M5a 与 M6c）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisPreviewLines, type AnalysisSendable } from './analysis-preview.ts';

const sendable = (over: Partial<AnalysisSendable> = {}): AnalysisSendable => ({
  covered: 12, total: 40, payloadKind: 'text',
  sheetCount: 0, columns: 3, cellWidth: 320, cellHeight: 240,
  ...over,
});

test('★ 抬头三行：发给谁 · 是什么内容 · 已交 N/M（含量词）', () => {
  const lines = analysisPreviewLines({ agentName: '分析助手', platform: 'coze', sendable: sendable(), unit: '人' });
  assert.equal(lines[0], '发给：分析助手（coze）');
  assert.equal(lines[1], '本次内容：一份聚合文档（全部是文字作答）');
  assert.equal(lines[2], '已交 12/40 人');
});

test('🔴 量词跟着 unit 走 —— 分组模式下必须是「组」', () => {
  const lines = analysisPreviewLines({ agentName: 'a', platform: 'coze', sendable: sendable(), unit: '组' });
  assert.equal(lines[2], '已交 12/40 组');
  assert.ok(!lines.join('').includes('人'), '不许在任何一行里写死「人」');
});

test('🔴 必须明说「均为代号」与「平台会留存」—— 这两句是知情同意的实质', () => {
  const text = analysisPreviewLines({ agentName: 'a', platform: 'coze', sendable: sendable(), unit: '人' }).join('\n');
  assert.match(text, /代号/, '要说明内容里是代号而不是真名');
  assert.match(text, /留存/, '要说明第三方平台会留存这次对话');
});

test('绘图题说清是几张什么形状的图（不报字节 —— 那要先把图渲一遍）', () => {
  const lines = analysisPreviewLines({
    agentName: 'a', platform: 'coze', unit: '人',
    sendable: sendable({ payloadKind: 'image', sheetCount: 4, covered: 40, total: 40 }),
  });
  assert.match(lines[1], /4 张联系表/);
  assert.match(lines[1], /3 列/);
  assert.match(lines[1], /320×240/);
  assert.ok(!lines.join('').includes('字节'), '不报字节数（渲一遍才报得出来，不划算）');
});

test('🔴 mixed 要额外说「两样都会发出去」（教师最容易只想到文档）', () => {
  const text = analysisPreviewLines({
    agentName: 'a', platform: 'coze', unit: '人', sendable: sendable({ payloadKind: 'mixed', sheetCount: 2 }),
  }).join('\n');
  assert.match(text, /两样都会发出去/);
});

test('🔴 不能发时，服务端那句话要**逐字**出现在预览里（界面据此禁用按钮）', () => {
  const text = analysisPreviewLines({
    agentName: 'a', platform: 'wenxin', unit: '人',
    sendable: sendable({ payloadKind: 'image', sheetCount: 3 }),
    blockedReason: '当前平台的智能体（wenxin）**收不了图** —— 请改用一个 **Coze** 平台的分析型智能体。',
  }).join('\n');
  assert.match(text, /收不了图/);
  assert.match(text, /Coze/);
});

test('平台会留存那一句**始终**在（不能因为不能发就省掉它）', () => {
  const lines = analysisPreviewLines({
    agentName: 'a', platform: 'coze', unit: '人', sendable: sendable(),
    blockedReason: '这道题还没有已提交的作答',
  });
  assert.ok(lines.some((l) => /留存/.test(l)), '不能发时它仍然要在 —— 教师迟早会发别的题');
});
