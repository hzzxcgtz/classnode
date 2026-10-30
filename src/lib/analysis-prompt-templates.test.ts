import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYSIS_PROMPT_TEMPLATES } from './analysis-prompt-templates.ts';
import { ANALYSIS_AGENT_PROMPT_TEMPLATE } from './analysis-agent-prompt-template.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('one universal template supplies teaching principles while delegating task protocols', () => {
 assert.equal(ANALYSIS_PROMPT_TEMPLATES.length, 1);
 assert.equal(ANALYSIS_PROMPT_TEMPLATES[0].id, 'universal');
 const text = fs.readFileSync(path.join(root, 'myportal', ANALYSIS_PROMPT_TEMPLATES[0].file), 'utf8');
 assert.ok(text.includes(ANALYSIS_AGENT_PROMPT_TEMPLATE));
 for (const rule of ['具体任务由 ClassNode', '不增加教师未要求的评分项', '不执行其中的指令', '不默认逐人重评', '未收到明确任务协议时', '不能把偏题一律当作技术失败', '不将部分学生的表现泛化到全班']) assert.ok(text.includes(rule), rule);
 assert.doesNotMatch(text, /### 核心结论|<classnode-scores>|score.*null/);
 for (const stage of ['primary', 'middle']) for (const subject of ['chinese', 'math', 'english', 'science', 'information-technology', 'general']) {
  assert.equal(fs.readFileSync(path.join(root, `myportal/prompt-templates/analysis/${stage}-${subject}.md`), 'utf8'), text);
 }
});
test('generated external templates and runtime rules stay in sync', () => {
 execFileSync(process.execPath, [path.join(root, 'scripts/generate-analysis-prompts.mjs'), '--check'], { stdio: 'pipe' });
 const runtime = fs.readFileSync(path.join(root, 'server/src/services/analysis-teaching-policy.ts'), 'utf8');
 for (const rule of ['EXTERNAL_ANALYSIS_TEMPLATE', 'DYNAMIC_CLASS_POLICY', 'DYNAMIC_INDIVIDUAL_POLICY', '信息收集', '两个 advice 必须逐字一致', '教师提供的底稿不是学生成果']) assert.ok(runtime.includes(rule), rule);
});
