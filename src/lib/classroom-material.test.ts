/**
 * `classroom-material.ts` 的逐组合断言 —— **本文件是「高级模式不回落」这条红线的唯一门禁**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的 TS 类型擦除直接执行）：
 *
 * ```bash
 * cd /Users/zxc/myprojects/classnode && node --test src/lib/classroom-material.test.ts
 * ```
 *
 * ⚠️ 为什么值得为一个 5 行的解析函数写测试：它的错法**不会报错**。回落到课堂级数组之后，
 * 学生照样能聊天、网页照样打得开，只是用的是**别的组**的智能体/网页 —— 界面、日志、教师看板
 * 全都没有异常信号（spec §1.2 ① 的原话是「AI 正常回答、教师完全看不出」）。所以这里要断言的
 * 不是「能取到」，而是**「取不到的时候必须是 null」**：下面带 🔴 的那几条是反向断言，
 * 把 `effectiveGroupAgent` 的高级模式分支改成 `return classroom.agents?.[0] ?? null` 会立刻
 * 变红 —— 实测过（见 Task 4 报告的反证一节）。
 *
 * ⚠️ 服务端那侧有等价的纯函数（`server/src/services/group-material-resolve.ts` 的
 * `resolveMaterialTargetId`）与它自己的用例。**两边都要在**：服务端那个决定 AI 请求发给谁，
 * 这个决定学生看到谁、打开哪个网页，任何一个漏掉都会让「服务端改对了、界面仍在撒谎」重演。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classroomMaterialsInUse, effectiveGroupAgent, effectiveGroupWebapp } from './classroom-material.ts';
import type { AgentSummary, ClassroomWebappSummary } from './types';

/** 只填本测试读到的字段；其余字段的存在与否与本函数无关（服务端下发的组材料也只是子集）。 */
function agent(id: string, name: string, enabled = true): AgentSummary {
  return { id, name, logo: null, platform: 'coze', enabled } as unknown as AgentSummary;
}
function webapp(id: string, name: string): ClassroomWebappSummary {
  return { id, name, entryPath: 'index.html' };
}

// ── 高级模式：只认自己的组，没有就是没有 ──────────────────────────────────

test('高级模式：自己组配了就用自己组的', () => {
  const classroom = {
    mode: 'advanced',
    agents: [agent('a-other', '别的组的智能体')],
    webapps: [webapp('w-class', '课堂级网页')],
    groups: [{ id: 'g1', agent: agent('a-mine', '我组的智能体'), webapp: webapp('w-mine', '我组的网页') }],
  };
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g1' })?.name, '我组的智能体');
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' })?.name, '我组的网页');
});

test('🔴 高级模式：自己的组没配智能体 ⇒ null，不回落到课堂级 agents[0]', () => {
  const classroom = {
    mode: 'advanced',
    agents: [agent('a-other', '别的组的智能体')],
    groups: [{ id: 'g1', agent: null, webapp: webapp('w-mine', '我组的网页') }],
  };
  const result = effectiveGroupAgent(classroom, { groupId: 'g1' });
  assert.equal(result, null);
  // 同一组合下网页仍然取得到 —— 两种材料互相独立，不因为一个缺失而互相影响。
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' })?.id, 'w-mine');
});

test('🔴 高级模式：自己的组没配网页 ⇒ null，不回落到课堂级 webapps[0]', () => {
  const classroom = {
    mode: 'advanced',
    webapps: [webapp('w-class', '课堂级网页')],
    groups: [{ id: 'g1', agent: agent('a-mine', '我组的智能体'), webapp: null }],
  };
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' }), null);
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g1' })?.id, 'a-mine');
});

test('🔴 高级模式：学生没有组 ⇒ 两个材料都是 null（也不回落）', () => {
  const classroom = {
    mode: 'advanced',
    agents: [agent('a-other', '别的组的智能体')],
    webapps: [webapp('w-class', '课堂级网页')],
    groups: [{ id: 'g1', agent: agent('a-mine', '我组的智能体'), webapp: webapp('w-mine', '我组的网页') }],
  };
  assert.equal(effectiveGroupAgent(classroom, { groupId: null }), null);
  assert.equal(effectiveGroupAgent(classroom, null), null);
  assert.equal(effectiveGroupAgent(classroom, undefined), null);
  assert.equal(effectiveGroupWebapp(classroom, { groupId: null }), null);
});

test('🔴 高级模式：服务端没下发 groups（更老的服务端）⇒ null，不回落到课堂级数组', () => {
  const classroom = { mode: 'advanced', agents: [agent('a-other', '别的组的智能体')], webapps: [webapp('w-class', '课堂级网页')] };
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g1' }), null);
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' }), null);
});

