/**
 * 流程图的位图快照：**形状对、文字转义、坏数据不抛**。
 *
 * ⚠️ 这里验不了「老 iPad 上栅格化出来是什么样」（没有浏览器），只能钉住**SVG 的内容**：
 *    形状是不是按 kind 分的、连线有没有箭头、文字有没有转义、坐标有没有落在 viewBox 里。
 *    真机走查仍在验收清单里。
 *
 * ★ 2026-10-06（教师上传的标准流程图）：下面加了**画板 ⇄ 快照**那两条**语义一致**的网
 *    （交点尺寸/样式、线标签位置规则）。
 *    🔴 为什么要有它们：这两处坏掉是**静默**的 —— 快照（教师预览 / AI 联系表 / Word 报告）
 *       与画板不一样，而两边都不报错。判据**不许逐字钉数值**（数值自己会变），一律这样写：
 *         ① 从**画板的真源**（CSS `.flowNode_junction` / 画板组件里的 `EDGE_LABEL_GAP`）读出来；
 *         ② 与**快照自己的常量**（`worksheet-flowchart-svg.ts`）对起来；
 *         ③ 再验**快照真的画成了那样**（SVG 里的 `r` / `fill` / `text-anchor` / 坐标偏移）；
 *         ④ 每条判据配一条**变异**（在源码文本上改回旧写法）⇒ 必须判违规 ——
 *            否则这条网是恒真的，等于没写。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeXml, flowchartSvg, readFlowRaster } from './worksheet-flowchart-svg.ts';

/** 断言有图 + 把 `| null` 收窄（`tsc` 也跑这个文件，解构 null 会红）。 */
function shot(raw: unknown): { svg: string; width: number; height: number } {
  const out = flowchartSvg(raw);
  assert.ok(out, '这一份数据应当画得出图');
  return out;
}

const FLOW = {
  nodes: [
    { id: 'n1', type: 'flow', position: { x: 80, y: 40 }, measured: { width: 120, height: 44 }, data: { label: '开始', kind: 'terminator' } },
    { id: 'n2', type: 'flow', position: { x: 60, y: 160 }, measured: { width: 160, height: 60 }, data: { label: '水开了吗', kind: 'decision' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bottom', targetHandle: 'top', type: 'default' }],
};

test('阳性对照：读出来的确实是两个节点一条线（否则下面几条在空集上永远绿）', () => {
  const { nodes, edges } = readFlowRaster(FLOW);
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  assert.equal(nodes[1].kind, 'decision');
});

test('🔴 形状按 kind 分：terminator 圆角、decision 菱形、io 平行四边形、其余矩形', () => {
  const { svg } = shot({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { label: '开始', kind: 'terminator' } },
      { id: 'b', position: { x: 0, y: 80 }, data: { label: '判断', kind: 'decision' } },
      { id: 'c', position: { x: 0, y: 160 }, data: { label: '输入', kind: 'io' } },
      { id: 'd', position: { x: 0, y: 240 }, data: { label: '处理', kind: 'process' } },
    ],
    edges: [],
  });
  assert.match(svg, /rx="2[0-9]"/, 'terminator 不是胶囊形（rx 应等于半高）');
  assert.match(svg, /<polygon points="[^"]+" fill="#eef3f8"/, 'decision / io 没有画成多边形');
  assert.equal((svg.match(/<polygon /g) ?? []).length, 2, '四个节点里应当正好两个多边形（菱形 + 平行四边形）');
  assert.equal((svg.match(/<rect /g) ?? []).length, 3, '白底一个 + terminator 一个 + process 一个');
});

test('🔴 连线带箭头：marker 定义了、也真的被引用', () => {
  const { svg } = shot(FLOW);
  assert.match(svg, /<marker id="flow-arrow"/, '没有箭头 marker —— 流程图的连线看不出方向');
  assert.match(svg, /marker-end="url\(#flow-arrow\)"/, '连线没有引用箭头');
  assert.match(svg, /<line x1="140" y1="84" x2="140" y2="160"/, '连线没有按 handle（下→上）落在框边上');
});

test('🔴 学生写的字要转义（标签会原样进 SVG）', () => {
  const { svg } = shot({
    nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: '<script>x</script>', kind: 'process' } }],
    edges: [],
  });
  assert.ok(!svg.includes('<script>'), '原始 <script> 进了 SVG');
  assert.match(svg, /&lt;script&gt;/, '标签没有被转义');
  assert.equal(escapeXml(`a & b "c" 'd' <e>`), 'a &amp; b &quot;c&quot; &apos;d&apos; &lt;e&gt;');
});

