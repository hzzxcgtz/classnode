/**
 * `worksheet-ink.ts` 的逐条断言 —— M4b 手写层**唯一能被自动化钉住**的那一半。
 *
 * 跑法（本仓没有前端测试框架，用 Node 24 自带的类型擦除直接执行）：
 *
 * ```bash
 * node --test src/lib/worksheet-ink.test.ts
 * ```
 *
 * ⚠️ 为什么值得单独成文件：这一段**错了不报错**。
 *   · 上限判据写成 `>` / `<` ⇒ 学生那一笔永远画不上（或上限形同虚设），而屏幕上没有任何异常；
 *   · 单位规则写错（`width` 乘 `canvas.w`、`points` 忘了乘 `canvas.h`）⇒ 线宽 / 形状随屏幕变化，
 *     学生在自己的 iPad 上看到的是对的那一份、教师在抽屉里看到的是错的那一份，**没有一条日志**；
 *   · `readInkValue` 读不回 ⇒ 学生画的东西**从屏幕上消失**，而「画的是空的」与「值读不出来」
 *     在屏幕上一模一样（学生会以为老师把题撤了）。
 *
 * 判据全部下沉在这里的理由写在文件头上：JSX 那一半（`ink-canvas.tsx` / `ink-body.tsx`）在本仓
 * **没有任何回归网**（没有 jsdom、没有 testing-library），而它真正要命的部分是**手感**
 * —— 跟不跟手、延迟、手掌误触、落笔与滚动抢不抢，本机一条都验不了（Global Constraint 16）。
 * 所以能从组件里挪出来的判断一律挪到这里。
 *
 * 带 🔴 的用例是**反向断言**：把对应实现改坏，它们必须变红（反证过程见
 * `.superpowers/sdd/2026-09-23-m4b-plan/task-A1-report.md`）。
 *
 * ⚠️ 本文件也在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内，
 * 且扫描器按**扩展名白名单**取文件（`.ts` 在册）—— 所以下面这些写法在本文件里同样不许出现：
 * `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` / `@container` /
 * `content-visibility` / `color-mix(`。深拷贝用 `JSON.parse(JSON.stringify(x))`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INK_MAX_STROKES,
  INK_MIN_POINT_DISTANCE_PX,
  INK_STROKE_COLOR,
  INK_STROKE_WIDTH,
  appendStroke,
  clearStrokes,
  countPoints,
  defaultInkBox,
  inkFormatOf,
  inkHint,
  inkLimitReason,
  isFarEnough,
  isInkFormat,
  isInkNode,
  normalizeAxis,
  readInkValue,
  strokePath,
  strokeWidthPx,
  toPixel,
  undoStroke,
} from './worksheet-ink.ts';
import type { InkCanvas, InkPoint, InkStroke, InkValue } from './worksheet-ink.ts';

// ── 脚手架 ──────────────────────────────────────────────────────────────

/** 学生作答那一刻的框：4:3。 */
const BOX: InkCanvas = { w: 320, h: 240 };

function pt(x: number, y: number): InkPoint {
  return [x, y];
}

function stroke(points: InkPoint[], style: Partial<InkStroke> = {}): InkStroke {
  return { color: INK_STROKE_COLOR, width: INK_STROKE_WIDTH, points, ...style };
}

function value(strokes: InkStroke[], canvas: InkCanvas = BOX): InkValue {
  return { format: 'ink/v1', canvas, strokes };
}

/** `count` 个互不相同的合法点（都落在 0..1 里，免得测试自己先给了越界的值）。 */
function points(count: number): InkPoint[] {
  // ⚠️ `Math.floor` 是**为反证准备的**：反证把常量改成奇数时（`INK_MAX_POINTS / 2` 会变成
  // `1000.5`），不取整会让这个脚手架悄悄多产生一个点 —— 那时的红会落在「点数不对」上，
  // 而不是落在被反证的判据上（一次归错因的红等于没验）。
  const total = Math.floor(count);
  const out: InkPoint[] = [];
  for (let index = 0; index < total; index += 1) out.push(pt(index / total, 0.5));
  return out;
}

