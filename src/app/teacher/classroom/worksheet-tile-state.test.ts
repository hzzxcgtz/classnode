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
  moduleCountUnit,
  tileBadgeText,
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

/** 一份进度记录。`cells` 只写**有状态**的题（其余题在实现里按「未答」处理）。 */
function progress(
  cells: Record<string, 'draft' | 'submitted'>,
  lastQuestionId: string | null,
  at: number,
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

test('正在做：最后一次保存的那一题 + 题型（题号是 1-based，题型走注册表的中文名）', () => {
  const result = state({ progress: progress({ q2: 'draft' }, 'q2', NOW - 1000) });
  assert.deepEqual(result, {
    kind: 'working',
    index: 1,
    typeLabel: '填空题',
    cells: ['unanswered', 'draft', 'unanswered'],
  });
});

test('🔴 「正在做哪题」= 最后一次保存的那题，不是第一道有状态的题', () => {
  // 学生先在第 1 题上写了草稿、再跳到第 3 题写：格子必须说第 3 题。
  // 改成「第一道 draft」就会说第 1 题 —— 而两处都不报错。
  const result = state({ progress: progress({ q1: 'draft', q3: 'draft' }, 'q3', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.index : -1, 2);
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
  assert.deepEqual(result, { kind: 'all-submitted', cells: ['submitted', 'submitted', 'submitted'] });
});

test('全部提交 ⇒ all-submitted（题数取方格阵的长度）', () => {
  const result = state({ progress: progress({ q1: 'submitted', q2: 'submitted', q3: 'submitted' }, 'q3', NOW - 1000) });
  assert.deepEqual(result, { kind: 'all-submitted', cells: ['submitted', 'submitted', 'submitted'] });
});

/* ── ③ 「停住了」的判据：在线 且 > 5 分钟 且 未全部提交 ──────────────── */

test('🔴 停住了：在线 + 距最后一次作答刚好超过 5 分钟', () => {
  const result = state({
    progress: progress({ q1: 'draft' }, 'q1', NOW - WORKSHEET_STUCK_AFTER_MS - 1000),
  });
  assert.equal(result.kind, 'stuck');
  assert.equal(result.kind === 'stuck' ? result.index : -1, 0);
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

test('分钟数向下取整（8 分 59 秒说 8 分钟，不说 9 分钟）', () => {
  const result = state({ progress: progress({ q1: 'draft' }, 'q1', NOW - (8 * 60 + 59) * 1000) });
  assert.equal(result.kind === 'stuck' ? result.minutes : -1, 8);
});

/* ── ④ 教师课上改单（规格 §3-J：只警告不拦）后的两种退化 ─────────────── */

test('🔴 最后一次作答的那题被教师删掉 ⇒ 退到「第一道还在作答中的题」，不编题号', () => {
  const result = state({ progress: progress({ q1: 'draft', gone: 'draft' }, 'gone', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.index : -1, 0);
});

test('🔴 说不出在哪一题（最后作答那题已删、也没有在答的题）⇒ index 为 null 而不是猜一道', () => {
  // q1 已提交、q2 没作答、最后一次作答的 q_gone 已被删掉：题号确实推不出来。
  const result = state({ progress: progress({ q1: 'submitted', gone: 'draft' }, 'gone', NOW - 1000) });
  assert.equal(result.kind === 'working' ? result.index : -1, null);
  assert.equal(result.kind === 'working' ? result.typeLabel : 'x', null);
});

test('收到的作答全都不在这份学习单上了（题被删光）⇒ no-progress，不说「正在做第 N 题」', () => {
  const result = state({ progress: progress({ gone1: 'submitted', gone2: 'draft' }, 'gone2', NOW - 1000) });
  assert.deepEqual(result, { kind: 'no-progress' });
});

/* ── ⑤ 徽章文字 ─────────────────────────────────────────────────────── */

test('徽章：学伴说轮数，学习单说已交题数', () => {
  assert.equal(tileBadgeText({ kind: 'rounds', rounds: 3 }), '3 轮');
  assert.equal(tileBadgeText({ kind: 'submitted', submitted: 2, total: 3 }), '已交 2/3');
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
