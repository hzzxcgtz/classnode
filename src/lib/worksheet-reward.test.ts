/**
 * `worksheet-reward.ts` 的逐条断言 —— 奖励**取值规则**的唯一回归网。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/lib/worksheet-reward.test.ts
 * ```
 *
 * ⚠️ 为什么值得单独成文件：这一段**错了不报错**。步长算错只会让学生少拿一朵花、
 * 多拿一颗星，界面上一切正常、没有任何异常与日志。而且它**不落库**（规格 §9.1），
 * 所以也没有任何数据侧的比对能发现它 —— 只有这里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HALF_STEP,
  DEFAULT_REWARD_STEP,
  DEFAULT_REWARD_STYLE,
  HALF_STEPS,
  normalizeHalfStep,
  normalizeRewardStep,
  normalizeRewardStyle,
  resolveRewardScale,
  rewardAmount,
  rewardMark,
  rewardSymbol,
  rewardTotalText,
  REWARD_STEPS,
  REWARD_STYLE_OPTIONS,
  type RewardScale,
  pointsUnit,
} from './worksheet-reward.ts';

/**
 * 一份奖励配置。
 *
 * ★ M4a（绝对值模型）：它过去还要一个**步长**（`scale(2)` = 星星 ×2），而奖励层现在
 * **不再有步长**（`RewardScale` 上那两个数已删，理由见那个类型的注释）。
 * 所以入参从「步长」变成了「哪一档」，而用例里原来那个数**挪去了 `rewardAmount` 的第一个入参**
 *（画出来的个数就是得分本身）。
 */
function scale(over: Partial<RewardScale> = {}): RewardScale {
  return { style: 'star', ...over };
}

// ── 1. 取值域与默认档 ────────────────────────────────────────────────────

test('四个选项的取值两两不同，且都带标签；只有对错档没有符号', () => {
  const values = REWARD_STYLE_OPTIONS.map(option => option.value);
  assert.deepEqual([...values].sort(), ['correctness', 'flower', 'points', 'star']);
  assert.equal(new Set(values).size, values.length, '取值重复会让单选按钮选中两个');
  for (const option of REWARD_STYLE_OPTIONS) {
    assert.ok(option.label.length > 0, `${option.value} 缺标签`);
    assert.ok(option.hint.length > 0, `${option.value} 缺说明`);
    assert.equal(option.symbol, rewardSymbol(option.value));
  }
  assert.equal(rewardSymbol('correctness'), null, '对错档画的是 ✓/✗，不是一个固定符号');
  assert.ok(REWARD_STEPS.includes(DEFAULT_REWARD_STEP));
  assert.ok(REWARD_STYLE_OPTIONS.some(option => option.value === DEFAULT_REWARD_STYLE));
});

test('normalizeRewardStyle：认得出的原样返回，认不出的一律落到默认档', () => {
  for (const option of REWARD_STYLE_OPTIONS) {
    assert.equal(normalizeRewardStyle(option.value), option.value);
  }
  for (const bad of [null, undefined, '', 'STAR', '对错', 42, {}, ['star']]) {
    assert.equal(normalizeRewardStyle(bad), DEFAULT_REWARD_STYLE, `${JSON.stringify(bad)} 应当落到默认档`);
  }
});

test('normalizeRewardStep：只认 1/2/3/5，越界值回落到默认（不是夹逼）', () => {
  for (const step of REWARD_STEPS) assert.equal(normalizeRewardStep(step), step);
  for (const bad of [0, 4, 0.5, 100, -1, '2', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeRewardStep(bad), DEFAULT_REWARD_STEP, `${JSON.stringify(bad)} 应当回落到默认步长`);
  }
});

/**
 * ★ M4a：部分给分档是**另一条规则**（域含 0、默认是 0）。
 *
 * 🔴 这一条钉住的正是「两档的取值域**不同**」这件事：`0` 在 `normalizeRewardStep` 那里
 * 是**越界值**（回落到 1），在这里是**合法值**（原样返回 0）。两处一旦合并，
 * 教师配的「部分给分 0」就会变成 1 —— 而界面上只是多出一个符号，没有任何报错。
 */
