/**
 * 「一键整理」的**行为**判据（★ 2026-10-06 教师报的问题）。
 *
 * 🔴 教师原话：「『一键整理』会打乱我原有的结果，我的本意是简单的根据原有结构对对齐，
 *    连接线整理一下即可」。
 *
 * 所以这个函数的契约**不是**「排得好看」，而是**「别动我摆好的东西」**：
 *   · 只把**已经差不多在一条线上**的框吸齐 —— 不在一条线上的，一根手指都不许碰；
 *   · **不许**按连线的出入关系重新分层（那不是整理，那是重画）；
 *   · 连线只按两端**当前的相对位置**选句柄，不改拓扑。
 *
 * ⚠️ 这几条判据是**反着的**：它们钉的是「什么不许发生」。一条恒等的实现能过前两条，
 *    但过不了第三条与第四条 —— 所以四条要**一起**看，别只看第一条就以为网住了。
 * ⚠️ 全部用**自己造的节点**、不 import 组件（本仓没有 jsdom，`.tsx` 在纯 Node 下加载不了）；
 *    正因为算法在这个 `lib` 里是纯函数，这里才能写**真的**行为断言而不是读源码文本。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tidyFlowchart } from './worksheet-flowchart-layout.ts';

/** 判据用的最小节点 —— 形状与 React Flow 的 `Node` 在**用到的这几个字段上**一致。 */
interface TidyTestNode {
  id: string;
  position: { x: number; y: number };
  measured: { width: number; height: number };
  data: { kind: string; label: string };
}
interface TidyTestEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

const node = (id: string, x: number, y: number, kind = 'process'): TidyTestNode => ({
  id,
  position: { x, y },
  measured: { width: 150, height: 54 },
  data: { kind, label: id },
});
const edge = (source: string, target: string): TidyTestEdge => ({ id: `${source}-${target}`, source, target });

/** 纵向中心 —— 对齐看的是「中心齐不齐」，不是「左上角齐不齐」（判断框比处理框高）。 */
const centerY = (n: TidyTestNode) => n.position.y + n.measured.height / 2;
/** 横向中心。 */
const centerX = (n: TidyTestNode) => n.position.x + n.measured.width / 2;
const find = (ns: TidyTestNode[], id: string) => {
  const hit = ns.find((n) => n.id === id);
  assert.ok(hit, `整理后不该丢掉节点 ${id}`);
  return hit;
};

test('几乎在同一水平线上的框会被吸齐', () => {
  const nodes = [node('a', 100, 100), node('b', 400, 108)];
  const out = tidyFlowchart(nodes, []);
  assert.equal(
    centerY(find(out.nodes, 'a')),
    centerY(find(out.nodes, 'b')),
    '两个框只差 8px，是靠眼睛看得出「该齐没齐」的距离，必须吸到同一条线上',
  );
});

test('几乎在同一竖列上的框会被吸齐', () => {
  const nodes = [node('a', 100, 100), node('b', 108, 400)];
  const out = tidyFlowchart(nodes, []);
  assert.equal(
    centerX(find(out.nodes, 'a')),
    centerX(find(out.nodes, 'b')),
    '同上，横向的一对',
  );
});

test('原本就分开的两层不会被合并到一起', () => {
  const nodes = [node('a', 100, 100), node('b', 400, 300)];
  const out = tidyFlowchart(nodes, []);
  assert.equal(centerY(find(out.nodes, 'b')) - centerY(find(out.nodes, 'a')), 200, '间距 200 的两层，整理后间距还是 200');
});

test('原有的上下相对关系原样保留 —— 不按连线重新分层', () => {
  /*
    ★ 这条是**冲着旧实现**写的：旧 `layoutFlowchart` 按拓扑分层，`a → b` 会把 a 排到 b 上面，
      而画板上 a 明明在 b 的**右下**。教师说的「打乱我原有的结果」就是这个。
    🔴 判据只钉「相对关系不变」，不钉具体坐标 ⇒ 换个对齐算法也不会误红。
  */
  const nodes = [node('a', 400, 300), node('b', 100, 100)];
  const out = tidyFlowchart(nodes, [edge('a', 'b')]);
  assert.ok(
    centerY(find(out.nodes, 'a')) > centerY(find(out.nodes, 'b')),
    'a 原本在 b 下方，整理后 a 必须还在 b 下方 —— 让它翻上去就是「重新分层」，不是「整理」',
  );
});

test('连线按两端的相对位置选句柄', () => {
  const nodes = [node('a', 100, 100), node('b', 100, 300)];
  const out = tidyFlowchart(nodes, [edge('a', 'b')]);
  assert.equal(out.edges[0].sourceHandle, 'bottom', 'b 在 a 正下方 ⇒ 从 a 的底边出');
  assert.equal(out.edges[0].targetHandle, 'top', '⇒ 进 b 的顶边');
});

test('连线横向相接时改用左右句柄', () => {
  const nodes = [node('a', 100, 100), node('b', 400, 100)];
  const out = tidyFlowchart(nodes, [edge('a', 'b')]);
  assert.equal(out.edges[0].sourceHandle, 'right', 'b 在 a 正右方 ⇒ 从 a 的右边出');
  assert.equal(out.edges[0].targetHandle, 'left', '⇒ 进 b 的左边');
});

test('整理不动连线上学生自己调过的路由点', () => {
  const nodes = [node('a', 100, 100), node('b', 100, 300)];
  const routed = { ...edge('a', 'b'), data: { routeX: 42, routeY: 84 } };
  const out = tidyFlowchart(nodes, [routed]);
  assert.deepEqual(out.edges[0].data, { routeX: 42, routeY: 84 }, '路由点是学生手调的，整理不该把它清掉');
});
