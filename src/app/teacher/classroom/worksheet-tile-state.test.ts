/**
 * `worksheet-tile-state.ts` 的逐条断言 —— **教师看板学习单格子的唯一回归网**。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/app/teacher/classroom/worksheet-tile-state.test.ts
 * ```
 *
 * 也可以走 `pnpm test`（根目录），它把本文件与服务端那批一起跑。
 *
 * ⚠️ 为什么值得单独成文件：这一段错了**不报错**。格子上的字是教师课上唯一的信息源，
 * 「正在做第 3 题」说成第 4 题、「停住了」永不出现、交完的格子还写着「正在做」——
 * 三种都不抛异常、不让编译失败，只会让教师点错人、讲错题。
 * 带 🔴 的几条是**反向断言**：把对应实现改坏，它们必须变红（反证见 D3 报告）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorksheetQuestionNode } from '@/lib/types';
import {
  activeAnswer,
  moduleCountUnit,
  tileBadgeText,
  tileShowsWorksheetClear,
  WORKSHEET_STUCK_AFTER_MS,
  worksheetTileState,
  type ParticipantWorksheetProgress,
  type WorksheetTileState,
} from './worksheet-tile-state.ts';

/* ── 造题：三个题型各一道，外加一份「嵌套」的树 ───────────────────────── */

