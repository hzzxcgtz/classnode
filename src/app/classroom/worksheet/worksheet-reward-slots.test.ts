/**
 * ★ 2026-10-08（教师 第 7 项，原话）：「这个奖励图标改一种显示方式，**移动到这行绿色文字
 *   信息框的前面**，例如这题满分是 2 个图标，在完成评分前先显示两个非常浅的灰度化处理的
 *   图标，评分后，根据评分结果将指定个数的图标改为正常颜色显示。」
 *   并选定：**超过 5 个封顶，改用 `×N`**。
 *
 * 🔴 三层都要钉，少一层就会假绿：
 *   ① 纯函数 —— 满分怎么算（与服务端同口径）、槽位怎么排（含封顶与"得分超过满分"那条）；
 *   ② 接线 —— 槽位真的挂在白底圆角条**外面**（教师第二批改的口径，早先是"条子里的第一个子项"）、
 *      真的按满分画、未得的那几枚走灰档；
 *   ③ CSS —— `.resultReward` 不再是绝对定位角标（否则画再多槽位也还压在框角上）。
 *
 * ⚠️ CSS 按「**所有**同名块里最后声明的那一条」读（本文件所在目录已踩过三次这个坑）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_REWARD_SLOTS,
  resolveFullPoints,
  resolveWorksheetFullStep,
  rewardSlotPlan,
} from '../../../lib/worksheet-reward.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const PANEL = fs.readFileSync(path.join(HERE, 'worksheet-panel.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BADGE = fs.readFileSync(path.join(HERE, 'reward-badge.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function ruleBodies(selector: string): string[] {
  const bodies: string[] = [];
  let cursor = 0;
  for (;;) {
    const at = CSS.indexOf(`\n${selector} {`, cursor);
    if (at < 0) break;
    const open = CSS.indexOf('{', at);
    const close = CSS.indexOf('}', open);
    if (close < 0) break;
    bodies.push(CSS.slice(open + 1, close));
    cursor = close;
  }
  return bodies;
}

function effective(bodies: string[], property: string): string | null {
  let value: string | null = null;
  for (const body of bodies) {
    const matched = body.match(new RegExp(`${property}:\\s*([^;]+);`));
    if (matched) value = matched[1].trim();
  }
  return value;
}

// ── ① 纯函数层 ──────────────────────────────────────────────────────────────

test('① 满分：逐题填了用它，留空则用传进来的学习单级回退值', () => {
  assert.equal(resolveFullPoints({ full: 3 }, 5), 3, '题上填了分值却没被采用');
  assert.equal(resolveFullPoints({ full: undefined }, 5), 5, '题上留空时没有用学习单级回退值');
  assert.equal(resolveFullPoints({}, 2), 2, '题上没有 points 时没有用学习单级回退值');
  assert.equal(resolveFullPoints(undefined, 2), 2, '整份 points 缺失时没有用学习单级回退值');
  assert.equal(resolveFullPoints({ full: 2 }, 5), 2, '题上的分值被学习单级盖掉了');
});

test('① 满分：坏值一律当"没填"往学习单级回退，不能变成 0 或 NaN', () => {
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 100, '2', null]) {
    assert.equal(resolveFullPoints({ full: bad }, 4), 4,
      `题上的坏值 ${String(bad)} 没有被当成"没填"⇒ 槽位数会算出 0 或 NaN`);
  }
  assert.equal(resolveFullPoints({ full: 2.4 }, 4), 2, '小数分值没有取整');
});

test('① 满分：`{ half: 2 }` 这种"只填了部分分"的形状，满分是 1 而不是学习单级', () => {
  // 🔴 这一条是照服务端 `normalizePoints(node.points) ?? fallback` 抄的：整份 points
  //    只要**有一格**可用就会被采用，而 `full` 不可用时填的是 `DEFAULT_POINTS.full`（=1）。
  //    我第一版漏了这一支，会把满分算成学习单级 —— 而那与判分用的数不一致。
  assert.equal(resolveFullPoints({ half: 2 }, 5), 1,
    '只填了 half 的形状上，满分应回落到 DEFAULT_POINTS.full（1），而不是学习单级');
  assert.equal(resolveFullPoints({ half: 0 }, 5), 1, 'half 为 0 也是合法值，同样应走这一支');
  // 反面：half 是坏值时整份 points 都不可用 ⇒ 仍走学习单级。
  assert.equal(resolveFullPoints({ half: 'x' }, 5), 5, '两格都不可用时没有回落到学习单级');
});

test('① 学习单级回退值：认得出就用，否则默认 1（域是 1..99，不是教师端那三个选项）', () => {
  assert.equal(resolveWorksheetFullStep({ rewardStep: 3 }), 3, '认得出的步长没有采用');
  assert.equal(resolveWorksheetFullStep({ rewardStep: 7 }), 7,
    '把 7 归一化掉了 ⇒ 与服务端判分用的 7 不一致（服务端只要求 1..99，不限 {1,2,3,5}）');
  assert.equal(resolveWorksheetFullStep({ rewardStep: 0 }), 1, '0 在"全对"档是非法值，应回落默认');
  assert.equal(resolveWorksheetFullStep({ rewardStep: 100 }), 1, '越界值应回落默认');
  assert.equal(resolveWorksheetFullStep({}), 1, '缺字段应回落默认 1');
  assert.equal(resolveWorksheetFullStep(null), 1, 'settings 为 null 时应回落默认 1');
  assert.equal(resolveWorksheetFullStep(undefined), 1, 'settings 缺失时应回落默认 1');
  assert.equal(resolveWorksheetFullStep([1, 2]), 1, '数组形状的 settings 不该被当成对象读');
});

test('① 槽位：满分几枚就画几枚，已得的那几枚点亮', () => {
  assert.deepEqual(rewardSlotPlan(2, 0), { slots: 2, lit: 0, overflow: null },
    '评分前不是"满分的枚数全灰"——这正是教师那条"评分前先显示很浅的灰度图标"');
  assert.deepEqual(rewardSlotPlan(2, 1), { slots: 2, lit: 1, overflow: null }, '部分得分的点亮数不对');
  assert.deepEqual(rewardSlotPlan(2, 2), { slots: 2, lit: 2, overflow: null }, '全对时不是全亮');
  assert.deepEqual(rewardSlotPlan(1, 0), { slots: 1, lit: 0, overflow: null }, '满分 1 时不是一枚灰图标');
});

test('① 槽位：超过 5 个封顶，并把真实数量补成 ×N（教师选定的那一档）', () => {
  const capped = rewardSlotPlan(8, 0);
  assert.equal(capped.slots, MAX_REWARD_SLOTS, '满分 8 没有封顶');
  assert.equal(capped.lit, 0);
  const earned = rewardSlotPlan(8, 8);
  assert.equal(earned.slots, MAX_REWARD_SLOTS, '满分 8 没有封顶');
  assert.equal(earned.lit, MAX_REWARD_SLOTS, '全对时点亮数不等于封顶数');
  assert.equal(earned.overflow, 8, '封顶之后没有把真实得分补成 ×N ⇒ 学生以为只拿到 5 个');
});

test('① 槽位：得分**超过**满分时不缩水（"混合填空按空计分"那一档会这样）', () => {
  // 服务端 per-blank 给的是 `命中空数 × full` ⇒ 得分可以大于逐题分值。
  const plan = rewardSlotPlan(1, 3);
  assert.equal(plan.slots, 3, '只按满分画 ⇒ 答对 3 空却只画 1 枚，看起来像丢了两个奖励');
  assert.equal(plan.lit, 3);
  assert.equal(plan.overflow, null, '得分没超过画得下的枚数，不该补 ×N');
});

test('① 槽位：坏输入不炸、也不画出负数枚图标', () => {
  assert.deepEqual(rewardSlotPlan(Number.NaN, Number.NaN), { slots: 0, lit: 0, overflow: null });
  assert.deepEqual(rewardSlotPlan(-2, -1), { slots: 0, lit: 0, overflow: null });
  assert.equal(rewardSlotPlan(2.4, 0).slots, 2, '小数分值没有取整');
});

// ── ② 接线层 ────────────────────────────────────────────────────────────────

test('② 槽位图标的大小：贴着右边那个框的高度，但**不许超过它**', () => {
  /*
   * ★ 2026-10-08 第二批（教师）：「图标继续加大，**高度可以与右边的框的一致**」，
   *   随后又收回「**再小点，不超过两条红线**」⇒ 最终 28。
   * 🔴 那两个数**是量出来的**：无头 Chrome 里量到 `.questionResult` 高 **33.5px**
   *   （内格 `.resultCell` 31.5px）。⇒ 28 在里面（上下各余 2.75px）。
   * ⚠️ 两个数在这里都写死是**刻意**的：它们是一对（图标 ≤ 框高），
   *   而框高由 `.resultCell` 的 `padding` 决定 —— 那边一改，这条网就该红。
   */
  const size = Number((BADGE.match(/const REWARD_SLOT_ICON_SIZE = (\d+)/) ?? [])[1]);
  assert.ok(Number.isFinite(size), '找不到 REWARD_SLOT_ICON_SIZE');
  /*
   * ⚠️ 下界从 30 收到 24：教师先要"与框一致"（32），看过之后又要"**再小点，不超过两条红线**"
   *   ⇒ 28。红线的意思就是"图标别比框高"，所以**上界（33）才是那条硬约束**，
   *   下界只是个"别小到看不见"的兜底，不该拦着教师往下调。
   */
  assert.ok(size >= 24, `图标只有 ${size}px —— 小到看不出是什么了`);
  assert.ok(size <= 33, `图标 ${size}px 超过了那个框的高度（33.5px）⇒ 会越出教师画的那两条红线`);
});
test('② 槽位组件：收满分、按计划画、未得的走灰度档', () => {
  assert.match(BADGE, /export function QuestionReward\(\{ scale, full, score \}/,
    '② QuestionReward 没有收 full ⇒ 画不出"满分几枚"');
  assert.match(BADGE, /rewardSlotPlan\(full, amount\)/, '② 没有走槽位计划（枚数会与封顶/溢出规则脱节）');
  assert.match(BADGE, /state=\{index < plan\.lit \? 'earned' : 'empty'\}/,
    '② 未获得的槽位没有走 empty 档 ⇒ 教师说的"非常浅的灰度化"没有实现');
  assert.doesNotMatch(BADGE, /if \(score === null\) return null/,
    '② 未评分时整块不画 ⇒ 教师要的"评分前先显示灰图标"没做到');
});

test('② 面板：奖励在白底圆角条**外面**（它是条子的兄弟、排在条子之前）', () => {
  /*
   * ★ 2026-10-08 第二批（教师）：「**图标在框外**，图标可以大一些」。
   * 第 7 项那版是把它当 `.questionResult` 的**第一个子项**（在条子里面）——
   * 教师看过之后明确要它在**框外**。⇒ 判据从"在条子内部某格之前"改成
   * "在整条 `.questionResult` **之前**"。
   */
  const boxAt = PANEL.indexOf('className={styles.questionResult}');
  assert.notEqual(boxAt, -1, '② 找不到结果条');
  const rewardAt = PANEL.indexOf('styles.resultReward');
  assert.notEqual(rewardAt, -1, '② 找不到奖励那一组');
  assert.ok(rewardAt < boxAt,
    '② 奖励排在结果条**里面** ⇒ 教师说的"图标在框外"没做到');

  assert.match(PANEL, /const fullPoints = resolveFullPoints\(node\.points, rewardFullFallback \?\? 1\)/,
    '② 没有逐题算满分（槽位数会全部退化成同一个值）');
  assert.match(PANEL, /<QuestionReward scale=\{reward\} full=\{fullPoints\}/,
    '② 算出来的满分没有传给槽位组件');
  assert.match(PANEL, /reward && \(state !== 'empty' \|\| gradeState\)/,
    '② 奖励的显示时机不是"答过就显示"⇒ 未评分时画不出灰槽位');
});

// ── ③ CSS 层 ────────────────────────────────────────────────────────────────

test('③ 那一组不再是绝对定位的角标（否则画再多槽位也还压在框角上）', () => {
  const bodies = ruleBodies('.resultReward');
  assert.ok(bodies.length > 0, '找不到 .resultReward 的规则块');
  const position = effective(bodies, 'position');
  assert.notEqual(position, 'absolute',
    '③ .resultReward 仍是绝对定位 ⇒ 教师说的"移到绿色框前面"没有落到版面上');
  assert.equal(effective(bodies, 'flex'), '0 0 auto',
    '③ 没有 flex: 0 0 auto ⇒ 一行里枚数多时会被压扁');
});

test('⑤ 庆祝动画：就地轻弹（不长距离飞行、不大幅缩放位图、有图层提升、可降级）', () => {
  /*
   * ★ 2026-10-08（教师）：「庆祝动画**改一种效果，目前的感觉有点卡**」⇒ 选定"就地轻弹一下"。
   *
   * 🔴 这一条网要挡住的是**回退成"飞"的形状**（那正是"卡"的来源）：
   *   ① 图标是 `background-image` 雪碧图 —— 大幅 `scale` 会让浏览器**逐步重新栅格化**；
   *   ② 长距离 `translate` + 旋转 = 全程大面积重绘。
   *   两样都不在源码里报错，只在老 iPad 上表现为掉帧。
   */
  const collect = CSS.slice(CSS.indexOf('@keyframes rewardCollect'), CSS.indexOf('@keyframes rewardHalo'));
  assert.ok(collect.length > 0, '找不到 rewardCollect');
  assert.doesNotMatch(collect, /translate\(/, '庆祝动画又在长距离飞了（那正是"卡"的来源）');
  assert.doesNotMatch(collect, /rotate\(/, '庆祝动画又在旋转了');
  const scales = [...collect.matchAll(/scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.ok(scales.length >= 2, '找不到 scale 关键帧');
  assert.ok(Math.max(...scales) <= 1.2 && Math.min(...scales) >= 0.7,
    `scale 幅度是 ${Math.min(...scales)}–${Math.max(...scales)}，放大/缩小过度 ⇒ 雪碧图会被反复重栅格化`);

  const burst = ruleBodies('.rewardBurst').join('\n');
  assert.match(burst, /will-change:\s*transform/, '没有图层提升 ⇒ scale 会带着邻居一起重绘');
  const duration = Number((burst.match(/animation:\s*rewardCollect\s+(\d+)ms/) ?? [])[1]);
  assert.ok(duration > 0 && duration <= 600, `庆祝动画时长 ${duration}ms —— 太长会让掉帧更容易被看见`);

  const reduceAt = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.notEqual(reduceAt, -1, '找不到 prefers-reduced-motion 降级块');
  const reduced = CSS.slice(reduceAt);
  /*
   * 降级：本文件的 `prefers-reduced-motion` 块**早就**有 `.rewardBurst { display: none }`
   * （M6b/12/16 那批留下的），所以这次**不需要新加**。
   * 🔴 我第一版在这里加了一条**重复规则**，并且顺口说"顺带补上降级"—— 那既不准确，
   *   还让这条判据**失去了咬合**：变异把 `display:none` 换成 `animation:none` 时，
   *   正则匹配到的是**旧的那条**，于是变异逃掉了（我自己的变异检验当场抓出来的）。
   * ⇒ 现在只**断言既有事实**，不加规则。
   */
  assert.match(reduced, /\.rewardBurst\s*\{[^}]*display:\s*none/,
    '奖励庆祝动画在 prefers-reduced-motion 下没有隐藏 —— 这个文件自己立过"动效要降级"的规矩');
});
