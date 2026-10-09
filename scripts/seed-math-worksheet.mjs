/**
 * 造一份**小学数学**学习单（教师 2026-10-08：「要包括所有题型的所有用法，尤其绘图题及其它
 * 主观题，我要重点测试；要有分任务；要基于真实场景」）。
 *
 * 用法（仓库根）：
 *   npx tsx scripts/seed-math-worksheet.mjs          # 干跑：只自检形状，不写库
 *   npx tsx scripts/seed-math-worksheet.mjs --apply  # 真的插入一行
 *
 * 🔴 安全：本脚本**只发一条 `INSERT`**（`prisma.worksheet.create`）。全程不碰
 *   `db push` / `dev.sh db` / `dev.sh reset` —— 库是教师的真实开发库。
 *   落库前先跑服务端**同一套**校验（`flattenQuestions` + `validateQuestion`，即
 *   `parseContent` 用的那一步），所以"形状不被接受"会在写库前就报出来。
 *
 * ⚠️ 直插绕过 `normalizeNode`（白名单），所以**写进去的就是我给的**。这也是为什么
 *   下面每一处都按服务端的真实读法写：`categorize` 的框名是 `label` 不是 `text`、
 *   `order` 的初始顺序不能等于 `correctOrder`（会 400）、填空的 `answers` 必须是
 *   `string[][]`（写成平铺会被读成"1 个空、多个可接受答案"）。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const requireFromServer = createRequire(path.join(ROOT, 'server', 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');
const { flattenQuestions, validateQuestion } = await import('../server/src/services/worksheet-questions.ts');

const APPLY = process.argv.includes('--apply');
const TITLE = '小学数学学习单 · 校园数学节（全题型覆盖）';

/* ── 小工具 ─────────────────────────────────────────────────────────── */

let seq = 0;
const nid = (prefix) => `${prefix}_math_${String(++seq).padStart(3, '0')}`;

/**
 * 把带 `{填空域}` 的题干切成 `promptRuns`。
 * 🔴 服务端与前端都按**字符偏移**读空（`promptRuns[*].start/end`），且必须**正好拼满**
 *   `[0, prompt.length)`。带 `blank` 的那一段恰好覆盖 `{填空域}` 这 5 个字符 ——
 *   这是从库里真实数据量出来的（不是猜的）。
 */
function runsOf(prompt) {
  const runs = [];
  let cursor = 0;
  for (;;) {
    const at = prompt.indexOf('{填空域}', cursor);
    if (at < 0) break;
    if (at > cursor) runs.push({ start: cursor, end: at, blank: '' });
    runs.push({ start: at, end: at + 5, blank: nid('blank') });
    cursor = at + 5;
  }
  if (cursor < prompt.length) runs.push({ start: cursor, end: prompt.length, blank: '' });
  return runs.map((run) => ({ ...run, bold: false, italic: false, underline: false, emphasis: false, color: '#1e293b' }));
}
/** 没有空的题干也要给一条整段 run。 */
const plainRun = (prompt) => [{ start: 0, end: prompt.length, blank: '', bold: false, italic: false, underline: false, emphasis: false, color: '#1e293b' }];

const node = (type, prompt, data, extra = {}) => ({
  id: nid('q'), type, prompt, inputMode: 'keyboard', data, children: [], ...extra,
});
const task = (prompt, description, children) => ({
  id: nid('t'), type: 'task', prompt, inputMode: 'keyboard', data: { description }, children,
});
/** 条目/框/端点都要 id 且唯一。 */
const item = (text) => ({ id: nid('i'), text });
const zone = (label) => ({ id: nid('z'), label });

/* ── 任务一：筹备（钱、单位、运算）────────────────────────────────── */

