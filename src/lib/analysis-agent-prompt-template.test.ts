import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_AGENT_PROMPT_TEMPLATE, ANALYSIS_PROMPT_VERSION } from './analysis-agent-prompt-template.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COZE_TEMPLATE = fs.readFileSync(path.resolve(HERE, '..', '..', 'docs', 'Coze学习单小题分析智能体提示词.md'), 'utf8');

test('分析智能体模板采用最新姓名学号、评分与初始图口径', () => {
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /姓名#学号/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /逐字复制本次/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /缺少可靠依据时不猜分/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /不增加名单外学生/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /初始图不是学生成果/);
  assert.ok(!ANALYSIS_AGENT_PROMPT_TEMPLATE.includes('User_001'), '模板仍在使用过期的匿名学生代号');
});

test('分析智能体模板区分通用建议与条件评分，明确输出协议', () => {
  for (const heading of ['# 角色：', '## 目标：', '## 技能：', '## 工作流：', '## 输出格式：', '## 限制：']) {
    assert.ok(ANALYSIS_AGENT_PROMPT_TEMPLATE.includes(heading), `缺少结构：${heading}`);
  }
  assert.ok(!ANALYSIS_AGENT_PROMPT_TEMPLATE.includes('<classnode-scores>'), '动态机器协议不应重复写死在教师模板里');
  assert.doesNotMatch(ANALYSIS_AGENT_PROMPT_TEMPLATE, /写给同学们的话|可优化区|固定区/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /逐生建议与评分开关无关/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /两个 advice 必须逐字一致/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /系统未提供机器反馈协议时/);
  assert.match(ANALYSIS_AGENT_PROMPT_TEMPLATE, /不批评、不排名、不贴标签/);
});

test('Coze 文档提供通用模板与 12 份完整学科模板入口', () => {
  assert.ok(COZE_TEMPLATE.includes(`Worksheet Analysis Prompts v${ANALYSIS_PROMPT_VERSION}`));
  assert.match(COZE_TEMPLATE, /学生标签采用“姓名#学号”/);
  assert.match(COZE_TEMPLATE, /列入可评分名单/);
  assert.match(COZE_TEMPLATE, /教师提供的初始图不是学生成果/);
  assert.match(COZE_TEMPLATE, /基础模板可直接使用，无需指定年级/);
  assert.doesNotMatch(COZE_TEMPLATE, /写给同学们的话|配置时必须替换/);
  assert.ok(!COZE_TEMPLATE.includes('v2.2.0'), 'Coze 模板仍残留旧版本号');
  assert.ok(!COZE_TEMPLATE.includes('逐一评价每个已提交作答的学生'), 'Coze 模板仍要求给不可评分作答猜分');
  assert.equal((COZE_TEMPLATE.match(/\.\.\/public\/prompt-templates\/analysis\//g) ?? []).length, 12, '全学科的 12 个完整模板入口不完整');
});
