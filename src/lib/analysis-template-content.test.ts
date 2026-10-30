import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analysisTemplateParts } from './analysis-template-content.ts';
const text = fs.readFileSync(new URL('../../myportal/prompt-templates/analysis/universal.md', import.meta.url), 'utf8');
test('精简模板完整复制，不依赖旧的固定区和工作流栏目', () => {
 const parts=analysisTemplateParts(text);assert.equal(parts.prompt,text);assert.match(parts.prompt,/# 角色：通用教育评价/);assert.match(parts.prompt,/具体任务由 ClassNode/);assert.doesNotMatch(parts.prompt,/## 工作流|固定区/);
});
test('无分区的旧模板保持原文，不会错误截断', () => {
  assert.equal(analysisTemplateParts('# 角色：旧模板\n## 限制：原有规则').prompt, '# 角色：旧模板\n## 限制：原有规则');
});

test('旧分区模板仍可提取角色和固定规则，不丢兼容内容',()=>{
 const old='# 角色：旧模板\n说明\n---\n# 固定区：教师不应修改\n说明\n## 工作流：\n旧规则\n## 限制：\n不猜测';
 const parts=analysisTemplateParts(old);assert.match(parts.editable,/# 角色：旧模板/);assert.match(parts.fixed,/旧规则/);assert.doesNotMatch(parts.prompt,/固定区：/);
});
