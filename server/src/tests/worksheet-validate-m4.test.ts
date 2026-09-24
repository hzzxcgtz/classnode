import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRejectedFullPointValue,
  isUsableFullPointValue,
  isUsablePointValue,
  normalizePoints,
  POINTS_MAX,
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
  //
  // ★ M4b/B1 补第二个豁免：**绘图题**。它与主观题逐字同一条理由 —— 它没有答案要配
  // （学生画图，教师人眼看，`JUDGES.drawing` 恒回 `null`），所以 `data` 的合法形状就是 `{}`。
  // 🔴 **这条豁免不会削弱本用例对它的把关**：「`VALIDATORS` 里根本没有 `drawing` 这个键」
  // 是**编译错误**（`Record<QuestionType, …>` 少一个键 ⇒ TS2741），不靠这条用例。
  // 而「键在、内容是空的」对绘图题**就是正确行为**，本用例无法也不该在这里判它。
  // ⚠️ 别顺手把 `drawing: () => {}` 改成 `drawing: () => { errors.push('…') }` 来让它从
  // EXEMPT 里挪出来：绘图题在 `newQuestion` 里的 `data` 是 `{}` ⇒ 那等于**新建的绘图题
  // 永远存不下去**，而那句错误文案说的是「题干不能为空」（一个说得通但与真实原因无关的提示）。
  const EXEMPT: readonly QuestionType[] = ['short-answer', 'drawing'];
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
  // ⚠️ M4b 之后这个数**恰好等于 7**（9 个题型 - 2 个豁免）：`>= 7` 现在卡在下界上，
  // 动 `QUESTION_TYPES` / `EXEMPT` 之前先看这里 —— 再加一个豁免就会红。
  assert.ok(checked.length >= 7, `实际只跑到 ${checked.length} 个题型`);
});

