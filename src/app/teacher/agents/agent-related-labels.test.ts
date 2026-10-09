/**
 * ★ 2026-10-08（教师）第 6 项两条：
 *   ① 「这两个都不要显示了」——卡片上那两条分类文字（「教师分析型智能体」/「课堂学生学伴」）
 *      整条去掉，但**保留**名称后那枚小汉字（`学` / `析`）。
 *   ② 「这里应该是**查看关联的学习单**」——分析型智能体那个 chip 与它打开的弹窗
 *      都要说**学习单**，学伴型仍说课堂。
 *
 * 🔴 ① 的由来值得记着：教师原话是改名（→「智能分析类」/「智能学伴类」），但「智能学伴」
 *   在本仓**已经是一个课堂模块名**（`src/app/classroom/module-meta.tsx` 的 `companion`，
 *   学生端 Tab 上直接显示）⇒ 改名会撞名。教师权衡后选了"都不要显示"。
 *   ⚠️ 所以这条网要同时钉「那句话没了」**和**「小汉字还在」——
 *   只钉前者的话，哪天有人把 `PurposeChip` 一起删掉，网还是绿的。
 *
 * 🔴 ② 的数据来源**没有关联表**（全仓无 `WorksheetAgent`），只有
 *   `Worksheet.settings.analysisAgentId` 一条路 —— 这决定了 chip 上**不能**显示条数
 *   （条数要点了才知道）。这里的判据只钉界面分支，数据那半在
 *   `server/src/tests/agent-webapp-usage.test.ts` 里用真库钉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => fs.readFileSync(path.join(HERE, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD = read('agent-card.tsx');
const OVERLAYS = read('agent-overlays.tsx');
const PAGE = read('page.tsx');

test('① 那条分类文字没了，但小汉字（PurposeChip）还在', () => {
  assert.doesNotMatch(CARD, /教师分析型智能体/, '卡片上还写着「教师分析型智能体」');
  assert.doesNotMatch(CARD, /课堂学生学伴/, '卡片上还写着「课堂学生学伴」');
  assert.match(CARD, /<PurposeChip purpose=\{agent\.purpose\} \/>/,
    '把名称后那枚小汉字（学 / 析）也一起删了 —— 教师说的是"留小汉字"');
});

test('② chip：分析型说学习单、学伴型仍说课堂，且**各显示各自的条数**', () => {
  // ★ 2026-10-08 第二批（教师）：「改成『关联学习单』」—— 与「关联课堂」对齐的四字短语。
  assert.match(CARD, /purpose === 'analysis'[\s\S]{0,80}?'关联学习单'/,
    '分析型的 chip 文案不是「关联学习单」');
  assert.doesNotMatch(CARD, /查看关联的学习单/, '旧文案「查看关联的学习单」还留着');
  assert.match(CARD, /'未关联课堂'/, '学伴型那一条被误改了');
  /*
   * ★ 2026-10-08 第二批（教师）：「这个数据取不到吗？」⇒ 取得到，要显示出来。
   * 🔴 两条关系的数字**不能混**：分析型显示 `worksheetCount`，学伴型显示 `classroomCount`，
   *   各自都**不显示**对方那个 —— 混在一起才是真的说不清"这个 12 是什么的 12"。
   */
  assert.match(CARD, /purpose === 'analysis' && typeof agent\.worksheetCount === 'number'/,
    '分析型 chip 没有显示学习单条数（教师问的就是这个数据）');
  assert.match(CARD, /chip-count">\{agent\.worksheetCount\}/, '学习单条数没有渲染出来');
  assert.match(CARD, /purpose !== 'analysis' && typeof agent\.classroomCount === 'number'/,
    '分析型也去显示 classroomCount 了 ⇒ 两条关系的数字混在一起');
});

test('② 弹窗按 purpose 分流，且两条清单都不做二次请求', () => {
  assert.match(OVERLAYS, /const showsWorksheets = agentPurposeOf\(purpose\) === 'analysis'/,
    '弹窗没有按 purpose 分流');
  assert.match(OVERLAYS, /showsWorksheets\s*\?\s*'学习单'\s*:\s*'课堂'/, '标题没有跟着分流');
  assert.match(OVERLAYS, /worksheets\.map\(/, '分流到学习单那一支后没有列出学习单');
  assert.match(OVERLAYS, /teacher\/worksheets\/edit\/\?id=\$\{worksheet\.id\}/,
    '清单里的学习单没有可打开的链接');
  // 「无法删除」那个弹窗仍然只讲课堂（删除守卫拦的确实是课堂与小组）。
  assert.doesNotMatch(OVERLAYS, /AgentDeleteBlockedDialog[\s\S]{0,600}?showsWorksheets/,
    '「无法删除」弹窗也被按 purpose 分流了 —— 它拦的是课堂/小组引用，不该分流');
});

test('② 接线：两张清单在同一次 usage 请求里回来，页面把它们都传下去', () => {
  const controller = read('use-agent-controller.ts');
  assert.match(controller, /worksheets: usage\.worksheets/, '控制器没有把 worksheets 存进状态');
  assert.match(controller, /const usage = await api\.checkAgentUsage\(agent\.id\)/,
    '控制器不再只请求一次 usage 了');
  assert.match(PAGE, /worksheets=\{relatedClassrooms\.worksheets\}/, '页面没有把 worksheets 传给弹窗');
  assert.match(PAGE, /purpose=\{relatedClassrooms\.agent\.purpose\}/, '页面没有把 purpose 传给弹窗');
});
