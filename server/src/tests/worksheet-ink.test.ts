import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INK_MAX_POINTS,
  INK_MAX_STROKES,
  findInkValueError,
  isInkFormat,
} from '../services/worksheet-ink.js';

/**
 * `findInkValueError` 的用例 —— 规格 §12 裁定 4 的后半句「服务端也要校验」。
 *
 * 🔴 **本文件里最重要的一条是「别的格式一律放行」。** 这个校验的全部价值在于它**只**
 * 挡 ink 值；一旦它变成一道格式门（「`format` 不是这 7 个之一 ⇒ 400」），代价是
 * 库里已有的行与旧客户端**静默不判分** —— 而那正是 `worksheet-answer-value.ts:42-52`
 * 立过纪律要防的事。所以那条用例是这份文件的**主判据**，其余几条是它的边界。
 *
 * ⚠️ 常量与 `src/lib/worksheet-ink.ts` 是**两份**（服务端读不到 `src/`）。
 * 本文件里所有数字都从常量算出来（`INK_MAX_STROKES + 1`），**不手打 400 / 2000** ——
 * 手打的数字会在有人改了常量之后**继续绿**，而那正是「两份常量漂了」的失效形态。
 */

/** 造一条有 `points` 个点的合法笔画（点的内容与本文件无关，只需要点数）。 */
function stroke(points: number): Record<string, unknown> {
  return {
    color: '#1f2937',
    width: 0.016,
    points: Array.from({ length: points }, (_item, index) => [index / 100, index / 200]),
  };
}

/** 造一份有 `strokes` 笔、每笔 `points` 个点的 ink 值。 */
function ink(strokes: number, points: number): Record<string, unknown> {
  return {
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: Array.from({ length: strokes }, () => stroke(points)),
  };
}

/**
 * 🔴 ★ **这两个数字被钉死在字面量上**（本文件唯一一处硬编码它们的地方）。
 *
 * 理由与下面那些「从常量算出来」的边界用例**不矛盾，是互补的**：
 *   · 从常量算 ⇒ 能抓住**判据方向写错**（`>` 写成 `>=` 时，「恰好到上限」那条当场红）；
 *   · 钉字面量 ⇒ 能抓住**常量本身被改动**。少了这一条，把 `INK_MAX_STROKES` 改成 401
 *     会让所有边界用例**跟着漂**（`ink(INK_MAX_STROKES, 1)` 变成 401 笔，仍然合法）
 *     ⇒ 整套边界用例在常量被改时**一条都不红**（实测过，见报告的反证 3）。
 *
 * ⚠️ 这两个数**不是从任何公式算出来的**，它们是 A1（`src/lib/worksheet-ink.ts`）与 B1
 * 约定的那一对字面量，而两端**各写一份**（服务端读不到 `src/`）。所以改动必须是**刻意的、
 * 被看见的**：改这里 ⇒ 本用例红 ⇒ 去改另一端。这正是两份文件里「两处必须一起改」那句话
 * 唯一能被机器观测到的地方。
 */
test('🔴 两个上限的字面量：400 笔 / 2000 点（与 `src/lib/worksheet-ink.ts` 是同一对）', () => {
  assert.equal(INK_MAX_STROKES, 400, '笔数上限改了 ⇒ 必须同步改 src/lib/worksheet-ink.ts');
  assert.equal(INK_MAX_POINTS, 2000, '点数上限改了 ⇒ 必须同步改 src/lib/worksheet-ink.ts');
});

test('isInkFormat：只有 ink/v1 与 drawing/v1 是笔迹，其余一律不是', () => {
  for (const format of ['ink/v1', 'drawing/v1']) {
    assert.equal(isInkFormat(format), true, `${format} 应当是笔迹`);
  }
  for (const raw of ['text/v1', 'choice/v1', 'INK/V1', 'ink/v2', '', null, undefined, 0, 42, {}, [], ['ink/v1']]) {
    assert.equal(isInkFormat(raw), false, `${JSON.stringify(raw)} 不该被认成笔迹`);
  }
});

// ---------------------------------------------------------------------------
// 放行 —— 这几条是「它不是格式门」的证据
// ---------------------------------------------------------------------------

test('🔴 非对象 / 数组 / null 一律放行（回 null，不是拒绝）', () => {
  for (const value of [null, undefined, 0, 42, '', 'abc', true, [], ['B'], [1, 2]]) {
    assert.equal(
      findInkValueError(value),
      null,
      `${JSON.stringify(value)} 不是 ink 值 ⇒ 不该有错误（**放行**，不是拒绝）`,
    );
  }
});

