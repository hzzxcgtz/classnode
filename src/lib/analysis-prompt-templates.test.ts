import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    assert.match(text, /重要的词、句使用 Markdown \*\*加粗\*\*/);
    assert.match(text, /不添加“一、班级分析”等总标题/);
    assert.match(text, /### .+的评价方法/);
    assert.match(text, /只选本题适用的评价方法/);
    assert.doesNotMatch(text, /## 学习任务观察指引/);
    assert.match(text, /信息收集/);
    assert.match(text, /不按交互题型猜测是否评分/);
    assert.match(text, /本题分析重点/);
    assert.match(text, /不强制字数、句数或 emoji 数量/);
    assert.match(text, /简单题可以合并段落/);
    assert.match(text, /证据不足时明确说明/);
    assert.match(text, /不把 AI 润色后的内容冒充学生原话/);
    assert.match(text, /单人实例只关联该学生/);
    assert.doesNotMatch(text, /三分之一至二分之一|支持两种任务|80—150/);
    assert.ok(!text.includes('【请删除本行') && !text.includes('学科模块粘贴区'));
  }
});


test('通用、学科、运行期指引和平台升级文档来自同一维护源', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-analysis-prompts.mjs'), '--check'], { stdio: 'pipe' });
});


test('学科与学段各自描述具体评价方法，公共规则保持一致', () => {
  const methods = new Set<string>();
  let common = '';
  const cases: Record<string, string[]> = {
    'primary-chinese': ['语文习作', '儿童的真实用语', '回到原文', '自行补写'],
    'middle-chinese': ['文言', '论据不支持观点', '表达效果', '补一条证据'],
    'primary-math': ['位值', '摆一摆', '精确作图', '截图外观'],
    'middle-math': ['定义域', '漏解增解', '推理', '尺规步骤'],
    'primary-english': ['词块', '角色问答', '没有音频', '较简单但准确'],
    'middle-english': ['交际任务', '语篇', '调整段落', '不自行套用'],
    'primary-science': ['预测未被验证不直接视为错误', '对照', '再观察', '不以画得像'],
    'middle-science': ['自变量', '异常值', '误差', '结论范围'],
    'primary-information-technology': ['角色扮演', '终止', '不机械要求所有流程都有循环', '没有执行结果'],
    'middle-information-technology': ['边界', '数据结构', '静态', '不声称程序运行正确'],
    'primary-general': ['儿童表达', '静态照片', '一次回答', '偏好'],
    'middle-general': ['时序', '地图', '证据缺口', '人格'],
  };
  for (const row of ANALYSIS_PROMPT_TEMPLATES) {
    const text = fs.readFileSync(path.join(root, 'public', row.file), 'utf8');
    const method = text.slice(text.indexOf('### '), text.indexOf('# 固定区：'));
    assert.ok(!methods.has(method), `${row.id} 不应复用另一个学科或学段的评价方法`);
    methods.add(method);
    for (const term of cases[row.id]) assert.ok(method.includes(term), `${row.id} 缺少评价方法：${term}`);
    const fixed = text.slice(text.indexOf('## 工作流：'));
    if (!common) common = fixed;
    assert.equal(fixed, common, `${row.id} 不应分别维护评分、名单和输出协议`);
  }
  assert.equal(methods.size, 12);
});
