#!/usr/bin/env node
/**
 * 给一个课堂灌一批**像真人写的**学习单作答数据（仅供开发 / 演示 / 试用 AI 分析）。
 *
 * 用法（在仓库根目录）：
 *   npx tsx scripts/seed-worksheet-demo.mjs                    # 默认课堂：1001课堂
 *   npx tsx scripts/seed-worksheet-demo.mjs --classroom 8268   # 按互动码 / 课堂 id / 课堂名
 *   npx tsx scripts/seed-worksheet-demo.mjs --dry              # 只打印，不写库
 *   npx tsx scripts/seed-worksheet-demo.mjs --seed 7           # 换一组随机数
 *   npx tsx scripts/seed-worksheet-demo.mjs --keep             # 不清旧数据，追加
 *   npx tsx scripts/seed-worksheet-demo.mjs --python <path>    # 渲染照片作答用的解释器
 *                                                              #（默认 `python3`，需要 Pillow）
 *
 * ★ 2026-10-05：**照片作答**（`inputMode: 'photo'` 的问答/绘图）不是编一个 URL 就完事 ——
 *   AI 分析会把那个 URL **真的读成图**（`analysis-render.ts` → `resolveLocalPath`）。
 *   ⇒ 这个脚本会把「学生写的那段话」交给 `scripts/make-answer-photos.py` 画成一张 PNG，
 *     落到上传目录里，再把 URL 写进作答值。渲染失败就**整体不写库**（宁可没数据，
 *     也不要一批指向空文件的照片作答 —— 那种数据会让 AI 分析当场抛错，而屏幕上只是
 *     「分析失败」，查起来得从服务端日志一路倒推）。
 *
 * 🔴 判分三列（`isCorrect` / `gradeState` / `score`）**由服务端自己的 `grade()` 算** ——
 *    本脚本一行判分逻辑都不写。自己写一遍的后果是：脚本算出的对错与教师点开看板看到的
 *    不是同一个东西，而**两边都不会报错**（这正是本仓反复栽的那类分叉）。
 *    同理，题干与正确答案都从 `Worksheet.content` 现读，不在脚本里抄一份题面。
 *
 * 🔴 **只写两张表**：`WorksheetResponse` 与 `WorksheetAnswer`。
 *    不碰 `Worksheet` / `Classroom` / `Student` —— 也就是说它**不会**去修题干或参考答案，
 *    更不会去配「分析型智能体」。那些是编辑页里的事。
 *
 * ⚠️ 为什么要 `tsx` 跑：要 import `server/src/services/*.ts`（判分器与拍平题号的纯函数）。
 *    而 `@prisma/client` 只装在 `server/node_modules` ⇒ 用 `createRequire` 以 server/ 为基准去要它。
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/** 上传目录 —— 与 `server/src/routes/upload.ts` **同一套判据**（`CLASSNODE_DATA_DIR` 优先）。 */
const UPLOADS = process.env.CLASSNODE_DATA_DIR
  ? path.join(process.env.CLASSNODE_DATA_DIR, 'uploads')
  : path.join(ROOT, 'server', 'uploads');
const CHAT_DIR = path.join(UPLOADS, 'chat');

const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');

const { grade, resolvePoints, DEFAULT_POINTS, readStrings, answerSlotCount, acceptableAnswersFor } =
  await import('../server/src/services/worksheet-questions.ts');
const { flattenAnswerable } = await import('../server/src/services/worksheet-heading.ts');
// ★ 2026-10-05：选词那两档的**错答只能从词库里挑**（学生是点词，不是打字），
//   而「哪个空是选词档」「词库怎么拆」这两件事界面那边已经有一份实现了 ——
//   这里 import 它，不在脚本里再写一遍（本仓最防的就是同一件事两份实现）。
const { readPromptRuns } = await import('../src/lib/worksheet-prompt-marks.ts');
const { fillSettingsFor, splitChoiceText } = await import('../src/lib/worksheet-fill-modes.ts');
/** 这道题每个空的设置（`mode` / 词库），按**空的出现顺序**。 */
const fillSettingsOf = (node) => fillSettingsFor(node, readPromptRuns(node.data.promptRuns, node.prompt));

/* ── 命令行 ─────────────────────────────────────────────────────────── */

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const CLASSROOM_ARG = argOf('classroom', '1001课堂');
const SEED = Number(argOf('seed', '20261001'));
const PYTHON = argOf('python', process.env.CLASSNODE_PYTHON || 'python3');
const DRY = hasFlag('dry');
const KEEP = hasFlag('keep');

/* ── 随机数：**带种子**，所以同一份数据可以反复重现 ─────────────────── */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const chance = (p) => rng() < p;
const pick = (list) => list[Math.floor(rng() * list.length)];
/** 从 `list` 里不放回地抽 `n` 个。 */
function pickN(list, n) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/* ── 每个学生的「水平档」────────────────────────────────────────────────
   🔴 独立地给每道题掷一次硬币会得到一份**不像班级**的数据：每个人每道题都像换了个人。
      真实班级里「谁学得好」是稳定的，所以先分档、再让每档有各自的正确率。
   ⚠️ 分档只在这里做一次；每道题的错法随机 —— 所以同一个孩子两道题可能错得不一样。 */

