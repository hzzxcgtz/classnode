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
/* ★ 2026-10-07：标签「默认让开多少」用到的两个量 —— 与快照这两个常量**对拍**（见下面那条）。 */
import { FLOW_LABEL_CHAR, FLOW_LABEL_LINE } from './worksheet-flowchart-edge.ts';

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
  /*
   * ★ 2026-10-07（教师：「快照也一起修了吧」那一轮）：端点要落在**句柄方块的边**上，
   *   与库（`getEdgePosition` / `getHandlePosition`）和画板**同一个约定** —— 比节点边框再往外 6px。
   * 🔴 这里原来钉的是 `y1="84" y2="160"`（**边框上的点**）—— 那正是与画板差 6px 的那一版：
   *   快照里的线比画板上短 6px（两头各 6），而且绕行点的能走范围也差 6px。
   */
  assert.match(svg, /<line x1="140" y1="90" x2="140" y2="154"/, '连线没有按 handle（下→上）+ 端点约定落在句柄方块的外边上');
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
/**
 * 画板的**唯一真源**：交点样式在 CSS 里。
 * ⊘ 2026-10-06（「全回原版」）：这里原来还指过画板组件（`CANVAS_TSX`）—— 那是为了对「标签离线多远」
 *   （`EDGE_LABEL_GAP`）。标签交回库之后画板不再摆标签，那个常量与这条引用一起删了。
 */
const CANVAS_CSS = path.resolve(HERE, '../app/classroom/worksheet/worksheet.module.css');
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

