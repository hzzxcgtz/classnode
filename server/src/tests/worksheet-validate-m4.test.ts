import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTION_TYPES,
  validateQuestion,
  type QuestionNode,
  type QuestionType,
} from '../services/worksheet-questions.js';

/**
 * M4a 的**编辑期校验**（`validateQuestion`）的用例。
 *
 * 🔴 **为什么这个文件必须有**：`validateQuestion` 是「本文件里最会骗人的一处」——
 * 它不认识某个题型时返回**空错误**（= 通过）。一条没写的分支不会红、不会抛、不会记日志，
 * 只会让一道新建的题**永远无法作答、也永远无法提交**，整卷永远停在 `in-progress`、
 * 看板「已交 N/M」永远填不满。
 *
 * `VALIDATORS` 那张 `Record<QuestionType, …>` 挡住的只是「键整个漏了」（编译错误）；
 * 「键在、内容是空的」只有用例挡得住。下面的第一条就是它。
 *
 * A2 的文件（`worksheet-grade-m4.test.ts`）测的是**判分**，与这里不重叠：
 * 判分错一道题教师能看见，校验漏一支谁也看不见。
 */

const node = (type: QuestionType, data: Record<string, unknown>): QuestionNode => ({
  id: `q_${type}`,
  type,
  prompt: '题干',
  inputMode: 'keyboard',
  data,
  children: [],
});

const rejected = (type: QuestionType, data: Record<string, unknown>): string[] => {
  const errors = validateQuestion(node(type, data));
  assert.ok(
    errors.length > 0,
    `题型「${type}」用这份 data 通过了校验：${JSON.stringify(data)} —— 它的校验分支多半没写`,
  );
  return errors;
};

const accepted = (type: QuestionType, data: Record<string, unknown>): void => {
  assert.deepEqual(
    validateQuestion(node(type, data)),
    [],
    `题型「${type}」这份合法 data 被拒了：${JSON.stringify(data)}`,
  );
};

// ---------------------------------------------------------------------------
// ⓪ 「每个题型都真的在校验」—— 本文件最重要的一条
// ---------------------------------------------------------------------------

test('🔴 每个可判分的题型，空 data 都必须被拒绝（漏写分支 = 那道题永远交不了）', () => {
  // 只有主观题豁免：它**真的**没有别的字段要校验（题干在上面的公共检查里）。
  const EXEMPT: readonly QuestionType[] = ['short-answer'];
  const checked: QuestionType[] = [];

  for (const type of QUESTION_TYPES) {
    if (EXEMPT.includes(type)) continue;
    rejected(type, {});
    checked.push(type);
  }

  // 阳性对照：豁免表不能把整个题型清单吞掉（`EXEMPT` 写成「全部」时上面一条都跑不到，
  // 而整个用例仍然是绿的 —— 这正是本项目反复出现的假绿形态）。
  assert.deepEqual(
    checked.slice().sort(),
    QUESTION_TYPES.filter((type) => !EXEMPT.includes(type)).slice().sort(),
    '每个非豁免题型都应真的被跑过',
  );
  assert.equal(checked.length, QUESTION_TYPES.length - EXEMPT.length);
  assert.ok(checked.length >= 7, `实际只跑到 ${checked.length} 个题型`);
});

test('题干为空是公共检查：所有题型都拦（含主观题）', () => {
  for (const type of QUESTION_TYPES) {
    const empty: QuestionNode = { id: 'q', type, prompt: '   ', inputMode: 'keyboard', data: {}, children: [] };
    assert.ok(validateQuestion(empty).includes('题干不能为空'), `题型「${type}」的空题干没被拦下`);
  }
});

// ---------------------------------------------------------------------------
// ① 判断题：与单选同一支
// ---------------------------------------------------------------------------

test('判断题与单选共用一支：correctKeys 必须恰好一个，且不要求 options', () => {
  accepted('true-false', { correctKeys: ['T'] });
  accepted('true-false', { correctKeys: ['F'] });
  rejected('true-false', { correctKeys: [] });
  rejected('true-false', { correctKeys: ['T', 'F'] });
  rejected('true-false', {});

  // 反向对照：判断题**不该**冒出「至少需要两个选项」那条 —— 它根本不存 options，
  // 一条错的提示会让教师去找一个不存在的设置项。
  for (const data of [{ correctKeys: [] }, { correctKeys: ['T'] }]) {
    const errors = validateQuestion(node('true-false', data));
    assert.ok(!errors.some((message) => message.includes('选项')), `判断题不该提「选项」：${errors.join(' / ')}`);
  }
});

