/**
 * ★ M7a：载荷的**选择**（谁进来）与**形态**（是文档还是联系表）。
 *
 * 🔴 这里每一条错了都**不报错**，只会让教师看到一份缺人的名单 —— 所以逐条钉。
 * 三条最要命的（都在 Review Focus 里）：
 *   · 零份已提交（教师最可能踩：全班还没交就点开了）
 *   · 形状认不出的作答被**静默过滤**（后果是 covered 说 12 而文档只有 8 段）
 *   · 混杂（教师中途改过作答方式）被当成单一形态 ⇒ 笔迹条目整批消失
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_TEXT_MAX, DEFAULT_ANALYSIS_KNOBS, KNOBS_SETTING_KEY, SHEET_GAP, SHEET_LABEL_H,
  SHEET_MARGIN, buildAnalysisPayload, buildTextDocument, entriesFromAggregate, entriesToAggregate, isAnalysisStale,
  lastSubmittedAt, layoutSheets, normalizeAnalysisKnobs, payloadKindOf, selectAnalyzeEntries,
  type AnalyzeEntry, type Participant, type RawAnswer,
} from '../services/analysis-payload.js';
import type { QuestionNode } from '../services/worksheet-questions.js';

const ink = (strokes: number) => ({
  format: 'ink/v1',
  canvas: { w: 320, h: 240 },
  strokes: Array.from({ length: strokes }, () => ({ points: [[0, 0], [1, 1]], width: 0.01, color: '#111111' })),
});
const people: Participant[] = [
  { participantId: 'p1', name: '张三' },
  { participantId: 'p2', name: '李四' },
  { participantId: 'p3', name: '王五' },
];
const row = (participantId: string, status: string, value: unknown): RawAnswer =>
  ({ participantId, questionId: 'q1', status, value });

test('只收 status === "submitted"，未作答与草稿都不进载荷', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'text/v1', text: '甲' }),
    row('p2', 'draft', { format: 'text/v1', text: '写到一半' }),
    row('p3', 'unanswered', null),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => e.studentId), ['p1']);
  assert.equal(entries[0].kind, 'text');
  assert.equal(entries[0].text, '甲');
});

test('🔴 零份已提交 ⇒ 空数组（不抛、不造一条假的）', () => {
  assert.deepEqual(selectAnalyzeEntries([], people, 'q1'), []);
  assert.deepEqual(
    selectAnalyzeEntries([row('p1', 'draft', { format: 'text/v1', text: 'x' })], people, 'q1'), []);
});

test('顺序按 studentId 升序，与入参顺序无关（模型会说「第 3 格」，顺序必须可复现）', () => {
  const answers = [
    row('p3', 'submitted', { format: 'text/v1', text: '丙' }),
    row('p1', 'submitted', { format: 'text/v1', text: '甲' }),
    row('p2', 'submitted', { format: 'text/v1', text: '乙' }),
  ];
  assert.deepEqual(selectAnalyzeEntries(answers, people, 'q1').map((e) => e.studentId), ['p1', 'p2', 'p3']);
  assert.deepEqual(
    selectAnalyzeEntries([...answers].reverse(), people, 'q1').map((e) => e.studentId), ['p1', 'p2', 'p3']);
});

test('🔴 形状认不出的作答必须以 unknown 留在载荷里（静默过滤会让 covered 与格子数对不上）', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'choice/v1', selected: ['a'] }),   // 题型被改过，旧值还在
    row('p2', 'submitted', 'not-an-object'),
    row('p3', 'submitted', null),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => [e.studentId, e.kind]),
    [['p1', 'unknown'], ['p2', 'unknown'], ['p3', 'unknown']]);
});

test('笔迹的格式判据是 format（与 judge() 同一条），不是题型', () => {
  const [entry] = selectAnalyzeEntries([row('p1', 'submitted', ink(2))], people, 'q1');
  assert.equal(entry.kind, 'ink');
  assert.equal(entry.ink?.strokes.length, 2);
  assert.equal(entry.ink?.canvas.w, 320);
});

test('🔴 笔迹值形状坏掉（canvas 不是数 / strokes 不是数组）⇒ unknown 而不是抛', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'ink/v1', canvas: { w: 'x', h: 240 }, strokes: [] }),
    row('p2', 'submitted', { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: 'nope' }),
  ], people, 'q1');
  assert.deepEqual(entries.map((e) => e.kind), ['unknown', 'unknown']);
});

test('文本值为空串仍然算 text（空白是学生的作答，不是「认不出」）', () => {
  const [entry] = selectAnalyzeEntries([row('p1', 'submitted', { format: 'text/v1', text: '' })], people, 'q1');
  assert.equal(entry.kind, 'text');
  assert.equal(entry.text, '');
});

test('只收这一道题的作答行（同一份学习单里别的题不进载荷）', () => {
  const entries = selectAnalyzeEntries([
    { participantId: 'p1', questionId: 'q2', status: 'submitted', value: { format: 'text/v1', text: '别题' } },
  ], people, 'q1');
  assert.deepEqual(entries, []);
});

test('参与者名单里查不到的作答行被丢掉（脏数据不抛）', () => {
  assert.deepEqual(selectAnalyzeEntries([row('ghost', 'submitted', { format: 'text/v1', text: 'x' })], people, 'q1'), []);
});

test('客观题按题型翻译成语义文本，并把本地判分结果带给智能体', () => {
  const question: QuestionNode = {
    id: 'q1', type: 'single-choice', prompt: '哪一种变化属于化学变化？', inputMode: 'keyboard', children: [],
    data: {
      options: [{ key: 'A', text: '冰融化' }, { key: 'B', text: '铁生锈' }],
      correctKeys: ['B'],
      explanation: '是否生成新物质是判断依据。',
    },
  };
  const entries = selectAnalyzeEntries([{
    participantId: 'p1', questionId: 'q1', status: 'submitted', gradeState: 'incorrect',
    value: { format: 'choice/v1', selected: ['A'] },
  }], people, 'q1', question);

  assert.equal(entries[0].text, '选择：A. 冰融化');
  assert.equal(entries[0].gradeState, 'incorrect');

  const payload = buildAnalysisPayload({
    question: {
      questionId: 'q1', heading: '任务一 · 1', typeLabel: '单选题', prompt: question.prompt,
      details: '选项：A. 冰融化；B. 铁生锈',
      referenceAnswer: 'B. 铁生锈\n参考说明：是否生成新物质是判断依据。',
    },
    entries,
    total: 3,
    knobs: DEFAULT_ANALYSIS_KNOBS,
  });
  assert.deepEqual(payload.localStats, { correct: 0, partial: 0, incorrect: 1, ungraded: 0 });
  assert.match(payload.text ?? '', /参考答案：B\. 铁生锈/);
  assert.match(payload.text ?? '', /本地统计：全对 0；部分正确 0；答错 1/);
  assert.match(payload.text ?? '', /User_001｜答错[\s\S]*选择：A\. 冰融化/);
});

test('形态：全文字 ⇒ text · 全笔迹 ⇒ image · 混杂 ⇒ mixed · 全 unknown/空 ⇒ text', () => {
  const t = (id: string) => ({ studentId: id, kind: 'text' as const, text: 'x' });
  const i = (id: string) => ({ studentId: id, kind: 'ink' as const, ink: ink(1) as never });
  const u = (id: string) => ({ studentId: id, kind: 'unknown' as const });
  assert.equal(payloadKindOf([t('a'), t('b')]), 'text');
  assert.equal(payloadKindOf([i('a'), i('b')]), 'image');
  assert.equal(payloadKindOf([t('a'), i('b')]), 'mixed');
  assert.equal(payloadKindOf([i('a'), t('b')]), 'mixed', '顺序反过来也是 mixed');
  assert.equal(payloadKindOf([u('a')]), 'text', '全认不出时至少给一份文档，把那几条说出来');
  assert.equal(payloadKindOf([]), 'text', '零份作答时给空文档，不给一张空格子图');
});

test('🔴 混杂时不许把笔迹丢掉：mixed 是必须的（教师中途改过作答方式）', () => {
  const entries = selectAnalyzeEntries([
    row('p1', 'submitted', { format: 'text/v1', text: '键盘答的' }),
    row('p2', 'submitted', ink(3)),
  ], people, 'q1');
  assert.equal(payloadKindOf(entries), 'mixed');
  assert.deepEqual(entries.map((e) => e.kind), ['text', 'ink']);
  assert.equal(entries.length, 2, '混杂时两条都要在 —— 丢一条就是「已交 2 人」而只有一条内容');
});

/* ── Task 3：文字类的聚合文档 ─────────────────────────────────────────── */