function question(id: string, type: string, children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type, prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

const THREE = [question('q1', 'single-choice'), question('q2', 'fill-blank'), question('q3', 'short-answer')];

/**
 * 一份进度记录。`cells` 只写**有状态**的题（其余题在实现里按「未答」处理）。
 * `at` 传 `null` = **不知道**最后一次保存是什么时候（数据来自旧行，见 §3 那一段）。
 */
function progress(
  cells: Record<string, 'draft' | 'submitted'>,
  lastQuestionId: string | null,
  at: number | null,
): ParticipantWorksheetProgress {
  return { cells, lastQuestionId, lastAt: at };
}

const NOW = 1_700_000_000_000;
const WORKSHEET = { id: 'w1', title: '光合作用实验' };

/** 每次都从同一组默认值出发，只覆盖关心的那几项 —— 免得每条用例都写六行。 */
function state(overrides: Partial<Parameters<typeof worksheetTileState>[0]>): WorksheetTileState {
  return worksheetTileState({
    worksheet: WORKSHEET,
    nodes: THREE,
    progress: undefined,
    online: true,
    now: NOW,
    ...overrides,
  });
}

/* ── ① 画不出格子的三种情形 ──────────────────────────────────────────── */

test('没有学习单 ⇒ unconfigured（高级模式下「本组没配」是合法状态，不是错误）', () => {
  assert.deepEqual(state({ worksheet: null }), { kind: 'unconfigured' });
});

test('题目还没从 REST 拿到 ⇒ loading（不是「没有学习单」，也不是「还没开始」）', () => {
  assert.deepEqual(state({ nodes: null }), { kind: 'loading' });
});

test('学习单里一道题都没有 ⇒ empty（分母是 0，四态全都无从谈起）', () => {
  assert.deepEqual(state({ nodes: [] }), { kind: 'empty' });
});

/* ── ② 四态 ─────────────────────────────────────────────────────────── */

test('🔴 一条广播都没收到 ⇒ no-progress，**不是**「还没开始作答」', () => {
  // 看板没有历史 REST（见文件头），所以「没收到」与「没开始」是两件事：教师刷新一次页面，
  // 早就做完的学生也会落到这一态。把它说成「还没有开始作答」就是编了一个假事实。
  assert.deepEqual(state({ progress: undefined }), { kind: 'no-progress' });
});

test('正在做：最后一次保存的那一题 + 题型（题号是两级题号，题型走注册表的中文名）', () => {
  const result = state({ progress: progress({ q2: 'draft' }, 'q2', NOW - 1000) });
  assert.deepEqual(result, {
    kind: 'working',
    heading: '2',
    typeLabel: '填空题',
    cells: ['unanswered', 'draft', 'unanswered'],
    headings: ['1', '2', '3'],
  });
});

test('🔴 「正在做哪题」= 最后一次保存的那题，不是第一道有状态的题', () => {
  // 学生先在第 1 题上写了草稿、再跳到第 3 题写：格子必须说第 3 题。
  // 改成「第一道 draft」就会说第 1 题 —— 而两处都不报错。
  const result = state({ progress: progress({ q1: 'draft', q3: 'draft' }, 'q3', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.heading : 'x', '3');
});

test('方格阵 = 逐题状态（未答 / 作答中 / 已提交），顺序与题目顺序一致', () => {
  const result = state({ progress: progress({ q1: 'submitted', q3: 'draft' }, 'q3', NOW - 1000) });
  assert.deepEqual(result.kind === 'working' ? result.cells : null, ['submitted', 'unanswered', 'draft']);
});

test('子题也算题（嵌套 content 不能只渲染顶层 —— 否则格子永远差几格才满）', () => {
  // 两份 `content` 的题数不一样：拍平后是 3 道（父 → 子 → 下一个），只数顶层的话是 2 道，
  // 而服务端算「整卷交齐」时数的也是 3 ⇒ 只看顶层的实现会让这一格**永远交不完**。
  const nodes = [question('q1', 'single-choice', [question('q1a', 'fill-blank')]), question('q2', 'short-answer')];
  const result = state({ nodes, progress: progress({ q1: 'submitted', q1a: 'submitted', q2: 'submitted' }, 'q2', NOW - 1000) });
  assert.deepEqual(result, { kind: 'all-submitted', cells: ['submitted', 'submitted', 'submitted'], headings: ['1', '2', '3'] });
});

test('全部提交 ⇒ all-submitted（题数取方格阵的长度）', () => {
  const result = state({ progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'submitted' }, 'q3', NOW - 1000) });
  assert.deepEqual(result, { kind: 'all-submitted', cells: ['submitted', 'submitted', 'submitted'], headings: ['1', '2', '3'] });
});

/* ── ③ 「停住了」的判据：在线 且 > 5 分钟 且 未全部提交 ──────────────── */

test('🔴 停住了：在线 + 距最后一次作答刚好超过 5 分钟', () => {
  const result = state({
    progress: progress({ q1: 'draft' }, 'q1', NOW - WORKSHEET_STUCK_AFTER_MS - 1000),
  });
  assert.equal(result.kind, 'stuck');
  assert.equal(result.kind === 'stuck' ? result.heading : 'x', '1');
  assert.equal(result.kind === 'stuck' ? result.minutes : -1, 5);
});

test('🔴 边界：刚好 5 分钟**不算**停住了（判据是「> 5 分钟」）', () => {
  const result = state({ progress: progress({ q1: 'draft' }, 'q1', NOW - WORKSHEET_STUCK_AFTER_MS) });
  assert.equal(result.kind, 'working');
});

test('🔴 离线不算停住了 —— 那条判据里有「在线」（离线状态本身已经在徽章行上）', () => {
  const result = state({ progress: progress({ q1: 'draft' }, 'q1', NOW - 60 * 60 * 1000), online: false });
  assert.equal(result.kind, 'working');
});

test('🔴 已全部提交时不算停住了（判据里的「未全部提交」）', () => {
  const result = state({
    progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'submitted' }, 'q3', NOW - 60 * 60 * 1000),
  });
  assert.equal(result.kind, 'all-submitted');
});

/**
 * ★ 2026-09-28：**「不知道」必须有自己的那一档。**
 *
 * 数据源统一之后，进度可能来自**历史读端点**，而那一侧的时间戳取自作答行的 `savedAt`
 * —— 它在**旧行上是 `null`**（那一列上线之前落库的行，见 `ensureWorksheetAnswerColumns`：
 * 只加列、刻意不回填）。`lastAt: null` 就是这个意思。
 *
 * 🔴 少了这一档，`now - null` 会算成 `now`（= 一个巨大的数）⇒ 那一格**立刻**报「停住了」，
 * 而那些题可能是学生刚才才答的 —— 教师会去「救」一个根本不需要救的人。
 * 反过来把它当成「刚刚」则会永远不报 —— 两种都是把「不知道」编成了一个事实。
 * 所以它既不报停住了、也不假装知道：落 `working`（唯一诚实的那一档）。
 *
 * ⚠️ 阳性对照在紧邻的上面两条（`lastAt` 是数时照样能报出 stuck）——
 * 少了它们，一个「stuck 永不出现」的实现也能让本用例绿。
 */
