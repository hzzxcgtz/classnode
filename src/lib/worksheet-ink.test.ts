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
  INK_MAX_POINTS,
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
  hitTestStroke,
  INK_DEFAULT_COLOR,
  INK_DEFAULT_TEXT_SIZE,
  INK_DEFAULT_TOOL,
  INK_DEFAULT_WIDTH,
  INK_PALETTE,
  INK_TEXT_SIZES,
  textBoxOf,
  textSizeForWidth,
  INK_TOOLS,
  INK_WIDTH_OPTIONS,
  isInkColor,
  isInkWidth,
  isInkShapeKind,
  isInkShapeTool,
  moveStroke,
  resizeStroke,
  INK_SHAPE_KINDS,
  estimateTextWidth,
  hitTestText,
  isShapeTooSmall,
  moveText,
  pickInkHandle,
  pickInkStroke,
  shapeOutline,
  strokeHandles,
  normalizeAxis,
  readInkValue,
  strokePath,
  strokeWidthPx,
  toPixel,
  undoStroke,
  downsampleInkValue,
} from './worksheet-ink.ts';
import type { InkCanvas, InkPoint, InkStroke, InkText, InkValue } from './worksheet-ink.ts';

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

/**
 * 🔴 ★ **这两个数字被钉死在字面量上**（本文件唯一一处硬编码它们的地方）。
 *
 * 它们与 `server/src/services/worksheet-ink.ts` 的同名常量是**同一对**（服务端读不到
 * `src/`，所以是**两份**、不是共享）—— 而这一条是「两处必须一起改」那句话**唯一**能被
 * 机器观测到的地方。服务端那侧有一条逐字对称的用例
 * （`server/src/tests/worksheet-ink.test.ts` 的「两个上限的字面量」那一条）。
 *
 * ⚠️ 为什么必须打**字面量**：本文件其余的上限用例**全部从常量自推导**
 *（`strokes(INK_MAX_STROKES - 1, 1)` / `strokes(INK_MAX_STROKES, 1)` / `strokes(1, 1999)` …）
 * —— 那是刻意的（它抓的是「判据方向写错」：`>` 写成 `>=` 时「恰好到上限」那条当场红）。
 * 但**只**有那种写法时，常量本身被改会让边界用例**跟着漂**、一条都不红：
 * 本轮的实测（反证）—— 把 `INK_MAX_STROKES` 从 400 改成 **500** ⇒
 * 本文件**其余 34 条全绿**，只有下面这一条变红。
 */
test('🔴 两个上限的字面量：400 笔 / 2000 点（与 `server/src/services/worksheet-ink.ts` 是同一对）', () => {
  assert.equal(INK_MAX_STROKES, 400, '笔数上限改了 ⇒ 必须同步改 server/src/services/worksheet-ink.ts');
  assert.equal(INK_MAX_POINTS, 2000, '点数上限改了 ⇒ 必须同步改 server/src/services/worksheet-ink.ts');
});

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

/* ── ★ 抽稀（只给「正在输入」那条实时通道用）────────────────────────── */

test('★ 抽稀：不是笔迹的值**原样返回**（文本/选择远小于预算，不该被动）', () => {
  const text = { format: 'text/v1', text: '光合作用需要阳光' };
  assert.equal(downsampleInkValue(text, 100), text, '返回的必须是**同一个对象**（原样，不是复制）');
});

test('★ 抽稀：装得下就原样返回（不许无谓地降质）', () => {
  const small = {
    format: 'ink/v1', canvas: { w: 10, h: 10 },
    strokes: [{ color: '#000', width: 2, points: [[0, 0], [1, 1]] as InkPoint[] }],
  };
  assert.equal(downsampleInkValue(small, 100000), small);
});

/**
 * 🔴 **装不下时必须真的变小，而且首尾要留着。**
 * 一幅实测约 335 KB 的画，只有抽稀才能走那条 300ms 节流的通道。
 */
test('🔴 抽稀：超预算的一幅画要被抽小，且每一笔的首尾都在', () => {
  const points: InkPoint[] = Array.from({ length: 400 }, (_, index) => [index / 400, index / 400] as InkPoint);
  const big = {
    format: 'ink/v1', canvas: { w: 320, h: 240 },
    strokes: Array.from({ length: 8 }, () => ({ color: '#000', width: 2, points })),
  };
  const before = JSON.stringify(big).length;
  assert.ok(before > 20000, `前提：这一幅要真的超预算（实际 ${before}）`);

  const after = downsampleInkValue(big, 4000);
  const size = JSON.stringify(after).length;
  assert.ok(size <= 4000, `抽稀后要装得下：${size} > 4000`);
  const read = readInkValue(after)!;
  assert.equal(read.strokes.length, 8, '笔数不许变（少一笔就是少一条线）');
  for (const stroke of read.strokes) {
    assert.deepEqual(stroke.points[0], points[0], '每一笔的首点必须在');
    assert.deepEqual(stroke.points[stroke.points.length - 1], points[points.length - 1], '每一笔的尾点必须在');
  }
});