/** `strokeCount` 笔、每笔 `each` 个点。上限用例都从这里造值。 */
function strokes(strokeCount: number, each: number): InkStroke[] {
  const out: InkStroke[] = [];
  for (let index = 0; index < strokeCount; index += 1) out.push(stroke(points(each)));
  return out;
}

/** 读一份值并断言它读得出来（不写 `!`：`assert.fail` 的返回类型是 `never`，能收窄）。 */
function mustRead(raw: unknown): InkValue {
  const parsed = readInkValue(raw);
  if (!parsed) assert.fail(`readInkValue 应当读得出来：${JSON.stringify(raw)}`);
  return parsed;
}

// ── 形状与分派 ──────────────────────────────────────────────────────────

test('isInkNode：drawing / short-answer + handwriting ⇒ true；其余 ⇒ false；未知题型 + handwriting ⇒ true', () => {
  assert.equal(isInkNode({ type: 'drawing', inputMode: 'keyboard' }), true);
  assert.equal(isInkNode({ type: 'short-answer', inputMode: 'handwriting' }), true);
  assert.equal(isInkNode({ type: 'short-answer', inputMode: 'keyboard' }), false);
  assert.equal(isInkNode({ type: 'order', inputMode: 'keyboard' }), false);
  // 手工改过的库行：题型名不是我们认识的那 9 个，但输入方式是手写 ⇒ 照样走画布那条路。
  assert.equal(isInkNode({ type: 'some-legacy-type', inputMode: 'handwriting' }), true);
});

test('inkFormatOf：drawing ⇒ drawing/v1；手写问答 ⇒ ink/v1；drawing + keyboard ⇒ 仍是 drawing/v1（题型优先）', () => {
  assert.equal(inkFormatOf({ type: 'drawing', inputMode: 'keyboard' }), 'drawing/v1');
  assert.equal(inkFormatOf({ type: 'short-answer', inputMode: 'handwriting' }), 'ink/v1');
  // 手改过的行可能把 drawing 的 inputMode 写成 keyboard：两个 format 名的存储与渲染完全相同，
  // 而「这题当初按哪种形状存的」只由题型决定。
  assert.equal(inkFormatOf({ type: 'drawing', inputMode: 'keyboard' }), 'drawing/v1');
  assert.equal(inkFormatOf({ type: 'fill-blank', inputMode: 'handwriting' }), 'ink/v1');
});

test('defaultInkBox：绘图题是 4:3、手写问答是 2:1 —— 这是「裁定 6 的差别」的观测', () => {
  const drawing = defaultInkBox({ type: 'drawing' });
  const writing = defaultInkBox({ type: 'short-answer', inputMode: 'handwriting' });
  assert.notDeepEqual(drawing, writing);
  assert.equal(drawing.w * 3, drawing.h * 4); // 4:3
  assert.equal(writing.w, writing.h * 2); // 2:1
});

test('defaultInkBox：回的是副本 —— 就地改它不会污染下一道题的默认框', () => {
  const box = defaultInkBox({ type: 'drawing' });
  box.h = 1;
  // 两次调用互不影响：那两个常量是模块级的，交出去的对象一旦被就地改，
  // 之后每一道题的默认框都会跟着变（题与题之间的耦合，屏幕上完全看不出来）。
  assert.equal(defaultInkBox({ type: 'drawing' }).h, 240);
});

test('inkHint：绘图题与手写题两种文案，都不为空且互不相同；同为手写的两个题型共用一句', () => {
  const drawing = inkHint({ type: 'drawing' });
  const fill = inkHint({ type: 'fill-blank', inputMode: 'handwriting' });
  const short = inkHint({ type: 'short-answer', inputMode: 'handwriting' });
  assert.ok(drawing.length > 0);
  assert.ok(fill.length > 0);
  assert.notEqual(drawing, fill);
  assert.equal(fill, short);
});

test('isInkFormat：只有 ink/v1 与 drawing/v1 认', () => {
  assert.equal(isInkFormat('ink/v1'), true);
  assert.equal(isInkFormat('drawing/v1'), true);
  assert.equal(isInkFormat('choice/v1'), false);
  assert.equal(isInkFormat('ink/v2'), false);
  assert.equal(isInkFormat('ink/v1 '), false);
  assert.equal(isInkFormat(null), false);
  assert.equal(isInkFormat(1), false);
});