const task1 = task(
  '任务一　筹备：校园数学节的采购清单',
  '下周五是校园数学节，五（2）班要摆一个“旧书义卖”摊位。班长小雨负责采购和记账，遇到了一连串数学问题，请你帮她一起解决。',
  [
    node('single-choice', '义卖摊位要买 3 盒彩笔，每盒 12 元，一共要付多少钱？（　　）', {
      options: [
        { key: 'A', text: '15 元' },
        { key: 'B', text: '36 元' },
        { key: 'C', text: '24 元' },
        { key: 'D', text: '48 元' },
      ],
      correctKeys: ['B'],
      explanation: '12 × 3 = 36（元）。',
    }, { points: { full: 2, half: 0 } }),

    node('true-false', '小雨说：“一张课桌高约 75 分米。”这个说法是对的。', {
      correctKeys: ['F'],
      explanation: '课桌高约 75 厘米，不是 75 分米。',
    }),

    node('fill-blank', '价目牌上写：一本旧书 8 元。买 6 本要付{填空域}元；如果付 100 元，应找回{填空域}元。', {
      promptRuns: runsOf('价目牌上写：一本旧书 8 元。买 6 本要付{填空域}元；如果付 100 元，应找回{填空域}元。'),
      answers: [['48'], ['52']],
      fillScoring: 'per-blank',
      fillBlankSettings: {},
    }, { points: { full: 2, half: 1 } }),

    node('choice-blank', '选词填空：一支铅笔长约 18{填空域}；一间教室的面积约 60{填空域}。', {
      promptRuns: runsOf('选词填空：一支铅笔长约 18{填空域}；一间教室的面积约 60{填空域}。'),
      fillChoicePool: ['厘米', '分米', '平方米', '立方米'],
      answers: [['厘米'], ['平方米']],
      fillScoring: 'per-blank',
      fillBlankSettings: {
        [runsOf('选词填空：一支铅笔长约 18{填空域}；一间教室的面积约 60{填空域}。')[0].blank]: { mode: 'pool', choices: [] },
        [runsOf('选词填空：一支铅笔长约 18{填空域}；一间教室的面积约 60{填空域}。')[1].blank]: { mode: 'pool', choices: [] },
      },
    }),

    node('order', '把小雨算“一共花了多少钱”的步骤按**正确的先后顺序**排好（现在顺序是乱的）。', {
      items: [item('把三样东西的价钱加起来'), item('算出每样东西花多少钱'), item('写出答语')],
      correctOrder: [],
      explanation: '先算单价×数量，再求和，最后写答语。',
    }),
  ],
);

/* ── 任务二：测量（图形与几何）────────────────────────────────────── */

