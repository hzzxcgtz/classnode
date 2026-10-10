import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYSIS_PROMPT_TEMPLATES, ANALYSIS_TEMPLATE_STAGES, ANALYSIS_TEMPLATE_SUBJECTS } from './analysis-prompt-templates.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('each school stage and subject has one complete standalone Markdown prompt', () => {
  assert.equal(ANALYSIS_PROMPT_TEMPLATES.length, 12);
  assert.equal(new Set(ANALYSIS_PROMPT_TEMPLATES.map(row => row.file)).size, 12);
  for (const stage of ANALYSIS_TEMPLATE_STAGES) for (const subject of ANALYSIS_TEMPLATE_SUBJECTS) {
    const matches = ANALYSIS_PROMPT_TEMPLATES.filter(row => row.stage === stage.id && row.subject === subject.id);
    assert.equal(matches.length, 1);
    const row = matches[0];
    const text = fs.readFileSync(path.join(root, 'public', row.file), 'utf8');
    assert.match(text, /姓名#学号/);
    assert.match(text, /列入可评分名单/);
    assert.match(text, /`score` 返回 `null`/);
    assert.match(text, /教师提供的初始图不是学生成果/);
    assert.doesNotMatch(text, /写给同学们的话|未开启时只输出班级分析|仅在本次开启 AI 评分时/);
    assert.match(text, /不修改也能直接使用/);
    assert.match(text, /逐生建议与评分开关无关/);
    assert.match(text, /两个 advice 必须逐字一致/);
    for (const field of ['student', 'advice', 'score', 'reason']) assert.ok(text.includes("`" + field + "`"));
    assert.match(text, /系统未提供机器反馈协议时/);
    assert.ok(text.includes(`# 角色：${row.title}学习分析助手`));
    const fixedAt = text.indexOf('# 固定区：教师不应修改');
    assert.ok(fixedAt > 0);
    for (const heading of ['# 角色：', '## 目标：', '## 技能：']) assert.ok(text.indexOf(heading) < fixedAt);
    for (const heading of ['## 工作流：', '## 输出格式：', '## 限制：']) assert.ok(text.indexOf(heading) > fixedAt);
    assert.match(text, /班级正文不直接显示学生姓名、学号/);
    assert.ok(text.includes('### 核心结论'));
    const report = text.split('### 一、班级分析')[1].split('### 二、典型表现对应名单')[0];
    assert.equal((report.match(/^### /gm) ?? []).length, 5);
    assert.match(report, /典型表现与/);
    assert.match(report, /后检查/);
    assert.match(report, /简单题可以合并段落/);
    assert.match(report, /不逐人罗列/);
    assert.match(report, /共性问题与优秀回答/);
    assert.match(report, /不把 AI 润色后的内容冒充学生原话/);
    assert.match(report, /单人实例只关联该学生/);
    assert.match(text, /优秀作答同学.*classnode-group-g2/);
    assert.doesNotMatch(text, /教师可引用完整学生标签/);
    assert.ok(!text.includes('【请删除本行') && !text.includes('学科模块粘贴区'));
  }
});