// ── 上限 ────────────────────────────────────────────────────────────────

test('countPoints：空 ⇒ 0；两笔 3 + 2 点 ⇒ 5（总数，不是「每笔最多多少点」）', () => {
  assert.equal(countPoints([]), 0);
  assert.equal(countPoints([stroke(points(3)), stroke(points(2))]), 5);
});

test('inkLimitReason：399 笔各 1 点 ⇒ null；400 笔 ⇒ 非 null，且那句话里就是 400 笔', () => {
  assert.equal(inkLimitReason(strokes(INK_MAX_STROKES - 1, 1)), null);
  const reason = inkLimitReason(strokes(INK_MAX_STROKES, 1));
  assert.notEqual(reason, null);
  assert.ok(reason, '400 笔应当给出上限原因');
  assert.ok(reason.includes(`${INK_MAX_STROKES} 笔`));
});

test('inkLimitReason：点数到 2000 ⇒ 非 null（笔数远没到，卡住的是点数）', () => {
  // ⚠️ 这三处用**字面量** 2000 / 1999，不写 `INK_MAX_POINTS / 2`：反证把常量改成 2001 时，
  // `/2` 会算出小数、让红落在脚手架的点数上而不是上限判据上 —— 归错因的红等于没验。
  // 字面量同时也是计划钉的那个值（`INK_MAX_POINTS = 2000`）。
  const full = strokes(2, 1000);
  assert.equal(full.length < INK_MAX_STROKES, true); // 「卡住的是点数」这句话本身要成立
  assert.equal(countPoints(full), 2000);
  const reason = inkLimitReason(full);
  assert.notEqual(reason, null);
  assert.ok(reason, '到点数上限时应当给出上限原因');
  assert.ok(reason.includes('2000 个点'));
  // 差一个点就还能落笔：`>=` 而不是 `>`。
  assert.equal(inkLimitReason(strokes(1, 1999)), null);
});

test('appendStroke：恰好把总点数补到 2000 的那一笔要收下（`>` 不是 `>=`）', () => {
  const base = value(strokes(1, 1900));
  const next = appendStroke(base, stroke(points(100)));
  assert.notEqual(next, base);
  assert.equal(next.strokes.length, 2);
  assert.equal(countPoints(next.strokes), 2000);
});

test('appendStroke：再加一笔会超 2000 ⇒ 原样返回同一个对象，且笔画数不变', () => {
  const full = value(strokes(2, 1000)); // 字面 2000 点：满了但笔数没到，走的是点数那条门槛
  const next = appendStroke(full, stroke([pt(0.5, 0.5)]));
  assert.equal(next, full); // 同一个对象（`assert.equal` 是引用相等）
  assert.equal(next.strokes.length, 2);
  assert.equal(countPoints(next.strokes), 2000);
});

test('appendStroke：笔数到 400 ⇒ 原样返回同一个对象', () => {
  const full = value(strokes(INK_MAX_STROKES, 1));
  const next = appendStroke(full, stroke([pt(0.5, 0.5)]));
  assert.equal(next, full);
  assert.equal(next.strokes.length, INK_MAX_STROKES);
});

test('appendStroke：0 个点的笔画 ⇒ 原样返回（它画不出东西，却会占掉一笔的额度）', () => {
  const base = value(strokes(1, 3));
  const next = appendStroke(base, stroke([]));
  assert.equal(next, base);
});

test('undoStroke：去掉最后一笔；空数组上仍是空，不抛', () => {
  const two = value(strokes(2, 3));
  const one = undoStroke(two);
  assert.equal(one.strokes.length, 1);
  assert.equal(one.strokes[0], two.strokes[0]);
  assert.equal(undoStroke(value([])).strokes.length, 0);
  assert.equal(undoStroke(value([])).strokes.length, 0); // 连点两下也不抛
});