const task2 = task(
  '任务二　测量：布置“数学角”',
  '教室后面要布置一个“数学角”，需要裁剪卡纸、贴图形，还要量尺寸。小组成员动手前先把方案想清楚。',
  [
    node('fill-blank', '量一量这张卡纸的四条边，把结果填在表里。{表格域}', {
      promptRuns: runsOf('量一量这张卡纸的四条边，把结果填在表里。{表格域}'),
      answers: [['12'], ['8'], ['12'], ['8']],
      fillScoring: 'per-blank',
      table: {
        headerRow: true,
        rows: [
          [{ text: '边', blank: '' }, { text: '长（厘米）', blank: '' }],
          [{ text: '上边', blank: '' }, { text: '', blank: nid('tb') }],
          [{ text: '下边', blank: '' }, { text: '', blank: nid('tb') }],
          [{ text: '左边', blank: '' }, { text: '', blank: nid('tb') }],
          [{ text: '右边', blank: '' }, { text: '', blank: nid('tb') }],
        ],
      },
    }, { points: { full: 4, half: 2 } }),

    node('categorize', '把下面的图形分一分：哪些是**轴对称图形**？', {
      items: [item('正方形'), item('平行四边形'), item('等腰三角形'), item('圆')],
      zones: [zone('是轴对称图形'), zone('不是轴对称图形')],
      placement: {},
      explanation: '平行四边形（一般的）不是轴对称图形；正方形、等腰三角形、圆都是。',
    }),

    node('match', '把图形和它的特征用直线连起来。', {
      left: [item('长方形'), item('正方形'), item('圆')],
      right: [item('对边相等，四个角都是直角'), item('四条边都相等，四个角都是直角'), item('从圆心到圆上任意一点的距离都相等')],
      pairs: [],
      explanation: '按定义一一对应。',
    }),

    node('drawing', '在方格纸上画一个长 4 格、宽 2 格的长方形，并用**直角记号**标出它的四个直角。', {
      drawingTool: 'math',
      drawingBackgroundPreset: 'small-grid',
      answers: [['画出长 4 格、宽 2 格的长方形'], ['四个角都标上了直角记号']],
      aiScoringEnabled: true,
      aiScoringMaxScore: 4,
      rubricText: '长方形边长正确得 2 分（长 4 格、宽 2 格各 1 分）；四个直角记号齐全得 2 分（每缺一个扣 0.5 分，扣完为止）。画成正方形或边长不符的，边长部分不得分。',
    }, { inputMode: 'handwriting', points: { full: 4, half: 0 } }),

    node('drawing', '下面已经给出了一条线段和一个直角坐标系。请在坐标系里画出一个**面积为 4 个方格**的长方形，并用平行记号标出一组对边。', {
      drawingTool: 'math',
      drawingBackgroundPreset: 'coordinate',
      drawingStarter: {
        tool: 'math',
        data: {
          elements: [
            { kind: 'coordinateSystem', a: [0, 0], b: [8, 8] },
            { kind: 'segment', a: [0, 8], b: [8, 8] },
          ],
        },
      },
      answers: [['画出一个面积为 4 格的长方形（如长 4 宽 1、或长 2 宽 2 的正方形也算）'], ['用平行记号标出了一组对边']],
      aiScoringEnabled: true,
      aiScoringMaxScore: 4,
      rubricText: '长方形面积恰为 4 格得 3 分；用平行记号标出一组对边得 1 分。面积不对不得分。',
    }, { inputMode: 'handwriting' }),
  ],
);

/* ── 任务三：统计（数据）──────────────────────────────────────────── */