/*
 * ⊘ 2026-10-06（教师：「全回原版」）：这里原有四个辅助函数 —— `canvasLabelEdgeBody` /
 *   `canvasLabelGap` / `canvasBiasesRight` / `canvasBiasesAbove`，它们是给「快照的标签摆法与
 *   画板一致」那条判据抠画板实现用的（`FlowLabelEdge` + `EDGE_LABEL_GAP`）。
 *   标签交回库之后画板不再摆标签，那条判据连同这四个函数一起删了。
 */

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
/*
  ⊘ 2026-10-06（教师：「**全回原版**」）：这里原有两条判据 ——
    · 「快照的线标签**摆法与画板一致**：竖线右侧（左对齐）/ 横线上方（居中）」；
    · 「快照的线标签**不再有白底框**，且颜色与画板 \`.flowEdgeLabel\` 一致」。
  两条都是配**我们自己**摆的标签写的（偏在线侧、不压线、无底框）。
  教师看过原版行为之后定了「全回原版」：标签交回库 ⇒ 库把字画在**路径中点**、**带白底框**
  \`（.react-flow__edge-textbg）\`，而 \`.flowEdgeLabel\` 那份样式已经删了。
  ⇒ 「摆法一致」那条没有对象了（画板不再摆标签），「无白底框」那条则要**反过来**。
  下面这条替代它们 —— **跨文件绑定仍然在**：快照必须跟着画板走，只是方向反了过来。
*/
test('★ 快照的线标签画在路径中点、带白底框 —— 与交回库之后的画板一致', () => {
  const { svg } = shot({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
      { id: 'b', position: { x: 0, y: 140 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是' }],
  });
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  const labelAt = live.indexOf('const bgWidth = Array.from(edge.label)');
  assert.notEqual(labelAt, -1, '线标签那一句没找到（改成什么写法了？）—— 先修这条判据');
  /*
   * ⚠️ 切片**切到标签那段代码结束**（下一个 `for (const node of nodes) parts.push(nodeShape(node))`），
   *    不写死字数：★ 2026-10-07 标签的偏移计算搬进来之后，700 字那个窗口当场就不够了
   *    （判据红在「标签没有居中」上 —— 而代码其实是对的）。
   */
  const labelEnd = live.indexOf('for (const node of nodes) parts.push(nodeShape(node))', labelAt);
  const labelBlock = live.slice(labelAt, labelEnd === -1 ? labelAt + 700 : labelEnd);
  assert.ok(labelBlock.length > 200, '切片太短 —— 别让它在空串上全绿');
  assert.match(labelBlock, /<rect/, '线标签没画白底框 —— 中点正好压在线段上，没有它字和线会叠在一起读不清');
  assert.match(labelBlock, /fill="#ffffff"/, '白底框的填充不是白色');
  assert.match(labelBlock, /text-anchor="middle"/, '标签没有居中 —— 库画在中点就是居中的');
  const word = (svg.match(/<text[^>]*>是<\/text>/) ?? [])[0] ?? '';
  assert.ok(word.length > 0, '竖线上的标签没画出来');
});

// ── ④ 竖向基线：Safari 15 对 `dominant-baseline` 的支持不可靠 ───────────────────
test('★ 线标签不依赖 `dominant-baseline`（Safari 15 支持不佳），竖向基线用 `dy`（em）', () => {
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  /*
    🔴 老 iPad / Safari 15 上 `dominant-baseline` 的支持不可靠 ⇒ 快照里那颗标签的竖向位置
       不能靠它。中点是**压在线段上**的，字要靠 `dy="0.35em"`（`em` 相对 `font-size` 一起缩放）
       抬到线的上方 —— 这条属性不需要。
    ⚠️ 只钉**线标签那一句**，不动节点文字（那是另一件事、本轮不碰）。
    ⚠️ 「全回原版」之后标签不再分「竖向 / 横向」两支（库在中点画，只这一种）
       ⇒ 这里也不再断言那个三元表达式的形状。
  */
  const labelAt = live.indexOf('const bgWidth = Array.from(edge.label)');
  assert.notEqual(labelAt, -1, '线标签那一句没找到（改成什么写法了？）—— 先修这条判据');
  /*
   * ⚠️ 切片**切到标签那段代码结束**（下一个 `for (const node of nodes) parts.push(nodeShape(node))`），
   *    不写死字数：★ 2026-10-07 标签的偏移计算搬进来之后，700 字那个窗口当场就不够了
   *    （判据红在「标签没有居中」上 —— 而代码其实是对的）。
   */
  const labelEnd = live.indexOf('for (const node of nodes) parts.push(nodeShape(node))', labelAt);
  const labelBlock = live.slice(labelAt, labelEnd === -1 ? labelAt + 700 : labelEnd);
  assert.ok(labelBlock.length > 200, '切片太短 —— 别让它在空串上全绿');
  assert.match(labelBlock, /dy="0\.35em"/, '标签的基线没有用 `dy`（em 相对字号）表达');
  assert.ok(!/dominant-baseline/.test(labelBlock), '线标签又在用 `dominant-baseline` —— Safari 15 上竖向位置会不可靠');
});


/* ══════════════════════════════════════════════════════════════════════════════
   ★ 2026-10-07（教师：「快照也一起修了吧」）：绕行点必须**与画板同一份规则**
   ══════════════════════════════════════════════════════════════════════════════ */
/*
  🔴 原来这里是 `Number.isFinite(edge.routeX) && Number.isFinite(edge.routeY)`：**两个轴都在**才认。
     而拖动**只写一个轴**（竖直的边只写 routeY）⇒ 学生拖过的线在快照里**一点都看不出来**
     —— 画板上是对的、报告里还是老样子，两边都不报错。
  ✅ 现在两处都走 `flowRoutePoint`（认自由轴、夹进范围、另一个轴补中点）。
  ⚠️ 判据是**行为**的：快照是纯函数，直接喂数据看它画成什么。端点按句柄方块的外边算（上 46 / 下 194）。
*/
const ROUTED = {
  nodes: [
    { id: 'a', position: { x: 0, y: 0 }, measured: { width: 100, height: 40 }, data: { label: '上', kind: 'process' } },
    { id: 'b', position: { x: 200, y: 200 }, measured: { width: 100, height: 40 }, data: { label: '下', kind: 'process' } },
  ],
  edges: [],
};
const routed = (routeY: number) => [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', data: { routeY } }];

test('★ 只写一个轴的绕行点也要画出来', () => {
  const { svg } = shot({ ...ROUTED, edges: routed(150) });
  assert.match(
    svg,
    /<path d="M 50 46 L 50 150 L 250 150 L 250 194"/,
    '绕行点没画出来 —— 或者端点又回到「节点边框上的点」了（那会与画板差 6px）',
  );
});

test('★ 快照也要把绕行点夹住（与画板同一个范围）', () => {
  const { svg } = shot({ ...ROUTED, edges: routed(9999) });
  assert.match(
    svg,
    /<path d="M 50 46 L 50 174 L 250 174 L 250 194"/,
    '越界的绕行点没被夹住 —— 教师那张图的「弧线折返」会在报告里重现，而画板上没有',
  );
});

/* ── ★ 2026-10-07：线上文字摆在线旁边（默认）／被拖过的位置 ─────────────────── */
test('★ 线上文字默认摆在那一段线的**旁边**（竖线右侧 / 横线顶部），不压线', () => {
  const { svg } = shot({ ...ROUTED, edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是' }] });
  /*
   * 这条边的中段是**横线**（bottom→top，中点在 y = (46+194)/2 = 120）⇒ 字摆在**上方**：
   *   120 − (17/2 + 4) = 107.5；白底框高 17 ⇒ 框顶 = 107.5 − 17 + 3 = 93.5。
   * ⚠️ 那几个数是从 `flowLabelOffset`（画板与快照共用）来的 —— 这里钉的是**快照真的照做了**。
   */
  assert.match(svg, /<text x="150" y="107\.5"/, '字没有摆到线的上方');
  assert.match(svg, /<rect x="140\.5" y="93\.5"/, '白底框没跟着一起挪（字和框会分家）');
  // 反面对照：没有文字的线不该凭空多出这个框。
  assert.ok(!/<rect x="140\.5" y="93\.5"/.test(shot({ ...ROUTED, edges: routed(150) }).svg), '没有文字的线也画了标签框');
});

test('★ 拖过的标签按拖到的位置画（快照与画板同一份偏移）', () => {
  const { svg } = shot({
    ...ROUTED,
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: '是', data: { labelDX: 40, labelDY: -60 } }],
  });
  // 中点是 (150, 120) ⇒ 拖到 (190, 60)。
  assert.match(svg, /<text x="190" y="60"/, '拖过的位置没有画出来（报告里还是老位置）');
});

/*
  ★ 2026-10-07（教师）：「如果是竖线，默认在右侧；如果是横线，默认在上方」。
  「让开多少」= **半个字宽 / 半行字** —— 这两个量必须与快照估文字尺寸用的那两个常量**同值**：
  各写一个数必然分叉，而分叉的表现是「默认位置在画板与报告里差几像素」这种**不报错**的错。
  ⚠️ 判据从**源码里现读**快照的常量（`constNumber`），不逐字写 17 / 13。
*/
test('★ 标签让开的距离用的「一行多高 / 一个字多宽」与快照那两个常量对拍', () => {
  const live = stripComments(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.equal(FLOW_LABEL_LINE, constNumber(live, 'LINE_HEIGHT'),
    '「一行多高」两边对不上 —— 标签默认位置在画板与报告里会差几像素（谁也不报错）');
  assert.equal(FLOW_LABEL_CHAR, constNumber(live, 'FONT_SIZE'),
    '「一个字多宽」两边对不上 —— 横线右侧的标签会让开得不一样多');
});