/**
 * 🔴 **少于两个点的笔画画不出线**（`strokePath` 会给一条空路径），而空白与「他没画」
 * 长得一模一样 —— 所以抽稀**永远不能把一笔抽到只剩一个点**。
 */
test('🔴 抽稀：一笔只剩两个点时不再抽（再抽就画不出线了）', () => {
  const tiny = {
    format: 'ink/v1', canvas: { w: 10, h: 10 },
    strokes: [{ color: '#000', width: 2, points: [[0, 0], [1, 1]] as InkPoint[] }],
  };
  const out = readInkValue(downsampleInkValue(tiny, 1))!;
  assert.equal(out.strokes[0].points.length, 2, '两个点必须都留着');
});

/* ══ ★ 2026-09-30：基本图形工具 ═══════════════════════════════════════════
   教师原话：「帮我解决绘图区支持基本图形工具」，并在四条上分别定了：
   都要 / 学生画布 / 甲档（选择-移动-改大小-删除）/ 手写笔留着。
   规格：`specs/2026-09-30-绘图区-基本图形工具.md`

   🔴 这一层是本次的重心：`ink-canvas.tsx`（Canvas）与 `ink-preview.tsx`（SVG）
      是**两个渲染器**，而判据全在这里 ⇒ 只要这一层的折线是对的，
      两边的画法就只可能同时对（见 spec 里「几何是那一份」那一节）。
*/

/** 一个图形的笔迹（点 = 定义几何，不是画出来的点）。 */
function shapeStroke(shape: string, points: InkPoint[]): InkStroke {
  return { color: INK_STROKE_COLOR, width: INK_STROKE_WIDTH, points, shape } as InkStroke;
}

test('🔴 shapeOutline：手写笔迹（没有 shape）**不产生任何折线**', () => {
  // 手写那条路走的是画布自己的 `lineTo`（今天就是这样），不经过 shapeOutline。
  assert.deepEqual(shapeOutline({ points: [[0, 0], [1, 1]] }, { w: 200, h: 100 }), []);
});

test('🔴 shapeOutline：直线 / 矩形（1 条折线，闭合与否各自标）', () => {
  const box = { w: 200, h: 100 };
  assert.deepEqual(shapeOutline(shapeStroke('line', [[0.1, 0.2], [0.6, 0.8]]), box),
    [{ closed: false, points: [[0.1, 0.2], [0.6, 0.8]] }]);

  const rect = shapeOutline(shapeStroke('rect', [[0.1, 0.2], [0.5, 0.6]]), box);
  assert.equal(rect.length, 1, '矩形应当是 1 条折线');
  assert.equal(rect[0].closed, true, '矩形要闭合');
  assert.deepEqual(rect[0].points, [[0.1, 0.2], [0.5, 0.2], [0.5, 0.6], [0.1, 0.6]]);
});

test('🔴 shapeOutline：学生从**任意方向**拖都要成立（对角要排序）', () => {
  // 学生很可能从右下往左上拖 —— 那时 points[0] 是 max、points[1] 是 min。
  // 🔴 少了对角排序，矩形会自己交叉成「蝴蝶结」，而屏幕上只是「画出来的框怪怪的」。
  const box = { w: 200, h: 100 };
  assert.deepEqual(
    shapeOutline(shapeStroke('rect', [[0.5, 0.6], [0.1, 0.2]]), box)[0].points,
    [[0.1, 0.2], [0.5, 0.2], [0.5, 0.6], [0.1, 0.6]],
  );
});

test('🔴 shapeOutline：**归一化空间是各向异性的** —— 形状要在像素空间里算再转回来', () => {
  // 🔴 本次最容易做错的地方：x 乘画布宽、y 乘画布高，两者不等。
  //    先在归一化空间里算「箭头头部」再直接用，宽高比一变箭头就是**歪的**
  //    —— 而屏幕上只是「箭头看着怪」，没有任何报错。
  const stroke = shapeStroke('arrow', [[0.1, 0.5], [0.9, 0.5]]);
  const wingPx = (box: InkCanvas) => {
    const parts = shapeOutline(stroke, box);
    assert.equal(parts.length, 2, '箭头应当是「杆 + 头部」两条折线');
    const [left, tip, right] = parts[1].points;      // 头部 = 左翼 → 尖端 → 右翼
    const px = (p: InkPoint): InkPoint => [p[0] * box.w, p[1] * box.h];
    const dist = (p: InkPoint, q: InkPoint) => Math.hypot(px(p)[0] - px(q)[0], px(p)[1] - px(q)[1]);
    return { left: dist(left, tip), right: dist(right, tip), tipX: px(tip)[0] };
  };
  // 很扁的画布 vs 很方的画布：同一个笔迹，**像素空间**里的翼长必须一样。
  const flat = wingPx({ w: 400, h: 50 });
  const square = wingPx({ w: 100, h: 100 });
  // ⚠️ 容差是 **1e-3 像素**，不是 1e-6：`shapeOutline` 把归一化输出统一四舍五入到
  //    6 位小数（那是为了 `deepEqual` 那些用例稳定），折算到 400px 宽的画布上
  //    约 4e-4 px —— 比一个像素小四个数量级，肉眼与渲染都无差别。
  //    ✅ 这条容差仍然咬得住：**不在像素空间算**的话，两种画布下的翼长会差**好几个像素**。
  assert.ok(Math.abs(flat.left - square.left) < 1e-3,
    `两种画布下箭头翼长必须相同（像素空间），实际 ${flat.left} vs ${square.left}`);
  // 两翼对称（左右等长）—— 归一化空间里算的话，这条在非方画布上必红。
  assert.ok(Math.abs(flat.left - flat.right) < 1e-3, `两翼应当等长，实际 ${flat.left} vs ${flat.right}`);
  // 尖端落在杆的终点上。
  assert.ok(Math.abs(flat.tipX - 0.9 * 400) < 1e-3, `尖端应当落在杆的终点，实际 x=${flat.tipX}`);
});