const TIERS = { high: 0.28, mid: 0.5, low: 0.22 };

/** 每题每档的「做对」概率。**难的那几道明显低**（多选题、单位换算、平角/周角）。 */
const P = {
  'single-1': { high: 0.95, mid: 0.82, low: 0.55 },   // 单选：一步就能定下来的那种
  'true-false': { high: 0.92, mid: 0.78, low: 0.52 }, // 判断题：一句话，蒙对的也多
  'multi':    { high: 0.50, mid: 0.25, low: 0.08 },   // 多选题全对才算
  'fill-a':   { high: 0.85, mid: 0.62, low: 0.38 },   // 每空一次判定（3 空：单位换算）
  'fill-b':   { high: 0.85, mid: 0.62, low: 0.38 },   // 4 空：角的分类
  'match':    { high: 0.68, mid: 0.38, low: 0.14 },
  'categorize': { high: 0.95, mid: 0.86, low: 0.58 },
  'order':    { high: 0.90, mid: 0.70, low: 0.38 },
};

/* ── 填空的「典型错答」─────────────────────────────────────────────────
   🔴 这一张表是本脚本**唯一**手写的学科知识 —— 它的价值全在「错得像人」：
      分析功能要能看出「全班都把 180° 说成钝角」这种共性，靠的就是这里。 */
const TYPICAL_WRONG = {
  '80000': ['8000', '800000', '8万'],
  '平方米': ['平方分米', '平方厘米', '米'],
  '6': ['60', '600', '6000'],
  '锐角': ['直角', '钝角'],
  '平角': ['钝角', '周角', '直线'],
  '钝角': ['平角', '锐角'],
  '周角': ['平角', '钝角', '360度'],
  // ── 小学科学（五上「光」单元 / 水循环）────────────────────────────────
  // ⚠️ 这几对是**互为错答**的（反射↔折射、蒸发↔凝结）：那道题唯一像人的错法就是
  //    把两个概念对调 —— 分析功能要能一眼看出「全班都把折射说成反射」。
  '反射': ['折射', '反光', '反射线'],
  '折射': ['反射', '偏折', '分解'],
  '蒸发': ['凝结', '融化', '降水'],
  '凝结': ['蒸发', '凝固', '降水'],
};

/** 认不出的正确答案就现编一个「像错了」的：末尾少一个 0 / 把数字改成邻近的。 */
function typicalWrongOf(correct) {
  const known = TYPICAL_WRONG[correct];
  if (known) return known;
  if (/^\d+$/.test(correct)) {
    const n = Number(correct);
    return rng() < 0.5 ? [String(Math.round(n / 10))] : [String(n + (chance(0.5) ? 1 : -1) * 10)];
  }
  return [correct.slice(0, -1) || correct];   // 中文词：去掉最后一个字
}

/* ── 各题型的作答值生成 ─────────────────────────────────────────────── */

function genChoice(node, tier, key) {
  const correct = readStrings(node.data.correctKeys);
  const keys = Array.isArray(node.data.options)
    ? node.data.options.map((o) => o.key).filter((k) => typeof k === 'string')
    : [];
  if (correct.length === 0) return null;
  const wrongs = keys.filter((k) => !correct.includes(k));

  if (correct.length === 1) {
    if (chance(P[key][tier])) return { format: 'choice/v1', selected: [correct[0]] };
    if (wrongs.length > 0) return { format: 'choice/v1', selected: [pick(wrongs)] };
    // 🔴 **判断题没有 `options`**：它的答案键是固定的 `T` / `F`（规格 §12），
    //    所以「错答」只有另一个字面量。原来这一支在没有选项时回落到 `'A'` ——
    //    那是**一个不存在的答案键**，判分读到它会判「错」，看上去像对的，
    //    但它不是学生会交上来的东西（学生点的是「对」或「错」两个按钮）。
    const flip = correct[0] === 'T' ? 'F' : correct[0] === 'F' ? 'T' : null;
    return { format: 'choice/v1', selected: [flip ?? correct[0]] };
  }
  // 多选（本仓的「全对才算」档）：漏选是最常见的错法 —— 也是 AI 分析最该看出来的那个。
  if (chance(P.multi[tier])) return { format: 'choice/v1', selected: [...correct] };
  const r = rng();
  if (r < 0.55) return { format: 'choice/v1', selected: [correct[0]] };
  if (r < 0.75) return { format: 'choice/v1', selected: [correct[correct.length - 1]] };
  if (r < 0.9 && wrongs.length > 0) return { format: 'choice/v1', selected: [correct[0], pick(wrongs)] };
  return { format: 'choice/v1', selected: wrongs.length > 0 ? [pick(wrongs)] : [correct[0]] };
}