// 题号是**两级**的串（`任务一 · 3`），服务端与前端同一份（对拍用例钉着）。
const meta = { questionId: 'q1', typeLabel: '问答题', prompt: '说说你的看法', heading: '任务一 · 3' };
const docLabels = new Map([['p1', 'User_001'], ['p2', 'User_002'], ['p3', 'User_003']]);

test('文档：抬头有题号/题型/题干/覆盖数，逐条带伪名，顺序就是入参顺序', () => {
  const doc = buildTextDocument(meta, [
    { studentId: 'p1', kind: 'text', text: '我认为是甲' },
    { studentId: 'p2', kind: 'text', text: '我觉得是乙' },
  ], docLabels, 12, 40);
  assert.match(doc, /任务一 · 3/);      // 抬头印的就是看板上那个题号
  assert.match(doc, /问答题/);
  assert.match(doc, /说说你的看法/);
  assert.match(doc, /已交 12\/40/);
  assert.match(doc, /User_001/);
  assert.match(doc, /我认为是甲/);
  // 真名**不许**出现在文档里（文档就是将来发给 AI 的那份东西）
  assert.ok(!doc.includes('张三'), '真名不得进文档 —— 上线的只有伪名');
  assert.ok(!doc.includes('李四'), '真名不得进文档');
  assert.ok(doc.indexOf('User_001') < doc.indexOf('User_002'), '顺序必须保持');
});