test('🔴 shapeOutline：椭圆是**闭合折线**（不是弧命令，两个渲染器只会画折线）', () => {
  const box = { w: 200, h: 200 };
  const parts = shapeOutline(shapeStroke('ellipse', [[0.2, 0.2], [0.8, 0.8]]), box);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].closed, true);
  assert.ok(parts[0].points.length >= 16, `椭圆至少要有 16 段，实际 ${parts[0].points.length} 个点`);
  // 每个点都在外接框上（内切椭圆）—— 用像素空间量，否则非方画布上量不准。
  for (const [x, y] of parts[0].points) {
    const dx = (x - 0.5) / 0.3, dy = (y - 0.5) / 0.3;      // 半径 0.3（归一化）
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 0.02, `点 (${x}, ${y}) 不在内切椭圆上`);
  }
});

test('🔴 shapeOutline：角的弧也是折线，且**半径比例一致**', () => {
  const box = { w: 200, h: 200 };
  const parts = shapeOutline(shapeStroke('angle', [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]]), box);
  assert.equal(parts.length, 3, '角应当是「两条射线 + 一段弧」');
  assert.equal(parts[0].closed, false);
  assert.deepEqual(parts[0].points, [[0.9, 0.1], [0.1, 0.1]], '第一条射线：从边一的端点回到顶点');
  assert.deepEqual(parts[1].points, [[0.1, 0.1], [0.1, 0.9]], '第二条射线：从顶点到边二的端点');
  assert.ok(parts[2].points.length >= 4, '弧要是折线（至少几段）');
});

test('🔴 INK_SHAPE_KINDS：九个，且一条不多一条不少', () => {
  assert.deepEqual([...INK_SHAPE_KINDS], ['line', 'arrow', 'rect', 'ellipse', 'triangle',
    'right-triangle', 'parallelogram', 'trapezoid', 'angle']);
  assert.equal(isInkShapeKind('rect'), true);
  assert.equal(isInkShapeKind('hexagon'), false);
  assert.equal(isInkShapeKind(undefined), false);
  assert.equal(isInkShapeKind(42), false);
});

test('🔴 strokePath：有 shape 时走折线；**没有时一个字不改**（老调用点不动）', () => {
  const box = { w: 200, h: 100 };
  // ⚠️ 手写那条路是**既有行为**，逐字钉住 —— 它在四个渲染点、以及服务端镜像里都跑着。
  //    （格式是 `M0 0 L200 100`，`M`/`L` 后面**没有空格**；第一版计划里我把它写成了
  //     `M 0 0 L 200 100`，那是错的。）
  assert.equal(strokePath([[0, 0], [1, 1]], box), 'M0 0 L200 100');
  // 矩形 ⇒ 一条闭合折线，以 Z 收尾
  const d = strokePath([[0.1, 0.2], [0.5, 0.6]], box, 'rect');
  assert.ok(d.startsWith('M'), `应当以 M 开头，实际 ${d}`);
  assert.ok(d.endsWith('Z'), `闭合折线要以 Z 收尾，实际 ${d}`);
  // 🔴 反面：手写那条路**不许**因为多了第三个参数而变样。
  assert.equal(strokePath([[0, 0], [1, 1]], box, undefined), 'M0 0 L200 100');
});

test('🔴 hitTestStroke：闭合图形**内部也算命中**；线状只算轮廓附近', () => {
  const box = { w: 200, h: 200 };
  const rect = shapeStroke('rect', [[0.2, 0.2], [0.8, 0.8]]);
  assert.equal(hitTestStroke([0.5, 0.5], rect, box, 8), true, '点在矩形**内部**要点得中（否则学生拖不动它）');
  assert.equal(hitTestStroke([0.95, 0.95], rect, box, 8), false, '离得远就不该中');

  const line = shapeStroke('line', [[0.2, 0.5], [0.8, 0.5]]);
  assert.equal(hitTestStroke([0.5, 0.52], line, box, 8), true, '线附近（宽容度内）');
  assert.equal(hitTestStroke([0.5, 0.9], line, box, 8), false, '线**下方**不算 —— 直线没有内部');
});