const task3 = task(
  '任务三　统计：全班同学的课余活动',
  '数学节前，班里做了一次“课余活动”调查，每人只能选一项。下面是收集到的数据，请你把它整理清楚。',
  [
    node('multi-choice', '要从这份调查数据里看出“哪项活动最受欢迎”，下面哪些做法是**合适**的？（多选）', {
      options: [
        { key: 'A', text: '把每项活动的人数数出来' },
        { key: 'B', text: '画一张条形统计图' },
        { key: 'C', text: '只挑人数最多的那一项，其余不用管' },
        { key: 'D', text: '把所有人数加起来，检查是不是等于总人数' },
      ],
      correctKeys: ['A', 'B', 'D'],
      partialCredit: 'allow-missing',
      explanation: 'C 会丢掉信息，不算合适；A、B、D 都是整理数据时该做的事。',
    }, { points: { full: 3, half: 1 } }),

    node('multi-choice', '下列说法中，正确的有哪些？（多选，漏选不给分）', {
      options: [
        { key: 'A', text: '条形统计图能清楚地看出数量的多少' },
        { key: 'B', text: '折线统计图能看出数量的增减变化' },
        { key: 'C', text: '统计图里的每一格代表多少，是自己随便定的，跟题目无关' },
      ],
      correctKeys: ['A', 'B'],
      partialCredit: 'all-or-nothing',
      explanation: '一格里代表多少要看数据大小来定，不能随便。',
    }, { points: { full: 2, half: 0 } }),

    node('single-choice', '（这是一道**多选口径**的单选题）下面哪些是统计表里应该有的内容？（可多选）', {
      options: [
        { key: 'A', text: '项目名称' },
        { key: 'B', text: '数据的单位' },
        { key: 'C', text: '调查那天的天气' },
      ],
      correctKeys: ['A', 'B'],
      choiceMode: 'multiple',
      explanation: '统计表要有项目与单位；天气与统计内容无关。',
    }, { points: { full: 2, half: 1 } }),

    node('order', '把“用条形统计图整理数据”的步骤排成正确的顺序（现在顺序是乱的）。', {
      items: [item('画出坐标轴，标好项目与刻度'), item('统计每项的人数'), item('按人数画出条形的高度'), item('写上标题和单位')],
      correctOrder: [],
      explanation: '先统计，再画轴，再画条，最后写标题。',
    }),

    node('drawing', '请根据下面的数据，在坐标纸上画一张**条形统计图**，并标出标题。\n跳绳 6 人　踢球 4 人　看书 5 人　画画 3 人', {
      drawingTool: 'math',
      drawingBackgroundPreset: 'coordinate',
      drawingStarter: { tool: 'math', data: { elements: [{ kind: 'coordinateSystem', a: [0, 0], b: [10, 8] }] } },
      answers: [
        ['横轴标出四项活动', '纵轴标出人数刻度（每格 1 人或 2 人）'],
        ['四根条形的高度分别为 6、4、5、3'],
        '写上标题',
      ],
      aiScoringEnabled: true,
      aiScoringMaxScore: 6,
      rubricText: '横轴项目齐全得 1 分；纵轴有刻度与单位得 1 分；四根条形高度正确得 3 分（每对一根 0.75 分）；有标题得 1 分。条形高度与数据不符的，对应那根不得分。',
    }, { inputMode: 'handwriting', points: { full: 6, half: 0 } }),

    node('fill-blank', '看上面你画的条形统计图回答：人数最多的项目是{填空域}，比人数最少的项目多{填空域}人。请用一句话说说你是怎么比较出来的：{填空域}', {
      promptRuns: runsOf('看上面你画的条形统计图回答：人数最多的项目是{填空域}，比人数最少的项目多{填空域}人。请用一句话说说你是怎么比较出来的：{填空域}'),
      answers: [['跳绳'], ['3'], []],
      fillScoring: 'per-blank',
      // 🔴 混合填空：前两空本地判分，第三空交给 AI。整份 fillBlankSettings 的**条数必须
      //    等于答案槽数**，且每一项的 gradingMode 都得是三个字面量之一 —— 否则整份被静默忽略。
      fillBlankSettings: {},
    }, { points: { full: 4, half: 2 } }),

    node('choice-blank', '填上合适的词：条形统计图中，条形越{填空域}，表示数量越{填空域}。', {
      promptRuns: runsOf('填上合适的词：条形统计图中，条形越{填空域}，表示数量越{填空域}。'),
      fillChoicePool: ['高', '矮', '多', '少'],
      answers: [['高'], ['多']],
      fillScoring: 'per-blank',
      fillBlankSettings: {},
    }),
  ],
);

/* ── 任务四：设计与表达（绘图四档 + 主观题 + AI 评分）────────────── */

