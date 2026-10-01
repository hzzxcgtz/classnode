#!/usr/bin/env node
/**
 * 给一个课堂灌一批**像真人写的**学习单作答数据（仅供开发 / 演示 / 试用 AI 分析）。
 *
 * 用法（在仓库根目录）：
 *   npx tsx scripts/seed-worksheet-demo.mjs                    # 默认课堂：1001课堂
 *   npx tsx scripts/seed-worksheet-demo.mjs --classroom 8169   # 按互动码
 *   npx tsx scripts/seed-worksheet-demo.mjs --dry              # 只打印，不写库
 *   npx tsx scripts/seed-worksheet-demo.mjs --seed 7           # 换一组随机数
 *   npx tsx scripts/seed-worksheet-demo.mjs --keep             # 不清旧数据，追加
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');

const { grade, resolvePoints, DEFAULT_POINTS, readStrings, answerSlotCount, acceptableAnswersFor } =
  await import('../server/src/services/worksheet-questions.ts');
const { flattenAnswerable } = await import('../server/src/services/worksheet-heading.ts');

/* ── 命令行 ─────────────────────────────────────────────────────────── */

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const CLASSROOM_ARG = argOf('classroom', '1001课堂');
const SEED = Number(argOf('seed', '20261001'));
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
  'single-1': { high: 0.95, mid: 0.82, low: 0.55 },   // 只读一个零
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

function genChoice(node, tier) {
  const correct = readStrings(node.data.correctKeys);
  const keys = Array.isArray(node.data.options)
    ? node.data.options.map((o) => o.key).filter((k) => typeof k === 'string')
    : [];
  if (correct.length === 0) return null;
  const wrongs = keys.filter((k) => !correct.includes(k));

  if (correct.length === 1) {
    if (chance(P['single-1'][tier])) return { selected: [correct[0]] };
    return { selected: [wrongs.length > 0 ? pick(wrongs) : 'A'] };
  }
  // 多选（本仓的「全对才算」档）：漏选是最常见的错法 —— 也是 AI 分析最该看出来的那个。
  if (chance(P.multi[tier])) return { selected: [...correct] };
  const r = rng();
  if (r < 0.55) return { selected: [correct[0]] };
  if (r < 0.75) return { selected: [correct[correct.length - 1]] };
  if (r < 0.9 && wrongs.length > 0) return { selected: [correct[0], pick(wrongs)] };
  return { selected: wrongs.length > 0 ? [pick(wrongs)] : [correct[0]] };
}

function genFill(node, tier, key) {
  const slots = answerSlotCount(node.data);
  const texts = [];
  for (let i = 0; i < slots; i += 1) {
    const acceptable = acceptableAnswersFor(node.data, i);
    const correct = acceptable[0] ?? '';
    if (correct !== '' && chance(P[key][tier])) texts.push(correct);
    else if (correct === '') texts.push('');
    else texts.push(pick(typicalWrongOf(correct)));
  }
  return { texts };
}

function genOrder(node, tier) {
  const correct = readStrings(node.data.correctOrder);
  if (correct.length === 0) return null;
  if (chance(P.order[tier])) return { order: [...correct] };
  if (correct.length < 2) return { order: [...correct] };
  if (rng() < 0.3) return { order: [...correct].reverse() };       // 整个反了
  // 抽两项对调 —— 小学生排错最常见的样子
  const out = [...correct];
  const [a, b] = pickN(correct.map((_, i) => i), 2);
  [out[a], out[b]] = [out[b], out[a]];
  return { order: out };
}

function genMatch(node, tier) {
  const pairs = Array.isArray(node.data.pairs) ? node.data.pairs : [];
  if (pairs.length === 0) return null;
  if (chance(P.match[tier])) return { links: pairs.map((p) => ({ leftId: p.leftId, rightId: p.rightId })) };

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
  return { links };
}

function genCategorize(node, tier) {
  const placement = node.data.placement ?? {};
  const itemIds = Object.keys(placement);
  if (itemIds.length === 0) return null;
  const assignment = { ...placement };
  if (chance(P.categorize[tier])) return { assignment };
  const zones = [...new Set(Object.values(placement))];
  const bad = pickN(itemIds, 1 + Math.floor(rng() * 2));   // 错 1~2 个
  for (const itemId of bad) {
    const others = zones.filter((z) => z !== placement[itemId]);
    if (others.length > 0) assignment[itemId] = pick(others);
  }
  return { assignment };
}