test('🔴 lastAt 是 null（旧行没有 savedAt）⇒ **不许**报「停住了」，落 working', () => {
  const result = state({ progress: progress({ q1: 'draft' }, 'q1', null) });
  assert.equal(result.kind, 'working', '「不知道多久没动了」不是「他卡住了」—— 那两句话不是一句');
});

test('分钟数向下取整（8 分 59 秒说 8 分钟，不说 9 分钟）', () => {
  const result = state({ progress: progress({ q1: 'draft' }, 'q1', NOW - (8 * 60 + 59) * 1000) });
  assert.equal(result.kind === 'stuck' ? result.minutes : -1, 8);
});

/* ── ④ 教师课上改单（规格 §3-J：只警告不拦）后的两种退化 ─────────────── */

test('🔴 最后一次作答的那题被教师删掉 ⇒ 退到「第一道还在作答中的题」，不编题号', () => {
  const result = state({ progress: progress({ q1: 'draft', gone: 'draft' }, 'gone', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.heading : 'x', '1');
});

test('🔴 说不出在哪一题（最后作答那题已删、也没有在答的题）⇒ heading 为 null 而不是猜一道', () => {
  // q1 已提交、q2 没作答、最后一次作答的 q_gone 已被删掉：题号确实推不出来。
  const result = state({ progress: progress({ q1: 'submitted', gone: 'draft' }, 'gone', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.heading : 'x', null);
  assert.equal(result.kind === 'working' ? result.typeLabel : 'x', null);
});

test('收到的作答全都不在这份学习单上了（题被删光）⇒ no-progress，不说「正在做第 N 题」', () => {
  const result = state({ progress: progress({ gone1: 'submitted', gone2: 'draft' }, 'gone2', NOW - 1000) });
  assert.deepEqual(result, { kind: 'no-progress' });
});

/* ── ⑤ 徽章文字 ─────────────────────────────────────────────────────── */

test('徽章：只剩学伴那一档说轮数（学习单的「已交 N/M」随第 5 条去掉了）', () => {
  assert.equal(tileBadgeText({ kind: 'rounds', rounds: 3 }), '3 轮');
  // ⊘ ★ 2026-09-28：这里原来断言 `{ kind: 'submitted', … }` → `'已交 2/3'`。
  // 教师第 5 条把学习单那一格的徽章去掉了 ⇒ 那一档从 `TileBadge` 里删掉
  // ⇒ 这条断言**在类型上就写不出来了**（这正是我们要的：不是靠人记得别加回来）。
  // ⚠️ 别把 `submitted` 那一档加回去 —— 它说的数与格子正文里那串方块是同一件事。
});

/* ── ⑥ ★ M5a：模块筛选行那六个数字的量词 ──────────────────────────────── */

/**
 * 🔴 这一条修的是一个**假断言**：`page.tsx` 模块筛选行上方原写着「单位是**人数**」，
 * 而 `moduleDistribution` 是逐 `students` 计数的 —— 分组 / 高级模式下 `students` 的
 * 每一行是一个**参与者**，而参与者**就是组**（规格 §1.2）⇒ 那些模式下这一行是**组数**。
 *
 * ⚠️ 改的**只有量词**，数字算法一个字不动：那个数字与「点它会筛出几张卡片」是同一件事，
 * 那正是筛选控件应有的口径；页头那个「N 名学生」在分组模式下按成员求和（真·人数），
 * 两者都对、只是单位不同。
 */
test('★ M5a：模块筛选行的量词按 mode 走（个人=人 / 分组与高级=组）', () => {
  assert.equal(moduleCountUnit('standard'), '人');
  assert.equal(moduleCountUnit('group'), '组');
  assert.equal(moduleCountUnit('advanced'), '组');
  // 未知 / 缺失一律按标准模式 —— 与 `ClassroomSummary.mode` 是可选字段同源：
  // 老服务端不发它时，按「人」说比按「组」说更保守（标准模式下参与者就是学生）。
  assert.equal(moduleCountUnit(''), '人');
  assert.equal(moduleCountUnit('nobody-knows'), '人');
});

test('★ M5a 反证：把量词改成恒回「组」⇒ 上一条的前两条必红', () => {
  const alwaysGroup = (): '人' | '组' => '组';
  assert.equal(alwaysGroup(), '组', '这就是改坏之后的样子');
  assert.notEqual(alwaysGroup(), moduleCountUnit('standard'), '个人模式必须与人不同');
  assert.notEqual(alwaysGroup(), moduleCountUnit(''));
  // 阳性对照：分组 / 高级那两条在改坏前后**恰好相同**（别把「挡住回退」写成「凡 mode 都特殊」）。
  assert.equal(alwaysGroup(), moduleCountUnit('group'));
  assert.equal(alwaysGroup(), moduleCountUnit('advanced'));
});

/* ── 任务制：格子上的题号是两级的，且任务不算一道题 ──────────────────── */

/** 一个任务容器（`prompt` 是它的标题）。 */
function task(id: string, prompt: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: 'task', prompt, inputMode: 'keyboard', data: {}, children };
}

const IN_TASK = [task('t1', '任务一', THREE)];

test('🔴 任务不占格子：三题全交 ⇒ all-submitted（任务被当成一道题时这一态**永不成立**）', () => {
  // §十一 数出来的失效：任务节点没有作答行 ⇒ 它那一格永远是 `unanswered`
  // ⇒ `cells.every(submitted)` 恒假 ⇒ 学生明明交了卷，格子上永远停在「正在做」。
  const result = state({ nodes: IN_TASK, progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'submitted' }, 'q3', NOW - 1000) });
  assert.deepEqual(result, { kind: 'all-submitted', cells: ['submitted', 'submitted', 'submitted'], headings: ['任务一 · 1', '任务一 · 2', '任务一 · 3'] });
});

test('格子上的题号带任务前缀', () => {
  const result = state({ nodes: IN_TASK, progress: progress({ q2: 'draft' }, 'q2', NOW - 1000) });
  assert.deepEqual(result, {
    kind: 'working',
    heading: '任务一 · 2',
    typeLabel: '填空题',
    cells: ['unanswered', 'draft', 'unanswered'],
    headings: ['任务一 · 1', '任务一 · 2', '任务一 · 3'],
  });
});

test('🔴 停住了：也带同一个题号', () => {
  const result = state({ nodes: IN_TASK, progress: progress({ q1: 'draft' }, 'q1', NOW - WORKSHEET_STUCK_AFTER_MS - 1), online: true });
  assert.equal(result.kind === 'stuck' ? result.heading : 'x', '任务一 · 1');
});

test('题目树里只有任务、一道可作答的题都没有 ⇒ empty（不是「一道题都还没答」）', () => {
  const result = state({ nodes: [task('t1', '任务一', [])], progress: progress({}, null, NOW) });
  assert.deepEqual(result, { kind: 'empty' });
});

test('🔴 格子阵的 tooltip 也要两级题号 —— `headings` 与 `cells` 同源、逐格对齐', () => {
  // 终审 I5：`worksheet-tiles.tsx` 的 tooltip 原先写 `第 ${index + 1} 题`，
  // 与同一屏上抽屉/矩阵/学生端的题号**不是同一个号**（第二级任务的第一道题会说「第 3 题」
  // 而别处说「任务二 · 1」）。修法不是在那儿现算 —— 现算就是又一份真源；
  // 而是让判据层把题号**一起带出来**，与 `cells` 由同一个数组投影，结构上不可能漂。
  const result = state({
    nodes: [task('t1', '任务一', THREE), task('t2', '任务二', [question('q4', 'order')])],
    progress: progress({ q1: 'draft', q4: 'submitted' }, 'q4', NOW - 1000),
  });
  assert.equal(result.kind, 'working');
  if (result.kind !== 'working') return;
  assert.deepEqual(result.cells, ['draft', 'unanswered', 'unanswered', 'submitted']);
  assert.deepEqual(result.headings, ['任务一 · 1', '任务一 · 2', '任务一 · 3', '任务二 · 4']);
  assert.equal(result.headings.length, result.cells.length, '两个数组必须逐格对齐');
});

test('🔴 全部交齐那一态也带题号（tooltip 在那个态里同样要能hover）', () => {
  const result = state({
    nodes: IN_TASK,
    progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'submitted' }, 'q3', NOW - 1000),
  });
  assert.deepEqual(result, {
    kind: 'all-submitted',
    cells: ['submitted', 'submitted', 'submitted'],
    headings: ['任务一 · 1', '任务一 · 2', '任务一 · 3'],
  });
});