test('⚠️ `measured` 缺席时按字数估宽（且不画成零宽，否则快照上是几条线）', () => {
  const { nodes } = readFlowRaster({ nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: '一段比较长的节点文字内容', kind: 'process' } }] });
  assert.ok(nodes[0].width >= 96, `估出来的宽度太小：${nodes[0].width}`);
  const measuredZero = readFlowRaster({ nodes: [{ id: 'a', position: { x: 0, y: 0 }, measured: { width: 0, height: 0 }, data: { label: 'x' } }] });
  assert.ok(measuredZero.nodes[0].width > 0 && measuredZero.nodes[0].height > 0, '测出来是 0 的那一帧要兜住');
});

test('坏数据不抛：空 / 不是对象 / 缺 id / 悬空连线', () => {
  assert.equal(flowchartSvg(null), null);
  assert.equal(flowchartSvg({}), null);
  assert.equal(flowchartSvg({ nodes: [], edges: [] }), null);
  assert.equal(flowchartSvg({ nodes: [{ position: { x: 0, y: 0 } }], edges: [] }), null, '没有 id 的节点要跳过');
  const dangling = flowchartSvg({ nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: '有', kind: 'process' } }], edges: [{ source: 'a', target: '消失的' }] });
  assert.ok(dangling && !dangling.svg.includes('<line'), '悬空连线不该画出来');
});

test('viewBox 装得下所有节点（含 padding），否则快照会被裁掉一角', () => {
  const { svg, width, height } = shot({
    nodes: [{ id: 'a', position: { x: 300, y: 200 }, measured: { width: 100, height: 40 }, data: { label: '右下', kind: 'process' } }],
    edges: [],
  });
  assert.match(svg, new RegExp(`viewBox="0 0 ${width} ${height}"`));
  assert.ok(width >= 300 + 100 + 18, `宽度没装下最右的节点：${width}`);
  assert.ok(height >= 200 + 40 + 18, `高度没装下最下的节点：${height}`);
});

test('★ 线上的字要画进快照（判断框分出的「是 / 否」不能在报告里消失）', () => {
  const { svg } = shot({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
      { id: 'b', position: { x: 0, y: 140 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
    ],
    // ⚠️ 用画板**现在的默认标注**（`是 / 否`，见 `DECISION_BRANCH_LABELS`）当样本 ——
    //    拿已经不再产生的 `Y` 当样本，这条网就盖不到真实数据。
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是' }],
  });
  assert.match(svg, />是<\/text>/, '线上的字没有画进快照');
  // 反面对照：没标注的线不该凭空多一个标签。
  const bare = shot({
    nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: '甲', kind: 'process' } }],
    edges: [],
  });
  assert.ok(!/<text[^>]*>是<\/text>/.test(bare.svg), '没标注的线凭空多出了标签');
});

/* ══════════════════════════════════════════════════════════════════════════════
   ★ 2026-10-06（教师上传的标准流程图）：**画板 ⇄ 快照** 语义一致
   ══════════════════════════════════════════════════════════════════════════════ */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 画板的**唯一真源**：交点样式在 CSS 里、标签离线多远在画板组件里。 */
const CANVAS_CSS = path.resolve(HERE, '../app/classroom/worksheet/worksheet.module.css');
const CANVAS_TSX = path.resolve(HERE, '../app/classroom/worksheet/questions/drawing-surfaces/flowchart-drawing.tsx');
/** 快照自己的那一份（下面要拿它与画板对起来）。 */
const SNAPSHOT = path.join(HERE, 'worksheet-flowchart-svg.ts');