test('normalizeHalfStep：0/1/2/3/5 原样；越界与缺字段回落到 0（**不是** 1）', () => {
  for (const half of HALF_STEPS) assert.equal(normalizeHalfStep(half), half);
  // 阳性对照：同一个 0 在两条规则下**必须是两个结果** —— 否则上面那条循环可能只是碰巧全绿。
  assert.equal(normalizeRewardStep(0), DEFAULT_REWARD_STEP);
  assert.equal(normalizeHalfStep(0), DEFAULT_HALF_STEP);
  assert.notEqual(DEFAULT_HALF_STEP, DEFAULT_REWARD_STEP, '两条规则的默认值不同，别把它们并成一个常量');
  for (const bad of [4, -1, 0.5, 100, '2', null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalizeHalfStep(bad), DEFAULT_HALF_STEP, `${JSON.stringify(bad)} 应当回落到 0`);
  }
});

test('resolveRewardScale：从 settings 那一坨里取**档位**，缺字段与坏值都回落，**不抛**', () => {
  assert.deepEqual(resolveRewardScale({ rewardStyle: 'flower', rewardStep: 3 }), { style: 'flower' });
  assert.deepEqual(resolveRewardScale({}), { style: DEFAULT_REWARD_STYLE });
  assert.deepEqual(resolveRewardScale(null), { style: DEFAULT_REWARD_STYLE });
  assert.deepEqual(resolveRewardScale([1, 2]), { style: DEFAULT_REWARD_STYLE });
  assert.deepEqual(resolveRewardScale('star'), { style: DEFAULT_REWARD_STYLE });
  // 一个坏键不该把另一个好键也带坏
  assert.deepEqual(
    resolveRewardScale({ rewardStyle: '不知道', rewardStep: 5 }),
    { style: DEFAULT_REWARD_STYLE },
  );
  assert.deepEqual(resolveRewardScale({ rewardStyle: 'points', rewardStep: '不知道' }), { style: 'points' });
  // ★ M4a：`rewardStep` / `halfStep` **不进这个返回值**（规格 §12 裁定 4：学习单级那两个数
  // 由服务端 `pointsFromSettings` 读出来折算成**得分**；学生端不复制第三份归一化）。
  // ⇒ 返回值里的键就这一个。多回来的键在这里不会报错，只会让下游多一个能读错的开关 ——
  // 那正是本次**删掉 `RewardScale` 上那两个数**要防的事（见那个类型的注释）。
  assert.deepEqual(
    Object.keys(resolveRewardScale({ rewardStyle: 'star', rewardStep: 2, halfStep: 5 })).sort(),
    ['style'],
  );
  // ⚠️ 「那两个数怎么归一化」的判据**没有丢**，只是不在本函数上：
  // `normalizeRewardStep` / `normalizeHalfStep` 在上面各有自己的用例（两档的域与默认值都不一样），
  // 教师端走 `worksheet-editor-core.ts` 的 `normalizeLoadedSettings`（`worksheet-editor-core.test.ts`），
  // 服务端走 `pointsFromSettings`（`worksheet-grade-m4.test.ts`）。
});

// ── 2. 得分 → 奖励个数（规格 §9.1 / §12 的绝对值模型）──────────────────────

test('🔴 rewardAmount：**得分就是画出来的那个数** —— 5 分画 5 个，不乘任何步长', () => {
  // 这是本次改动（M4a 裁定，2026-09-24）的**形状契约**（规格 §12：「得分」与「奖励」
  // 不再是两件事，而是同一个数的两种画法）。
  // 反证：把函数体改回乘法模型（`score >= 1 ? scale.step : …`）⇒ 本条与它后面三条一起变红。
  for (const score of [1, 2, 3, 5]) {
    assert.equal(rewardAmount(score, scale()), score, `${score} 分就该画 ${score} 个`);
  }
  // 🔴 旧模型的反例（B2 那轮抓的）：学习单级 `rewardStep = 3` + 某题 `full = 5`。
  // 旧的 `score >= 1 ? scale.step : …` 返回 **3** ⇒ 学生看到 ⭐⭐⭐，而规格 §12 要的是 5 个。
  assert.equal(rewardAmount(5, scale()), 5, '学习单级 ×3 + 本题 5 分 ⇒ 画 5 个，不是 3 个');
  // 三档符号的规则是同一条（只有对错档不同，见下一条用例）
  assert.equal(rewardAmount(4, scale({ style: 'flower' })), 4);
  assert.equal(rewardAmount(4, scale({ style: 'points' })), 4);
});