test('🔴 hitTestStroke：**手写笔迹一律不命中**（不然学生一点就选中自己画的线）', () => {
  const box = { w: 200, h: 200 };
  const freehand: InkStroke = { color: '', width: 0, points: [[0.2, 0.2], [0.8, 0.8]] };
  assert.equal(hitTestStroke([0.5, 0.5], freehand, box, 8), false);
  // 也**不许**把点划到画布外当作命中（宽容度不该把整个画布变成热区）。
  assert.equal(hitTestStroke([2, 2], freehand, box, 8), false);
});

test('🔴 strokeHandles：两点框图形 4 个角；直线/箭头 2 个端点；角 3 个顶点', () => {
  assert.deepEqual(strokeHandles(shapeStroke('rect', [[0.1, 0.2], [0.5, 0.6]])),
    [[0.1, 0.2], [0.5, 0.2], [0.5, 0.6], [0.1, 0.6]]);
  assert.deepEqual(strokeHandles(shapeStroke('line', [[0.1, 0.2], [0.5, 0.6]])),
    [[0.1, 0.2], [0.5, 0.6]]);
  // 🔴 角是**三个自由点**（顶点 + 两条边的端点），不是外接框的四个角 ——
  //    给它四个角的话，学生拖一个角会把「顶点」和「边」的语义搅在一起。
  assert.deepEqual(strokeHandles(shapeStroke('angle', [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]])),
    [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]]);
  // 手写没有把手（它不参与选中）。
  assert.deepEqual(strokeHandles({ color: '', width: 0, points: [[0, 0], [1, 1]] }), []);
});

test('🔴 moveStroke：平移后**按包围盒夹取到 0..1**（不许把图形拖出画布外）', () => {
  const box = { w: 200, h: 100 };
  const rect = shapeStroke('rect', [[0.2, 0.2], [0.6, 0.6]]);
  assert.deepEqual(moveStroke(rect, 0.1, 0.1).points, [[0.3, 0.3], [0.7, 0.7]]);
  assert.deepEqual(moveStroke(rect, 0, 0).points, [[0.2, 0.2], [0.6, 0.6]], '零位移不该动它');
  // 🔴 往左上拖过头 ⇒ **整体停在边界上**（形状不变形）。
  //    ⚠️ 逐点夹取会把矩形压扁成一条线 —— 而屏幕上只是「矩形变形了」。
  assert.deepEqual(moveStroke(rect, -9, -9).points, [[0, 0], [0.4, 0.4]]);
  assert.deepEqual(moveStroke(rect, 9, 9).points, [[0.6, 0.6], [1, 1]]);
  // 只要有一个方向到界，那一维就停住、另一维照走。
  assert.deepEqual(moveStroke(rect, -9, 0.1).points, [[0, 0.3], [0.4, 0.7]]);
  void box;
});

test('🔴 moveStroke：手写笔迹**也能平移**（它不是图形，但同一个函数不该对它失效）', () => {
  // ⚠️ 这条是**反面**：图形可选中、手写不可选中；而 `moveStroke` 是纯几何，
  //    它对谁都能算。别在这里加一道「只许图形」的闸 —— 那会让这个函数突然与选中扯上关系。
  const freehand: InkStroke = { color: '', width: 0, points: [[0.1, 0.1], [0.2, 0.2]] };
  assert.deepEqual(moveStroke(freehand, 0.05, 0).points, [[0.15, 0.1], [0.25, 0.2]]);
});

