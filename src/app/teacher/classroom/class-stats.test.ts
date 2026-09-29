/**
 * 统计面板那两个新页（学习单 / 探究空间）的**判据**用例。
 *
 * 🔴 这一层为什么必须存在：教师第 5 条明说「你先根据你的思考帮我实现一个**初稿**，
 * 然后我在这个初稿的基础上进行优化」⇒ 口径**一定会被改**。改的时候屏幕上不会报错
 *（只会显示另一个数），所以每一条口径都得有一条用例跟着。
 *
 * ⚠️ 用例里每一个「不计数」的断言都配了**对照**（同一形状但该计数的那种）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { STATS_TABS, exploreClassSummary, needsAttentionQuestions, visibleStatsTabs, worksheetClassSummary } from './class-stats.ts';
import type { WorksheetBoardAnswerRow, WorksheetBoardWorksheet, WorksheetQuestionNode } from '@/lib/types';

function node(id: string, type = 'single-choice'): WorksheetQuestionNode {
  return { id, type, prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children: [] };
}

function task(id: string, title: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: 'task', prompt: title, inputMode: 'keyboard', data: {}, children };
}

function row(questionId: string, over: Partial<WorksheetBoardAnswerRow> = {}): WorksheetBoardAnswerRow {
  return {
    questionId, status: 'submitted', isCorrect: null, gradeState: null, score: null,
    reviewedAt: null, value: null, createdAt: null, savedAt: null, saveCount: null, ...over,
  };
}

function sheet(participants: Array<{ id: string; rows: WorksheetBoardAnswerRow[] }>): WorksheetBoardWorksheet {
  return {
    id: 'w1',
    title: '光合作用',
    participants: participants.map((p) => ({
      participantId: p.id, name: `参与者${p.id}`, kind: 'student', groupName: null, answerRows: p.rows,
    })),
  };
}

/* ── 学习单那一页 ────────────────────────────────────────────────────── */

test('🔴 逐题四个数：只数已提交的格，且判分结论**只读 `gradeState`**', () => {
  const s = worksheetClassSummary(
    sheet([
      { id: 'p1', rows: [row('q1', { gradeState: 'correct' }), row('q2', { gradeState: 'incorrect' })] },
      // p2 的 q1 还是草稿（没判分）—— 它**不进 submitted**，也不进任何判分档。
      { id: 'p2', rows: [row('q1', { status: 'draft', gradeState: 'correct' })] },
    ]),
    [node('q1'), node('q2')],
  );
  assert.equal(s.participants, 2);
  assert.equal(s.questions, 2);
  assert.equal(s.totalPairs, 4);
  assert.equal(s.submittedPairs, 2, '只有 p1 的两题交了一一 p2 那一题是草稿');
  const q1 = s.rows[0];
  assert.equal(q1.submitted, 1, '草稿不算已交');
  assert.equal(q1.correct, 1);
  assert.equal(q1.graded, 1, '草稿那一行的 gradeState 是脏数据，不许计进判分档');
  assert.equal(q1.total, 2, '分母是参与者数');
  assert.equal(s.rows[1].wrong, 1);
});

test('🔴 engaged 数的是「有作答记录的人」，不是「开始作答的人」', () => {
  // 有一行就是有动作 —— 而 status 是 draft 还是有行、没动过，格子上本来就分不出来。
  const s = worksheetClassSummary(
    sheet([{ id: 'p1', rows: [row('q1', { status: 'draft' })] }, { id: 'p2', rows: [] }]),
    [node('q1')],
  );
  assert.equal(s.engaged, 1, '只有 p1 有行');
  assert.equal(s.participants, 2);
});

test('⚠️ 认不出的题 id：丢掉，**不**给它在结果里新建一行', () => {
  // 教师删过题之后，旧作答行还在库里 —— 给它建行会让「题数」与实际不符。
  const s = worksheetClassSummary(sheet([{ id: 'p1', rows: [row('q_gone', { gradeState: 'correct' })] }]), [node('q1')]);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].questionId, 'q1');
  assert.equal(s.submittedPairs, 0, '那一行不属于这份学习单 ⇒ 一个数都不该进');
});

test('★ 题号与题型来自题目树（与矩阵/抽屉同源）', () => {
  const s = worksheetClassSummary(
    sheet([{ id: 'p1', rows: [] }]),
    [task('t1', '任务一', [node('q1', 'fill-blank')])],
  );
  assert.equal(s.rows[0].heading, '任务一 · 1');
  assert.equal(s.rows[0].typeLabel, '填空题');
  assert.equal(s.questions, 1, '任务本身不是一道题');
});