/** 块注释 / 整行 `//` 注释（判据必须落在**活代码**上：注释里写着不算）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 从源码里读一个 `const NAME = <数值>;`（数值里可以出现 `+ - * /` 这种算式）。 */
function constNumber(source: string, name: string): number {
  // ⚠️ 尾部那个 `(?![A-Za-z0-9_$])`：没有它会用 `const JUNCTION_DIAMETER = …` 命中
  //    `const JUNCTION_DIAMETER_LABELS = …` 那种**前缀同名**的常量（读到别人的数值还判绿）。
  // ⚠️ 取值用 `[^;{}]+`（不是 `[^;]+`）：否则 `const X = Y;` 后面紧跟的另一句会被一并吞进来，
  //    拿到 `Y; const Z` 这种半截算式（`new Function` 会报 `X is not defined`）。
  // ⚠️ 取值里引用**本文件另一个常量**（`JUNCTION_DIAMETER / 2`）是合法写法 ⇒ 把本文件所有
  //    `const 名字 = 算式;` 先解出来再求值（不解的话 `new Function` 会报 `… is not defined`）。
  const raw = (source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;{}]+);(?![A-Za-z0-9_$])`)) ?? [])[1];
  assert.ok(raw !== undefined, `源码里没有 \`const ${name} = …;\` —— 先修这条判据，别让它在空串上全绿（读到 ${raw}）`);
  const scope = new Map<string, number>();
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;{}]+);/g)) {
    try {
      const value = Number(new Function(...scope.keys(), `return (${match[2]});`)(...scope.values()));
      if (Number.isFinite(value)) scope.set(match[1], value);
    } catch {
      // 引用的是本文件别的东西（`COLORS.text` 之类）⇒ 这一条跳过，由下面那条断言负责报错。
    }
  }
  assert.ok(scope.has(name), `\`const ${name}\` 解不出一个数（读到 ${raw}）—— 判据要能读出它的值`);
  return scope.get(name)!;
}

/** 从源码里读一个 `const NAME = '<字符串>';`（颜色这种）。 */
function constLiteral(source: string, name: string): string {
  const raw = (source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;{}]+);(?![A-Za-z0-9_$])`)) ?? [])[1];
  assert.ok(raw !== undefined, `源码里没有 \`const ${name} = …;\` —— 先修这条判据，别让它在空串上全绿（读到 ${raw}）`);
  const value = raw.trim();
  const quote = value[0];
  assert.ok((quote === `'` || quote === '"' || quote === '`') && value[value.length - 1] === quote,
    `\`${name}\` 不是字符串字面量（读到 ${raw}）—— 判据要能读出它的值`);
  return value.slice(1, -1);
}

/** 抠 CSS 里某条规则（`.sel { … }`）的规则体。抠不出来**必须报错**，不许静默在空串上全绿。 */
function cssRuleBody(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `样式表里没有 \`${selector}\` 那条规则`);
  const body = css.slice(at, css.indexOf('}', at) + 1);
  assert.ok(body.length > selector.length + 4, `\`${selector}\` 那条规则没抠出来 —— 先修这条判据`);
  return body;
}

/** 画板交点的外框尺寸 —— 读 CSS 那个数（`[^-]width:` 才不会命中 `min-width:`）。 */
function canvasJunctionSize(): number {
  const css = stripComments(fs.readFileSync(CANVAS_CSS, 'utf8'));
  const raw = (cssRuleBody(css, '.flowNode_junction').match(/[^-]width:\s*(\d+)px/) ?? [])[1];
  assert.ok(raw !== undefined, '没有读到画板交点的尺寸');
  return Number(raw);
}