test('🔴 高级模式：groupId 指向的组不在 groups[] 里 ⇒ null（不猜、不回落）', () => {
  const classroom = {
    mode: 'advanced',
    agents: [agent('a-other', '别的组的智能体')],
    groups: [{ id: 'g1', agent: agent('a-mine', '我组的智能体'), webapp: null }],
  };
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g-不存在' }), null);
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g-不存在' }), null);
});

// ── 标准 / 分组模式：权威来源是课堂级（spec §1.3）────────────────────────

test('分组模式：用课堂级那个，组里的材料不参与（全班共用一套）', () => {
  const classroom = {
    mode: 'group',
    agents: [agent('a-class', '课堂级智能体')],
    webapps: [webapp('w-class', '课堂级网页')],
    groups: [{ id: 'g1', agent: agent('a-mine', '我组的智能体'), webapp: webapp('w-mine', '我组的网页') }],
  };
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g1' })?.id, 'a-class');
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' })?.id, 'w-class');
});

test('标准模式：用课堂级第一个；没有组也照常取到', () => {
  const classroom = { mode: 'standard', agents: [agent('a-1', '第一个'), agent('a-2', '第二个')], webapps: [webapp('w-1', '第一个网页')] };
  assert.equal(effectiveGroupAgent(classroom, null)?.id, 'a-1');
  assert.equal(effectiveGroupWebapp(classroom, undefined)?.id, 'w-1');
});

test('mode 缺失（更老的服务端）：按非高级处理，用课堂级第一个', () => {
  const classroom = { agents: [agent('a-1', '第一个')], webapps: [webapp('w-1', '第一个网页')] };
  assert.equal(effectiveGroupAgent(classroom, { groupId: 'g1' })?.id, 'a-1');
  assert.equal(effectiveGroupWebapp(classroom, { groupId: 'g1' })?.id, 'w-1');
});

// ── 边界 ────────────────────────────────────────────────────────────────

test('classroom 为 null / undefined ⇒ null（预渲染期无数据不抛）', () => {
  assert.equal(effectiveGroupAgent(null, { groupId: 'g1' }), null);
  assert.equal(effectiveGroupAgent(undefined, null), null);
  assert.equal(effectiveGroupWebapp(null, { groupId: 'g1' }), null);
  assert.equal(effectiveGroupWebapp(undefined, null), null);
});

test('课堂级数组为空 / 缺失 ⇒ null，不抛', () => {
  assert.equal(effectiveGroupAgent({ mode: 'group', agents: [] }, null), null);
  assert.equal(effectiveGroupWebapp({ mode: 'standard' }, null), null);
  assert.equal(effectiveGroupAgent({ mode: 'advanced', agents: [], webapps: [], groups: [] }, { groupId: 'g1' }), null);
});

// ── 接线：消费点必须走上面这两个函数 ──────────────────────────────────────