test('clearStrokes：全部清掉，`canvas` / `format` 原样保留', () => {
  const full = value(strokes(3, 4));
  const empty = clearStrokes(full);
  assert.equal(empty.strokes.length, 0);
  assert.deepEqual(empty.canvas, full.canvas);
  assert.equal(empty.format, full.format);
});

test('🔴 appendStroke / undoStroke / clearStrokes 都不改动入参，且都回新对象', () => {
  const base = value(strokes(2, 3));
  const snapshot = JSON.stringify(base);

  const appended = appendStroke(base, stroke([pt(0.1, 0.1)]));
  const undone = undoStroke(base);
  const cleared = clearStrokes(base);

  assert.notEqual(appended, base);
  assert.notEqual(undone, base);
  assert.notEqual(cleared, base);
  assert.notEqual(undone.strokes, base.strokes);
  // 「原对象逐字未变」：整份 JSON 与调用前逐字相同（就地改入参是 React 拿同一个身份
  // ⇒ 屏幕不重画那种最难查的症状）。
  assert.equal(JSON.stringify(base), snapshot);
  // 三份结果各自只改了该改的那一处。
  assert.equal(appended.strokes.length, 3);
  assert.equal(undone.strokes.length, 1);
  assert.equal(cleared.strokes.length, 0);
});

// ── 采样与归一化 ────────────────────────────────────────────────────────

test('isFarEnough：相距 1px ⇒ false；相距 2px ⇒ true；恰好等于阈值 ⇒ true；没动 ⇒ false', () => {
  const flat: InkCanvas = { w: 100, h: 100 }; // 1 单位 = 1px，便于把距离算成整数
  const origin = pt(0, 0);
  assert.equal(isFarEnough(origin, pt(0.01, 0), flat, INK_MIN_POINT_DISTANCE_PX), false);
  assert.equal(isFarEnough(origin, pt(0.02, 0), flat, INK_MIN_POINT_DISTANCE_PX), true);
  // 判据是 `>=`：阈值本身算「够远」。
  assert.equal(isFarEnough(origin, pt(INK_MIN_POINT_DISTANCE_PX / 100, 0), flat, INK_MIN_POINT_DISTANCE_PX), true);
  // 手指没动时 `pointermove` 会重复派发同一个坐标：那一个点不该记。
  assert.equal(isFarEnough(origin, pt(0, 0), flat, INK_MIN_POINT_DISTANCE_PX), false);
});

test('isFarEnough：判的是**像素**距离 —— 同一个归一化位移在大小框里的结论必须不同', () => {
  const small: InkCanvas = { w: 100, h: 100 };
  const large: InkCanvas = { w: 1000, h: 1000 };
  const from = pt(0, 0);
  const to = pt(0.01, 0); // 小框里 1px（太近）、大框里 10px（够远）
  assert.equal(isFarEnough(from, to, small, INK_MIN_POINT_DISTANCE_PX), false);
  assert.equal(isFarEnough(from, to, large, INK_MIN_POINT_DISTANCE_PX), true);
});

test('normalizeAxis：正常比例原样；越界夹到 0..1；size 为 0 回 0（不产生 NaN）', () => {
  // ⚠️ 计划那一行的示例写的是「`0.5 / 0.5` ⇒ 0.5」，按签名 `(offset, size)` 算出来是 **1**
  // （0.5 ÷ 0.5 = 1，整除，不越界也不夹）—— 那是计划里那一行写错了，签名与实现都对。
  // 这里按签名给两个真正的「正常比例」：160/320 与 0.5/1。
  assert.equal(normalizeAxis(160, 320), 0.5);
  assert.equal(normalizeAxis(0.5, 1), 0.5);
  assert.equal(normalizeAxis(-0.2, 1), 0); // 夹住
  assert.equal(normalizeAxis(1.3, 1), 1); // 夹住
  assert.equal(normalizeAxis(0.5, 0), 0);
  assert.equal(normalizeAxis(0.5, -5), 0);
  assert.equal(Number.isNaN(normalizeAxis(Number.NaN, 100)), false);
  assert.equal(Number.isNaN(normalizeAxis(0.5, Number.NaN)), false);
});

// ── 换算（两处渲染的公共入口）──────────────────────────────────────────