function genFill(node, tier, key) {
  const slots = answerSlotCount(node.data);
  const settings = fillSettingsOf(node);
  const pool = splitChoiceText(node.data.fillChoicePool ?? []);
  const texts = [];
  for (let i = 0; i < slots; i += 1) {
    const acceptable = acceptableAnswersFor(node.data, i);
    const correct = acceptable[0] ?? '';
    if (correct === '') { texts.push(''); continue; }
    if (chance(P[key][tier])) { texts.push(correct); continue; }
    // ★ 选词那两档（`pool` 共用词池 / `inline` 右侧选词）：学生是**点**词，不是打字 ——
    //   所以错答必须**从词库里挑**（挑「降水」而不是编一个「蒸法」）。
    //   不这么做的话，那份数据的错法就不是这个题型能产生的，分析结论会失真。
    const mode = settings[i]?.mode;
    const words = mode === 'pool' ? pool
      : mode === 'inline' ? splitChoiceText(settings[i]?.choices ?? [])
      : [];
    const wrongs = words.filter((word) => word !== correct && !acceptable.includes(word));
    texts.push(wrongs.length > 0 ? pick(wrongs) : pick(typicalWrongOf(correct)));
  }
  // 单空与多空是两个 format 名（客户端的 `valueFromDraft` 就是这么分的）—— 照抄，别自创。
  return slots === 1 ? { format: 'fill/v1', text: texts[0] ?? '' } : { format: 'fill-multi/v1', texts };
}

function genOrder(node, tier) {
  const correct = readStrings(node.data.correctOrder);
  if (correct.length === 0) return null;
  if (chance(P.order[tier])) return { format: 'order/v1', order: [...correct] };
  if (correct.length < 2) return { format: 'order/v1', order: [...correct] };
  if (rng() < 0.3) return { format: 'order/v1', order: [...correct].reverse() };       // 整个反了
  // 抽两项对调 —— 小学生排错最常见的样子
  const out = [...correct];
  const [a, b] = pickN(correct.map((_, i) => i), 2);
  [out[a], out[b]] = [out[b], out[a]];
  return { format: 'order/v1', order: out };
}

function genMatch(node, tier) {
  const pairs = Array.isArray(node.data.pairs) ? node.data.pairs : [];
  if (pairs.length === 0) return null;
  if (chance(P.match[tier])) return { format: 'match/v1', links: pairs.map((p) => ({ leftId: p.leftId, rightId: p.rightId })) };

  // 没全对：**错 e 处**（e = 1…n-1）。
  // 🔴 「错几处」不是随便定的 —— 判分是「总数 − 连对 ≤ 容错档」才算部分正确，
  //    所以错 1 处与错 3 处是两种结果。容错档由题面给（`partialTolerance`），
  //    这里读题库里那份真值，不拍脑袋写死一个数。
  const n = pairs.length;
  const miss = 1 + Math.floor(rng() * Math.max(1, n - 1));
  const keep = pickN(pairs, Math.max(0, n - miss));
  const used = new Set(keep.map((p) => p.rightId));
  const links = keep.map((p) => ({ leftId: p.leftId, rightId: p.rightId }));
  for (const pair of pairs) {
    if (keep.includes(pair)) continue;
    // 🔴 只能从**已经被用掉的**右项里挑：挑一个没被用过的，很可能正好是它自己的正确右项
    //    —— 那样这一条又对了，「错的 k 条」会变成「全对」。
    //    （第一版就是这个 bug：错 1 条时，剩下那条的右项唯一可用 ⇒ 必然连对 ⇒ 全班满分。）
    const pool = [...used].filter((rightId) => rightId !== pair.rightId);
    const rightId = pool.length > 0 ? pick(pool) : pair.rightId;
    links.push({ leftId: pair.leftId, rightId });
    used.add(rightId);
  }
  if (chance(0.2)) links.pop();      // 有人漏连一条（判分对此同样是「不全对」）
  return { format: 'match/v1', links };
}

function genCategorize(node, tier) {
  const placement = node.data.placement ?? {};
  const itemIds = Object.keys(placement);
  if (itemIds.length === 0) return null;
  const assignment = { ...placement };
  if (chance(P.categorize[tier])) return { format: 'categorize/v1', assignment };
  const zones = [...new Set(Object.values(placement))];
  const bad = pickN(itemIds, 1 + Math.floor(rng() * 2));   // 错 1~2 个
  for (const itemId of bad) {
    const others = zones.filter((z) => z !== placement[itemId]);
    if (others.length > 0) assignment[itemId] = pick(others);
  }
  return { format: 'categorize/v1', assignment };
}

/* ── 问答题：一段一段手写的「学生腔」──────────────────────────────────
   按题干里的关键词选池子；认不出就回落到通用池。 */