/**
 * 只做**文本层**的粗筛：去掉注释之后，这四个文件里不许再出现 `classroom.agents?.[0]` /
 * `classroom.webapps?.[0]` 这种「自己读课堂级数组」的写法，且必须真的调用了解析函数。
 *
 * ⚠️ **它证明的是「接线」，不是「浏览器里的行为」**：四个消费点都是 React 组件 / hook，
 * 本仓没有前端测试框架（`pnpm test` 只跑 `server/dist/tests/*.test.js`），所以「学生打开的是
 * 哪个网页、显示谁的名字」只能人工验。这条断言补的是另一半、且是能机器验的那一半：
 * 上一轮真正出问题的不是函数写错，而是**消费点各写各的**，而那种回归编译期一声不吭。
 *
 * ⚠️ 去掉注释是必须的：本文件与 `explore-panel.tsx` 的注释里都**引用**了被禁的写法
 * （「改动前这里写的是 `classroom?.webapps?.[0] ?? null`」），不去注释就会自己把自己扫红。
 * 这层剥离不做语法分析（字符串里的 `//` 会被当成行注释起点），代价是可能**误红** ——
 * 误红是响的、会被人查；漏红才是危险的，而漏红要求违规代码正好落在被误剥的行尾之后。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const CONSUMER_FILES = [
  'src/app/classroom/explore/explore-panel.tsx',
  'src/app/classroom/chat/chat-panel.tsx',
  'src/app/classroom/home/student-home.tsx',
  'src/app/classroom/use-classroom-session.ts',
];

test('🔴 四个消费点都接线到解析函数，没有自己读课堂级数组', () => {
  for (const relativePath of CONSUMER_FILES) {
    const source = stripComments(readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
    // 用 `assert.ok` + `test()` 而不是 `assert.match`：后者失败时会把**整个源文件**打进
    // 报错里（实测过，几十行，真正的原因淹在里面）。这里只留一句话。
    assert.ok(/effectiveGroup(Agent|Webapp)\(/.test(source), `${relativePath} 没有调用解析函数`);
    assert.ok(
      !/(classroom|cr)\s*\??\.\s*(agents|webapps)\s*\??\.\s*\[0\]/.test(source),
      `${relativePath} 又自己读了课堂级数组 —— 高级模式下那是错的来源`,
    );
  }
});

// ── 「这间课堂在用什么材料」（教师端课堂卡片 / 课堂设置弹窗的读口径）──────────
//
// 与上面那两组是同一枚硬币的两面：上面问「**某个学生**用哪一份」，这里问
// 「**这间课堂**在用哪些」。权威来源的规矩是同一句 —— 高级模式只认各组，标准/分组认课堂级。
// 抽出来的理由就是它**已经错过一次**：卡片与弹窗都只读课堂级，于是高级模式那些课堂
// 显示成「未关联」而其实每个组都配了（用户 2026-09-23：「这部分显示为空白，其实已经有关联了」）。

test('高级模式：探究网页来自**各组**，同类多份全部列出', () => {
  const classroom = {
    mode: 'advanced',
    // 高级模式下课堂级那张关联表服务端**根本不写**，所以这里是空的 —— 而它空了不影响结果。
    webapps: [] as ClassroomWebappSummary[],
    groups: [
      { id: 'g1', name: '第1组', agent: null, webapp: webapp('w1', '光合作用') },
      { id: 'g2', name: '第2组', agent: null, webapp: webapp('w2', '水循环') },
      { id: 'g3', name: '第3组', agent: null, webapp: null },
    ],
  };
  const inUse = classroomMaterialsInUse(classroom);
  assert.deepEqual(inUse.webapps.map((item) => item.material.name), ['光合作用', '水循环']);
  assert.deepEqual(inUse.webapps.map((item) => item.groupNames), [['第1组'], ['第2组']]);
});

test('高级模式：同一个材料被两个组引用 → 合成一条，组名并列（不是列两遍）', () => {
  const shared = webapp('w1', '光合作用');
  const inUse = classroomMaterialsInUse({
    mode: 'advanced',
    groups: [
      { id: 'g1', name: '第1组', agent: null, webapp: shared },
      { id: 'g2', name: '第2组', agent: null, webapp: shared },
    ],
  });
  assert.equal(inUse.webapps.length, 1);
  assert.deepEqual(inUse.webapps[0].groupNames, ['第1组', '第2组']);
});

test('🔴 高级模式：各组都没配就是**空**，绝不回落到课堂级', () => {
  // 老课堂可能还留着课堂级的关联行（迁移前写的），高级模式下它**不生效**。
  // 读它就是让教师看到一份「学生根本不会打开」的网页，还顺便掩盖了「各组都没配」这件事。
  // 反证：把实现改成只读 `classroom.webapps`，本条的期望会变成 ['w-legacy'] ⇒ 红。
  const inUse = classroomMaterialsInUse({
    mode: 'advanced',
    webapps: [webapp('w-legacy', '幽灵网页')],
    groups: [{ id: 'g1', name: '第1组', agent: null, webapp: null }],
  });
  assert.deepEqual(inUse.webapps, [], '高级模式不得读课堂级网页');
});

test('标准 / 分组模式：材料来自**课堂级**（那是该模式的权威来源）', () => {
  const inUse = classroomMaterialsInUse({
    mode: 'group',
    agents: [agent('a1', '全班共用')],
    webapps: [webapp('w1', '光合作用')],
    groups: [{ id: 'g1', name: '第1组', agent: null, webapp: null }],
  });
  assert.deepEqual(inUse.agents.map((item) => item.material.name), ['全班共用']);
  assert.deepEqual(inUse.webapps.map((item) => item.material.name), ['光合作用']);
  // 课堂级材料不属于任何组 ⇒ 不该显示组名（否则界面上会凭空多出一句「第1组」）。
  assert.deepEqual(inUse.webapps[0].groupNames, []);
});

test('学习单：今天服务端不下发，但形状就位 —— 有数据就列得出来', () => {
  // 三件套的分类显示要求学习单那一类**现在就能显示**，而不是等 P1 落地再改一遍读路径。
  const inUse = classroomMaterialsInUse({
    mode: 'advanced',
    groups: [{ id: 'g1', name: '第1组', agent: null, webapp: null, worksheet: { id: 's1', title: '第一课练习' } }],
  });
  assert.deepEqual(inUse.worksheets.map((item) => item.material.title), ['第一课练习']);
  assert.deepEqual(inUse.worksheets[0].groupNames, ['第1组']);
});

test('没有任何材料（含 classroom 为 null）时三组都是空数组，不抛错', () => {
  const empty = { agents: [], webapps: [], worksheets: [] };
  assert.deepEqual(classroomMaterialsInUse(null), empty);
  assert.deepEqual(classroomMaterialsInUse({ mode: 'standard' }), empty);
  assert.deepEqual(classroomMaterialsInUse({ mode: 'advanced', groups: [] }), empty);
});