test('🔴 resizeStroke：拖一个角 ⇒ 那个角动、对角不动（外接框重算）', () => {
  const rect = shapeStroke('rect', [[0.2, 0.2], [0.6, 0.6]]);
  // 把手 0 = 左上角 [0.2,0.2] ⇒ 拖到 [0.1,0.3]
  assert.deepEqual(resizeStroke(rect, 0, [0.1, 0.3]).points, [[0.1, 0.3], [0.6, 0.6]]);
  // 把手 2 = 右下角 [0.6,0.6] ⇒ 拖到 [0.9,0.95]
  assert.deepEqual(resizeStroke(rect, 2, [0.9, 0.95]).points, [[0.2, 0.2], [0.9, 0.95]]);
  // 🔴 拖过头**穿过对角** ⇒ 只是框翻了个方向，仍然是合法矩形（不许变成负宽）。
  assert.deepEqual(resizeStroke(rect, 0, [0.9, 0.9]).points, [[0.6, 0.6], [0.9, 0.9]]);
  // 把手越界 ⇒ 原样返回（坏输入不许造出一个框外的图形）。
  assert.deepEqual(resizeStroke(rect, 99, [0.5, 0.5]).points, rect.points);
  // 🔴 **拖到画布外 ⇒ 夹回边界**（与 `moveStroke` 的夹取同一条纪律）。
  //    ⚠️ 少了这一条，学生把角拖到画布外就能造出一个「一半在框外」的图形 ——
  //    教师端按外接框渲染，那一半会被裁掉，而学生屏幕上看着是好的。
  //    （这条是变异检验补出来的：我先前的用例全都落在 0..1 之内，夹取从来没被触发过。）
  // ⚠️ 拖右下角到 (1.5, -0.2) ⇒ 夹成 (1, 0)，而另一角仍在 (0.2,0.2)
  //    ⇒ 包围盒是 [[0.2, 0], [1, 0.2]]（y 的上界由 0.6 变成 0.2，不是 0.6）。
  assert.deepEqual(resizeStroke(rect, 2, [1.5, -0.2]).points, [[0.2, 0], [1, 0.2]]);
  assert.deepEqual(resizeStroke(shapeStroke('line', [[0.1, 0.1], [0.9, 0.9]]), 1, [2, 2]).points, [[0.1, 0.1], [1, 1]]);
  assert.deepEqual(resizeStroke(shapeStroke('angle', [[0.5, 0.5], [0.9, 0.5], [0.5, 0.9]]), 0, [-1, 3]).points,
    [[0, 1], [0.9, 0.5], [0.5, 0.9]]);
});

test('🔴 resizeStroke：直线拖的是**端点**、角拖的是**顶点**（不是外接框）', () => {
  const line = shapeStroke('line', [[0.1, 0.1], [0.9, 0.9]]);
  assert.deepEqual(resizeStroke(line, 0, [0.2, 0.3]).points, [[0.2, 0.3], [0.9, 0.9]]);
  assert.deepEqual(resizeStroke(line, 1, [0.2, 0.3]).points, [[0.1, 0.1], [0.2, 0.3]]);
  const angle = shapeStroke('angle', [[0.5, 0.5], [0.9, 0.5], [0.5, 0.9]]);
  assert.deepEqual(resizeStroke(angle, 0, [0.4, 0.4]).points, [[0.4, 0.4], [0.9, 0.5], [0.5, 0.9]]);
  assert.deepEqual(resizeStroke(angle, 2, [0.1, 0.3]).points, [[0.5, 0.5], [0.9, 0.5], [0.1, 0.3]]);
  // 手写没有把手 ⇒ 原样返回（它不该被 resize）。
  const freehand: InkStroke = { color: '', width: 0, points: [[0, 0], [1, 1]] };
  assert.deepEqual(resizeStroke(freehand, 0, [0.5, 0.5]).points, freehand.points);
});

test('🔴 readInkValue：认 shape；**认不出的形状整笔丢掉**（不是静默当手写）', () => {
  // 🔴 「静默当手写」是最坏的一种：学生画了一个矩形、教师看到一条奇怪的手写线，
  //    而两边都不报错。丢掉整笔至少与「坏点丢整笔」是同一条纪律 —— 一致的代价。
  const value = {
    format: 'ink/v1', canvas: { w: 200, h: 100 },
    strokes: [
      { color: '#000', width: 0.01, points: [[0, 0], [1, 1]] },                    // 老值：手写
      { color: '#000', width: 0.01, points: [[0, 0], [1, 1]], shape: 'rect' },     // 图形
      { color: '#000', width: 0.01, points: [[0, 0], [1, 1]], shape: 'hexagon' },  // 坏形状
      { color: '#000', width: 0.01, points: [[0, 0], [1, 1]], shape: 42 },         // 坏形状（不是字符串）
    ],
  };
  const read = readInkValue(value);
  assert.equal(read?.strokes.length, 2, '认不出的形状那两笔都要被丢掉');
  assert.equal(read?.strokes[0].shape, undefined, '老值仍然没有 shape');
  assert.equal(read?.strokes[1].shape, 'rect');
});

test('🔴 downsampleInkValue：**图形一个点都不许抽**（点是它的定义几何，不是采样）', () => {
  // 🔴 手写的点是**采样**（抽掉一半形状基本不变），而图形的点是**定义几何**：
  //    · 角有 3 个点（顶点 + 两条边），抽掉中间那个 ⇒ **角变成一条直线**；
  //    · 矩形/椭圆只有 2 个点，抽掉一个 ⇒ 只剩一个点，画出来是一片空白
  //      （而空白与「他没画」在屏幕上一模一样）。
  //    ⚠️ `keepEveryOther` 现有的守卫是「点数 ≤ 2 就不抽」—— 它对**角**不成立（3 个点）。
  const value = {
    format: 'ink/v1', canvas: { w: 100, h: 100 },
    strokes: [
      { color: '#000', width: 0.01, points: [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]], shape: 'angle' },
      { color: '#000', width: 0.01, points: [[0.2, 0.2], [0.8, 0.8]], shape: 'rect' },
      // 一笔手写，用来看「手写照抽」（阳性对照）
      { color: '#000', width: 0.01, points: Array.from({ length: 40 }, (_, i) => [i / 40, i / 40] as InkPoint) },
    ],
  };
  const small = downsampleInkValue(value, 60) as typeof value;
  assert.equal(small.strokes[0].points.length, 3, '角的三个顶点被抽掉了 —— 它会变成一条直线');
  assert.equal(small.strokes[1].points.length, 2, '矩形的定义几何被抽掉了');
  // 阳性对照：手写那一笔**照旧被抽**（别为了保图形把整条抽稀路径关掉）。
  assert.ok(small.strokes[2].points.length < 40, `手写那一笔没被抽（${small.strokes[2].points.length} 个点）—— 那这个函数就没在干活`);
});

