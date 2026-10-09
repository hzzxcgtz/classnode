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
/*
 * ★ 2026-10-08：绘图作答要产**一张 PNG 快照**（详见 `lib/answer-snapshots.mjs` 的文件头）。
 *   `sharp` 只装在 server/ ⇒ 与 `@prisma/client` 同一条路数用 `createRequire` 去要。
 *   三个纯函数都从产品那边 import，不在这里重写：
 *     · `flowchartSvg`      —— 流程图快照的**唯一真源**（`worksheet-flowchart-svg.ts`）
 *     · `readFlowchartPayload` / `mergeFlowchart` / `subtractFlowchart` —— 底稿的合并与剥离
 */
const sharp = requireFromServer('sharp');
const { drawingSnapshot } = await import('./lib/answer-snapshots.mjs');
const { flowchartSvg } = await import('../src/lib/worksheet-flowchart-svg.ts');
const { readFlowchartPayload, subtractFlowchart } = await import('../src/lib/worksheet-drawing-starter.ts');
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
/**
 * `--dump-snapshots <目录>`：把这一批**绘图快照**额外落一份到该目录（文件名带题号）。
 * 用途是「**写库之前先看一眼画出来的是什么**」—— 快照渲得出不等于画得对，
 * 而画错的快照 AI 会照着它给结论，比空白更难发现。
 */