test('🔴 最需要讲的题：有判分数据 ⇒ 按**答错人数**降序', () => {
  const s = worksheetClassSummary(
    sheet([
      { id: 'p1', rows: [row('q1', { gradeState: 'incorrect' }), row('q2', { gradeState: 'incorrect' })] },
      { id: 'p2', rows: [row('q1', { gradeState: 'incorrect' }), row('q2', { gradeState: 'correct' })] },
      { id: 'p3', rows: [row('q1', { gradeState: 'correct' }), row('q2', { gradeState: 'correct' })] },
    ]),
    [node('q1'), node('q2')],
  );
  const picked = needsAttentionQuestions(s);
  assert.equal(picked.mode, 'byWrong');
  assert.deepEqual(picked.rows.map((r) => r.questionId), ['q1', 'q2'], 'q1 错 2 人、q2 错 1 人');
});

test('🔴 最需要讲的题：**一道判分数据都没有** ⇒ 退回按「最多人没交」排序', () => {
  // ⚠️ 这一档是必需的：判分全 0 时按「答错人数」排等于按题序取前三，
  //    而屏幕上会写着「错得最多的题」—— 那是编出来的结论。
  const s = worksheetClassSummary(
    sheet([
      { id: 'p1', rows: [row('q1', { gradeState: null })] },
      { id: 'p2', rows: [] },
      { id: 'p3', rows: [] },
    ]),
    [node('q1'), node('q2')],
  );
  const picked = needsAttentionQuestions(s);
  assert.equal(picked.mode, 'byUnsubmitted');
  // q2 一票都没有（3 人未交），q1 有 1 人交过 ⇒ q2 排前面。
  assert.deepEqual(picked.rows.map((r) => r.questionId), ['q2', 'q1']);
});

test('⚠️ 最需要讲的题：全对且全班都交了的题**不出现**在名单里', () => {
  const s = worksheetClassSummary(
    sheet([{ id: 'p1', rows: [row('q1', { gradeState: 'correct' }), row('q2', { gradeState: 'incorrect' })] }]),
    [node('q1'), node('q2')],
  );
  const picked = needsAttentionQuestions(s);
  assert.deepEqual(picked.rows.map((r) => r.questionId), ['q2'], 'q1 错 0 人 ⇒ 不进名单');
});

test('最需要讲的题：最多 `limit` 条（默认 3）', () => {
  const nodes = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => node(id));
  const s = worksheetClassSummary(
    sheet([{ id: 'p1', rows: nodes.map((n) => row(n.id, { gradeState: 'incorrect' })) }]),
    nodes,
  );
  assert.equal(needsAttentionQuestions(s).rows.length, 3);
  assert.equal(needsAttentionQuestions(s, 2).rows.length, 2);
});

test('⚠️ 空的学习单 / 零参与者：不抛，且分母如实是 0', () => {
  const s = worksheetClassSummary(sheet([]), []);
  assert.equal(s.questions, 0);
  assert.equal(s.participants, 0);
  assert.equal(s.totalPairs, 0);
  assert.deepEqual(needsAttentionQuestions(s).rows, []);
});

/* ── 探究空间那一页 ──────────────────────────────────────────────────── */

test('🔴 探究空间：有画面 / 正打开 / 放弃采集，三个数各数各的', () => {
  const s = exploreClassSummary(['a', 'b', 'c', 'd'], {
    a: { dataUrl: 'data:image/png;base64,x', captureBlocked: false, presence: { webappId: 'w1', visible: true, depth: 30, switches: 1 } },
    b: { dataUrl: null, captureBlocked: true, presence: { webappId: 'w1', visible: true, depth: 10, switches: 0 } },
    // c 有画面但**切走了**（presence.visible false）⇒ 进 withFrame，不进 opened。
    c: { dataUrl: 'data:image/png;base64,y', captureBlocked: false, presence: { webappId: 'w2', visible: false, depth: 80, switches: 2 } },
    d: { dataUrl: null, captureBlocked: false, presence: null },
  });
  assert.equal(s.participants, 4);
  assert.equal(s.withFrame, 2, 'a 与 c');
  assert.equal(s.opened, 2, 'a 与 b（c 切走了）');
  assert.equal(s.blocked, 1, 'b 的设备放弃了采集 —— 与「画面还没到」是两件事');
});