test('🔴 零份已提交 ⇒ 仍然是一份说得清的文档（不是空字符串）', () => {
  const doc = buildTextDocument(meta, [], docLabels, 0, 40);
  assert.ok(doc.length > 0, '零份也要有一份文档，不能是空字符串');
  assert.match(doc, /已交 0\/40/);
  assert.match(doc, /尚无/);
});

test('🔴 超长答案被截断，且**说出来**（不许悄悄砍）', () => {
  const long = '甲'.repeat(ANSWER_TEXT_MAX + 500);
  const doc = buildTextDocument(meta,
    [{ studentId: 'p1', kind: 'text', text: long }], docLabels, 1, 40);
  assert.ok(!doc.includes(long), '不该原样带出超长答案');
  assert.match(doc, /已截断/, '截断必须有一句说明');
  assert.ok(doc.includes('甲'.repeat(ANSWER_TEXT_MAX)), '前 ANSWER_TEXT_MAX 个字要保留');
  assert.match(doc, new RegExp(String(ANSWER_TEXT_MAX + 500)), '要说清原文共多少字');
});

test('刚好 ANSWER_TEXT_MAX 个字不截断（边界不多不少）', () => {
  const exact = '乙'.repeat(ANSWER_TEXT_MAX);
  const doc = buildTextDocument(meta,
    [{ studentId: 'p1', kind: 'text', text: exact }], docLabels, 1, 40);
  assert.ok(doc.includes(exact));
  assert.ok(!doc.includes('已截断'), '刚好到上限不该标截断');
});

test('🔴 空白答案与「认不出」的条目都要在文档里说出来（不能只剩一个伪名）', () => {
  const doc = buildTextDocument(meta, [
    { studentId: 'p1', kind: 'text', text: '   ' },
    { studentId: 'p2', kind: 'unknown' },
  ], docLabels, 2, 40);
  assert.match(doc, /User_001[\s\S]*?空白/, '空文字要说「空白」');
  assert.match(doc, /User_002[\s\S]*?认不出/, 'unknown 要说「认不出」');
});

test('缺伪名时回落成参与者 id（不抛、不留空）', () => {
  const doc = buildTextDocument(meta,
    [{ studentId: 'pX', kind: 'text', text: 'x' }], new Map(), 1, 40);
  assert.match(doc, /pX/);
});