test('单选题：选项数与正确答案都要查', () => {
  accepted('single-choice', { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: ['B'] });
  rejected('single-choice', { options: [{ key: 'A', text: '甲' }], correctKeys: ['A'] });
  rejected('single-choice', { options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], correctKeys: [] });
});

// ---------------------------------------------------------------------------
// ② 多选题
// ---------------------------------------------------------------------------

test('多选题：至少两个选项、至少一个正确答案，且每个答案都要指向真实选项', () => {
  const options = [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }];
  accepted('multi-choice', { options, correctKeys: ['A', 'C'], partialCredit: 'allow-missing' });
  accepted('multi-choice', { options, correctKeys: ['A'] });
  rejected('multi-choice', { options: [{ key: 'A', text: '甲' }], correctKeys: ['A'] });
  rejected('multi-choice', { options, correctKeys: [] });
  // 🔴 指向不存在的选项：那道题**没有任何学生能答对**，而看板上只表现为「正确率 0%」——
  // 教师会去怀疑学生，不会来怀疑这道题。
  rejected('multi-choice', { options, correctKeys: ['D'] });
  rejected('multi-choice', { options, correctKeys: ['A', 'B', 'Z'] });
});

// ---------------------------------------------------------------------------
// ③ 填空题：单空（M3 形状）与多空共存
// ---------------------------------------------------------------------------

test('填空题：没有 blanks 时走原来的单空路径（M3 的老数据不受影响）', () => {
  accepted('fill-blank', { answers: ['光合作用'] });
  rejected('fill-blank', { answers: [] });
  rejected('fill-blank', { answers: ['', '   '] });
  rejected('fill-blank', {});
});

test('填空题：有 blanks 时逐个非空', () => {
  accepted('fill-blank', { blanks: [{ answers: ['H2O'] }, { answers: ['二氧化碳', 'CO2'] }] });
  rejected('fill-blank', { blanks: [] });
  // 第二个空没有答案：整道题拒掉（只查第一个空的话，第二个空永远判不了分）
  rejected('fill-blank', { blanks: [{ answers: ['H2O'] }, { answers: [] }] });
  rejected('fill-blank', { blanks: [{ answers: ['H2O'] }, {}] });
  rejected('fill-blank', { blanks: [{ answers: ['H2O'] }, { answers: ['  '] }] });

  // ⚠️ 同一个毛病只报一条：一道 10 个空都没填的题甩 10 条一样的错，教师会以为有 10 个问题。
  const errors = validateQuestion(node('fill-blank', { blanks: [{}, {}, {}, {}] }));
  assert.equal(errors.filter((message) => message.includes('每个空')).length, 1);
});

// ---------------------------------------------------------------------------
// ④ 排序题
// ---------------------------------------------------------------------------

const ORDER_ITEMS = [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }, { id: 'i3', text: '丙' }];

test('排序题：合法形状', () => {
  accepted('order', { items: ORDER_ITEMS, correctOrder: ['i3', 'i1', 'i2'] });
  // 两个条目也合法（下界是 2，不是 3）
  accepted('order', { items: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }], correctOrder: ['b', 'a'] });
});

test('🔴 排序题：显示顺序与正确顺序相同 ⇒ 拒绝（学生什么都不做就是满分）', () => {
  const errors = rejected('order', { items: ORDER_ITEMS, correctOrder: ['i1', 'i2', 'i3'] });

  // 文案要指出**怎么办**，不只是「不合法」—— 教师看到的第一反应是「那我该怎么改」。
  assert.ok(
    errors.some((message) => message.includes('打乱')),
    `错误文案应告诉教师怎么改（打乱顺序），实际是：${errors.join(' / ')}`,
  );

  // 阴性对照：**只差一个位置**（后两项互换）确实与 items 的顺序不同 ⇒ 必须通过。
  // 这一条防止判据被写成「只要不是完全逆序就拒绝」之类更宽的东西。
  accepted('order', { items: ORDER_ITEMS, correctOrder: ['i1', 'i3', 'i2'] });
});

test('排序题：correctOrder 必须是 items 的 id 的一个排列', () => {
  rejected('order', { items: ORDER_ITEMS, correctOrder: ['i3', 'i1'] });             // 少一个
  rejected('order', { items: ORDER_ITEMS, correctOrder: ['i3', 'i1', 'i2', 'i9'] }); // 多一个不存在的
  rejected('order', { items: ORDER_ITEMS, correctOrder: ['i3', 'i1', 'i1'] });       // 重复顶替
  rejected('order', { items: ORDER_ITEMS, correctOrder: [] });
});