test('rewardAmount：没判分（null）⇒ 0，而不是「0 分」', () => {
  assert.equal(rewardAmount(null, scale()), 0);
});

test('🔴 rewardAmount：对错档**只看有没有分**，不看得几分（否则累计会变成 ✓×9）', () => {
  // 这一档画的是 ✓/✗，不是一串符号 ⇒ 一次只算 1；它的累计画成 `✓×N`，N 是「有分几题」。
  // 旧实现读 `scale.step`，教师在「星星 ×3」与「对错」之间来回选时库里那个 3 一直留着
  //（这是好事，切回星星时他配的 ×3 还在）⇒ 拿它去算对错档的累计会得到 `✓×9`。
  for (const score of [1, 2, 5]) {
    assert.equal(rewardAmount(score, scale({ style: 'correctness' })), 1);
  }
  const correctness: RewardScale = scale({ style: 'correctness' });
  const scores: Array<number | null> = [5, 1, 0, 2];
  const total = scores.reduce<number>((sum, score) => sum + rewardAmount(score, correctness), 0);
  assert.equal(total, 3, '三题有分（含部分给分拿到的 2 分）⇒ 累计 3 枚 ✓');
  assert.equal(rewardTotalText(correctness, total), '✓×3');
  // 阴性对照：同一批得分换到星星档就必须**按分数**画（否则这条断言证明不了什么）
  assert.equal(scores.reduce<number>((sum, score) => sum + rewardAmount(score, scale()), 0), 8);
});

test('rewardAmount：不做任何数学变换（不乘、不折算、不取整）', () => {
  // 旧模型把 [0,1] 当成**比例**（`score = 0.5` ⇒ 部分给分档）、把 `step` 当成**上界**
  //（`Math.floor(step × score)`）。这两个概念在绝对值模型下都不存在了：教师逐题填的就是
  // 绝对数（规格 §12 裁定 5），所以画出来的个数可以大于任何「步长」。
  assert.equal(rewardAmount(9, scale()), 9, '上界来自教师填的分值，不是一个步长');
  assert.equal(rewardAmount(99, scale()), 99);
  // ⚠️ 下面这一条在真机上**不会出现**：服务端 `normalizePointValue` 把得分归一化到 0..99
  // 的整数。它钉的是「本函数不做数学变换」这件事本身 —— 旧模型在这里是 `Math.floor(step × 0.5)`。
  assert.equal(rewardAmount(0.5, scale()), 0.5);
});

test('rewardAmount：部分给分不是奖励层的事 —— 那一档给了几分就画几个', () => {
  // 教师给某题填「全对 5 / 部分给分 2」：服务端判出 5 或 2（`resolvePoints` + `pointsFromSettings`），
  // 显示层照画。旧实现在这里读 `RewardScale.halfStep`，而那条分支**在真实数据上一次都走不到**
  //（归一化后的得分是整数 ⇒ 不存在 `0 < score < 1`）；现在连字段都没有了。
  assert.equal(rewardAmount(5, scale()), 5);
  assert.equal(rewardAmount(2, scale()), 2);
  assert.equal(rewardMark(scale(), 2), '⭐⭐', '部分给分拿到 2 分就在星星档画两颗');
  assert.equal(rewardMark(scale({ style: 'points' }), 2), '+2');
  // 部分给分填 0（默认档，规格 §12 裁定 3）⇒ 得分 0 ⇒ 什么都不画（对错档除外，那档画 ✗）
  assert.equal(rewardMark(scale(), 0), null);
  assert.equal(rewardMark(scale({ style: 'correctness' }), 0), '✗');
});

test('rewardAmount：坏数字（NaN / Infinity）当成 0，不画出一串长度未定义的符号', () => {
  assert.equal(rewardAmount(Number.NaN, scale()), 0);
  assert.equal(rewardAmount(Number.POSITIVE_INFINITY, scale()), 0);
  assert.equal(rewardAmount(-1, scale()), 0);
});

// ── 3. 画出来的字面（规格 §9.3 的两处）───────────────────────────────────

test('rewardMark：每题旁那个字 —— 对错档画 ✓/✗，符号档按**得分**重复，分数档画 +N', () => {
  assert.equal(rewardMark(scale({ style: 'correctness' }), 5), '✓');
  assert.equal(rewardMark(scale({ style: 'correctness' }), 0), '✗');
  assert.equal(rewardMark(scale(), 2), '⭐⭐');
  assert.equal(rewardMark(scale({ style: 'flower' }), 1), '🌸');
  assert.equal(rewardMark(scale({ style: 'points' }), 3), '+3');
  assert.equal(rewardMark(scale({ style: 'points' }), 5), '+5');
});