/* ── ⑥ 清除数据的垃圾桶何时出现（第 4 条）────────────────────────────── */

test('★ 垃圾桶：只有这一格显示着学习单（或混合里有学习单）时才出现', () => {
  // 与学伴那个 `tileShowsClear` 逐字同构 —— 两个垃圾桶在同一排按钮里，判据不同会打架。
  assert.equal(tileShowsWorksheetClear('worksheet', ['worksheet']), true);
  assert.equal(tileShowsWorksheetClear('companion', ['companion']), false, '学伴那一格给的是「清除对话」');
  assert.equal(tileShowsWorksheetClear('explore', ['explore']), false, '探究空间的内容区是画面，没有作答可清');
  assert.equal(tileShowsWorksheetClear('mixed', ['companion', 'worksheet']), true, '混合里有学习单 ⇒ 还有意义');
  assert.equal(tileShowsWorksheetClear('mixed', ['companion', 'explore']), false, '混合里没有学习单 ⇒ 不出现');
  assert.equal(tileShowsWorksheetClear('home', ['home']), false);
  assert.equal(tileShowsWorksheetClear('unknown', []), false);
});

/* ── ⑦ 格子里预览哪一题（★ 教师：留出下方空间显示「正在答题的详细动态」）── */

/**
 * 🔴 **预览的那一题必须与格子正文写着的那一题是同一个。**
 * 各挑各的后果是：上面写「正在做 任务二 · 1」，下面预览的却是第 5 题的作答 ——
 * 而两边都不报错，教师会照着第 5 题的答案去讲第 3 题。
 */