test('排序题：条目本身的坏形状（少于两个 / 缺 id / id 重复）', () => {
  rejected('order', { items: [{ id: 'i1', text: '甲' }], correctOrder: ['i1'] });
  rejected('order', { items: [], correctOrder: [] });
  // 没有 id 的条目**不是可以忽略的噪声**：静默丢掉它会让「排列」判据看着成立。
  rejected('order', { items: [{ id: 'i1', text: '甲' }, { text: '乙' }], correctOrder: ['i1'] });
  // 阳性对照：两个条目、id 齐全、顺序不同 ⇒ 通过（确认下面那条「重复 id」判据
  // 没有把正常的两条目题一起误伤）。
  accepted('order', { items: [{ id: 'i1', text: '甲' }, { id: 'i2', text: '乙' }], correctOrder: ['i2', 'i1'] });
  // id 重复：学生作答按 id 索引 ⇒ 两个条目在判分里永远只算一个
  rejected('order', { items: [{ id: 'i1', text: '甲' }, { id: 'i1', text: '乙' }], correctOrder: ['i1', 'i1'] });
});

// ---------------------------------------------------------------------------
// ⑤ 连线题
// ---------------------------------------------------------------------------

const LEFT = [{ id: 'l1', text: '甲' }, { id: 'l2', text: '乙' }];
const RIGHT = [{ id: 'r1', text: 'A' }, { id: 'r2', text: 'B' }];
const PAIRS = [{ leftId: 'l1', rightId: 'r2' }, { leftId: 'l2', rightId: 'r1' }];

test('连线题：完整一一对应才通过', () => {
  accepted('match', { left: LEFT, right: RIGHT, pairs: PAIRS });
});

test('连线题：左右不等长 / 缺项 / 两项连到同一个右项 都要拒绝', () => {
  rejected('match', { left: LEFT, right: [{ id: 'r1', text: 'A' }], pairs: PAIRS });
  rejected('match', { left: LEFT, right: RIGHT, pairs: [PAIRS[0]] });                       // 缺一个左项
  rejected('match', { left: LEFT, right: RIGHT, pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l2', rightId: 'r1' }] });
  rejected('match', { left: LEFT, right: RIGHT, pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l9', rightId: 'r2' }] });
  rejected('match', { left: LEFT, right: RIGHT, pairs: [] });
  rejected('match', { left: LEFT, right: RIGHT, pairs: [{ leftId: 'l1', rightId: 'r1' }, { leftId: 'l1', rightId: 'r2' }] });
  rejected('match', { left: LEFT, right: LEFT, pairs: [] });
});

// ---------------------------------------------------------------------------
// ⑥ 归类题
// ---------------------------------------------------------------------------

const ZONES = [{ id: 'z1', label: '哺乳类' }, { id: 'z2', label: '鸟类' }];

test('归类题：每个条目都要落到一个存在的框里', () => {
  accepted('categorize', { items: [{ id: 'i1', text: '猫' }], zones: ZONES, placement: { i1: 'z1' } });
  accepted('categorize', {
    items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '麻雀' }],
    zones: ZONES,
    placement: { i1: 'z1', i2: 'z2' },
  });
});

test('归类题：缺归属 / 指向不存在的框 都要拒绝', () => {
  rejected('categorize', { items: [{ id: 'i1', text: '猫' }], zones: ZONES, placement: {} });
  // 🔴 指向已删掉的框：只查「有没有这一项」的话它会一路存进去 ——
  // 学生端把它画到不存在的框里（或干脆不画），而它永远判不了分。
  rejected('categorize', { items: [{ id: 'i1', text: '猫' }], zones: ZONES, placement: { i1: 'z9' } });
  rejected('categorize', { items: [{ id: 'i1', text: '猫' }, { id: 'i2', text: '麻雀' }], zones: ZONES, placement: { i1: 'z1' } });
  rejected('categorize', { items: [], zones: ZONES, placement: {} });
  rejected('categorize', { items: [{ id: 'i1', text: '猫' }], zones: [{ id: 'z1', label: '只有一个框' }], placement: { i1: 'z1' } });
  // 框的 id 重复
  rejected('categorize', { items: [{ id: 'i1', text: '猫' }], zones: [{ id: 'z1', label: '甲' }, { id: 'z1', label: '乙' }], placement: { i1: 'z1' } });
});

// ---------------------------------------------------------------------------
// ⑦ 主观题
// ---------------------------------------------------------------------------

test('主观题：只要题干在就算通过（它真的没有别的字段要校验）', () => {
  accepted('short-answer', {});
  accepted('short-answer', { explanation: '参考答案要点' });
  assert.deepEqual(
    validateQuestion({ id: 'q', type: 'short-answer', prompt: '  ', inputMode: 'keyboard', data: {}, children: [] }),
    ['题干不能为空'],
  );
});