const task4 = task(
  '任务四　设计与表达：把想法讲清楚',
  '数学节上还要展示同学们的作品。请你用画图、思维导图、流程图和文字，把你的想法表达清楚。这一部分**重点是过程，不是唯一答案**。',
  [
    node('drawing', '设计一个**轴对称的图案**作为义卖摊位的招牌底纹，并画出它的对称轴（用虚线）。', {
      drawingTool: 'free',
      answers: [['画出的图案左右（或上下）能完全重合'], ['用虚线画出了对称轴']],
      aiScoringEnabled: true,
      aiScoringMaxScore: 4,
      rubricText: '图案确实轴对称得 3 分（大体对称 2 分）；画出对称轴得 1 分。',
    }, { inputMode: 'handwriting' }),

    node('drawing', '用思维导图整理“长方形”的知识：至少写出 4 个分支，比如周长、面积、特征、生活中的例子。', {
      drawingTool: 'mind-map',
      drawingBackgroundPreset: 'blank',
      drawingStarter: {
        tool: 'mind-map',
        data: {
          nodeData: {
            id: 'starter-root',
            topic: '长方形',
            children: [
              { topic: '特征', id: nid('mm'), direction: 0 },
              { topic: '周长', id: nid('mm'), direction: 1 },
            ],
          },
          arrows: [],
          summaries: [],
          direction: 1,
        },
      },
      answers: [['中心主题是“长方形”'], ['至少 4 个分支，内容与长方形有关']],
      aiScoringEnabled: true,
      aiScoringMaxScore: 4,
      rubricText: '中心主题正确得 1 分；分支数量达到 4 个得 2 分；每个分支的内容与长方形相关得 1 分。',
    }, { inputMode: 'handwriting' }),

    node('drawing', '用流程图表示“解决一道两步计算应用题”的步骤：开始 → 读题找条件 → 判断先求什么 → 列式计算 → 检验 → 结束。（下面已经给了一个开头，请补完并调整成合理顺序）', {
      drawingTool: 'flowchart',
      drawingBackgroundPreset: 'blank',
      drawingStarter: {
        tool: 'flowchart',
        data: {
          nodes: [
            { id: 'starter-n1', type: 'flow', position: { x: 80, y: 0 }, measured: { width: 150, height: 55 }, data: { label: '开始', kind: 'terminator' } },
            { id: 'starter-n2', type: 'flow', position: { x: 80, y: 120 }, measured: { width: 220, height: 55 }, data: { label: '读题找条件', kind: 'process' } },
          ],
          edges: [
            { id: 'starter-e1', source: 'starter-n1', target: 'starter-n2', sourceHandle: 'bottom', targetHandle: 'top', type: 'smoothstep' },
          ],
        },
      },
      answers: [['流程里包含“判断先求什么”这一步'], ['顺序合理：读题 → 判断 → 列式 → 检验 → 结束']],
      aiScoringEnabled: true,
      aiScoringMaxScore: 4,
      rubricText: '步骤完整（含判断环节）得 3 分；顺序合理得 1 分。',
    }, { inputMode: 'handwriting' }),

    node('short-answer', '小明说：“周长相等的两个长方形，面积一定也相等。”你同意吗？请**举例说明**你的理由。', {
      rubricText: '判断正确（不同意）得 1 分；能举出一个具体反例（如长 5 宽 1 与长 4 宽 2，周长都是 12，面积分别是 5 和 8）得 3 分；说理清楚、有计算过程再加 1 分。只写“不同意”没有理由的，只给 1 分。',
      aiScoringMaxScore: 5,
      aiScoringEnabled: true,
    }, { points: { full: 5, half: 0 } }),

    node('short-answer', '把你在任务三里画条形统计图的过程写下来（或者**拍照**上传你的草稿），说说你遇到了什么困难、怎么解决的。', {
      rubricText: '能说清画图的实际步骤得 2 分；提到具体的困难与解决办法得 2 分；条理清楚再加 1 分。',
      aiScoringMaxScore: 5,
    }, { inputMode: 'photo', points: { full: 5, half: 0 } }),

    node('drawing', '（拍照提交）请把你**笔算**“48 ÷ 4 =”的竖式过程拍照上传。', {
      drawingTool: 'free',
      answers: [['竖式书写规范，商是 12']],
    }, { inputMode: 'photo', autoGrade: false }),

    node('fill-blank', '这次数学节你最大的收获是{填空域}。请写一句话说明理由：{填空域}', {
      promptRuns: runsOf('这次数学节你最大的收获是{填空域}。请写一句话说明理由：{填空域}'),
      answers: [[], []],
      fillScoring: 'per-blank',
      fillBlankSettings: {},
    }, { autoGrade: false, points: { full: 4, half: 0 } }),
  ],
);

/* ── 组装 ───────────────────────────────────────────────────────────── */

const nodes = [task1, task2, task3, task4];