test('★ M4b：绘图题**必须**接受空 data（它没有答案要配，data 恒为 {}）', () => {
  // 上面那条用例把 `drawing` 豁免掉了，所以「它接受 `{}`」这件事必须**另有**一条用例钉住 ——
  // 否则「绘图题能不能存下去」在这份文件里就没有任何观测点了。
  accepted('drawing', {});
  // ⚠️ 连一个**非空**的 data 也照收：绘图题的 data 今天没有约定字段，服务端不该替它立规矩。
  // （它不可能是答案的载体 —— 学生的笔迹在 `WorksheetAnswer.value` 里，不在 `data` 里。）
  accepted('drawing', { whatever: 1 });
  // 反向对照：公共那条「题干不能为空」对它**照样**生效 —— 豁免的只是它自己那一支校验器。
  assert.deepEqual(
    validateQuestion({ id: 'q', type: 'drawing', prompt: '  ', inputMode: 'keyboard', data: {}, children: [] }),
    ['题干不能为空'],
  );
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
  // 🔴 空串与纯空白**单独**钉一条：`readStrings` 会先丢掉空串，剩下的空数组必须仍然算
  // 「这个空没有答案」。漏了它，`['']` 会被当成一个可接受答案 ⇒ 学生的空作答判成正确。
  rejected('fill-blank', { blanks: [{ answers: [''] }] });
  rejected('fill-blank', { blanks: [{ answers: [''] }, { answers: ['CO2'] }] });
  rejected('fill-blank', { blanks: [{ answers: ['   '] }] });

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

// ---------------------------------------------------------------------------
// ⑧ 分值归一化（points）
// ---------------------------------------------------------------------------

/**
 * 🔴 **「留空」与「坏值」都必须落成 `undefined`（= 继承学习单级），不是默认档。**
 *
 * 落成显式 `{ full: 1, half: 0 }` 的后果是**静默切断继承**：`DEFAULT_POINTS` 恰好等于
 * 第一批的默认档 ⇒ 教师**看不出任何差别**，直到他改了学习单级的档，才发现这一道题
 * 不跟随 —— 且没有任何提示。裁定 4 要防的就是这个。
 */
test('🔴 分值留空或两个字段都无效 ⇒ undefined（继承学习单级），不是 DEFAULT_POINTS', () => {
  assert.equal(normalizePoints({}), undefined, '空对象 = 教师清空了两个输入框');
  assert.equal(normalizePoints({ full: null, half: '两朵' }), undefined, '两个字段都不是有效数字');
  assert.equal(normalizePoints({ full: '两朵', half: 1000 }), undefined, '越界与字符串都算无效');
  assert.equal(normalizePoints(undefined), undefined);
  assert.equal(normalizePoints(null), undefined);
  assert.equal(normalizePoints('3'), undefined, '整个 points 不是一个对象');
  assert.equal(normalizePoints([]), undefined);
  assert.equal(normalizePoints({ full: -1, half: Number.NaN }), undefined);
  assert.equal(normalizePoints({ full: Number.POSITIVE_INFINITY, half: 100 }), undefined, '100 > POINTS_MAX');
});

test('分值归一化：只填了一个字段 ⇒ 取那个，另一个回落默认档', () => {
  assert.deepEqual(normalizePoints({ full: 3 }), { full: 3, half: 0 });
  assert.deepEqual(normalizePoints({ half: 2 }), { full: 1, half: 2 });
  // 小数四舍五入到整数（`WorksheetAnswer.score` 是 Float，2.5 会一路走进奖励累计）
  assert.deepEqual(normalizePoints({ full: 3.4, half: '两朵' }), { full: 3, half: 0 });
  // 🔴 **`half: 0` 是有效分值**（「半对 0 分」就是默认档本身）：它假值，但不是「留空」。
  // 判据写成 `source.half ? … : …` 的话，这里会静默变成「没填」⇒ 那道题变成继承学习单级，
  // 而 `shouldWarnZeroHalfCredit` 那条提示正建立在「半对 0 是一个有效值」上面。
  //
  // ★ M4a/I1 更正：**这一条只对 `half` 成立，`full` 不是。** 两档的域**不同**
  //（`full` 是 1..99，见 `POINTS_FULL_MIN`）。原先这里把 `full: 0` 也写成「有效分值」，
  // 而那正是 I1：答对的题拿到 0 分 ⇒ 学生端画红叉、教师端画绿勾、正确率还算它全对。
  // 下面三行是更正后的行为（`full: 0` 按「没填」走，`half: 0` 照旧有效）：
  assert.deepEqual(normalizePoints({ full: 0, half: 0 }), { full: 1, half: 0 },
    'full: 0 不再算有效 ⇒ 它按「没填」回落 DEFAULT_POINTS.full；half: 0 仍然是有效分值');
  assert.deepEqual(normalizePoints({ full: 0 }), undefined,
    '两端都无效（`full` 那一端的 0 不算数）⇒ 与「留空」同义：继承学习单级');
  assert.deepEqual(normalizePoints({ full: 0, half: 2 }), { full: 1, half: 2 },
    '半对那一端有效 ⇒ 整题脱离学习单级，全对回落默认档 1');
  // 边界：POINTS_MAX 本身合法，超一个就无效
  assert.deepEqual(normalizePoints({ full: 99 }), { full: 99, half: 0 });
  assert.deepEqual(normalizePoints({ full: 100 }), undefined);
});

/**
 * 🔴 ★ M4a/I1：**两个档的域不同**，而这条差异就是缺陷 I1 的全部内容。
 *
 * 反向断言（GC 14 的反证实跑过，见报告）：把 `isUsableFullPointValue` 的下界改回 0、
 * 或把它整个换成 `isUsablePointValue` ⇒ 本条与 `worksheet-routes.test.ts` 里那条
 * 「full: 0 拒绝保存」一起变红。
 * 反过来的「统一两个域」也拦得住：把 `isUsablePointValue` 的下界抬到 1 ⇒ 下面 `half` 那几行变红。
 */
test('🔴 两个域：`full` 是 1..99、`half` 是 0..99（合并任何一边都会红）', () => {
  assert.equal(isUsableFullPointValue(0), false, '0 不是合法的「全对」分值 —— 这就是 I1');
  assert.equal(isUsableFullPointValue(0.4), false, '取整之后是 0 ⇒ 同样不在域里（与 normalizePointValue 同一把尺子）');
  assert.equal(isUsableFullPointValue(0.5), true, '取整之后是 1 ⇒ 在域里');
  assert.equal(isUsableFullPointValue(1), true);
  assert.equal(isUsableFullPointValue(POINTS_MAX), true);
  assert.equal(isUsableFullPointValue(POINTS_MAX + 1), false);
  assert.equal(isUsableFullPointValue(-1), false);
  assert.equal(isUsableFullPointValue('3'), false, '字符串不是数');
  assert.equal(isUsableFullPointValue(undefined), false);
  // half：0 **必须**在域里（规格 §12 裁定 3 的默认档就是它）
  assert.equal(isUsablePointValue(0), true, '⚠️ 别顺手把 half 的 0 也挡掉 —— 那是「不给部分分」，合法');
  assert.equal(isUsablePointValue(POINTS_MAX), true);
  assert.equal(isUsablePointValue(POINTS_MAX + 1), false);
  // 拒绝判据只认「宽域认它、窄域不认它」的那一个值 —— 0
  assert.equal(isRejectedFullPointValue(0), true);
  assert.equal(isRejectedFullPointValue(1), false);
  assert.equal(isRejectedFullPointValue(0.4), true, '取整到 0 的也拒（否则屏幕上「0.4」与「0」走两条路）');
  // ⚠️ 这三个**故意不拒**：它们在 A1 的语义里就是「没填 = 继承学习单级」，
  // 把它们一起改成 400 等于顺手改掉另一条已经生效、有用例钉着的裁定。
  assert.equal(isRejectedFullPointValue(-1), false, '越界 / 字符串 / 缺失走的是「没填」，不是「拒绝」');
  assert.equal(isRejectedFullPointValue('两朵'), false);
  assert.equal(isRejectedFullPointValue(undefined), false);
  assert.equal(isRejectedFullPointValue(POINTS_MAX + 1), false);
});