test('题干为空时不留一个空洞（写「（题干为空）」）', () => {
  const doc = buildTextDocument({ ...meta, prompt: '' }, [], docLabels, 0, 3);
  assert.match(doc, /题干为空/);
});

/* ── Task 4：联系表的排版与旋钮 ───────────────────────────────────────── */

const PT: [number, number] = [0, 0];
const inkEntries = (n: number): AnalyzeEntry[] => Array.from({ length: n }, (_, i) => ({
  studentId: `p${String(i + 1).padStart(3, '0')}`,
  kind: 'ink' as const,
  ink: { format: 'ink/v1' as const, canvas: { w: 320, h: 240 }, strokes: [{ points: [PT, [1, 1]], width: 0.01, color: '#111111' }] },
}));
const inkLabels = (n: number): Map<string, string> => new Map(
  Array.from({ length: n }, (_, i) => [`p${String(i + 1).padStart(3, '0')}`, `User_${String(i + 1).padStart(3, '0')}`]));

test('默认旋钮就是规格裁定 3 定下的那四个值', () => {
  assert.deepEqual(DEFAULT_ANALYSIS_KNOBS, { cellWidth: 320, cellHeight: 240, columns: 3, maxCellsPerSheet: 12 });
  assert.equal(KNOBS_SETTING_KEY, 'worksheet-analysis-knobs');
});

test('12 份 ⇒ 1 张 3×4 · 40 份 ⇒ 4 张（最后一张装剩下的）', () => {
  const one = layoutSheets(inkEntries(12), inkLabels(12), DEFAULT_ANALYSIS_KNOBS);
  assert.equal(one.length, 1);
  assert.equal(one[0].cells.length, 12);
  const four = layoutSheets(inkEntries(40), inkLabels(40), DEFAULT_ANALYSIS_KNOBS);
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((s) => s.cells.length), [12, 12, 12, 4]);
  assert.deepEqual(four.map((s) => s.sheetIndex), [0, 1, 2, 3]);
});

test('格子坐标按行列排：外边距 → 标签行 → 格子；换行回第一列', () => {
  const [sheet] = layoutSheets(inkEntries(4), inkLabels(4), DEFAULT_ANALYSIS_KNOBS);
  const [c0, c1, c2, c3] = sheet.cells;
  assert.deepEqual([c0.x, c0.y], [SHEET_MARGIN, SHEET_MARGIN + SHEET_LABEL_H]);
  assert.equal(c1.x, SHEET_MARGIN + 320 + SHEET_GAP);
  assert.equal(c1.y, c0.y, '同一行的 y 相同');
  // ⚠️ 3 列时 index 2 **仍在第一行**（第 3 列），换行的是 index 3 —— 计划里这条断言
  // 把 c2/c3 标反了，被这条用例当场抓住。
  assert.equal(c2.x, SHEET_MARGIN + 2 * (320 + SHEET_GAP), 'index 2 是第 3 列');
  assert.equal(c2.y, c0.y, 'index 2 仍在第一行');
  assert.equal(c3.x, c0.x, 'index 3 才换行回第一列');
  assert.equal(c3.y, c0.y + 240 + SHEET_LABEL_H + SHEET_GAP);
  assert.equal(c0.labelY, SHEET_MARGIN, '标签在格子上方、且在外边距之内');
  assert.equal(c0.labelX, c0.x);
  assert.equal(c3.labelY, c0.y + 240 + SHEET_LABEL_H + SHEET_GAP - SHEET_LABEL_H, '第二行的标签也在它自己格子之上');
  assert.equal(c0.w, 320); assert.equal(c0.h, 240);
  assert.equal(c0.anonLabel, 'User_001', '标签来自 labels 映射');
  assert.equal(c0.studentId, 'p001');
  assert.deepEqual(sheet.cells.map((c) => c.index), [0, 1, 2, 3], 'index 是全局的格序');
});

test('画布尺寸 = 外边距 + 列宽 + 间距 + 行高（含每行的标签行）', () => {
  const [sheet] = layoutSheets(inkEntries(12), inkLabels(12), DEFAULT_ANALYSIS_KNOBS);
  assert.equal(sheet.width, SHEET_MARGIN * 2 + 3 * 320 + 2 * SHEET_GAP);
  assert.equal(sheet.height, SHEET_MARGIN * 2 + 4 * (240 + SHEET_LABEL_H) + 3 * SHEET_GAP);
});