const DUMP = argOf('dump-snapshots', null);

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
    // ★ 2026-10-08：小学数学「画出条形统计图的过程 / 遇到了什么困难」——照片作答那一题。
    //   ⚠️ 它是**照片档**（`inputMode: 'photo'`），学生拍的是草稿纸，但写下来的那段话
    //      仍是这张池子给的 —— 三档的差别正是评分类 AI 要分辨的东西（有没有说清困难）。
    match: /条形统计图|遇到的困难|草稿/,
    answers: {
      high: [
        '我先数出每种活动的人数，跳绳 6 人最多，所以纵轴要画到 6 格以上，我就一格定成 1 人。'
        + '然后画横轴，四个活动之间留一样宽的空，再把每根柱子按人数画到对应的高度，最后在柱子上面写数字、在下面写活动名称。'
        + '困难是柱子宽度总画得不一样宽，我用尺子比着才画齐；标题一开始忘了写。',
        '第一步先定一格代表 1 人，因为最多的跳绳是 6 人，纵轴画 8 格就够。'
        + '第二步按跳绳、踢球、看书、画画的顺序画四根柱子，高度分别是 6、4、5、3。'
        + '我遇到的困难是画格子的时候数错了一次，把看书画成了 4 人，后来重新数人数改过来了。',
      ],
      mid: [
        '我先数人数，再画柱子。跳绳 6 人画 6 格，踢球 4 人画 4 格，看书 5 格，画画 3 格。'
        + '困难是格子不好数，画歪了。',
        '先画横轴和纵轴，然后一根一根画上去。有几根画得不太准，我改了两次。标题写在了上面。',
        '就是先数人数再画柱子。困难是不知道一格代表几人，我一开始一格画一个人，后来发现画不下。',
      ],
      low: [
        '我就照着人数画的，画了几根柱子。',
        '先把数写上去了，柱子有点画不下，没画完。',
        '我画的柱子高矮不一样，老师说要一样宽，我没太听懂。',
        '先画了线，然后画柱子，困难就是柱子画不直。',
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

/**
 * 🔴 认不出题干时的回落池 —— **必须也按档分**。
 *
 * ⊘ 2026-10-08：这里原来是一个**扁平数组**（`['我是这样想的…', …]`），而下面取值写的是
 *   `table[tier] ?? table.mid` —— 扁平数组按 `[tier]` 取是 `undefined`，`[.mid]` 也是
 *   `undefined`，于是 `pick(undefined)` 抛 `Cannot read properties of undefined (reading 'length')`。
 *   上一份科学单里"彩虹"命中了池子，所以这个 bug 一直没露头；换成数学单就当场崩。
 *   ⇒ 形状要跟 `SHORT_ANSWER_POOLS[*].answers` **一致**（三档都在），别再退回扁平数组。
 */
const SHORT_ANSWER_FALLBACK = {
  high: [
    '我是这样想的：先看清楚题目问什么，再一步一步算，最后检查一遍。',
    '先找已知条件，再想它们之间是什么关系，列式算出来，最后写答。',
  ],
  mid: [
    '我是这样想的：先看清楚题目问什么，再一步一步想。',
    '答：我的想法是先看清楚，再说清楚。',
  ],
  low: [
    '先想一想，然后写下来。',
    '就是这样做的，我算完了。',
    '不太确定，我随便写了一个数。',
  ],
};

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

/* ══════════════════════════════════════════════════════════════════════════
   ★ 2026-10-08 新增：**文档式绘图作答**（`drawing.data` + `drawing.image`）

   🔴 为什么非加这一块不可 —— 原来这四种画板的作答**在 AI 眼里是白卷**：
     2026-10-06 起画板不再产 `strokes`（四种都不产），结构化内容挂在 `drawing.data` 里，
     而服务端**渲染不了**那些文档。服务端读作答值只有两条路
     （`server/src/services/analysis-payload.ts:280-295`）：
       ① `readDrawingRaster` → 取 `drawing.image`（一张 PNG 快照）当照片用；
       ② `readInk` → 认 `strokes`，而新画板的 `strokes` 恒为 `[]`。
     ⇒ **没有 `drawing.image` 的绘图作答，联系表里那一格是空的**，且两边都不报错。
     所以这条路上的每一条作答都必须给两样：
       · `drawing.data`  —— 教师端画板读它（形状见 `worksheet-drawing-document.ts`）
       · `drawing.image` —— 一张**真 PNG**，AI 分析读它（与照片作答同一条纪律）

   ⚠️ **底稿不在学生那份里**：数学档 `publish()` 只交 `snapshot()`（底稿在独立锁定层，
     `math-drawing.tsx:543`），流程图档走 `subtractFlowchart`。但**快照画的是
     「底稿 + 学生画的」**（真机就是这么抓的）⇒ 见 `mergedFlowOf`。
   ⚠️ 思维导图那一档**相反**：整棵树（含底稿根）都是学生的（`mindMapOrStarter`）。
   ══════════════════════════════════════════════════════════════════════════ */

const DRAWING_TOOLS = ['free', 'math', 'mind-map', 'flowchart'];
/** 与产品同一条默认：认不出的 `drawingTool` 按 `free` 算（`readDrawingTool`）。 */
const drawingToolOf = (node) => (DRAWING_TOOLS.includes(node.data?.drawingTool) ? node.data.drawingTool : 'free');

/** 老师给的底稿**载荷**（`{tool,data}` 信封里的 `data`）；没有 / 档不对就回 `null`。 */
function starterPayloadOf(node) {
  const starter = node.data?.drawingStarter;
  if (!starter || typeof starter !== 'object' || Array.isArray(starter)) return null;
  if (starter.tool !== drawingToolOf(node)) return null;
  return starter.data ?? null;
}

const r2 = (value) => Math.round(value * 100) / 100;
/** 手抖：整体平移 `shift`，再逐点加 `amp` 的抖动（学生画的线不会笔笔精准）。 */
const drift = (points, shift, amp) => points.map(([x, y]) => [
  r2(x + shift[0] + (rng() - 0.5) * 2 * amp),
  r2(y + shift[1] + (rng() - 0.5) * 2 * amp),
]);
/** 一个封闭多边形（本单里的长方形、柱子都是它）。 */
const closedRect = ([x0, y0], [x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/* ── ① 画长方形：长是宽的 2 倍 + 四个直角记号（无底稿）─────────────────────
   典型错法两样：**画成正方形**（长宽不成 2 倍）、**直角记号没标全**（每个缺扣 0.5）。
   坐标是数学坐标，画板固定视野 [-10,10]×[-8,8] ⇒ 8×4 个单位约占画布 2/5，够看清。 */
function genMathRectangle(tier, ctx) {
  if (ctx.blankInk) return { __drawing: { tool: 'math', data: { elements: [] } } };
  if (tier === 'low' && chance(0.3)) return null;                       // 没画完，交不上来

  const shift = [(rng() - 0.5) * 2.4, (rng() - 0.5) * 1.8];
  const wobble = tier === 'high' ? 0.06 : tier === 'mid' ? 0.14 : 0.34;
  const square = tier === 'low' ? chance(0.6) : chance(0.08);
  const w = square ? 5 : 8;
  const h = square ? 5 : 4;
  const corners = drift(closedRect([-w / 2, -h / 2], [w / 2, h / 2]), shift, wobble);
  const elements = [{ kind: 'polyline', closed: true, points: corners }];

  // 四条边各自的**两个邻角**（顺序与 corners 一致：左下 → 右下 → 右上 → 左上）。
  const arms = [[1, 3], [0, 2], [1, 3], [0, 2]];
  const marks = tier === 'high' ? 4 : tier === 'mid' ? (chance(0.45) ? 2 : 3) : (chance(0.55) ? 0 : 1);
  for (let i = 0; i < marks; i += 1) {
    const [a, b] = arms[i];
    elements.push({ kind: 'rightAngle', vertex: corners[i], a: corners[a], b: corners[b] });
  }
  if (chance(0.35)) elements.push({ kind: 'label', at: [r2((corners[0][0] + corners[1][0]) / 2), r2(corners[0][1] - 0.8)], text: '长' });
  if (chance(0.35)) elements.push({ kind: 'label', at: [r2(corners[1][0] + 0.4), r2((corners[1][1] + corners[2][1]) / 2)], text: '宽' });
  return { __drawing: { tool: 'math', data: { elements } } };
}

/* ── ② 坐标系里画面积 4 的长方形 + 一组平行记号 ────────────────────────────
   底稿给了坐标系（0..8）与一条线段。典型错法：**把面积当边长**（画成 3×3）。 */
function genMathAreaRectangle(tier, ctx) {
  if (ctx.blankInk) return { __drawing: { tool: 'math', data: { elements: [] } } };
  if (tier === 'low' && chance(0.25)) return null;

  const x0 = r2(1 + (rng() - 0.5) * 0.6);
  const y0 = r2(1 + (rng() - 0.5) * 0.6);
  let w = 2;
  let h = 2;                                                            // 2×2 = 面积 4
  if (tier === 'mid' && chance(0.4)) { w = 1; h = 4; }                   // 1×4 也是 4，没错
  if (tier === 'low' && chance(0.6)) { w = 3; h = 3; }                   // ✗ 面积 9：把面积当成了边长
  const wobble = tier === 'high' ? 0.04 : 0.13;
  const corners = drift(closedRect([x0, y0], [r2(x0 + w), r2(y0 + h)]), [0, 0], wobble);
  const elements = [{ kind: 'polyline', closed: true, points: corners }];

  // 平行记号：一组对边。高档两边都标（4 分里的 1 分就是它）。
  const marks = tier === 'high' ? 2 : tier === 'mid' ? (chance(0.5) ? 1 : 0) : 0;
  if (marks >= 1) elements.push({ kind: 'parallelMark', a: corners[0], b: corners[1] });
  if (marks >= 2) elements.push({ kind: 'parallelMark', a: corners[3], b: corners[2] });
  return { __drawing: { tool: 'math', data: { elements } } };
}

/* ── ③ 坐标系里画条形统计图（跳绳 6 / 踢球 4 / 看书 5 / 画画 3）────────────
   一格 = 1 人（题干没给"一格代表几人"，所以正确的高度就是人数本身）。
   典型错法：**只画了三根**、**最后一根数错**、**把人数除以 2 当格数**。 */
const BAR_ITEMS = [
  { name: '跳绳', value: 6 },
  { name: '踢球', value: 4 },
  { name: '看书', value: 5 },
  { name: '画画', value: 3 },
];
function genMathBarChart(tier, ctx) {
  if (ctx.blankInk) return { __drawing: { tool: 'math', data: { elements: [] } } };
  if (tier === 'low' && chance(0.25)) return null;

  let heights = BAR_ITEMS.map((item) => item.value);
  let count = heights.length;
  if (chance(tier === 'high' ? 0.15 : tier === 'mid' ? 0.5 : 0.85)) {
    const roll = rng();
    if (roll < 0.3) heights = heights.map((value) => Math.max(1, Math.round(value / 2)));  // 人数÷2 当格数
    else if (roll < 0.55) heights = [6, 4, 5, 6];                                          // 「画画」看成了 6 人
    else if (roll < 0.75) heights = [6, 4, 4, 3];                                          // 「看书」少画一格
    else { count = 3; heights = [6, 4, 5]; }                                               // 只画了三根
  }

  const elements = [];
  const BAR_W = 1.4;
  const STEP = 2;
  for (let i = 0; i < count; i += 1) {
    const left = 1 + i * STEP;
    const top = heights[i];
    elements.push({ kind: 'polyline', closed: true, points: closedRect([left, 0], [r2(left + BAR_W), top]) });
    if (chance(tier === 'high' ? 0.85 : 0.5)) elements.push({ kind: 'label', at: [r2(left + 0.15), r2(top + 0.5)], text: String(top) });
    // ⚠️ 类目名要落在**刻度数字下面**（轴下第一行是 1/2/3…，第二行才是名字）——
    //    两条挤在一行时 AI 会把「跳绳」读成刻度（渲染出来看了一眼才发现）。
    if (chance(tier === 'high' ? 0.85 : 0.5)) elements.push({ kind: 'label', at: [left, -2.3], text: BAR_ITEMS[i].name });
  }
  if (chance(tier === 'high' ? 0.8 : 0.4)) elements.push({ kind: 'label', at: [1, 7.5], text: '全班同学课余活动统计图' });
  return { __drawing: { tool: 'math', data: { elements } } };
}

/* ── ④ 轴对称图案 + 对称轴（虚线）（基础绘图档）────────────────────────────
   画布是 320×240 的 CSS 像素。图案对称于 x=160。典型错法：**只画了半边**（忘了镜像）、
   **对称轴画成实线**（题目要虚线）、根本没画对称轴。 */
const SYM_OUTLINE = [[160, 40], [110, 80], [100, 140], [130, 190], [160, 205], [190, 190], [220, 140], [210, 80], [160, 40]];
const SYM_BAND = [[110, 110], [210, 110]];
function genSymmetryPattern(tier, ctx) {
  if (ctx.blankInk) return { __drawing: { tool: 'free', data: { paths: [] } } };
  if (tier === 'low' && chance(0.25)) return null;

  const color = chance(0.75) ? '#1f2937' : pick(['#1d4ed8', '#b91c1c', '#15803d']);
  const amp = tier === 'high' ? 2 : tier === 'mid' ? 4 : 8;
  const paths = [];
  /** 一笔：`react-sketch-canvas` 的 `CanvasPath` 形状（点就是**画布像素**）。 */
  const push = (points, width = 3) => paths.push({
    paths: points.map(([x, y]) => ({ x: r2(x), y: r2(y) })),
    strokeWidth: width,
    strokeColor: color,
    drawMode: false,
  });

  if (tier === 'low' && chance(0.55)) {
    push(drift(SYM_OUTLINE.slice(0, 5), [0, 0], amp));                  // ✗ 只画了左半边，忘了镜像
  } else {
    push(drift(SYM_OUTLINE, [0, 0], amp));
    if (chance(0.6)) push(drift(SYM_BAND, [0, 0], amp), 2);
  }

  const axisWanted = tier === 'high' ? chance(0.9) : tier === 'mid' ? chance(0.55) : chance(0.15);
  if (axisWanted) {
    if (tier !== 'high' && chance(0.45)) {
      push([[160, 26], [160, 214]], 2);                                 // ✗ 实线：题目要的是虚线
    } else {
      for (let y = 26; y < 212; y += 17) push([[160, y], [160, y + 11]], 2);   // 一段一段画出来的虚线
    }
  }
  if (paths.length === 0) return null;
  return { __drawing: { tool: 'free', data: { paths } } };
}

/* ── ⑤ 思维导图（底稿的根 + 学生补的分支）──────────────────────────────────
   ⚠️ 这一档与数学/流程图**相反**：整棵树都是学生的作答（`mindMapOrStarter`），
      底稿那个根节点原样留在里面 ⇒ 直接从底稿起手往上加。
   ⚠️ 刻意**不写 `theme`**：画板把主题放在 `new MindElixir({...})` 的选项里
      （`mindmap-drawing.tsx:124`），作答里没有就跟着选项走。塞一份死主题进去反而会盖掉它。 */
const MIND_BRANCHES = [
  { topic: '面积', children: ['长 × 宽', '单位：平方厘米'] },
  { topic: '生活中的例子', children: ['数学书的封面', '黑板'] },
  { topic: '面积公式', children: [] },
  { topic: '周长公式', children: ['（长 + 宽）× 2'] },
];
function genMindMap(node, tier, ctx) {
  /*
   * ⚠️ 思维导图这一档**没有「空白作答」这个值**：导图不抓首帧快照，学生什么都不动就
   *    永不触发 `onChange` ⇒ `draft.drawing` 始终为空 ⇒ 「提交本题」按不动（真机实测，
   *    `valueFromDraft` 也会回 `null`）。所以这里只能回 `null`（＝这道题没有作答），
   *    造一个空树出来是**一个学生交不上来的形状** —— 分析读到它只会更糊涂。
   *    （流程图相反：它有首帧快照，所以「只交了底稿」是一个真实存在的值。）
   */
  if (ctx.blankInk) return null;

  const starterRoot = starterPayloadOf(node)?.nodeData;
  const root = starterRoot && typeof starterRoot === 'object' && !Array.isArray(starterRoot)
    ? JSON.parse(JSON.stringify(starterRoot))
    : { id: 'root', topic: '中心主题', children: [] };
  root.children = Array.isArray(root.children) ? root.children : [];

  const taken = new Set(root.children.map((child) => child.topic));
  const pool = MIND_BRANCHES.filter((branch) => !taken.has(branch.topic));
  // 题目要「至少 4 个分支」：高档补到 4~5 个，中档 3 个上下（**差一口气**正是要分析出来的），
  // 低档基本不动底稿。
  const want = tier === 'high' ? 2 + Math.floor(rng() * 3)
    : tier === 'mid' ? 1 + Math.floor(rng() * 2)
      : (chance(0.5) ? 0 : 1);
  pickN(pool, Math.min(want, pool.length)).forEach((branch, index) => {
    const kids = tier === 'high'
      ? branch.children.map((topic, kidIndex) => ({ topic, id: `mm_seed_${index}_${kidIndex}` }))
      : [];
    root.children.push({
      topic: branch.topic,
      id: `mm_seed_${index}`,
      direction: (root.children.length + index) % 2,
      ...(kids.length > 0 ? { children: kids } : {}),
    });
  });
  return {
    __drawing: {
      tool: 'mind-map',
      data: { nodeData: root, arrows: [], summaries: [], direction: 1, compact: false },
    },
  };
}

/* ── ⑥ 流程图（补完底稿给的「开始 → 读题找条件」）───────────────────────────
   ⚠️ 学生那份**不含底稿节点**（`subtractFlowchart` 按 id 剥掉），但**快照画的是合并后的全图**
      —— 真机上 `lastFlow.current` 存的就是那一份（`flowchart-drawing.tsx:964`）。 */
const FLOW_SIZE = { terminator: [150, 55], process: [190, 55], decision: [220, 110], io: [190, 55] };
/** 居中放一个节点：`centerX` 是**中心**横坐标（底稿那两节点中心在 155）。 */
function flowNode(id, label, kind, centerX, y) {
  const [width, height] = FLOW_SIZE[kind] ?? FLOW_SIZE.process;
  return {
    id,
    type: 'flow',
    position: { x: r2(centerX - width / 2), y },
    measured: { width, height },
    data: { label, kind },
  };
}
function flowEdge(id, source, target) {
  return { id, source, target, sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep' };
}

function genFlowchart(node, tier, ctx) {
  const starterData = starterPayloadOf(node);
  const starter = readFlowchartPayload(starterData);

  // 一笔没动就交：学生那份被剥空，但快照画着底稿 ⇒ 真机上这仍是一次有效作答。
  if (ctx.blankInk) {
    const shot = starter.nodes.length > 0 ? flowchartSvg(readFlowchartPayload(starterData)) : null;
    return { __drawing: { tool: 'flowchart', data: { nodes: [], edges: [] }, snapshotSvg: shot?.svg ?? null } };
  }
  if (tier === 'low' && chance(0.25)) return null;

  const STEPS = [
    ['判断先求什么', 'decision'],
    ['列式计算', 'process'],
    ['检验', 'process'],
    ['结束', 'terminator'],
  ];
  const take = tier === 'high' ? 4 : tier === 'mid' ? (chance(0.5) ? 3 : 4) : 1 + Math.floor(rng() * 2);
  const reversed = tier === 'high' ? false : chance(tier === 'mid' ? 0.3 : 0.2);   // ✗ 顺序颠倒

  const mine = [];
  const mineEdges = [];
  let previous = 'starter-n2';
  let y = 240;
  for (let i = 0; i < take; i += 1) {
    const [label, kind] = STEPS[i];
    const id = `node-seed-${i}`;
    mine.push(flowNode(id, label, kind, 155, y));
    mineEdges.push(flowEdge(`edge-seed-${i}`, previous, id));
    previous = id;
    y += kind === 'decision' ? 140 : 120;
  }
  if (reversed && mine.length >= 3) {
    // 把「列式计算」和「检验」对调 —— 两步应用题最典型的顺序错误
    const a = mine[1]; const b = mine[2];
    const ay = a.position.y; a.position.y = b.position.y; b.position.y = ay;
  }

  const all = {
    nodes: [...starter.nodes, ...mine],
    edges: [...starter.edges, ...mineEdges],
  };
  const snapshot = flowchartSvg(all);
  return {
    __drawing: {
      tool: 'flowchart',
      // 存的是**剥掉底稿**的那一份（学生自己画的），这与真机一致。
      data: subtractFlowchart(all, starter),
      snapshotSvg: snapshot?.svg ?? null,
    },
  };
}

/**
 * 数学档的快照要**把底稿一起画进去**。
 *
 * 🔴 作答里只有学生自己画的（底稿在独立锁定层，`math-drawing.tsx:543`），
 *    但**真机抓的那张快照抓的是整块画板** ⇒ 底稿画在里面。
 *   ⊘ 2026-10-08 第一版把这两件事混为一谈：快照只画了学生那份，
 *     于是第 2、3 题的**坐标系（在底稿里）整块不见了**，图上只剩几根悬空的柱子 ——
 *     那比空白更坏，因为 AI 会照着它认真地给出结论。（拼出来看了一眼才发现。）
 */
function withStarterSnapshot(node, result) {
  if (!result?.__drawing) return result;
  const starterElements = starterPayloadOf(node)?.elements;
  if (!Array.isArray(starterElements) || starterElements.length === 0) return result;
  const mine = Array.isArray(result.__drawing.data?.elements) ? result.__drawing.data.elements : [];
  return {
    __drawing: {
      ...result.__drawing,
      snapshotData: { elements: [...starterElements, ...mine] },
    },
  };
}

/* ── 题干 → 哪一张图。判据是**画板工具 + 题面里的词**（不按题号）。────────── */
function genDrawing(node, tier, ctx) {
  const prompt = node.prompt ?? '';
  const tool = drawingToolOf(node);

  // ① 新单（小学数学）：走**文档 + 快照**那条路（见上面那段说明）。
  if (tool === 'mind-map') return genMindMap(node, tier, ctx);
  if (tool === 'flowchart') return genFlowchart(node, tier, ctx);
  if (/直角记号|长是宽的/.test(prompt)) return withStarterSnapshot(node, genMathRectangle(tier, ctx));
  if (/平行记号|平方单位/.test(prompt)) return withStarterSnapshot(node, genMathAreaRectangle(tier, ctx));
  if (tool === 'math' && /条形统计图/.test(prompt)) return withStarterSnapshot(node, genMathBarChart(tier, ctx));
  if (/轴对称/.test(prompt)) return genSymmetryPattern(tier, ctx);

  // ② 旧单（小学科学）：**沿用笔迹那条路**。理由不是懒得改 ——
  //    光路图有箭头、水面有虚线，而 `CanvasPath`（基础绘图档的作答形状）只有折线，
  //    表达不了它们；而 `strokes` 服务端**本来就渲染得了**（`ink-render.ts`），
  //    所以这条路对 AI 分析一直是通的。换过去只会把图变差。
  if (/折射|光路|入射|法线/.test(prompt)) return genLightPathAnswer(tier, ctx);
  return genBarChartAnswer(tier, ctx);
}

/* ── 编排：一个学生答哪些题、答成什么样 ─────────────────────────────── */

/** 题干 → 用哪个生成器。按**题型**分派，不按题号 —— 教师改了学习单也照样能跑。 */
/**
 * **笔算竖式**照片（`48 ÷ 4`）。
 *
 * 🔴 竖式的全部信息在**列对齐**上 ⇒ 交给渲染器时带 `mono: true`
 *   （`make-answer-photos.py` 会换等宽字体并逐行照抄、不换行）。
 *   用宋体渲染的话，那些空格对不齐，图上"有字"而 AI 读出来的是错位的竖式 —— 比空白更难查。
 * 三档的差别：高档竖式完整；中档省掉减法那两行（只写商）；低档只做了一半或商算错。
 */
function verticalDivisionPhoto(tier) {
  const FULL = [
    '48 ÷ 4 = 12', '',
    '     1 2',
    '   ┌─────',
    ' 4 │ 4 8',
    '     4',
    '     ───',
    '       8',
    '       8',
    '       ───',
    '       0',
  ];
  if (tier === 'high') return { lines: FULL, style: 'neat', mono: true };
  if (tier === 'mid') {
    return {
      lines: ['48 ÷ 4 = 12', '', '     1 2', ' 4 │ 4 8', '       8', '       8', '       0'],
      style: 'sloppy',
      mono: true,
    };
  }
  return chance(0.5)
    // 商算对了，竖式只写了一半就交
    ? { lines: ['48 ÷ 4 = 12', '', '     1', ' 4 │ 4 8', '     4', '       8'], style: 'sloppy', mono: true }
    // 竖式写完了但商错了（8 那里写成了 1，余 4）
    : { lines: ['48 ÷ 4 = 11', '', '     1 1', ' 4 │ 4 8', '     4', '       8', '       4', '       ───', '       4'], style: 'sloppy', mono: true };
}

/** 照片作答拍的那张纸上写了什么。回 `{lines, style, mono?}`。 */
function photoAnswerFor(node, tier) {
  if (/竖式/.test(node.prompt ?? '')) return verticalDivisionPhoto(tier);
  return { lines: [shortAnswerText(node, tier)], style: tier === 'high' ? 'neat' : 'sloppy' };
}

function genFor(node, tier, ctx, fillKey) {
  // ★ 2026-10-05：**照片作答**（`inputMode: 'photo'`）先分派 —— 它存的是
  //   `{format:'photo/v1', url}`，而不是这个题型平时那个文本/笔迹形状。
  //   这里返回一个「待渲染」的标记，主流程统一把那些文字画成图、再补上 URL。
  if ((node.type === 'short-answer' || node.type === 'drawing') && node.inputMode === 'photo') {
    return { __photo: photoAnswerFor(node, tier) };
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

  /** 待渲染的照片作答：`{ path, lines, style, mono? }` —— 循环结束后**一次性**交给 Python 画。 */
  const photoJobs = [];
  /**
   * 待渲染的**绘图快照**：`{ path, svg }` —— 循环结束后**一次性**交给 sharp 栅格化。
   * 🔴 与照片同一条纪律：先落盘、再写库。指向空文件的 URL 会让 AI 分析当场抛错，
   *    而界面上只有"分析失败"四个字（这一格的失败是**静默**的，见本文件头第 4 条）。
   */
  const snapshotJobs = [];

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
      /*
       * 交卷前才动笔的那道题，有人干脆空着交上来（绘图题最常见）。
       *
       * ⚠️ **每道题重新掷**。⊘ 2026-10-08：原来写的是 `if (… && chance(0.12)) ctx.blankInk = true;`
       *    —— 只置真、从不复位，而 `ctx` 是**整个学生**共用的一个对象 ⇒ 只要第一道绘图题
       *    掷中了，这个学生**后面每一道绘图题全交白卷**。造出来的数据是
       *    「要么一道空白都没有、要么一道图都没画」——两种都不像班级，
       *    而这正是分析功能要分辨的东西（原注释写的就是"那道题"，可见本意就是逐题）。
       */
      ctx.blankInk = q.node.type === 'drawing' && chance(0.12);
      let value = genFor(q.node, tier, ctx, fillKey);
      if (isFill) ctx.fillCount += 1;
      if (value === null) break;                    // 这一题没做 ⇒ 后面也不做了（学生是按顺序做的）

      // ★ 照片作答：值要等**统一渲染**之后才知道 URL ⇒ 这里先登记一个待渲染任务。
      if (value.__photo) {
        const file = `chat-${randomUUID()}.png`;
        const url = `/uploads/chat/${file}`;
        photoJobs.push({
          path: path.join(CHAT_DIR, file),
          lines: value.__photo.lines,
          style: value.__photo.style,
          ...(value.__photo.mono ? { mono: true } : {}),
        });
        value = { format: 'photo/v1', url };
      } else if (value.__drawing) {
        /*
         * ★ 2026-10-08 绘图作答：**两个字段缺一不可**（见 `genDrawing` 上面那段说明）——
         *   `drawing.data` 给教师端画板，`drawing.image` 给 AI 分析。
         *   快照渲不出来时**不编 URL**：宁可这条只交 `data`（分析里是一格空白），
         *   也不要写一个指向空文件的 `image` —— 后者会让整次分析抛错。
         */
        const { tool, data } = value.__drawing;
        // 快照画什么**不一定等于**作答存什么（数学档要带上底稿，见 `withStarterSnapshot`）。
        const snapshotData = value.__drawing.snapshotData ?? data;
        const svg = value.__drawing.snapshotSvg ?? drawingSnapshot(tool, snapshotData)?.svg ?? null;
        const drawing = { tool, data };
        if (typeof svg === 'string' && svg.length > 0) {
          const file = `chat-${randomUUID()}.png`;
          snapshotJobs.push({ path: path.join(CHAT_DIR, file), svg, label: `${q.heading}-${tool}` });
          drawing.image = `/uploads/chat/${file}`;
        }
        value = { format: 'drawing/v1', canvas: { w: 320, h: 240 }, strokes: [], drawing };
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
    /*
     * 「交了没有」判的是**真的答了几题**，不是 `limit`。
     * ⊘ 2026-10-08：原来写的是 `limit >= questions.length` —— 而 `limit` 只是**允许**答到哪，
     *   中途 `break`（某道题没做、后面就不做了）的人 `limit` 仍是 24 ⇒ **被标成「已交」**，
     *   可教师看板上那份是缺了几题的。于是「已交 N/M」这一列是假的，
     *   而 N 个学生里有多少人真交齐，正是教师会去读的那个数。
     */
    const done = answers.length >= questions.length && p.id !== stragglers[3].id;
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

  /*
    ── 绘图快照：SVG → PNG ─────────────────────────────────────────────────
    ★ 演练模式也渲一遍，但**落在临时目录里、渲完就删** —— 这样 `--dry` 能把
      「快照这条路通不通」验完（SVG 语法错、字体缺失、字段形状不对都会在这里炸），
      又不会在上传目录里留下**几百张孤儿 PNG**（每条作答一张，跑几次就是几千张）。
  */
  if (snapshotJobs.length > 0) {
    const scratch = DRY ? fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-snapshots-')) : null;
    try {
      for (const job of snapshotJobs) {
        const target = scratch ? path.join(scratch, path.basename(job.path)) : job.path;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await sharp(Buffer.from(job.svg)).png().toFile(target);
      }
      console.log(`绘图快照渲染完成：${snapshotJobs.length} 张（${DRY ? '落在临时目录，演练后已删' : '已落到 ' + CHAT_DIR + ''}）`);
      if (DUMP) {
        // 同一个人可能在同一题上渲出多张（不会，但别赌）—— 序号一并写进文件名，避免互相覆盖。
        const seen = new Map();
        for (const job of snapshotJobs) {
          const base = (job.label ?? path.basename(job.path)).replace(/[^\p{Script=Han}\w.-]+/gu, '_');
          const seq = (seen.get(base) ?? 0) + 1;
          seen.set(base, seq);
          fs.mkdirSync(DUMP, { recursive: true });
          await sharp(Buffer.from(job.svg)).png().toFile(path.join(DUMP, `${base}-${seq}.png`));
        }
        console.log(`快照另存一份到：${DUMP}（**给人看的**，写库不受它影响）`);
      }
    } catch (error) {
      throw new Error(`绘图快照渲染失败 —— 没有写库。原始错误：${error.message}`);
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
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
  // 教师看板那一列「已交 N/M」看的就是这个 —— 打出来，验收时不必再去库里数。
  const submitted = plans.filter((plan) => plan.status === 'submitted').length;
  console.log(`作答会话：${plans.length} 份（交齐 ${submitted} 人 · 未交齐 ${plans.length - submitted} 人 · 另有 ${participants.length - plans.length} 人一行作答都没有）`);
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
  // 🔴 只打印 `error.message` 的话，`Cannot read properties of undefined` 这类错误
  //    会让你完全不知道是**哪一行**读的 —— 2026-10-08 就为此多花了一轮侦察。
  console.error(`\n✗ ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