/** 画板标签的**摆位规则** —— 抠 `FlowLabelEdge` 那一份实现（与 `surface-lifecycle.test.ts` 同一个靶子）。 */
function canvasLabelEdgeBody(): string {
  const live = stripComments(fs.readFileSync(CANVAS_TSX, 'utf8'));
  const at = live.indexOf('function FlowLabelEdge');
  assert.notEqual(at, -1, '画板那份只管标签的自定义边（`FlowLabelEdge`）没了 —— 标签又会回到「压线」的摆法');
  const body = live.slice(at, live.indexOf('\n}\n', at));
  assert.ok(body.length > 200, '`FlowLabelEdge` 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  return body;
}

/** 画板 `EDGE_LABEL_GAP` 那个数。 */
function canvasLabelGap(): number {
  const live = stripComments(fs.readFileSync(CANVAS_TSX, 'utf8'));
  return constNumber(live, 'EDGE_LABEL_GAP');
}

/** 画板标签摆位符不符合规则（两半都判，变异才抓得住）。 */
function canvasBiasesRight(source: string): boolean {
  return /vertical \? \([\s\S]{0,400}?x=\{labelX \+ EDGE_LABEL_GAP\}[\s\S]{0,200}?textAnchor="start"/.test(source);
}
function canvasBiasesAbove(source: string): boolean {
  return /\) : \([\s\S]{0,400}?y=\{labelY - EDGE_LABEL_GAP\}[\s\S]{0,200}?textAnchor="middle"/.test(source);
}

// ── ① 交点（junction）：8×8 的描边空心小环，圆心在节点中心 ─────────────────────
test('★ 快照的交点与画板一致：8×8 空心环（r=半尺寸 / 白底 / 同色 2px 描边）', () => {
  const canvasSize = canvasJunctionSize();
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  const snapDiameter = constNumber(live, 'JUNCTION_DIAMETER');
  const snapRadius = constNumber(live, 'JUNCTION_RADIUS');

  // 画板 ⇄ 快照：外框尺寸、半径（现算，不逐字钉 8 / 4 ——「直径 = 2 × 半径」是语义）。
  assert.equal(snapDiameter, canvasSize,
    `快照交点的外框（${snapDiameter}）与画板 CSS 那个尺寸（${canvasSize}px）对不上 —— 快照上那颗会比画板大/小一圈`);
  assert.equal(snapRadius * 2, canvasSize,
    `快照交点的半径（${snapRadius}）不是画板那个外框（${canvasSize}px）的一半 —— 圆会偏大或偏小`);
  assert.equal(snapRadius * 2, snapDiameter, `快照交点的 r（${snapRadius}）不是外框的一半（${snapDiameter}）`);

  // 画板 CSS 的**颜色**与空心环：与快照常量对起来（不逐字钉色号）。
  const rule = cssRuleBody(stripComments(fs.readFileSync(CANVAS_CSS, 'utf8')), '.flowNode_junction');
  const borderColor = (rule.match(/border:\s*[^;]*?(#[0-9a-fA-F]{3,8})/) ?? [])[1];
  const background = (rule.match(/background:\s*(#[0-9a-fA-F]{3,8})/) ?? [])[1];
  assert.ok(borderColor !== undefined && background !== undefined, '`.flowNode_junction` 里读不到描边色 / 底色');
  assert.match(rule, /border:\s*[^;]*solid/, '画板交点不再是「描边」的（教师要求空心环，不是实心点）');
  assert.equal(constNumber(live, 'JUNCTION_STROKE_WIDTH'), 2, '快照交点的描边宽不是 2px（画板 CSS 是 `border: 2px solid …`）');
  assert.equal(constLiteral(live, 'JUNCTION_FILL').toLowerCase(), background.toLowerCase(), '快照交点的填充与画板的背景色不一致（应当都是白底空心）');
  assert.equal(constLiteral(live, 'JUNCTION_STROKE').toLowerCase(), borderColor.toLowerCase(), '快照交点的描边色与画板不一致');

  // 快照**真的画成了那样**（常量对了、SVG 没照着画 = 另一种静默不一致）。
  const { svg } = shot({
    nodes: [{ id: 'j', position: { x: 100, y: 60 }, data: { label: '', kind: 'junction' } }],
    edges: [],
  });
  const circle = (svg.match(/<circle[^>]*>/) ?? [])[0] ?? '';
  assert.ok(circle.length > 0, '交点没有被画成一个圆');
  assert.equal((circle.match(/\br="([^"]+)"/) ?? [])[1], String(snapRadius), 'SVG 里那个 r 与常量对不上');
  // ⚠️ 预期值从**快照自己的常量**（以及画板 CSS 读出来的那个色）现算 —— 不逐字钉色号。
  const snapFill = constLiteral(live, 'JUNCTION_FILL');
  const snapStroke = constLiteral(live, 'JUNCTION_STROKE');
  assert.ok(circle.includes(`fill="${snapFill}"`), '交点不是白底空心环（又变回实心点了？）');
  assert.ok(circle.includes(`stroke="${snapStroke}"`), '交点的描边色不是画板那个颜色（它是线的一部分，要与箭头同色）');
  assert.ok(circle.includes(`stroke-width="${constNumber(live, 'JUNCTION_STROKE_WIDTH')}"`), '交点的描边宽与常量不符');
  // 圆心落在节点中心：节点 12×12（`readFlowRaster` 给交点的盒子）⇒ 100+6 / 60+6。
  const junctionBox = readFlowRaster({ nodes: [{ id: 'j', position: { x: 100, y: 60 }, data: { label: '', kind: 'junction' } }] }).nodes[0];
  assert.match(circle, new RegExp(`cx="${junctionBox.position.x + junctionBox.width / 2}"`), '圆心不在节点中心的 x 上（会与线岔开）');
  assert.match(circle, new RegExp(`cy="${junctionBox.position.y + junctionBox.height / 2}"`), '圆心不在节点中心的 y 上（会与线岔开）');
  /** 改前那个实心深色（旧写法）—— 变异与判据都引它，避免各写一份色号。 */
  const SOLID_BACK = '#527198';
  assert.ok(!circle.includes(`fill="${SOLID_BACK}"`), '交点又变回原来那个实心圆（教师：「大大的圆点其实是不需要的」）');

  // ⚠️ 变异：改回原来的「10px 实心」⇒ 上面那几条必须红。
  const solidBack = live.replace(/const JUNCTION_DIAMETER = 8;/, 'const JUNCTION_DIAMETER = 10;')
    .replace(/const JUNCTION_FILL = '#fff';/, `const JUNCTION_FILL = '${SOLID_BACK}';`);
  assert.notEqual(solidBack, live, '变异没造出来 —— 这条判据会变成恒真');
  const mutatedDiameter = constNumber(solidBack, 'JUNCTION_DIAMETER');
  const mutatedFill = constLiteral(solidBack, 'JUNCTION_FILL');
  assert.ok(mutatedDiameter !== canvasSize || mutatedFill.toLowerCase() === background.toLowerCase(),
    '变异没被抓住（把交点改回 10px 实心，判据仍判它一致）—— 这条网是恒真的');
  assert.ok(!mutatedFill.toLowerCase().includes('fff'), '变异没真的把它改回实心 —— 反面对照本身是假的');
});

// ── ② 线标签：竖线 ⇒ 右侧左对齐；横线 ⇒ 上方居中；无白底；深色 ─────────────────
test('★ 快照的线标签摆法与画板一致：竖线右侧（左对齐）/ 横线上方（居中）', () => {
  const canvasGap = canvasLabelGap();
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.equal(constNumber(live, 'FLOW_LABEL_OFFSET'), canvasGap,
    `快照标签的偏移（${constNumber(live, 'FLOW_LABEL_OFFSET')}）与画板 EDGE_LABEL_GAP（${canvasGap}）不一致 —— 两边的字会离线不一样远`);

  // 反面对照（与画板那一条同一个靶子：去掉偏移 = 压回线上）⇒ 判据必须抓住。
  const canvasEdge = canvasLabelEdgeBody();
  assert.ok(canvasBiasesRight(canvasEdge) && canvasBiasesAbove(canvasEdge),
    '画板那边的摆位规则变了（不再是「竖线右侧 / 横线上方」）—— 先把画板与控制端对齐，再改快照');
  assert.ok(!canvasBiasesRight(canvasEdge.replace('x={labelX + EDGE_LABEL_GAP}', 'x={labelX}')),
    '画板的「压线」变异没被抓住 —— 这条判据是恒真的');
  assert.ok(!canvasBiasesAbove(canvasEdge.replace('y={labelY - EDGE_LABEL_GAP}', 'y={labelY}')),
    '画板的「压线」变异没被抓住 —— 这条判据是恒真的');

  // ⚠️ 竖直末段（进目标是上/下）⇒ 文字左边缘贴在线右侧 + 偏移。
  const V_NODES = [
    { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
    { id: 'b', position: { x: 0, y: 140 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
  ];
  const vertical = shot({
    nodes: V_NODES,
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是' }],
  });
  // 期望值**从同一份规则现算**（节点盒子宽高 + 边中点）—— 不手抄数字：
  // 两个 120×50 的盒子，`bottom → top` ⇒ 线从 (60,50) 到 (60,140)，中点 (60,95)。
  const vBoxes = readFlowRaster({ nodes: V_NODES, edges: [] }).nodes;
  const vAnchor = [vBoxes[0].position.x + vBoxes[0].width / 2,
    (vBoxes[0].position.y + vBoxes[0].height + vBoxes[1].position.y) / 2] as const;
  const vWord = (vertical.svg.match(/<text[^>]*>是<\/text>/) ?? [])[0] ?? '';
  assert.ok(vWord.length > 0, '竖线上的标签没画出来');
  assert.match(vWord, /text-anchor="start"/,
    '竖线上的标签不是**左对齐** —— 长标签会从线右侧横跨回线上（画板那边同样是 `textAnchor="start"`）');
  assert.ok(!/text-anchor="middle"/.test(vWord), '竖线上的标签又变成居中了（教师那张标准图是左边缘贴线）');
  const vx = Number((vWord.match(/\bx="([-\d.]+)"/) ?? [])[1]);
  assert.ok(Math.abs(vx - (vAnchor[0] + canvasGap)) < 1,
    `竖线上标签的 x（${vx}）不等于「中点 + ${canvasGap}」（${vAnchor[0] + canvasGap}）—— 没有摆在线的右侧`);
  // 竖向位置：基线就是线中点（画板那边这一点用 `dy="0.35em"` 微调，且**不**依赖 dominant-baseline）。
  const vy = Number((vWord.match(/\by="([-\d.]+)"/) ?? [])[1]);
  assert.ok(Math.abs(vy - vAnchor[1]) < 1, `竖线上标签的基线（${vy}）没落在线的中点（${vAnchor[1]}）上`);

  // ⚠️ 水平末段（进目标是左/右）⇒ 文字居中、抬到线的**上方**。
  const H_NODES = [
    { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
    { id: 'b', position: { x: 220, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
  ];
  const horizontal = shot({
    nodes: H_NODES,
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left', label: '否' }],
  });
  // `right → left` ⇒ 线从 (120,25) 到 (220,25)，中点 (170,25)。
  const hBoxes = readFlowRaster({ nodes: H_NODES, edges: [] }).nodes;
  const hAnchor = [(hBoxes[0].position.x + hBoxes[0].width + hBoxes[1].position.x) / 2,
    hBoxes[0].position.y + hBoxes[0].height / 2] as const;
  const hWord = (horizontal.svg.match(/<text[^>]*>否<\/text>/) ?? [])[0] ?? '';
  assert.ok(hWord.length > 0, '横线上的标签没画出来');
  assert.match(hWord, /text-anchor="middle"/, '横线上的标签不是水平居中（画板那边是 `textAnchor="middle"`）');
  const hx = Number((hWord.match(/\bx="([-\d.]+)"/) ?? [])[1]);
  const hy = Number((hWord.match(/\by="([-\d.]+)"/) ?? [])[1]);
  assert.ok(Math.abs(hx - hAnchor[0]) < 1, `横线上标签的 x（${hx}）不在中点（${hAnchor[0]}）上`);
  assert.ok(Math.abs(hy - (hAnchor[1] - canvasGap)) < 1,
    `横线上标签的基线（${hy}）没有抬到线的上方 ${canvasGap}（${hAnchor[1] - canvasGap}）—— 又压回线上了`);

  // 竖线 ⇒ 右侧：光把锚点改成 `start` 而**不**给偏移，字仍会压线 ⇒ 这一条单独抓。
  assert.ok(vx > vAnchor[0] + 1, '竖线上的标签没有真的偏到线的右侧（只改了 text-anchor 也可以压线）');

  // ⚠️ 变异：把偏移拿掉（标签回中点）⇒ 上面两条位置判据必须红。
  const pressedOnLine = live.replace(/const FLOW_LABEL_OFFSET = 8;/, 'const FLOW_LABEL_OFFSET = 0;');
  assert.notEqual(pressedOnLine, live, '变异没造出来 —— 这条判据会变成恒真');
  assert.ok(constNumber(pressedOnLine, 'FLOW_LABEL_OFFSET') !== canvasGap,
    '把标签偏移去掉（压回线上）之后判据仍判它一致 —— 这条网是恒真的');
});

// ── ③ 标签**没有白底框**、文字深色（画板 2026-10-06 去掉了 `.react-flow__edge-textbg`）──
test('★ 快照的线标签不再有白底框，且颜色与画板 `.flowEdgeLabel` 一致', () => {
  const { svg } = shot({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
      { id: 'b', position: { x: 0, y: 140 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是' }],
  });
  // 旧写法：`<rect … fill="#ffffff" stroke="#527198" …>` —— 那个白底框是「压线也读得清」的补偿，
  // 画板去掉它之后快照也必须去掉（留着一个白方块会盖住旁边的线/网格）。
  // ⚠️ 不能断言「整个 SVG 里没有 `#ffffff`」：画布底色本身就是 `#ffffff`（那是必须有的一块）。
  //    要抓的是那个**标签白底框**（白底 + 描边那一个组合）。
  assert.ok(
    !/<rect[^>]*fill="#ffffff"[^>]*stroke="#527198"/.test(svg),
    '快照还在画标签那个白底框（白底 + 描边）—— 画板已经去掉了',
  );
  // ⚠️ 不能断言「整个 SVG 里没有 `#527198`」：**节点形状**的描边就是它（本轮不许动形状）。
  //    要抓的是「有没有一个带描边的 `<rect>` 底框」——节点里只有 terminator / process 两种
  //    圆角矩形，而**它们的描边色也是 `#527198`** ⇒ 判据落在「标签那一句有没有再画 rect」上：
  //    标签那一句里不许出现 `<rect`。
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  const labelAt = live.indexOf('const anchor = vertical');
  assert.notEqual(labelAt, -1, '线标签那一句没找到 —— 先修这条判据');
  const labelBlock = live.slice(labelAt, labelAt + 700);
  assert.ok(!/<rect/.test(labelBlock), '线标签那一句又在画一个白底 `<rect>` 了（画板已去掉底框）');
  assert.ok(!/fill="#ffffff"/.test(labelBlock), '线标签那一句又用上了白底填充（`#ffffff`）');

  const canvasLabelRule = cssRuleBody(stripComments(fs.readFileSync(CANVAS_CSS, 'utf8')), '.flowEdgeLabel');
  const canvasFill = (canvasLabelRule.match(/fill:\s*(#[0-9a-fA-F]{3,8})/) ?? [])[1];
  assert.ok(canvasFill !== undefined, '画板 `.flowEdgeLabel` 里读不到文字颜色');
  const word = (svg.match(/<text[^>]*>是<\/text>/) ?? [])[0] ?? '';
  assert.ok(word.length > 0, '竖线上的标签没画出来');
  assert.ok(word.includes(`fill="${canvasFill}"`),
    `快照标签的颜色与画板 \`.flowEdgeLabel\`（${canvasFill}）不一致 —— 两边看到的字深浅不一样`);
});

// ── ④ 竖向基线：Safari 15 对 `dominant-baseline` 的支持不可靠 ───────────────────
test('★ 线标签不依赖 `dominant-baseline`（Safari 15 支持不佳），竖向基线用 `dy`（em）', () => {
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  /*
    🔴 老 iPad / Safari 15 上 `dominant-baseline` 的支持不可靠 ⇒ 快照里那颗标签的竖向位置
       不能靠它。竖向的基线用 `dy="0.35em"`（`em` 相对 `font-size` 一起缩放；与画板的 `dy` 同值），
       横向那一支靠 `y` 抬到线上方 —— 两处都不需要那条属性。
    ⚠️ 只钉**线标签那一句**，不动节点文字（那是另一件事、本轮不碰）。
  */
  const labelAt = live.indexOf('const anchor = vertical');
  assert.notEqual(labelAt, -1, '线标签那一句没找到 —— 先修这条判据');
  const labelBlock = live.slice(labelAt, labelAt + 700);
  assert.match(labelBlock, /dy="\$\{vertical \? '0\.35em' : '0'\}"/, '竖向基线没有用 `dy`（em 相对字号）表达');
  assert.ok(!/dominant-baseline/.test(labelBlock), '线标签又在用 `dominant-baseline` —— Safari 15 上竖向位置会不可靠');
});