test('🔴 别的格式一律放行（本文件最重要的一条：这个校验不是格式门）', () => {
  // 下面每一条都是**真实存在**的作答值形状（M3 / M4a 的四个题型 + 一个认不出的 format）。
  // 它们里面的 `strokes` 甚至是坏形状 —— 但 `format` 不是 ink，所以那些字段根本不该被看。
  const others: unknown[] = [
    { format: 'choice/v1', selected: ['A'] },
    { format: 'text/v1', text: '光合作用' },
    { format: 'links/v1', links: [{ leftId: 'l1', rightId: 'r1' }] },
    { format: 'assignment/v1', assignment: { i1: 'z1' } },
    { format: 'order/v1', order: ['i1', 'i2'] },
    // 连 `format` 都没有的行（M3 之前的形状）：`readField(value, 'format')` 读不到，
    // 所以 `isInkFormat(undefined)` 为假 ⇒ 放行。
    {},
    { selected: ['A'] },
    // 认不出的 format + 一个**超大**的坏形状：仍要放行（判据是 `format`，不是 `strokes`）。
    { format: 'nobody-knows/v9', strokes: 'not-an-array', extra: 'x'.repeat(100) },
  ];
  for (const value of others) {
    assert.equal(
      findInkValueError(value),
      null,
      `${JSON.stringify(value).slice(0, 60)}… 不是 ink 值 ⇒ 必须放行（加一道格式门会让旧行静默不判分）`,
    );
  }
});

test('合法的空画布（0 笔）放行 —— 学生打开画布还没落笔的那一份', () => {
  assert.equal(findInkValueError({ format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] }), null);
  assert.equal(findInkValueError({ format: 'drawing/v1', canvas: { w: 320, h: 240 }, strokes: [] }), null);
});

// ---------------------------------------------------------------------------
// 形状 —— 认得出是 ink 之后才看这些
// ---------------------------------------------------------------------------

test('形状坏掉：strokes 不是数组 / 笔画不是对象 / points 不是数组 ⇒ 一律非 null', () => {
  for (const strokes of [undefined, null, 'x', 0, {}, { 0: 'a' }]) {
    assert.notEqual(
      findInkValueError({ format: 'ink/v1', strokes }),
      null,
      `strokes=${JSON.stringify(strokes)} 该被拒`,
    );
  }
  for (const bad of [null, 0, 'x', [], ['a'], [1, 2]]) {
    const value = { format: 'ink/v1', strokes: [bad] };
    assert.notEqual(findInkValueError(value), null, `笔画=${JSON.stringify(bad)} 该被拒`);
  }
  for (const points of [undefined, null, 'x', 0, {}]) {
    const value = { format: 'ink/v1', strokes: [{ color: '#000', width: 0.01, points }] };
    assert.notEqual(findInkValueError(value), null, `points=${JSON.stringify(points)} 该被拒`);
  }
});

// ---------------------------------------------------------------------------
// 体积 —— 上限与边界（每一条都从常量算，不手打数字）
// ---------------------------------------------------------------------------

test('🔴 笔数：恰好到上限 ⇒ 放行；多一笔 ⇒ 拒绝，且文案里的数字与常量同源', () => {
  const atLimit = ink(INK_MAX_STROKES, 1);
  assert.equal(
    findInkValueError(atLimit),
    null,
    `恰好 ${INK_MAX_STROKES} 笔是**收下**的（边界要收下，否则常量说的上限就不是真的上限）`,
  );

  const overLimit = ink(INK_MAX_STROKES + 1, 1);
  const error = findInkValueError(overLimit);
  assert.notEqual(error, null, `${INK_MAX_STROKES + 1} 笔该被拒`);
  // ⚠️ 判据是「文案里出现那个数字」——`${INK_MAX_STROKES}` 是**从常量算出来的**，
  // 所以常量一改、文案没跟着改时这条会红。**不是**手打 '400'（那会恒真或恒假）。
  assert.ok(
    error?.includes(String(INK_MAX_STROKES)),
    `文案里必须出现笔数上限 ${INK_MAX_STROKES}（措辞与常量同源，不是手打的）：${error}`,
  );
});

test('🔴 点数：**总数**撞线才拒 —— 恰好 2000 点放行、2400 点拒绝', () => {
  // 恰好到上限（笔数远低于它的上限，只有点数在撞线）。
  const atLimit = ink(100, INK_MAX_POINTS / 100);
  assert.equal(
    findInkValueError(atLimit),
    null,
    `恰好 ${INK_MAX_POINTS} 个点是**收下**的（多空题的一份笔迹正常就落在这儿）`,
  );

  const overPoints = ink(100, INK_MAX_POINTS / 100 + 4);
  const error = findInkValueError(overPoints);
  assert.notEqual(error, null, `${100 * (INK_MAX_POINTS / 100 + 4)} 个点该被拒`);
  assert.ok(
    error?.includes(String(INK_MAX_POINTS)),
    `文案里必须出现点数上限 ${INK_MAX_POINTS}：${error}`,
  );
});

test('🔴 上限判据是**总数**，不是「每笔最多多少点」—— 5 笔各 500 点 = 2500 点要拒', () => {
  // 每笔都远低于 2000，但加起来超了。若实现写成「逐笔比」，这一条会**静默放行**。
  assert.notEqual(findInkValueError(ink(5, 500)), null);
  // 反向对照：同样 2500 个点、分在更多笔里，结论必须**一样**（判据与笔数无关）。
  assert.notEqual(findInkValueError(ink(50, 50)), null);
});