test('🔴 空笔迹与「认不出」也要占一格（丢了就让 covered 与格子数对不上）', () => {
  const entries: AnalyzeEntry[] = [
    { studentId: 'p001', kind: 'ink',
      ink: { format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] } },
    { studentId: 'p002', kind: 'unknown' },
    { studentId: 'p003', kind: 'text', text: '这题我写文字了' },
  ];
  const labels = new Map([['p001', 'User_001'], ['p002', 'User_002'], ['p003', 'User_003']]);
  const [sheet] = layoutSheets(entries, labels, DEFAULT_ANALYSIS_KNOBS);
  assert.equal(sheet.cells.length, 3, '三种条目各占一格');
  assert.deepEqual(sheet.cells.map((c) => c.hasInk), [false, false, false], '空笔迹与 unknown 都没有画可渲');
});

test('有笔画的笔迹格 hasInk 为真', () => {
  const [sheet] = layoutSheets(inkEntries(2), inkLabels(2), DEFAULT_ANALYSIS_KNOBS);
  assert.deepEqual(sheet.cells.map((c) => c.hasInk), [true, true]);
});

test('零份 ⇒ 零张（不给一张空图）', () => {
  assert.deepEqual(layoutSheets([], new Map(), DEFAULT_ANALYSIS_KNOBS), []);
});

test('🔴 旋钮可配：改 maxCellsPerSheet 就改分张数，不需要改代码', () => {
  const sheets = layoutSheets(inkEntries(12), inkLabels(12), { ...DEFAULT_ANALYSIS_KNOBS, maxCellsPerSheet: 4 });
  assert.equal(sheets.length, 3);
  assert.deepEqual(sheets.map((s) => s.cells.length), [4, 4, 4]);
  const wide = layoutSheets(inkEntries(2), inkLabels(2), { ...DEFAULT_ANALYSIS_KNOBS, columns: 1, cellWidth: 640, cellHeight: 480 });
  assert.equal(wide[0].width, SHEET_MARGIN * 2 + 640);
  assert.equal(wide[0].cells[1].y, SHEET_MARGIN + SHEET_LABEL_H + 480 + SHEET_LABEL_H + SHEET_GAP);
});

test('🔴 旋钮归一化：坏值/越界/缺字段一律回落默认（不抛、不产出一张 0 宽图）', () => {
  assert.deepEqual(normalizeAnalysisKnobs(null), DEFAULT_ANALYSIS_KNOBS);
  assert.deepEqual(normalizeAnalysisKnobs('nope'), DEFAULT_ANALYSIS_KNOBS);
  assert.deepEqual(normalizeAnalysisKnobs({}), DEFAULT_ANALYSIS_KNOBS);
  assert.deepEqual(normalizeAnalysisKnobs({ cellWidth: -5, columns: 0, maxCellsPerSheet: 1e9 }), DEFAULT_ANALYSIS_KNOBS);
  assert.deepEqual(normalizeAnalysisKnobs({ cellWidth: 200 }), { ...DEFAULT_ANALYSIS_KNOBS, cellWidth: 200 }, '合法的那个要留下');
  assert.deepEqual(normalizeAnalysisKnobs({ columns: 4.7 }), { ...DEFAULT_ANALYSIS_KNOBS, columns: 4 }, '小数取整');
  assert.deepEqual(normalizeAnalysisKnobs({ columns: NaN }), DEFAULT_ANALYSIS_KNOBS, 'NaN 不是数');
  assert.deepEqual(normalizeAnalysisKnobs('{"columns":2}'), { ...DEFAULT_ANALYSIS_KNOBS, columns: 2 }, 'JSON 串也要认');
  assert.deepEqual(normalizeAnalysisKnobs('{坏 json'), DEFAULT_ANALYSIS_KNOBS, '坏 JSON 回落而不是抛');
});

/* ── 落库 / 取回 ──────────────────────────────────────────────────────── */