test('🔴 预览的那一题 = 格子正文那一题（共用同一个 activeQuestionIndex）', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'fill-blank'), question('q3', 'short-answer')];
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['submitted', 'submitted', 'draft'];
  const rows = [
    { questionId: 'q1', value: 'A' },
    { questionId: 'q2', value: 'B' },
    { questionId: 'q3', value: 'C' },
  ];
  const answer = activeAnswer(nodes, rows, cells, 'q3');
  assert.equal(answer?.node.id, 'q3', '最后一次保存的是 q3');
  assert.equal(answer?.value, 'C', '值也要是那一题的');

  // 格子上那一行说的题号，与这里挑出来的**同一题**（两级题号同源）。
  // ⚠️ 局部变量**不能叫 `state`** —— 本文件顶上那个 `state()` 是造格子的助手，撞名会 TDZ。
  const tile = state({ nodes, progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'draft' }, 'q3', NOW - 1000) });
  assert.equal(tile.kind === 'working' ? tile.heading : null, answer?.heading);
});

/**
 * 🔴 **说不出是哪一题 ⇒ 不预览**（最后一题被教师删掉、也没有在答的题）。
 * 随便挑一道的后果与上一条同源：教师会照着**另一道题**的答案去讲这一道。
 */
test('🔴 说不出是哪一题 ⇒ 不预览（不随便挑一道来显示）', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'fill-blank')];
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['submitted', 'unanswered'];
  // 最后一次作答的 q_gone 已经被教师删掉，而 q2 也没在答 ⇒ 说不出来。
  assert.equal(activeAnswer(nodes, [], cells, 'q_gone'), null);
});

test('★ 退到「第一道还在作答中的题」（最后作答那题被删时）', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'fill-blank')];
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['unanswered', 'draft'];
  const answer = activeAnswer(nodes, [{ questionId: 'q2', value: 'x' }], cells, 'q_gone');
  assert.equal(answer?.node.id, 'q2');
  assert.equal(answer?.typeLabel, '填空题');
});

test('★ 一题都没有 ⇒ null（空学习单不预览）', () => {
  assert.equal(activeAnswer([], [], [], null), null);
});