const SHORT_ANSWER_POOLS = [
  {
    match: /满100元减20元/,
    answers: {
      high: [
        '不够。156－20＝136（元），136＞130，所以付130元不够，还差6元。',
        '不够。因为满100减20，156-20=136元，136比130大，还差6元。',
      ],
      mid: [
        '130元不够。156-20=136（元） 136>130 答：不够，差6元。',
        '不够用的。先算减完多少：156－20＝136元，136元比130元多，还多要6元。',
        '不够，156-20=136，136-130=6，还要6元。',
      ],
      low: [
        '够。156满100了，减20以后是136，136和130差不多，我觉得够。',
        '够吧。156元减20元等于136元，130元差不多够了。',
        '不够。因为156>130，所以130元买不了。',
        '我觉得够，因为打折嘛，156减20就是136，136约等于130。',
      ],
    },
  },
  {
    // ★ 2026-10-05：小学科学五上「雨后校园的水与彩虹」——照片作答那一题。
    match: /彩虹/,
    answers: {
      high: [
        '雨后空气里有很多小水滴，太阳光射进小水滴时发生折射和色散，白光被分成红橙黄绿蓝靛紫七种色光，就形成了彩虹。',
        '太阳光射到空中的小水滴上，先折射再反射，出来的时候发生色散，白光分成七种颜色，就成了彩虹。',
      ],
      mid: [
        '下雨后空气中有小水珠，阳光照到水珠上发生了色散，就出现彩虹了。',
        '阳光照在小水滴上会折射，白光分成七种颜色，所以有彩虹。',
        '因为水珠把太阳光分开了，就变成七种颜色了。',
      ],
      low: [
        '因为下过雨，太阳又出来了，所以有彩虹。',
        '彩虹是太阳照在水上变出来的。',
        '雨后有水，太阳一照就有彩虹了。',
        '天空中的水变成了彩色的。',
      ],
    },
  },
];

const SHORT_ANSWER_FALLBACK = [
  '我是这样想的：先看清楚题目问什么，再一步一步想。',
  '答：我的想法是先看清楚，再说清楚。',
  '先想一想，然后写下来。',
];

/**
 * 主观题的**作答文字**（还没变成作答值 —— 照片作答要拿它去画图）。
 * 按档位取：同一道题，高分档写得完整、低分档写得含糊 —— 这正是 AI 评分要分辨的东西。
 */
function shortAnswerText(node, tier) {
  const pool = SHORT_ANSWER_POOLS.find((p) => p.match.test(node.prompt ?? ''));
  const table = pool ? pool.answers : SHORT_ANSWER_FALLBACK;
  return pick(table[tier] ?? table.mid);
}

function genShortAnswer(node, tier) {
  return { format: 'text/v1', text: shortAnswerText(node, tier) };
}

/* ── 绘图题：真的画一张条形统计图 ─────────────────────────────────────
   🔴 与 `src/lib/worksheet-ink.ts` 同一套坐标口径：点归一化到 0..1，
      `width` 归一化到 min(w,h)。画布取绘图题的默认框 320×240。 */
const CANVAS = { w: 320, h: 240 };
const NX = (px) => Math.round((px / CANVAS.w) * 1e6) / 1e6;
const NY = (py) => Math.round((py / CANVAS.h) * 1e6) / 1e6;

const AXIS_X = 38;
const AXIS_TOP = 22;
const BASE_Y = 204;
const UNIT = 22;            // 一格 = 22px
const BAR_LEFT = [56, 118, 180, 242];
const BAR_W = 42;

const jitter = (amp) => (rng() - 0.5) * 2 * amp;

/** 手写的一笔：把一批像素点连起来，带抖动。 */
function penStroke(pxPoints, { width = 0.016, color = '#1f2937', amp = 2 } = {}) {
  return {
    points: pxPoints.map(([x, y]) => [NX(x + jitter(amp)), NY(y + jitter(amp))]),
    width,
    color,
  };
}

/** 图形工具画的一笔（`shape` 认得的九个之一）。 */
function shapeStroke(shape, px0, py0, px1, py1, color = '#1f2937', width = 0.016) {
  return { shape, points: [[NX(px0), NY(py0)], [NX(px1), NY(py1)]], width, color };
}

/**
 * 一张条形统计图。
 * `heights` 是四根柱子的**格数**（每格 2 人 ⇒ 12 人 = 6 格）。
 * `style`：`neat` 用图形工具画矩形，`sloppy` 手绘（歪、带抖动），`mixed` 一半一半。
 */
