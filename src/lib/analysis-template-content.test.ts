import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analysisTemplateParts } from './analysis-template-content.ts';
const text = fs.readFileSync(new URL('../../public/prompt-templates/analysis/primary-math.md', import.meta.url), 'utf8');
test('页面能区分可优化与固定内容，复制正文不包含教师编辑说明且不丢规则', () => {
  const parts = analysisTemplateParts(text);
  assert.match(parts.editable, /# 角色：小学数学/);
  assert.match(parts.fixed, /## 工作流：/);
  assert.match(parts.fixed, /## 限制：/);
  assert.match(parts.fixed, /默认显示人数、悬停显示姓名/);
  assert.doesNotMatch(parts.prompt, /可优化区|固定区|以下规则用于/);
  assert.match(parts.prompt, /student.*姓名#学号/);
});
test('无分区的旧模板保持原文，不会错误截断', () => {
  assert.equal(analysisTemplateParts('# 角色：旧模板\n## 限制：原有规则').prompt, '# 角色：旧模板\n## 限制：原有规则');
});