test('🔴 INK_TOOLS：**默认档是手写**，顺序 = 工具栏顺序', () => {
  // ★ 2026-09-30（基本图形工具，教师选「甲」）。
  // 🔴 「默认是手写」是一条**产品规则**，不是口味：老习惯的学生进题目要能直接画，
  //    默认成别的档他会以为画布坏了（而画布确实会「画不出线」）。
  assert.equal(INK_DEFAULT_TOOL, 'pen');
  // 顺序：手写在前、选择在后、九个图形夹在中间（与 `INK_SHAPE_KINDS` 同序）。
  // ★ 第二轮：文字档夹在九个图形与「选择」之间（工具栏上就是这个顺序）。
  assert.deepEqual([...INK_TOOLS], ['pen', ...INK_SHAPE_KINDS, 'text', 'select']);
  // 「这一档是不是画图形」的判据：`pen` 与 `select` 都不是。
  assert.equal(isInkShapeTool('rect'), true);
  assert.equal(isInkShapeTool('pen'), false);
  assert.equal(isInkShapeTool('select'), false);
  assert.equal(isInkShapeTool('text'), false, '文字档不是一个图形');
});

test('🔴 INK_WIDTH_OPTIONS：三档，且**中间那档就是原来的默认值**', () => {
  // ★ 2026-09-30（教师：「笔的粗细」+「要能选」）。
  // 🔴 「中间那档 = `INK_STROKE_WIDTH`」是一条**兼容性**要求，不是口味：
  //    它保证**加选项这件事不改默认手感** —— 否则以前画的与现在画的会不一样粗，
  //    而屏幕上只是「今天这笔怎么变粗了」，没有任何报错。
  assert.equal(INK_WIDTH_OPTIONS.length, 3);
  assert.equal(INK_WIDTH_OPTIONS[1], INK_STROKE_WIDTH, '中间那档必须还是原来的默认值');
  assert.equal(INK_DEFAULT_WIDTH, INK_STROKE_WIDTH);
  // 从小到大（UI 上「细中粗」的顺序就靠它）。
  assert.ok(INK_WIDTH_OPTIONS[0] < INK_WIDTH_OPTIONS[1] && INK_WIDTH_OPTIONS[1] < INK_WIDTH_OPTIONS[2]);
  assert.equal(isInkWidth(INK_WIDTH_OPTIONS[0]), true);
  assert.equal(isInkWidth(0.5), false, '认不出的粗细要被判掉（读值那一侧据此回落）');
});

test('🔴 pickInkHandle：控制点在**轮廓外面**也要抓得住（复审抓出来的核心缺陷）', () => {
  // ★ 2026-09-30 复审。**五个**图形的控制点（外接框的角）落在轮廓外面很远：
  //    椭圆 ≈30px、三角形 ≈75px（320×240 实测）。选择档原来是「先轮廓命中、再找控制点」
  //    ⇒ 按下那个**画出来的白点**时所有笔迹都不命中 ⇒ 选中被丢掉、什么都没拖起来。
  //    🔴 这条用例是它的回归网：控制点判定必须**独立于**轮廓命中。
  const box = { w: 320, h: 240 };
  const shapes = ['ellipse', 'triangle', 'trapezoid', 'parallelogram', 'right-triangle'];
  for (const shape of shapes) {
    const stroke = shapeStroke(shape, [[0.15, 0.15], [0.85, 0.85]]);
    const handles = strokeHandles(stroke);
    assert.ok(handles.length >= 4, `${shape} 应当有四个控制点`);
    for (let index = 0; index < handles.length; index += 1) {
      assert.equal(pickInkHandle(handles[index], stroke, box, 14), index,
        `${shape} 的第 ${index} 个控制点抓不住 —— 按下去会丢掉选中`);
    }
  }
  // 阳性对照：离得远就是 -1（别把整个画布变成热区）。
  assert.equal(pickInkHandle([0.5, 0.5], shapeStroke('ellipse', [[0.15, 0.15], [0.85, 0.85]]), box, 14), -1);
  // 手写没有控制点 ⇒ 永远 -1。
  assert.equal(pickInkHandle([0.1, 0.1], { color: '', width: 0, points: [[0.1, 0.1], [0.9, 0.9]] }, box, 14), -1);
});