function genBarChart(heights, style) {
  const strokes = [];
  const texts = [];

  // 坐标轴：一笔画成的「L」（真实学生就是这么画的）。
  // 🔴 起笔在**右下角**、先往左再往上 —— 点序反了（先上再右下）画出来的是一条**对角线**，
  //    而那在屏幕上只是「这根线怎么斜的」，不会报错。
  strokes.push(penStroke([[300, BASE_Y], [AXIS_X, BASE_Y], [AXIS_X, AXIS_TOP]], { width: 0.028, amp: style === 'sloppy' ? 3 : 1.2 }));

  const usesShape = style === 'neat' || (style === 'mixed' && chance(0.7));
  heights.forEach((grid, i) => {
    const top = BASE_Y - grid * UNIT;
    const x0 = BAR_LEFT[i];
    const x1 = x0 + BAR_W;
    if (usesShape) {
      strokes.push(shapeStroke('rect', x0, top, x1, BASE_Y));
    } else {
      // 手绘：从底面左边起笔 → 上 → 右 → 下（不闭合，笔就是这么走的）
      strokes.push(penStroke(
        [[x0, BASE_Y], [x0 + jitter(1), BASE_Y], [x0 + jitter(1.5), top + jitter(2)], [x1 + jitter(1.5), top + jitter(2)],
         [x1 + jitter(1), BASE_Y], [x1 + jitter(1), BASE_Y]],
        { amp: 1.5 },
      ));
    }
    // 柱子上标数据（本子上就是这么标的）
    texts.push({ text: String(grid * 2), at: [NX(x0 + 12 + jitter(3)), NY(top - 16)], color: '#1f2937', size: 0.045 });
  });

  // 约一半的人会把活动名称写在横轴下面
  if (chance(0.55)) {
    const names = ['跳绳', '踢毽子', '打篮球', '下棋'];
    names.forEach((name, i) => {
      texts.push({ text: name, at: [NX(BAR_LEFT[i] - 4), NY(BASE_Y + 4)], color: '#1f2937', size: 0.045 });
    });
  }
  return { format: 'drawing/v1', canvas: { ...CANVAS }, strokes, texts };
}

/** 绘图题①：**条形统计图**（小学数学那份）。大多数人画对，少数柱高画错 / 只画一半 / 交了白的。 */
function genBarChartAnswer(tier, ctx) {
  if (ctx.blankInk) return { format: 'drawing/v1', canvas: { ...CANVAS }, strokes: [] };
  if (tier === 'low' && chance(0.35)) return null;                 // 没画完，交不上来

  const correct = [6, 4, 5, 3];       // 跳绳12 / 踢毽子8 / 打篮球10 / 下棋6，每格 2 人
  let heights = correct;
  const style = tier === 'high' ? (chance(0.5) ? 'neat' : 'mixed') : (chance(0.4) ? 'mixed' : 'sloppy');

  if (chance(tier === 'high' ? 0.1 : tier === 'mid' ? 0.35 : 0.7)) {
    const r = rng();
    if (r < 0.3) heights = [3, 2, 2, 1];                 // 把人数的**一半**当成了格数
    else if (r < 0.55) heights = correct.map((g, i) => (i === 3 ? g - 1 : g));   // 最后一根矮一格
    else if (r < 0.8) heights = [6, 4, 5, 5];            // 把下棋看成 10 人
    else heights = [6, 4, 5];                            // 只画了三根
  }
  return genBarChart(heights, style);
}

/**
 * 绘图题②：**光从空气斜射入水的折射光路**（小学科学五上）。
 *
 * 要画的四样：水面 · 法线（虚线）· 入射光线（带箭头）· 折射光线（**向法线偏折**）+ 三处标注。
 * 错法按档位分，而且**错得是学生真的会那样错**：
 *   · 忘了画法线（虚线）—— 这条最常丢；
 *   · 折射光线**直着画下去**（以为光进了水不拐弯）—— 这就是那道题要考的错误认识；
 *   · 折射光线往**反**方向偏（离法线更远）；
 *   · 干脆只画了入射光线（没画完）。
 * ⚠️ 「向法线偏折」在坐标上就是：折射光线的**水平位移比入射光线小**（见下面 `dx * 0.5`）。
 */
