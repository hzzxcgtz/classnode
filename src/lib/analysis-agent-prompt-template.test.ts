import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_AGENT_PROMPT_TEMPLATE } from './analysis-agent-prompt-template.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COZE_TEMPLATE = fs.readFileSync(path.resolve(HERE, '..', '..', 'docs', 'Coze学习单小题分析智能体提示词.md'), 'utf8');

test('分析智能体模板采用最新姓名学号、评分与初始图口径', () => {
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /姓名#学号/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /逐字照抄完整标签/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /无法可靠判断时返回 null/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /名单外学生不得进入评分结果/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /初始图不是学生成果/);
  assert.ok(!ANALYSIS_AGENT_PROMPT_TEMPLATE.includes('User_001'), '模板仍在使用过期的匿名学生代号');
});

test('分析智能体模板保持清晰的四段结构，运行期协议不重复硬编码', () => {
  for (const heading of ['## 输入约定', '## 分析任务', '## AI 评分', '## 边界']) {
    assert.ok(ANALYSIS_AGENT_PROMPT_TEMPLATE.includes(heading), `缺少结构：${heading}`);
  }
  assert.ok(!ANALYSIS_AGENT_PROMPT_TEMPLATE.includes('<classnode-scores>'), '动态机器协议不应重复写死在教师模板里');
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /写给同学们的话/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /不点名、不排名/);
});

test('Coze 教师模板已同步最新姓名学号与评分协议，并保留 12 个学科模块', () => {
  assert.match(COZE_TEMPLATE, /Worksheet Analysis Prompts v3\.0\.0/);
  assert.match(COZE_TEMPLATE, /学生标签采用“姓名#学号”/);
  assert.match(COZE_TEMPLATE, /只评价本次消息明确点名的可评分学生/);
  assert.match(COZE_TEMPLATE, /教师提供的初始图不是学生成果/);
  assert.match(COZE_TEMPLATE, /七、学科模块粘贴区/);
  assert.match(COZE_TEMPLATE, /将本文后面选定的一个“学科模块”完整粘贴到这里/);
  assert.match(COZE_TEMPLATE, /### 写给同学们的话/);
  assert.ok(!COZE_TEMPLATE.includes('v2.2.0'), 'Coze 模板仍残留旧版本号');
  assert.ok(!COZE_TEMPLATE.includes('逐一评价每个已提交作答的学生'), 'Coze 模板仍要求给不可评分作答猜分');
  assert.equal((COZE_TEMPLATE.match(/^### 版本 \d+：/gm) ?? []).length, 12, '全学科的 12 个模块不完整');
});
