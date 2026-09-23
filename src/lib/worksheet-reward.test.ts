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
} from './worksheet-reward.ts';

function scale(step: number, over: Partial<RewardScale> = {}): RewardScale {
  return { style: 'star', step, ...over };
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
 * ★ M4a：半对档是**另一条规则**（域含 0、默认是 0）。
 *
 * 🔴 这一条钉住的正是「两档的取值域**不同**」这件事：`0` 在 `normalizeRewardStep` 那里
 * 是**越界值**（回落到 1），在这里是**合法值**（原样返回 0）。两处一旦合并，
 * 教师配的「半对 0」就会变成 1 —— 而界面上只是多出一个符号，没有任何报错。
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

test('resolveRewardScale：从 settings 那一坨里取，缺字段与坏值都回落，**不抛**', () => {
  assert.deepEqual(resolveRewardScale({ rewardStyle: 'flower', rewardStep: 3 }), { style: 'flower', step: 3, halfStep: DEFAULT_HALF_STEP });
  assert.deepEqual(resolveRewardScale({}), { style: DEFAULT_REWARD_STYLE, step: DEFAULT_REWARD_STEP, halfStep: DEFAULT_HALF_STEP });
  assert.deepEqual(resolveRewardScale(null), { style: DEFAULT_REWARD_STYLE, step: DEFAULT_REWARD_STEP, halfStep: DEFAULT_HALF_STEP });
  assert.deepEqual(resolveRewardScale([1, 2]), { style: DEFAULT_REWARD_STYLE, step: DEFAULT_REWARD_STEP, halfStep: DEFAULT_HALF_STEP });
  assert.deepEqual(resolveRewardScale('star'), { style: DEFAULT_REWARD_STYLE, step: DEFAULT_REWARD_STEP, halfStep: DEFAULT_HALF_STEP });
  // 一个坏键不该把另一个好键也带坏
  assert.deepEqual(
    resolveRewardScale({ rewardStyle: '不知道', rewardStep: 5 }),
    { style: DEFAULT_REWARD_STYLE, step: 5, halfStep: DEFAULT_HALF_STEP },
  );
  // ★ M4a：半对档也要取出**配过的**值 —— 少了这一项，`rewardAmount` 永远走
  // `Math.floor(step × score)` 那条兜底，教师配的「半对 0」在界面上是个「按比例折算」。
  assert.equal(resolveRewardScale({ halfStep: 2 }).halfStep, 2);
  assert.equal(resolveRewardScale({ halfStep: 0 }).halfStep, 0, '0 是一个**配过的**值，不许被当成缺字段');
  assert.equal(resolveRewardScale({ halfStep: 4 }).halfStep, DEFAULT_HALF_STEP, '越界值回落');
  assert.equal(resolveRewardScale({ halfStep: '2' }).halfStep, DEFAULT_HALF_STEP);
  // 返回值里的键就这三个 —— 多一个键在这里不会报错，只会让下游多一个能读错的开关。
  assert.deepEqual(Object.keys(resolveRewardScale({ rewardStep: 2 })).sort(), ['halfStep', 'step', 'style']);
});

// ── 2. 得分 → 奖励个数（规格 §9.1）────────────────────────────────────────

test('🔴 rewardAmount：今天的得分只可能是 0/1，行为与「isCorrect ? step : 0」逐字相同', () => {
  // 这一条是本次改动的**形状契约**：接口按得分写，但今天的输出与布尔版一模一样。
  // 反证：把 `rewardAmount` 改回 `score >= 1 ? step : 0` 之外的任何规则，它必须变红。
  for (const step of REWARD_STEPS) {
    for (const score of [0, 1] as const) {
      const booleanVersion = score >= 1 ? step : 0;
      assert.equal(
        rewardAmount(score, scale(step)),
        booleanVersion,
        `步长 ${step}、得分 ${score}：应当与布尔版一致`,
      );
    }
  }
});

test('rewardAmount：没判分（null）⇒ 0，而不是「0 分」', () => {
  assert.equal(rewardAmount(null, scale(2)), 0);
});

test('🔴 rewardAmount：对错档**不理**库里那个步长（否则累计会变成 ✓×9）', () => {
  // 教师从「星星 ×3」改选「对错」时，库里那个 3 仍然留着（切回星星时他配的档还在 ——
  // 刻意不清）。若累计去读它，3 道答对会画成 `✓×9`。这一档的口径是「答对一题一个 ✓」。
  for (const step of REWARD_STEPS) {
    assert.equal(rewardAmount(1, { style: 'correctness', step }), 1);
  }
  const correctness: RewardScale = { style: 'correctness', step: 3 };
  const scores: Array<number | null> = [1, 1, 0, 1];
  const total = scores.reduce<number>((sum, score) => sum + rewardAmount(score, correctness), 0);
  assert.equal(total, 3, '三题答对 ⇒ 累计 3');
  assert.equal(rewardTotalText(correctness, total), '✓×3');
  // 阴性对照：同一批得分换到星星档就必须吃那个 3（否则这条断言证明不了什么）
  assert.equal(scores.reduce<number>((sum, score) => sum + rewardAmount(score, scale(3)), 0), 9);
});

test('rewardAmount：非 0/1 的得分**不崩、不越界**（M4 的部分得分走这条）', () => {
  // 今天判分只会给出 0 或 1，所以下面这些值一次都不会出现 —— 但函数必须是得分驱动的，
  // 而不是靠「反正只有 0/1」活着。没有配半对档时按比例向下取整（兜底，不是产品规则）。
  assert.equal(rewardAmount(0.5, scale(1)), 0, '步长 1 的半对：向下取整到 0');
  assert.equal(rewardAmount(0.5, scale(2)), 1);
  assert.equal(rewardAmount(0.5, scale(3)), 1);
  assert.equal(rewardAmount(0.5, scale(5)), 2);
  assert.equal(rewardAmount(0.25, scale(4)), 1);
  for (const step of REWARD_STEPS) {
    for (const score of [0, 0.25, 0.5, 0.75, 1]) {
      const amount = rewardAmount(score, scale(step));
      assert.ok(
        amount >= 0 && amount <= step,
        `得分 ${score}、步长 ${step}：奖励个数 ${amount} 越出了 [0, step]`,
      );
    }
  }
});

test('rewardAmount：配了半对档就照它给（M4 的那条路，今天没人传）', () => {
  assert.equal(rewardAmount(0.5, scale(2, { halfStep: 1 })), 1);
  assert.equal(rewardAmount(0.5, scale(5, { halfStep: 2 })), 2);
  // 半对档**不参与**全对：1 分永远是 `step`，不会被 `halfStep` 顶掉
  assert.equal(rewardAmount(1, scale(5, { halfStep: 2 })), 5);
});

test('rewardAmount：坏数字（NaN / Infinity）当成 0，不画出一串长度未定义的符号', () => {
  assert.equal(rewardAmount(Number.NaN, scale(2)), 0);
  assert.equal(rewardAmount(Number.POSITIVE_INFINITY, scale(2)), 0);
  assert.equal(rewardAmount(-1, scale(2)), 0);
});

// ── 3. 画出来的字面（规格 §9.3 的两处）───────────────────────────────────

test('rewardMark：每题旁那个字 —— 对错档画 ✓/✗，符号档重复 N 次，分数档画 +N', () => {
  assert.equal(rewardMark(scale(2, { style: 'correctness' }), 1), '✓');
  assert.equal(rewardMark(scale(2, { style: 'correctness' }), 0), '✗');
  assert.equal(rewardMark(scale(2), 1), '⭐⭐');
  assert.equal(rewardMark(scale(1, { style: 'flower' }), 1), '🌸');
  assert.equal(rewardMark(scale(3, { style: 'points' }), 1), '+3');
  assert.equal(rewardMark(scale(5, { style: 'points' }), 1), '+5');
});

test('rewardMark：没判分 ⇒ null；符号档拿了 0 个 ⇒ null（不是画一个「0 颗星」）', () => {
  assert.equal(rewardMark(scale(2), null), null);
  assert.equal(rewardMark(scale(2, { style: 'correctness' }), null), null);
  assert.equal(rewardMark(scale(2), 0), null);
  assert.equal(rewardMark(scale(2, { style: 'flower' }), 0), null);
  assert.equal(rewardMark(scale(2, { style: 'points' }), 0), null);
  // 对错档相反：答错**必须**画出来 —— 那是这一档存在的意义
  assert.notEqual(rewardMark(scale(2, { style: 'correctness' }), 0), null);
});

test('rewardTotalText：顶部累计 —— 符号档 `⭐×3`、对错档 `✓×3`、分数档是 `+3 分`', () => {
  assert.equal(rewardTotalText(scale(1), 3), '⭐×3');
  assert.equal(rewardTotalText(scale(1, { style: 'flower' }), 2), '🌸×2');
  assert.equal(rewardTotalText(scale(1, { style: 'correctness' }), 3), '✓×3');
  assert.equal(rewardTotalText(scale(1, { style: 'points' }), 5), '+5 分');
  // 一个都没有 ⇒ 不画（`⭐×0` 会让「还没有」看起来像「统计过了」）
  assert.equal(rewardTotalText(scale(1), 0), null);
  assert.equal(rewardTotalText(scale(1, { style: 'points' }), 0), null);
  assert.equal(rewardTotalText(scale(1), -1), null);
});

test('累计 = 每题之和：同一份配置下，逐个求和的桶与逐步累加**同值**', () => {
  // 面板里那两处（每题旁的徽章与顶栏的累计）用的是同一个 `rewardAmount`，
  // 这里把「两边算出来的是同一个数」钉住 —— 分叉的表现是顶栏与题目里的星星对不上，
  // 而那种偏差没有任何报错。
  const star = scale(2);
  const scores: Array<number | null> = [1, 0, 1, null, 1, 0.5];
  let running = 0;
  for (const score of scores) running += rewardAmount(score, star);
  const summed = scores.reduce<number>((sum, score) => sum + rewardAmount(score, star), 0);
  assert.equal(running, summed);
  assert.equal(running, 7, '2 + 0 + 2 + 0 + 2 + 1（半对兜底向下取整）');
});