function genLightPathAnswer(tier, ctx) {
  if (ctx.blankInk) return { format: 'drawing/v1', canvas: { ...CANVAS }, strokes: [] };
  if (tier === 'low' && chance(0.3)) return null;                  // 没画完，交不上来

  const strokes = [];
  const texts = [];
  const SURFACE_Y = 138;          // 水面
  const HIT = 168;                // 入射点（水面与法线的交点）
  const neat = tier === 'high' ? chance(0.6) : chance(0.2);
  const amp = neat ? 1 : 2.6;
  const ink = (points, width = 0.014) => penStroke(points, { width, amp });
  const label = (text, x, y) => texts.push({ text, at: [NX(x), NY(y)], color: '#1f2937', size: 0.045 });
  const arrow = (x, y, angle) => {
    for (const delta of [2.6, -2.6]) {
      strokes.push(ink([[x, y], [x - 17 * Math.cos(angle + delta), y - 17 * Math.sin(angle + delta)]], 0.012));
    }
  };

  strokes.push(ink([[28, SURFACE_Y], [160, SURFACE_Y], [302, SURFACE_Y]], 0.02));   // 水面

  const wrongRate = tier === 'high' ? 0.12 : tier === 'mid' ? 0.45 : 0.8;
  const wrong = chance(wrongRate);
  const drawNormal = !(wrong && chance(0.45));
  const drawLabels = neat ? chance(0.85) : chance(0.5);

  if (drawNormal) {
    for (const [y0, y1] of [[46, 82], [94, 130], [146, 182], [194, 226]]) {          // 虚线 = 四段
      strokes.push(ink([[HIT, y0], [HIT, y1]], 0.01));
    }
    if (drawLabels) label('法线', HIT + 8, 50);
  }

  const startX = neat ? 62 : 52;
  const startY = neat ? 42 : 34;
  strokes.push(ink([[startX, startY], [HIT, SURFACE_Y]], 0.016));
  arrow(HIT, SURFACE_Y, Math.atan2(SURFACE_Y - startY, HIT - startX));
  if (drawLabels) label('入射光线', startX - 8, startY - 14);

  if (!(wrong && chance(0.25))) {                                                    // 错法：没画折射光线
    const dx = HIT - startX;
    const dy = SURFACE_Y - startY;
    const endX = wrong ? (chance(0.7) ? HIT + dx * 0.95 : HIT + dx * 1.15) : HIT + dx * 0.5;
    const endY = SURFACE_Y + dy * 0.9;
    strokes.push(ink([[HIT, SURFACE_Y], [endX, endY]], 0.016));
    arrow(endX, endY, Math.atan2(endY - SURFACE_Y, endX - HIT));
    if (drawLabels) label('折射光线', endX - 46, endY + 6);
  }
  if (drawLabels) label('水面', 246, SURFACE_Y - 18);

  return { format: 'drawing/v1', canvas: { ...CANVAS }, strokes, texts };
}

/** 题干 → 哪一张图。判据是**题面里的词**（不按题号），教师换了题也照样对得上。 */
function genDrawing(node, tier, ctx) {
  if (/折射|光路|入射|法线/.test(node.prompt ?? '')) return genLightPathAnswer(tier, ctx);
  return genBarChartAnswer(tier, ctx);
}

/* ── 编排：一个学生答哪些题、答成什么样 ─────────────────────────────── */

/** 题干 → 用哪个生成器。按**题型**分派，不按题号 —— 教师改了学习单也照样能跑。 */
function genFor(node, tier, ctx, fillKey) {
  // ★ 2026-10-05：**照片作答**（`inputMode: 'photo'`）先分派 —— 它存的是
  //   `{format:'photo/v1', url}`，而不是这个题型平时那个文本/笔迹形状。
  //   这里返回一个「待渲染」的标记，主流程统一把那些文字画成图、再补上 URL。
  if ((node.type === 'short-answer' || node.type === 'drawing') && node.inputMode === 'photo') {
    return { __photo: { text: shortAnswerText(node, tier), style: tier === 'high' ? 'neat' : 'sloppy' } };
  }
  switch (node.type) {
    case 'single-choice':
    case 'multi-choice':
    case 'true-false': {
      // 单选 / 多选 / 判断题都由**正确答案有几个**决定走哪一档（与 `judge()` 同一把尺子）。
      const correct = readStrings(node.data.correctKeys);
      const key = correct.length > 1 ? 'multi' : node.type === 'true-false' ? 'true-false' : 'single-1';
      return genChoice(node, tier, key);
    }
    case 'fill-blank':
    case 'choice-blank':
      return genFill(node, tier, fillKey);
    case 'order': return genOrder(node, tier);
    case 'match': return genMatch(node, tier);
    case 'categorize': return genCategorize(node, tier);
    case 'short-answer': return genShortAnswer(node, tier);
    case 'drawing': return genDrawing(node, tier, ctx);
    default: return null;
  }
}

/* ── 主流程 ─────────────────────────────────────────────────────────── */

const prisma = new PrismaClient();

