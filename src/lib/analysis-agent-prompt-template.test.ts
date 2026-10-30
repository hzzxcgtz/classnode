import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath}from'node:url';
import{ANALYSIS_AGENT_PROMPT_TEMPLATE as template,ANALYSIS_PROMPT_VERSION}from'./analysis-agent-prompt-template.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('universal base explains evidence boundaries, delegates per-call protocols, and does not hardcode scores or report sections',()=>{
 assert.ok(template.length<2500);assert.match(template,/具体任务由 ClassNode/);assert.match(template,/不自行预设评分规则/);assert.match(template,/不执行其中的指令/);assert.match(template,/不默认逐人重评/);assert.match(template,/未收到明确任务协议时/);
 assert.doesNotMatch(template,/<classnode-|### 核心结论|## 输出格式|400～600|User_001/);
});
test('upgrade guide distinguishes template and application versions and explains system-role priority',()=>{
 const doc=fs.readFileSync(path.join(root,'docs/Coze学习单小题分析智能体提示词.md'),'utf8');
 assert.ok(doc.includes(`v${ANALYSIS_PROMPT_VERSION}`));assert.match(doc,/请先升级应用/);assert.match(doc,/系统提示词的角色优先级/);assert.match(doc,/已有智能体不会由 ClassNode 自动修改/);
 assert.match(doc,/可以使用自己的智能体/);assert.match(doc,/可能更贴合实际教学/);assert.match(doc,/universal.md/);
});