test('往返：条目 → aggregate → 条目，内容与顺序都不变', () => {
  const entries: AnalyzeEntry[] = [
    { studentId: 'p1', kind: 'text', text: '甲' },
    { studentId: 'p2', kind: 'ink', ink: ink(2) as never },
    { studentId: 'p3', kind: 'unknown' },
  ];
  const back = entriesFromAggregate(entriesToAggregate(entries));
  assert.deepEqual(back.map((e) => [e.studentId, e.kind, e.text ?? null]), [
    ['p1', 'text', '甲'], ['p2', 'ink', null], ['p3', 'unknown', null],
  ]);
  assert.equal(back[1].ink?.strokes.length, 2);
});

test('🔴 脏 aggregate 不抛：坏行落 unknown / 被跳过，整体不是数组 ⇒ 空数组', () => {
  assert.deepEqual(entriesFromAggregate(null), []);
  assert.deepEqual(entriesFromAggregate('nope'), []);
  assert.deepEqual(entriesFromAggregate({}), []);
  // 有条目但没有 studentId ⇒ 跳过（它没法归属，也占不了一格）
  assert.deepEqual(entriesFromAggregate([{ kind: 'text', text: 'x' }]), []);
  // kind 是没见过的值 ⇒ unknown（不是丢）
  const back = entriesFromAggregate([{ studentId: 'p1', kind: '未来题型', text: null, ink: null }]);
  assert.deepEqual(back.map((e) => e.kind), ['unknown']);
  // kind 是 ink 但 ink 坏了 ⇒ unknown（不是丢，也不是抛）
  const badInk = entriesFromAggregate([{ studentId: 'p1', kind: 'ink', ink: { format: 'ink/v1', canvas: { w: 'x' } } }]);
  assert.deepEqual(badInk.map((e) => e.kind), ['unknown']);
  // 只给 studentId 的最小合法行（`displayName` 已从类型里去掉了 —— 见 `AnalyzeEntry` 的注释）
  const minimal = entriesFromAggregate([{ studentId: 'p9', kind: 'text', text: 'x' }]);
  assert.deepEqual(minimal.map((e) => [e.studentId, e.kind, e.text]), [['p9', 'text', 'x']]);
});

/* ── 陈旧判定 ─────────────────────────────────────────────────────────── */

test('★ lastSubmittedAt：只数**这一道题**的定稿时刻，取最新的那个', () => {
  const answers: RawAnswer[] = [
    { participantId: 'p1', questionId: 'q1', status: 'submitted', value: null, submittedAt: '2026-09-25T10:00:00.000Z' },
    { participantId: 'p2', questionId: 'q1', status: 'submitted', value: null, submittedAt: '2026-09-25T10:05:00.000Z' },
    { participantId: 'p3', questionId: 'q1', status: 'submitted', value: null, submittedAt: null },
    // 别的题交得再晚也不算 —— 否则「有人交了别的题」也会让这份分析显示过期（假提示）
    { participantId: 'p4', questionId: 'q2', status: 'submitted', value: null, submittedAt: '2026-09-25T11:00:00.000Z' },
  ];
  assert.equal(lastSubmittedAt(answers, 'q1'), '2026-09-25T10:05:00.000Z');
  assert.equal(lastSubmittedAt(answers, 'q2'), '2026-09-25T11:00:00.000Z');
  assert.equal(lastSubmittedAt([], 'q1'), null);
  assert.equal(lastSubmittedAt(answers, 'nope'), null);
});

test('★ isAnalysisStale：算完之后又有人交 ⇒ 陈旧；同一时刻不算', () => {
  const t = '2026-09-25T10:00:00.000Z';
  assert.equal(isAnalysisStale(t, null), false, '这道题没人交过 ⇒ 不存在陈旧');
  assert.equal(isAnalysisStale(t, '2026-09-25T09:59:59.000Z'), false);
  assert.equal(isAnalysisStale(t, t), false, '同一时刻不算（`>` 不是 `>=`）');
  assert.equal(isAnalysisStale(t, '2026-09-25T10:00:01.000Z'), true);
});