function stamp(ms) {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

async function main() {
  const classroom = await prisma.classroom.findFirst({
    where: { OR: [{ id: CLASSROOM_ARG }, { code: CLASSROOM_ARG }, { title: CLASSROOM_ARG }] },
    orderBy: { createdAt: 'desc' },
  });
  if (!classroom) throw new Error(`找不到课堂：${CLASSROOM_ARG}`);

  const link = await prisma.classroomWorksheet.findFirst({
    where: { classroomId: classroom.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!link) throw new Error(`课堂「${classroom.title}」没有挂学习单 —— 先去教师端挂一份`);
  const worksheet = await prisma.worksheet.findUnique({ where: { id: link.worksheetId } });

  const participants = await prisma.classroomStudent.findMany({
    where: { classroomId: classroom.id, type: 'student' },
    include: { student: { select: { name: true, studentNo: true } } },
    orderBy: { joinTime: 'asc' },
  });
  if (participants.length === 0) throw new Error('这个课堂里一个学生都没有');

  const questions = flattenAnswerable(worksheet.content.nodes ?? []);
  if (questions.length === 0) throw new Error('这份学习单一道可作答的题都没有');

  console.log(`课堂   ${classroom.title}（${classroom.code}）`);
  console.log(`学习单 ${worksheet.title} · ${questions.length} 道题`);
  console.log(`参与者 ${participants.length} 人 · 随机种子 ${SEED}${DRY ? ' · **演练模式，不写库**' : ''}`);
  console.log();

  // 分档：把名单打乱后按比例切成 高 / 中 / 低
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const nHigh = Math.round(shuffled.length * TIERS.high);
  const nMid = Math.round(shuffled.length * TIERS.mid);
  const tierOf = new Map();
  shuffled.forEach((p, i) => {
    tierOf.set(p.id, i < nHigh ? 'high' : i < nHigh + nMid ? 'mid' : 'low');
  });

  /*
    谁没做完 —— 「已交 N/M」那一列要真的不满才有意义，而且**几种状态都要有**：
      · 3 个差一两题（时间到了 / 卡在后面那道题上）；
      · 1 个只做完了**任务一**就交不动了（这个数从库里算，不写死）；
      · 1 个**根本没动笔**（连一行作答都没有）。
    ⚠️ 没做完的那几个响应状态是 `in-progress`（不是 `submitted`）—— 交齐了才叫已交。
  */
  const unfinished = new Map();
  const stragglers = pickN(participants, 5);
  const firstTask = (worksheet.content.nodes ?? []).find((n) => n.type === 'task');
  const firstTaskCount = firstTask ? flattenAnswerable([firstTask]).length : questions.length;
  unfinished.set(stragglers[0].id, Math.max(1, questions.length - 3));
  unfinished.set(stragglers[1].id, Math.max(1, questions.length - 2));
  unfinished.set(stragglers[2].id, Math.max(1, questions.length - 2));
  unfinished.set(stragglers[3].id, Math.min(firstTaskCount, questions.length));   // 只做完任务一
  const neverStarted = stragglers[4];                                            // 一行作答都没有

  const classStart = Number(classroom.createdAt) + 2 * 60_000;
  const plans = [];

  /** 待渲染的照片作答：`{ path, lines, style }` —— 循环结束后**一次性**交给 Python 画。 */
  const photoJobs = [];

  for (const p of participants) {
    if (p.id === neverStarted.id) continue;                 // 这一位没开始 ⇒ 连响应行都不建
    const tier = tierOf.get(p.id);
    const limit = Math.min(unfinished.get(p.id) ?? questions.length, questions.length);
    const startedAt = classStart + Math.floor(rng() * 6 * 60_000);
    const span = 8 * 60_000 + Math.floor(rng() * 30 * 60_000);
    const createdAt = Number(worksheet.createdAt);

    const ctx = { fillCount: 0, blankInk: false };
    const answers = [];
    for (let i = 0; i < limit; i += 1) {
      const q = questions[i];
      const isFill = q.node.type === 'fill-blank' || q.node.type === 'choice-blank';
      // 两位填空的难度不同（单位换算 vs 角的分类）⇒ 第一道走 fill-a 那一档概率。
      const fillKey = isFill && ctx.fillCount === 0 ? 'fill-a' : 'fill-b';
      // 交卷前才动笔的那道题，有人干脆空着交上来（绘图题最常见）
      if (q.node.type === 'drawing' && chance(0.12)) ctx.blankInk = true;
      let value = genFor(q.node, tier, ctx, fillKey);
      if (isFill) ctx.fillCount += 1;
      if (value === null) break;                    // 这一题没做 ⇒ 后面也不做了（学生是按顺序做的）

      // ★ 照片作答：值要等**统一渲染**之后才知道 URL ⇒ 这里先登记一个待渲染任务。
      if (value.__photo) {
        const file = `chat-${randomUUID()}.png`;
        const url = `/uploads/chat/${file}`;
        photoJobs.push({ path: path.join(CHAT_DIR, file), lines: [value.__photo.text], style: value.__photo.style });
        value = { format: 'photo/v1', url };
      }

      const at = startedAt + Math.floor((span * (i + 1)) / (limit + 1));
      const points = resolvePoints(q.node, DEFAULT_POINTS);
      const verdict = grade(q.node, value, points);
      answers.push({
        questionId: q.node.id,
        heading: q.heading,
        type: q.node.type,
        value,
        at,
        firstTouch: at - Math.floor(rng() * 3 * 60_000),
        saveCount: 1 + Math.floor(rng() * 4),
        isCorrect: verdict ? verdict.state === 'correct' : null,
        gradeState: verdict ? verdict.state : null,
        score: verdict ? verdict.score : null,
        createdAt: new Date(createdAt),
      });
    }
    const done = limit >= questions.length && p.id !== stragglers[3].id;
    plans.push({ participant: p, tier, answers, startedAt, submittedAt: startedAt + span, status: done ? 'submitted' : 'in-progress' });
  }

  /*
    ── 照片作答：把「学生写的那段话」画成一张图，落到上传目录 ────────────────
    🔴 必须先落盘再写库：AI 分析读的就是这个文件（`resolveLocalPath`），
       写一个指向空文件的 URL 会让分析当场抛错，而界面上只显示「分析失败」。
    ⚠️ 渲染失败 ⇒ **直接抛，整体不写库**（宁可这次没有数据，也不要半批坏数据）。
  */
  if (photoJobs.length > 0 && !DRY) {
    const manifest = path.join(os.tmpdir(), `classnode-answer-photos-${process.pid}.json`);
    fs.writeFileSync(manifest, JSON.stringify(photoJobs), 'utf8');
    try {
      const out = execFileSync(PYTHON, [path.join(HERE, 'make-answer-photos.py'), manifest], { encoding: 'utf8' });
      console.log(`照片作答渲染完成：${out.trim()}`);
    } catch (error) {
      throw new Error(
        `照片作答渲染失败（解释器：${PYTHON}）—— 没有写库。`
        + `换一个带 Pillow 的解释器：--python <path>；原始错误：${error.message}`,
      );
    } finally {
      fs.rmSync(manifest, { force: true });
    }
  }

  // ── 打印预览 ──
  const tally = {};
  for (const plan of plans) {
    for (const a of plan.answers) {
      tally[a.heading] = tally[a.heading] ?? { n: 0, correct: 0, partial: 0, incorrect: 0, ungraded: 0 };
      const t = tally[a.heading];
      t.n += 1;
      if (a.gradeState === 'correct') t.correct += 1;
      else if (a.gradeState === 'partial') t.partial += 1;
      else if (a.gradeState === 'incorrect') t.incorrect += 1;
      else t.ungraded += 1;
    }
  }
  for (const q of questions) {
    const t = tally[q.heading] ?? { n: 0, correct: 0, partial: 0, incorrect: 0, ungraded: 0 };
    const label = `${q.heading}`.padEnd(30);
    console.log(
      `  ${label} ${String(q.node.type).padEnd(14)}作答 ${String(t.n).padStart(2)}/${participants.length}` +
      `   全对 ${String(t.correct).padStart(2)}  部分 ${String(t.partial).padStart(2)}` +
      `  答错 ${String(t.incorrect).padStart(2)}  不判分 ${String(t.ungraded).padStart(2)}`,
    );
  }
  const totalAnswers = plans.reduce((sum, p) => sum + p.answers.length, 0);
  console.log();
  console.log(`合计 ${totalAnswers} 条作答 · 交卷时间 ${stamp(classStart)} ~ ${stamp(classStart + 45 * 60_000)}`);
  const limits = stragglers.map((p) => unfinished.get(p.id) ?? questions.length);
  console.log(
    `没做完整卷的人：`
    + stragglers.slice(0, 4).map((p, i) => `${p.student?.name}(${limits[i]}/${questions.length})`).join('、')
    + `；没开始的人：${neverStarted.student?.name}`,
  );
  console.log(`照片作答：${photoJobs.length} 张（${DRY ? '演练模式不落盘' : '渲染到 ' + CHAT_DIR + ''}）`);

  if (DRY) { console.log('\n演练模式：没有写库。'); return; }

  if (!KEEP) {
    const removed = await prisma.worksheetResponse.deleteMany({
      where: { classroomId: classroom.id, worksheetId: worksheet.id },
    });
    if (removed.count > 0) console.log(`\n先清掉了这个课堂已有的 ${removed.count} 份作答（级联删掉逐题行）`);
  }

  for (const plan of plans) {
    const response = await prisma.worksheetResponse.create({
      data: {
        classroomId: classroom.id,
        worksheetId: worksheet.id,
        participantId: plan.participant.id,
        // ⚠️ 没做完的那几个是 `in-progress`（交齐了才叫已交）—— 看板的「已交 N/M」看它。
        status: plan.status,
        startedAt: new Date(plan.startedAt),
        submittedAt: new Date(plan.submittedAt),
      },
    });
    for (const a of plan.answers) {
      await prisma.worksheetAnswer.create({
        data: {
          responseId: response.id,
          questionId: a.questionId,
          value: a.value,
          status: 'submitted',
          isCorrect: a.isCorrect,
          gradeState: a.gradeState,
          score: a.score,
          submittedAt: new Date(a.at),
          createdAt: new Date(a.firstTouch),
          savedAt: new Date(a.at - 20_000),
          saveCount: a.saveCount,
        },
      });
    }
    // `updatedAt` 是 `@updatedAt`，Prisma 会在 create 时盖成「现在」——
    // 用一次原样写回把它拨到交卷那一刻，否则整屏都是「刚刚」。
    await prisma.$executeRaw`UPDATE WorksheetResponse SET updatedAt = ${plan.submittedAt} WHERE id = ${response.id}`;
  }

  const written = await prisma.worksheetAnswer.count({ where: { response: { classroomId: classroom.id, worksheetId: worksheet.id } } });
  console.log(`\n✓ 写好了 ${plans.length} 份作答会话、${written} 条逐题作答`);
}

try {
  await main();
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