/**
 * 🔴 **他此刻正在编辑的那一题，优先于「最后一次落库的那一题」。**
 *
 * 这条用例是教师报「**问答题的实时显示非常慢**」之后改写的，而它记的正是那个根因：
 * `lastQuestionId` **只在落库时更新**，而落库有 1.5 秒防抖 —— 学生**连续打字**时
 * （问答题正是如此）一次都不会落库 ⇒ 它一直停在**上一题** ⇒ 预览那一份的题号
 * 永远对不上、被丢掉 ⇒ 格子看起来**冻住了**。选择题是「点一下就有一次落库」，
 * 所以那里只是慢 1.5 秒，不是不动。
 *
 * ⚠️ **第一版这条用例断言的是反过来的事**（「题号对不上就不许用预览」）——
 * 那个规则在当时看着对（怕拿上一题的草稿去填这一题），代价却是问答题整题不动。
 * 改成「谁新听谁的」之后，两件事都不再发生：
 *   · 新信号（他正在编辑）**优先**；
 *   · 并且**标题与预览共用**这一个判据 —— 各挑各的会「标题说第 3 题、下面画第 5 题」。
 */
test('🔴 他此刻正在编辑的那一题优先于「最后一次落库的那一题」（问答题那个 bug）', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'short-answer')];
  // 库里最后一次落库的是 q1（选择题），而他此刻在写 q2（问答题，还没落库）。
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['submitted', 'unanswered'];
  const rows = [{ questionId: 'q1', value: '库里那份' }];
  const draft = { questionId: 'q2', value: '他正在写的这一段' };

  const answer = activeAnswer(nodes, rows, cells, 'q1', draft);
  assert.equal(answer?.node.id, 'q2', '🔴 必须切到他正在写的那一题（否则这一题永远不显示）');
  // ⚠️ 这里原来还有一条 `fromDraft === true`（界面那个「正在写」记号）。教师 2026-09-29
  // 把那个记号去掉了 ⇒ 字段与断言一起删。**实质仍被上一行钉着**：用的是预览那一份的值。
  assert.equal(answer?.value, '他正在写的这一段');

  // 🔴 **标题与预览必须同源**：格子正文说的题号也得是 q2，不是 q1。
  const tile = state({ nodes, progress: progress({ q1: 'submitted' }, 'q1', NOW - 1000), liveQuestionId: 'q2' });
  assert.equal(tile.kind === 'working' ? tile.heading : null, answer?.heading, '标题与下方预览不许各说各的');
});

test('★ 没有实时预览时，退回「最后一次落库的那一题」', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'short-answer')];
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['submitted', 'unanswered'];
  const answer = activeAnswer(nodes, [{ questionId: 'q1', value: '库里那份' }], cells, 'q1', null);
  assert.equal(answer?.node.id, 'q1');
  // 没有预览 ⇒ 用库里那一份。⚠️ 断言的是**值**（原来断言的是 `fromDraft === false`）——
  // 那个字段已随「正在写」记号一起删掉，而这里真正要守的是「值取自哪一份」。
  assert.equal(answer?.value, '库里那份');
});

/**
 * ⚠️ 实时那一题的**题号不在学习单里**（他刚在别的学习单上写过、或者教师删了那题）
 * ⇒ 退回原来的两级判据，**不许**挑一道不存在的题。
 */
test('🔴 实时的题号不在学习单里 ⇒ 退回原判据（不挑一道不存在的题）', () => {
  const nodes = [question('q1', 'single-choice'), question('q2', 'short-answer')];
  const cells: Array<'unanswered' | 'draft' | 'submitted'> = ['unanswered', 'draft'];
  const answer = activeAnswer(
    nodes, [{ questionId: 'q2', value: '库里' }], cells, 'q2',
    { questionId: '别的学习单上的题', value: 'x' },
  );
  assert.equal(answer?.node.id, 'q2', '退回「第一道还在作答中的题」');
  // 🔴 那一份预览**不属于这一题** ⇒ 必须用库里那一份（`库里`），不许把 `x` 画出来。
  // ⚠️ 原来断言的是 `fromDraft === false`；字段删了之后，这里改成断言**值本身**
  //（更好：原来那个标志只说明「没走预览那条路」，而这一条直接证明「画出来的不是 x」）。
  assert.equal(answer?.value, '库里');
});