/* ── 问答题：一段一段手写的「学生腔」──────────────────────────────────
   按题干里的关键词选池子；认不出就回落到通用池。 */
const SHORT_ANSWER_POOLS = [
  {
    match: /满100元减20元/,
    answers: [
      '不够。156－20＝136（元），136＞130，所以付130元不够，还差6元。',
      '不够。因为满100减20，156-20=136元，136比130大，还差6元。',
      '130元不够。156-20=136（元） 136>130 答：不够，差6元。',
      '不够用的。先算减完多少：156－20＝136元，136元比130元多，还多要6元。',
      '够。156满100了，减20以后是136，136和130差不多，我觉得够。',
      '不够。156-20=136，所以要付136元。',
      '够吧。156元减20元等于136元，130元差不多够了。',
      '不够。因为156>130，所以130元买不了。',
      '不够，156-20=136，136-130=6，还要6元。',
      '我觉得够，因为打折嘛，156减20就是136，136约等于130。',
    ],
  },
];
const SHORT_ANSWER_FALLBACK = [
  '我是这样想的：先看清楚题目问什么，再一步一步算。',
  '答：我的想法是先算出来，再比较大小，最后写答。',
  '先算一算，然后比一比就知道了。',
];

function genShortAnswer(node) {
  const pool = SHORT_ANSWER_POOLS.find((p) => p.match.test(node.prompt ?? ''));
  return { format: 'text/v1', text: pick(pool ? pool.answers : SHORT_ANSWER_FALLBACK) };
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

/** 绘图题的作答：大多数人画对，少数柱高画错 / 只画一半 / 交了白的。 */
function genDrawing(node, tier, index) {
  if (index.blankInk) return { format: 'drawing/v1', canvas: { ...CANVAS }, strokes: [] };
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

/* ── 编排：一个学生答哪些题、答成什么样 ─────────────────────────────── */

/** 题干 → 用哪个生成器。按**题型**分派，不按题号 —— 教师改了学习单也照样能跑。 */
function genFor(node, tier, ctx, fillKey) {
  switch (node.type) {
    case 'single-choice':
    case 'true-false':
    case 'multi-choice':
      // 单选还是多选，由**正确答案有几个**决定（与 `judge()` 同一把尺子），不由题型名决定。
      return genChoice(node, tier);
    case 'fill-blank':
    case 'choice-blank':
      return genFill(node, tier, fillKey);
    case 'order': return genOrder(node, tier);
    case 'match': return genMatch(node, tier);
    case 'categorize': return genCategorize(node, tier);
    case 'short-answer': return genShortAnswer(node);
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

  // 谁没做完：三个孩子（时间到 / 请假）—— 「已交 N/M」这一列要真的不满才有意义
  const unfinished = new Map();
  const stragglers = pickN(participants, 4);
  unfinished.set(stragglers[0].id, 7);
  unfinished.set(stragglers[1].id, 8);
  unfinished.set(stragglers[2].id, 8);
  unfinished.set(stragglers[3].id, 4);   // 只做完了任务一

  const classStart = Number(classroom.createdAt) + 2 * 60_000;
  const plans = [];

  for (const p of participants) {
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
      const value = genFor(q.node, tier, ctx, fillKey);
      if (isFill) ctx.fillCount += 1;
      if (value === null) break;                    // 这一题没做 ⇒ 后面也不做了（学生是按顺序做的）

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
    plans.push({ participant: p, tier, answers, startedAt, submittedAt: startedAt + span });
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
    const label = `${q.heading}`.padEnd(12);
    console.log(
      `  ${label}${String(q.node.type).padEnd(15)}作答 ${String(t.n).padStart(2)}/${participants.length}` +
      `   全对 ${String(t.correct).padStart(2)}  部分 ${String(t.partial).padStart(2)}` +
      `  答错 ${String(t.incorrect).padStart(2)}  不判分 ${String(t.ungraded).padStart(2)}`,
    );
  }
  const totalAnswers = plans.reduce((sum, p) => sum + p.answers.length, 0);
  console.log();
  console.log(`合计 ${totalAnswers} 条作答 · 交卷时间 ${stamp(classStart)} ~ ${stamp(classStart + 45 * 60_000)}`);
  console.log('未做完整卷的人：' + stragglers.map((p, i) => `${p.student?.name}(${[7, 8, 8, 4][i]}/9)`).join('、'));

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
        status: 'submitted',
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
