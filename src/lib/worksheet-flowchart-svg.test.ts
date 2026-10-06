/**
 * 流程图的位图快照：**形状对、文字转义、坏数据不抛**。
 *
 * ⚠️ 这里验不了「老 iPad 上栅格化出来是什么样」（没有浏览器），只能钉住**SVG 的内容**：
 *    形状是不是按 kind 分的、连线有没有箭头、文字有没有转义、坐标有没有落在 viewBox 里。
 *    真机走查仍在验收清单里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('★ 线上的字要画进快照（判断框的 Y / N 不能在报告里消失）', () => {
  const { svg } = shot({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 50 }, data: { label: '判断', kind: 'decision' } },
      { id: 'b', position: { x: 0, y: 140 }, measured: { width: 120, height: 50 }, data: { label: '处理', kind: 'process' } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: 'Y' }],
  });
  assert.match(svg, />Y<\/text>/, '线上的字没有画进快照');
  // 反面对照：没标注的线不该凭空多一个标签。
  const bare = shot({
    nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: '甲', kind: 'process' } }],
    edges: [],
  });
  assert.ok(!/<text[^>]*>Y<\/text>/.test(bare.svg));
});