/*
 * 🔴 几处**必须按服务端读法**补的键，注释写明理由，改的时候别删：
 *  · `order.correctOrder` 不能与 `items` 的顺序相同（服务端会 400）；
 *    上面的 `items` 都刻意打乱了，`correctOrder` 按 `items` 的 id 写成正确顺序。
 *  · `match.pairs` / `categorize.placement` 必须给全，否则自动判分恒错。
 *  · 填空题的 `fillBlankSettings` 条数**必须等于答案槽数**，否则整份被静默忽略。
 */
const byId = new Map();
(function collect(list) {
  for (const n of list) { byId.set(n.id, n); if (n.children?.length) collect(n.children); }
})(nodes);
const findQ = (type, index) => {
  const all = [...byId.values()].filter((n) => n.type === type);
  const target = all[index];
  if (!target) throw new Error(`找不到第 ${index} 道 ${type}`);
  return target;
};

// order（两处）：按条目的文字写出**正确**顺序。
// 🔴 必须与 `items` 的书写顺序**不同** —— 相同会被服务端 400（`validateOrder`）。
const orders = [
  ['算出每样东西花多少钱', '把三样东西的价钱加起来', '写出答语'],
  ['统计每项的人数', '画出坐标轴，标好项目与刻度', '按人数画出条形的高度', '写上标题和单位'],
];
const orderNodes = [...byId.values()].filter((n) => n.type === 'order');
orderNodes.forEach((n) => {
  const want = orders.find((seqTexts) => seqTexts.every((t) => n.data.items.some((it) => it.text === t)));
  if (!want) throw new Error(`order 题对不上已知步骤表：${n.prompt.slice(0, 20)}`);
  n.data.correctOrder = want.map((t) => n.data.items.find((it) => it.text === t).id);
  if (JSON.stringify(n.data.correctOrder) === JSON.stringify(n.data.items.map((it) => it.id))) {
    throw new Error(`order 的初始顺序与正确顺序相同，服务端会 400：${n.prompt.slice(0, 20)}`);
  }
});

// match：左右按文字一一配对
for (const n of byId.values()) {
  if (n.type !== 'match') continue;
  const pairsFor = {
    长方形: '对边相等，四个角都是直角',
    正方形: '四条边都相等，四个角都是直角',
    圆: '从圆心到圆上任意一点的距离都相等',
  };
  n.data.pairs = n.data.left.map((l) => ({
    leftId: l.id,
    rightId: n.data.right.find((r) => r.text === pairsFor[l.text]).id,
  }));
}

// categorize：把每条按文字归位
for (const n of byId.values()) {
  if (n.type !== 'categorize') continue;
  const yes = ['正方形', '等腰三角形', '圆'];
  n.data.placement = Object.fromEntries(n.data.items.map((it) => [
    it.id,
    n.data.zones.find((z) => (yes.includes(it.text) ? z.label === '是轴对称图形' : z.label === '不是轴对称图形')).id,
  ]));
}