test('反证：把 `isAnalysisStale` 的方向写反 ⇒ 上一条必须红', () => {
  const t = '2026-09-25T10:00:00.000Z';
  assert.equal(isAnalysisStale(t, '2026-09-25T10:00:01.000Z'), true);
  assert.equal(isAnalysisStale('2026-09-25T10:00:01.000Z', t), false,
    '把「算完的时刻」往后挪一秒，同一个提交就不再是「之后」的 —— 方向写反时两条会同真');
});

test('🔴 越界坐标必须在**读**的时候夹到 0..1（不然那条线会画进隔壁同学的格子）', () => {
  // 与 `src/lib/worksheet-ink.ts` 的 `readPoint` 同一口径（`worksheet-ink.ts:100-101` 逐字写着
  // 「那边把越界的数夹到 0..1，这里不夹……**夹取是读的一侧的事**」）。
  // ⚠️ 不夹的后果不是「画歪一点」：`toPixel` 是 `x * box.w`，而联系表把每格平移到自己的框里 ——
  // 于是负坐标那一笔会被画进**相邻参与者**的格子里，看起来就是那个人画的（跨人错位，且不报错）。
  const [entry] = selectAnalyzeEntries([
    row('p1', 'submitted', {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [{ points: [[-0.5, 0.5], [2, 0.9]], width: 0.01, color: '#111111' }],
    }),
  ], people, 'q1');
  assert.equal(entry.kind, 'ink');
  assert.deepEqual(entry.ink?.strokes[0].points, [[0, 0.5], [1, 0.9]]);
});

test('🔴 坐标不是有限数的那一点被丢掉（不是留着让整张图渲不出来）', () => {
  const [entry] = selectAnalyzeEntries([
    row('p1', 'submitted', {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [{ points: [[0, 0], [NaN, 0.5], [0.7, 0.7]], width: 0.01, color: '#111111' }],
    }),
  ], people, 'q1');
  assert.deepEqual(entry.ink?.strokes[0].points, [[0, 0], [0.7, 0.7]], '坏的那一点丢掉，好的一点留下');
});

test('形状不对的笔画整条丢掉（不是留一条空笔画）', () => {
  const [entry] = selectAnalyzeEntries([
    row('p1', 'submitted', {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [
        { points: [[0, 0], [1, 1]], width: 0.01, color: '#111111' },
        { points: 'nope', width: 0.01, color: '#111111' },
        { points: [[0.5]], width: 0.01, color: '#111111' },
      ],
    }),
  ], people, 'q1');
  assert.equal(entry.ink?.strokes.length, 1, '只留形状对的那一条');
  assert.equal(entry.ink?.strokes[0].points.length, 2);
});

test('🔴 图形的 shape 必须活过这一层（它是**第四份读入器**，不在对拍网里）', () => {
  // 🔴 `analysis-payload.ts` 自己重建每一笔（**不 import** `ink-path.ts`，那个文件才是被
  //    跨工程对拍盯住的那一份）⇒ 新字段被它吞掉时，**AI 看到的图与教师看到的不是同一个
  //    东西**，而两边都不报错。这正是「有九处各自读同一份数据，漏一处就静默不一致」的
  //    那一处 —— 今天它是全仓唯一一个**没有任何护栏**的读入器。
  const [entry] = selectAnalyzeEntries([
    row('p1', 'submitted', {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [{ points: [[0, 0], [1, 1]], width: 0.01, color: '#111111', shape: 'rect' }],
    }),
  ], people, 'q1');
  assert.equal(entry.kind, 'ink');
  const first = entry.ink?.strokes[0] as { shape?: string } | undefined;
  assert.equal(first?.shape, 'rect', 'shape 被这一层吞掉了 —— AI 会把学生画的矩形看成一条手写线');
  // 阴性对照：**认不出的形状**不许当成手写（与前端 `readInkValue` 同一条纪律：丢整笔）。
  const [bad] = selectAnalyzeEntries([
    row('p2', 'submitted', {
      format: 'ink/v1', canvas: { w: 320, h: 240 },
      strokes: [{ points: [[0, 0], [1, 1]], width: 0.01, color: '#111111', shape: 'hexagon' }],
    }),
  ], people, 'q1');
  assert.equal(bad.ink?.strokes.length, 0, '认不出的形状那一笔要被丢掉，不是静默当手写');
});