test('toPixel：{0.5, 0.5} @ {320, 240} ⇒ [160, 120]', () => {
  assert.deepEqual(toPixel(pt(0.5, 0.5), BOX), [160, 120]);
  assert.deepEqual(toPixel(pt(0, 0), BOX), [0, 0]);
  assert.deepEqual(toPixel(pt(1, 1), BOX), [320, 240]);
});

test('strokeWidthPx：0.016 @ min = 160 ⇒ 2.56；width 0 ⇒ 1（下限）', () => {
  const box: InkCanvas = { w: 320, h: 160 };
  assert.equal(strokeWidthPx(stroke([], { width: 0.016 }), box), 2.56);
  assert.equal(strokeWidthPx(stroke([], { width: 0 }), box), 1);
  assert.equal(strokeWidthPx(stroke([], { width: 0.001 }), box), 1);
});

test('🔴 strokeWidthPx 的基准是 min(w, h) —— 一个很宽的框不会把线画粗', () => {
  const wide: InkCanvas = { w: 3000, h: 160 };
  // 拿 w 当基准会得到 48px（一根粗柱子）；min 是 160 ⇒ 与上面那条同一个数。
  assert.equal(strokeWidthPx(stroke([], { width: 0.016 }), wide), 2.56);
  const tall: InkCanvas = { w: 160, h: 3000 };
  assert.equal(strokeWidthPx(stroke([], { width: 0.016 }), tall), 2.56);
});

test('strokePath：两点 ⇒ 以 M 开头、含一个 L；单点 ⇒ 非空且含 l0.01 0；空数组 ⇒ 空串', () => {
  const path = strokePath([pt(0.5, 0.5), pt(1, 1)], BOX);
  assert.ok(path.startsWith('M'));
  assert.ok(path.includes('M160 120'));
  assert.ok(path.includes('L320 240'));

  const dot = strokePath([pt(0.5, 0.5)], BOX);
  assert.notEqual(dot, '');
  assert.ok(dot.includes('l0.01 0'));

  assert.equal(strokePath([], BOX), '');
});

test('strokePath：小数位不漂 —— `d` 串里不出现三位以上小数', () => {
  const path = strokePath([pt(0.111, 0.222), pt(0.333, 0.444)], { w: 3, h: 3 });
  assert.equal(/\.\d{3}/.test(path), false);
  assert.equal(path, 'M0.33 0.67 L1 1.33'); // 3 × 0.111 = 0.333 ⇒ 0.33（round2 的观测量）
});

// ── 读的容错 ────────────────────────────────────────────────────────────

test('readInkValue：合法值 ⇒ 逐字读回，键名仍是 format / canvas / strokes', () => {
  const raw = {
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [
      { color: INK_STROKE_COLOR, width: INK_STROKE_WIDTH, points: [[0.1, 0.2], [0.3, 0.4]] },
    ],
  };
  const parsed = mustRead(raw);
  assert.deepEqual(parsed, raw);
  // 键名是 Global Constraint 17 那件事的一半：笔迹值不许出现作答答案键的名字，
  // 而它的键是**新增**的这三个（加上笔画里的 color / width / points）。
  assert.deepEqual(Object.keys(parsed).sort(), ['canvas', 'format', 'strokes']);
});

test('readInkValue：坏形状整份 ⇒ null（不是抛）', () => {
  assert.equal(readInkValue(null), null);
  assert.equal(readInkValue(undefined), null);
  assert.equal(readInkValue(42), null);
  assert.equal(readInkValue('ink/v1'), null);
  assert.equal(readInkValue([]), null);
  assert.equal(readInkValue([stroke(points(2))]), null);
  assert.equal(readInkValue({ format: 'choice/v1', selected: ['a'] }), null);
  assert.equal(readInkValue({ format: 'ink/v1' }), null); // 没有 strokes 数组
  assert.equal(readInkValue({ format: 'ink/v1', strokes: 'abc' }), null);
  assert.equal(readInkValue({ format: 'ink/v1', strokes: {} }), null);
});