test('🔴 pickInkStroke：从**后往前**找（重叠处选后画的那个），手写不命中', () => {
  const box = { w: 320, h: 240 };
  const strokes: InkStroke[] = [
    shapeStroke('rect', [[0.1, 0.1], [0.9, 0.9]]),
    shapeStroke('rect', [[0.2, 0.2], [0.5, 0.5]]),
    { color: '', width: 0, points: [[0.05, 0.05], [0.95, 0.95]] },
  ];
  // (0.3,0.3) 两个矩形都命中 ⇒ 选**后画**的那个（下标 1）；手写那一笔在最后但它不参与。
  assert.equal(pickInkStroke([0.3, 0.3], strokes, box, 14), 1);
  // 只有第一个矩形命中。
  assert.equal(pickInkStroke([0.8, 0.8], strokes, box, 14), 0);
  // 全都点不中。
  assert.equal(pickInkStroke([0.99, 0.01], strokes, box, 14), -1);
});

test('🔴 isShapeTooSmall：**任一边**太小就丢；但线与角各按自己的几何判', () => {
  // ★ 2026-09-30 复审：这条规则原来散在组件里，且**三份说法打架**（spec / 代码 / 注释）。
  const box = { w: 320, h: 240 };
  const at = (shape: string, pts: InkPoint[]) => isShapeTooSmall(shapeStroke(shape, pts), box, 8);

  // 外接框图形：**任一边**太小就丢 —— 200×2 的薄片也要丢（「两边都小才丢」会放它进来）。
  assert.equal(at('rect', [[0, 0], [0.625, 2 / 240]]), true, '200×2 的薄片应当丢掉');
  assert.equal(at('rect', [[0, 0], [2 / 320, 0.833]]), true, '2×200 的薄片应当丢掉');
  assert.equal(at('rect', [[0, 0], [0.009, 0.009]]), true, '3×3 的手抖应当丢掉');
  assert.equal(at('rect', [[0, 0], [0.31, 0.33]]), false, '100×80 是正常的矩形');

  // 🔴 线：**只要两点不重合**就算成形 —— 一条 200×2 的水平直线是**合法**的。
  assert.equal(at('line', [[0, 0], [0.625, 2 / 240]]), false, '水平的直线不该被丢掉');
  assert.equal(at('arrow', [[0.5, 0], [0.9, 0]]), false, '水平的箭头不该被丢掉');
  assert.equal(at('line', [[0.5, 0.5], [0.5, 0.5]]), true, '两点重合才算没画');

  // 🔴 角：按**两条边各自的长度**判，不拿外接框 —— 一条竖直的边会让外接框宽 = 0，
  //    用「任一边太小就丢」会把一个完全正常的角判掉。
  assert.equal(at('angle', [[0.5, 0.2], [0.5, 0.8], [0.9, 0.2]]), false, '竖直的那条边不该让它被判掉');
  assert.equal(at('angle', [[0.5, 0.5], [0.5, 0.505], [0.9, 0.5]]), true, '有一条边短得几乎为零才算没画');

  // 手写不走这条判据（学生在屏幕上点一下就该留下一个点）。
  assert.equal(isShapeTooSmall({ color: '', width: 0, points: [[0.5, 0.5]] }, box, 8), false);
});

test('🔴 INK_PALETTE：八色，**第一个就是原来的默认色**，而且都是十六进制', () => {
  // ★ 2026-09-30（教师：「还缺少颜色工具」+「八色固定色板」）。
  // 🔴 「第一个 = `INK_STROKE_COLOR`」与粗细那条同一条纪律：**加选项不改默认观感**
  //    （否则以前画的与新画的不是一个颜色，而屏幕上只是「今天这笔怎么变色了」）。
  assert.equal(INK_PALETTE.length, 8);
  assert.equal(INK_PALETTE[0].value, INK_STROKE_COLOR);
  assert.equal(INK_DEFAULT_COLOR, INK_STROKE_COLOR);
  // 每一格都要是**十六进制** —— `server/src/services/ink-render.ts` 的 `safeColor` 只认它，
  // 别的写法会在教师用卷那张图上被回落成常量色（而屏幕上看着是好的）。
  for (const swatch of INK_PALETTE) {
    assert.equal(isInkColor(swatch.value), true, `${swatch.label} 不是十六进制：${swatch.value}`);
    assert.ok(swatch.label.length > 0, '每一格都要有中文名（读屏与悬停都用它）');
  }
  assert.equal(isInkColor('red'), false, '颜色名不算 —— 导出那边会回落');
  assert.equal(isInkColor('rgb(1,2,3)'), false);
  assert.equal(isInkColor('#fff'), true, '三位简写也算');
});

/* ══ ★ 2026-09-30 第二轮：文本工具 ═══════════════════════════════════════ */