test('rewardMark：没判分 ⇒ null；符号档拿了 0 个 ⇒ null（不是画一个「0 颗星」）', () => {
  assert.equal(rewardMark(scale(), null), null);
  assert.equal(rewardMark(scale({ style: 'correctness' }), null), null);
  assert.equal(rewardMark(scale(), 0), null);
  assert.equal(rewardMark(scale({ style: 'flower' }), 0), null);
  assert.equal(rewardMark(scale({ style: 'points' }), 0), null);
  // 对错档相反：答错**必须**画出来 —— 那是这一档存在的意义
  assert.notEqual(rewardMark(scale({ style: 'correctness' }), 0), null);
});

test('rewardTotalText：顶部累计 —— 符号档 `⭐×3`、对错档 `✓×3`、分数档是 `+3 分`', () => {
  assert.equal(rewardTotalText(scale(), 3), '⭐×3');
  assert.equal(rewardTotalText(scale({ style: 'flower' }), 2), '🌸×2');
  assert.equal(rewardTotalText(scale({ style: 'correctness' }), 3), '✓×3');
  assert.equal(rewardTotalText(scale({ style: 'points' }), 5), '+5 分');
  // 一个都没有 ⇒ 不画（`⭐×0` 会让「还没有」看起来像「统计过了」）
  assert.equal(rewardTotalText(scale(), 0), null);
  assert.equal(rewardTotalText(scale({ style: 'points' }), 0), null);
  assert.equal(rewardTotalText(scale(), -1), null);
});

test('累计 = 每题之和：同一份配置下，逐个求和的桶与逐步累加**同值**', () => {
  // 面板里那两处（每题旁的徽章与顶栏的累计）用的是同一个 `rewardAmount`，
  // 这里把「两边算出来的是同一个数」钉住 —— 分叉的表现是顶栏与题目里的星星对不上，
  // 而那种偏差没有任何报错。
  const star = scale();
  const scores: Array<number | null> = [2, 0, 5, null, 1, 3];
  let running = 0;
  for (const score of scores) running += rewardAmount(score, star);
  const summed = scores.reduce<number>((sum, score) => sum + rewardAmount(score, star), 0);
  assert.equal(running, summed);
  assert.equal(running, 11, '2 + 0 + 5 + 0 + 1 + 3（`null` 那题既不画也不加）');
});

// ── 逐题分值的量词（★ 2026-09-26，教师）────────────────────────────────

test('🔴 pointsUnit：量词跟着学习单的奖励档走 —— 不能一直是「分」', () => {
  // 教师原话：「这里要根据学习单的设置来调整，比如几朵花，几颗五角星，
  // **不能一直使用「分」**。」
  assert.equal(pointsUnit('star'), '颗', '教师原话是「几颗五角星」—— 不是「个」');
  assert.equal(pointsUnit('flower'), '朵');
  assert.equal(pointsUnit('points'), '分');
  // ⚠️ 「对错」档**也**要有个说法：它的逐题分值照样存在（只是学生看到的不是数字），
  // 所以它回落「分」而不是空串 —— 空串会让界面上出现一个光秃秃的数字。
  assert.equal(pointsUnit('correctness'), '分');
});

test('pointsUnit 与 REWARD_STYLE_OPTIONS 的 `unit` 是**两件事**（别合并）', () => {
  // `unit` 是**步长**的量词，而「对错」那一档根本没有步长（空串）；
  // `pointsUnit` 是**逐题分值**的量词，四档都有。
  const correctness = REWARD_STYLE_OPTIONS.find(option => option.value === 'correctness');
  assert.equal(correctness?.unit, '', '对错档没有步长 —— 所以它不能直接拿来当分值的量词');
  assert.equal(pointsUnit('correctness'), '分', '而分值的量词必须有个说法');
  // 星星那一档两个值**刻意不同**：步长沿用规格 §9.2 的「个」，分值是教师原话的「颗」。
  const star = REWARD_STYLE_OPTIONS.find(option => option.value === 'star');
  assert.equal(star?.unit, '个');
  assert.equal(pointsUnit('star'), '颗');
});