test('readInkValue：一条坏笔画只丢那一条，好的那条留下', () => {
  const good = { color: INK_STROKE_COLOR, width: INK_STROKE_WIDTH, points: [[0.1, 0.1]] };
  const parsed = mustRead({
    format: 'drawing/v1',
    canvas: { w: 320, h: 240 },
    strokes: [null, 'abc', { color: 'x' }, { points: 'abc' }, { points: [1] }, good],
  });
  assert.equal(parsed.strokes.length, 1);
  assert.deepEqual(parsed.strokes[0], good);
  assert.equal(parsed.format, 'drawing/v1');
});

test('readInkValue：`points` 里混进坏点 ⇒ 只丢那几个点，其余照留', () => {
  const parsed = mustRead({
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ color: INK_STROKE_COLOR, width: INK_STROKE_WIDTH, points: [['a', 'b'], [1], null, [0.5], [0.2, 0.3], 'x'] }],
  });
  assert.equal(parsed.strokes.length, 1);
  assert.deepEqual(parsed.strokes[0].points, [[0.2, 0.3]]);
});

test('readInkValue：非法数 / 越界的点 ⇒ 越界的夹到 0..1，非数的丢掉', () => {
  const parsed = mustRead({
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ points: [[7, -3], [Number.NaN, 0.5], [0.5, Number.POSITIVE_INFINITY]] }],
  });
  assert.deepEqual(parsed.strokes[0].points, [[1, 0]]);
});

test('readInkValue：`points` 一个点都不剩 ⇒ 丢掉整笔（它画不出任何东西）', () => {
  const parsed = mustRead({
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ points: [] }, { points: [null, 'x'] }, { points: [[0.5, 0.5]] }],
  });
  assert.equal(parsed.strokes.length, 1);
});

test('readInkValue：样式读不出来 ⇒ 回落常量，几何照留（裁定 2：只有一种颜色一种粗细）', () => {
  const parsed = mustRead({
    format: 'ink/v1',
    canvas: { w: 320, h: 240 },
    strokes: [{ points: [[0.5, 0.5]] }, { color: 7, width: 'x', points: [[0.5, 0.5]] }, { color: '', width: 0, points: [[0.5, 0.5]] }],
  });
  assert.equal(parsed.strokes.length, 3);
  parsed.strokes.forEach((item) => {
    assert.equal(item.color, INK_STROKE_COLOR);
    assert.equal(item.width, INK_STROKE_WIDTH);
  });
});

test('readInkValue：`strokes: []` 是合法的一份空笔迹（不是坏形状）', () => {
  const parsed = mustRead({ format: 'ink/v1', canvas: { w: 320, h: 240 }, strokes: [] });
  assert.deepEqual(parsed.strokes, []);
});

test('readInkValue：`canvas` 读不出来 ⇒ 回落 { w: 0, h: 0 }（不是 null、也不是编一个默认框）', () => {
  const cases: unknown[] = [
    undefined,
    null,
    'abc',
    [],
    { w: 320 }, // 只有一个字段 —— 逐字段回落会产出 w=320/h=0 的框，把所有点压到 y=0 那条线上
    { w: '320', h: 240 },
    { w: 320, h: '240' },
    { w: Number.NaN, h: 240 },
    { w: 0, h: 240 },
    { w: -320, h: 240 },
  ];
  cases.forEach((canvas) => {
    const parsed = mustRead({ format: 'ink/v1', canvas, strokes: [] });
    assert.deepEqual(parsed.canvas, { w: 0, h: 0 }, `canvas = ${JSON.stringify(canvas)}`);
  });
});

test('readInkValue：读出来的那份值能直接喂给渲染三件套（换算 / 线宽 / path 都不产生 NaN）', () => {
  const parsed = mustRead({ format: 'drawing/v1', strokes: [{ points: [[0.5, 0.5]] }] });
  const [x, y] = toPixel(parsed.strokes[0].points[0], parsed.canvas);
  assert.equal(Number.isFinite(x), true);
  assert.equal(Number.isFinite(y), true);
  assert.equal(Number.isFinite(strokeWidthPx(parsed.strokes[0], parsed.canvas)), true);
  assert.equal(strokePath(parsed.strokes[0].points, parsed.canvas).length > 0, true);
});