test('🔴 文字的单位规则与笔迹**逐字相同**（写错不会报错，只会让字号随屏幕变化）', () => {
  const box = { w: 200, h: 100 };
  const text: InkText = { text: 'AB', at: [0.25, 0.5], color: INK_STROKE_COLOR, size: 0.07 };
  const [x, y, w, h] = textBoxOf(text, box);
  // `at` 归一化到 0..1（基准是画布宽高）
  assert.equal(x, 50);
  assert.equal(y, 50);
  // `size` 归一化到 **min(w,h)** —— 200×100 的框里短边是 100 ⇒ 字号 7px
  assert.ok(Math.abs(h - 0.07 * 100 * 1.3) < 1e-6, `行高应当按短边算，实际 ${h}`);
  // 宽度按字符估：两个拉丁字符 ≈ 2 × 0.55 em
  assert.ok(Math.abs(w - 2 * 0.55 * 0.07 * 100) < 1e-6, `宽度估错了：${w}`);
  // 🔴 换一个**宽高比不同**的框：字号必须跟着**短边**变，不跟着宽。
  const [, , , h2] = textBoxOf(text, { w: 400, h: 100 });
  assert.equal(h2, h, '短边一样时行高必须一样（跟着 min(w,h)，不是 w）');
  const [, , , h3] = textBoxOf(text, { w: 200, h: 300 });
  assert.ok(h3 > h, '短边变大 ⇒ 字号变大');
  // CJK 按 1 em 估（而不是拉丁的 0.55）—— **逐字**比，别拿两个字的和去比（第一版就是这么写错的）。
  assert.ok(estimateTextWidth('中') > estimateTextWidth('a'), 'CJK 要按全宽估');
  assert.ok(Math.abs(estimateTextWidth('中文') - 2) < 1e-6, '两个汉字 ≈ 2 em');
});

test('🔴 readInkValue：认 texts；**老值（没有 texts）读出来仍然没有这个键**', () => {
  const base = { format: 'ink/v1', canvas: { w: 100, h: 100 }, strokes: [{ color: '#000', width: 0.01, points: [[0, 0], [1, 1]] }] };
  // 老值：不带 `texts` ⇒ 读出来也**不带**（`undefined` 而不是 `[]`）——
  // 那让「老值原样返回」在 deepEqual 上也成立，而不是多出一个空数组。
  const old = readInkValue(base);
  assert.equal(old?.texts, undefined, '老值不该凭空多出一个 texts');
  // 新值：带上文字
  const withText = readInkValue({ ...base, texts: [{ text: '你好', at: [0.1, 0.2], color: '#dc2626', size: 0.07 }] });
  assert.equal(withText?.texts?.length, 1);
  assert.equal(withText?.texts?.[0].text, '你好');
  // 坏形状**整段丢掉**（与「坏点丢整笔」同一条纪律）：
  //   · 没有 text / 没有 at ⇒ 丢；· color / size 坏 ⇒ **回落**（样式坏不丢几何）。
  const mixed = readInkValue({ ...base, texts: [
    { at: [0.1, 0.2] },                                        // 没有 text ⇒ 丢
    { text: '甲', at: ['x', 'y'] },                            // at 坏 ⇒ 丢
    { text: '乙', at: [0.3, 0.4], color: 'red', size: 99 },    // 样式坏 ⇒ 收下并回落
  ] });
  assert.equal(mixed?.texts?.length, 1, '坏的两段都要丢掉');
  assert.equal(mixed?.texts?.[0].color, INK_STROKE_COLOR, '坏颜色要回落成常量色');
  assert.equal(mixed?.texts?.[0].size, INK_DEFAULT_TEXT_SIZE, '坏字号要回落成默认档');
});

test('🔴 hitTestText / moveText / textSizeForWidth', () => {
  const box = { w: 200, h: 200 };
  const text: InkText = { text: 'AB', at: [0.1, 0.1], color: INK_STROKE_COLOR, size: 0.07 };
  assert.equal(hitTestText([0.12, 0.12], text, box, 8), true, '框内要点得中');
  assert.equal(hitTestText([0.9, 0.9], text, box, 8), false, '离得远不中');
  // 平移：夹到 0..1（按估算框，不是逐点）
  assert.deepEqual(moveText(text, 0.1, 0.1).at, [0.2, 0.2]);
  assert.deepEqual(moveText(text, 0, 0).at, [0.1, 0.1], '零位移不该动它');
  assert.ok(moveText(text, -9, -9).at[0] === 0 && moveText(text, -9, -9).at[1] === 0, '往左上拖过头要停在边界');
  // 字号跟着粗细档（教师：「字号跟着粗细档」）
  assert.equal(textSizeForWidth(INK_WIDTH_OPTIONS[0]), INK_TEXT_SIZES[0]);
  assert.equal(textSizeForWidth(INK_WIDTH_OPTIONS[2]), INK_TEXT_SIZES[2]);
  assert.equal(textSizeForWidth(0.999), INK_DEFAULT_TEXT_SIZE, '认不出的粗细档取中间');
});