// 填空：把答案槽与逐空设置对齐（**条数必须相等**）
for (const n of byId.values()) {
  if (n.type !== 'fill-blank' && n.type !== 'choice-blank') continue;
  // ⚠️ 表格填空的空住在 `data.table` 里（题干里是 `{表格域}`，不是 `{填空域}`）⇒ 跳过它，
  //    由下面那一趟单独对齐。
  if (n.data?.table) continue;
  const blanks = (n.data.promptRuns ?? []).filter((r) => r.blank);
  const answers = n.data.answers ?? [];
  if (blanks.length !== answers.length) {
    throw new Error(`空数 ${blanks.length} 与答案 ${answers.length} 不等：${n.prompt.slice(0, 24)}`);
  }
  const settings = {};
  blanks.forEach((run, i) => {
    // 混合填空的判定：有可接受答案 ⇒ 本地判分；没有 ⇒ 交给 AI（主观空）。
    const hasAnswer = Array.isArray(answers[i]) && answers[i].length > 0;
    settings[run.blank] = hasAnswer
      ? { mode: 'text', choices: [], gradingMode: 'auto', maxScore: 1 }
      : { mode: 'text', choices: [], gradingMode: 'ai', maxScore: 2 };
  });
  n.data.fillBlankSettings = settings;
}
// 表格填空的逐空设置（它没有 promptRuns 的 blank，槽在 table 里）
for (const n of byId.values()) {
  if (!n.data?.table) continue;
  const cellBlanks = n.data.table.rows.flat().filter((c) => c.blank).map((c) => c.blank);
  if (cellBlanks.length !== n.data.answers.length) {
    throw new Error(`表格空数 ${cellBlanks.length} 与答案 ${n.data.answers.length} 不等`);
  }
  n.data.fillBlankSettings = Object.fromEntries(cellBlanks.map((b) => [b, { mode: 'text', choices: [], gradingMode: 'auto', maxScore: 1 }]));
}
// choice-blank：第一处用**共用词池**（pool），第二处用**行内候选词**（inline）——
// 两种用法都要覆盖到（`mode` 是区分它们的那个字段）。
const choiceBlankNodes = [...byId.values()].filter((n) => n.type === 'choice-blank');
choiceBlankNodes.forEach((n, index) => {
  const keys = Object.keys(n.data.fillBlankSettings);
  if (index === 0) {
    for (const key of keys) n.data.fillBlankSettings[key] = { mode: 'pool', choices: [], maxScore: 1 };
  } else {
    // 行内候选词：**每个空自带两个词**，学生在那两个词里点一下。
    const inlinePairs = [['高', '矮'], ['多', '少']];
    keys.forEach((key, i) => {
      n.data.fillBlankSettings[key] = { mode: 'inline', choices: inlinePairs[i] ?? [], maxScore: 1 };
    });
  }
});

const content = { schemaVersion: 1, nodes };
const settings = {
  allowResubmit: true,          // 这份是**测试单**：允许重做，方便反复走查
  autoGrade: true,
  answerMode: 'open',           // 全开放，避免测试时被"逐步解锁"挡住
  defaultInputMode: 'keyboard',
  rewardStyle: 'star',
  rewardStep: 2,                // 满分 2 枚起步，正好测"多个槽位"
  halfStep: 1,
  analysisAgentId: null,        // 由教师在界面上选一个分析型智能体
  backgroundTheme: 'creative-notebook',
  backgroundImageUrl: null,
  backgroundPortraitImageUrl: null,
  surfaceOpacity: 'soft',
};

/* ── 自检（与服务端 parseContent 同一套判据）──────────────────────── */

const flat = flattenQuestions(content);
const errors = [];
for (const n of flat) for (const e of validateQuestion(n)) errors.push(`${n.id}(${n.type}): ${e}`);
const types = flat.reduce((acc, n) => { acc[n.type] = (acc[n.type] ?? 0) + 1; return acc; }, {});
console.log('题型覆盖 :', types);
console.log('节点总数 :', flat.length);

if (errors.length) {
  console.error('\n❌ 形状不合法，未写库：');
  for (const e of errors) console.error('  ·', e);
  process.exit(1);
}
console.log('✅ 形状自检通过');

if (!APPLY) {
  console.log('\n（干跑模式：没有写库。加 --apply 才写。）');
  process.exit(0);
}

/* ── 写库 ───────────────────────────────────────────────────────────── */

const prisma = new PrismaClient();
try {
  const created = await prisma.worksheet.create({ data: { title: TITLE, content, settings } });
  const back = await prisma.worksheet.findUnique({ where: { id: created.id } });
  console.log('\n✅ 已写入');
  console.log('  id    :', created.id);
  console.log('  title :', back.title);
  console.log('  编辑页 : /teacher/worksheets/edit/?id=' + created.id);
} finally {
  await prisma.$disconnect();
}