test('🔴 探究空间：同一个网页多人 ⇒ 合并计数，深度取**最浅**的那个', () => {
  const s = exploreClassSummary(['a', 'b'], {
    a: { dataUrl: null, captureBlocked: false, presence: { webappId: 'w1', visible: true, depth: 70, switches: 0 } },
    b: { dataUrl: null, captureBlocked: false, presence: { webappId: 'w1', visible: true, depth: 10, switches: 0 } },
  });
  assert.deepEqual(s.viewing, [{ webappId: 'w1', count: 2, minDepth: 10 }], '最浅的那个才是「还有人没往下看」');
});

test('🔴 探究空间：切来切去的人按次数降序，**切走的人也算**（那正是次数大的）', () => {
  const s = exploreClassSummary(['a', 'b', 'c'], {
    a: { dataUrl: null, captureBlocked: false, presence: { webappId: 'w1', visible: false, depth: 0, switches: 9 } },
    b: { dataUrl: null, captureBlocked: false, presence: { webappId: 'w1', visible: true, depth: 0, switches: 3 } },
    c: { dataUrl: null, captureBlocked: false, presence: { webappId: 'w1', visible: true, depth: 0, switches: 0 } },
  }, 2);
  assert.deepEqual(s.switchy.map((x) => x.studentId), ['a', 'b'], 'a 切走了但次数最多，必须还在名单里');
});

test('⚠️ 探究空间：没状态的学生（`undefined`）不抛，也不进任何计数', () => {
  const s = exploreClassSummary(['a', 'ghost'], {
    a: { dataUrl: null, captureBlocked: false, presence: null },
  });
  assert.equal(s.participants, 2, '分母仍然是名册（那一个学生是参与者，只是没有状态）');
  assert.equal(s.withFrame, 0);
  assert.deepEqual(s.viewing, []);
  assert.deepEqual(s.switchy, []);
});

/* ── Tab 栏 ──────────────────────────────────────────────────────────── */

test('🔴 三个页签：顺序与名字就是教师给的三件套', () => {
  assert.deepEqual(STATS_TABS.map((tab) => tab.label), ['智能学伴', '学习单', '探究空间']);
  assert.equal(new Set(STATS_TABS.map((tab) => tab.id)).size, 3, 'id 不许重复');
});

/* ── 页签显隐（★ 2026-09-29，教师：根据本堂课的模块设置自动决定）──────────────── */

test('🔴 三个都配了 ⇒ 三个页签都在', () => {
  const tabs = visibleStatsTabs([[
    { moduleKey: 'learning-sheet' }, { moduleKey: 'explorer' }, { moduleKey: 'companion' },
  ]]);
  assert.deepEqual(tabs.map((tab) => tab.id), ['companion', 'worksheet', 'explore']);
});

test('🔴 只配了学习单 ⇒ 只剩「学习单」那一页（外加恒有的学伴）', () => {
  // ⚠️ 这一条正是「只判 hidden 不够」：没配网页的课堂不该有一个空的「探究空间」统计页。
  const tabs = visibleStatsTabs([[{ moduleKey: 'learning-sheet' }]]);
  assert.deepEqual(tabs.map((tab) => tab.id), ['worksheet']);
});

test('🔴 高级模式：各组配得不一样 ⇒ 取**并集**（教师看的是全班）', () => {
  // 第 1 组只配了网页、第 2 组只配了学习单 ⇒ 两页都要有。
  // ⚠️ 按「课堂级那一份」判的话这里会**一个页签都不剩**（高级模式课堂级材料本就不落库）。
  const tabs = visibleStatsTabs([
    [{ moduleKey: 'explorer' }, { moduleKey: 'companion' }],
    [{ moduleKey: 'learning-sheet' }, { moduleKey: 'companion' }],
  ]);
  assert.deepEqual(tabs.map((tab) => tab.id), ['companion', 'worksheet', 'explore']);
});

test('⚠️ 一个都没配 / 没有任何参与者 ⇒ 零个页签（调用方据此整块不渲染）', () => {
  assert.deepEqual(visibleStatsTabs([]), []);
  assert.deepEqual(visibleStatsTabs([[]]), []);
});

test('⚠️ 认不出的 moduleKey 不算任何一页（线缆上的脏值不许把页签点亮）', () => {
  assert.deepEqual(visibleStatsTabs([[{ moduleKey: 'worksheet' }, { moduleKey: 'explore' }]]), []);
});
