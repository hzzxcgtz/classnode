/**
 * 底稿 ⇄ 学生作答的换算（纯函数）。教师三条决定都在这几条用例里：
 * 「先拿流程图当试点」/「A 底稿不算学生的作答」/「B 学生不能改删底稿」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeFlowchart,
  readDrawingStarter,
  readFlowchartPayload,
  subtractFlowchart,
} from './worksheet-drawing-starter.ts';

const node = (id: string, label = id) => ({ id, type: 'flowNode', position: { x: 0, y: 0 }, data: { label } });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

test('阳性对照：读得出底稿，也认得出「没有底稿」（否则下面几条在空数据上永远绿）', () => {
  const starter = { tool: 'flowchart', data: { nodes: [node('a')], edges: [] } };
  assert.deepEqual(readDrawingStarter({ type: 'drawing', data: { drawingStarter: starter } }), starter);
  assert.equal(readDrawingStarter({ type: 'drawing', data: {} }), null);
  // 反面对照：认不出的形状一律当「没有底稿」，不抛。
  assert.equal(readDrawingStarter({ type: 'drawing', data: { drawingStarter: { tool: 'nope', data: {} } } }), null);
  assert.equal(readDrawingStarter({ type: 'drawing', data: { drawingStarter: { tool: 'flowchart' } } }), null);
  assert.equal(readDrawingStarter({ type: 'single-choice', data: { drawingStarter: starter } }), null);
});

test('B：合并之后底稿的节点/边被锁住，学生自己的不锁', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [] });
  const merged = mergeFlowchart(starter, mine);
  assert.deepEqual(merged.nodes.map((item) => item.id), ['t1', 't2', 's1'], '合并顺序/集合不对');
  for (const id of ['t1', 't2']) {
    const item = merged.nodes.find((entry) => entry.id === id)!;
    assert.equal(item.draggable, false, `${id} 还能拖动（B：学生不能改底稿）`);
    assert.equal((item.data as Record<string, unknown>).locked, true, `${id} 的文字还能改`);
    assert.equal(item.deletable, false, `${id} 还能删（B：学生不能删底稿）`);
  }
  const mineNode = merged.nodes.find((entry) => entry.id === 's1')!;
  assert.equal(mineNode.draggable, undefined, '学生自己的节点反而不许拖了');
  assert.equal(merged.edges.find((entry) => entry.id === 'e1')!.deletable, false, '底稿的边还能删（B）');
});

test('A：交上去的那份只留学生自己画的（按 id 剔除底稿）', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const all = readFlowchartPayload({
    nodes: [node('t1'), node('t2'), node('s1'), node('s2')],
    edges: [edge('e1', 't1', 't2'), edge('e2', 't2', 's1'), edge('e3', 's1', 's2')],
  });
  const mine = subtractFlowchart(all, starter);
  assert.deepEqual(mine.nodes.map((item) => item.id), ['s1', 's2']);
  assert.deepEqual(mine.edges.map((item) => item.id), ['e2', 'e3'], '底稿那条边也被算成学生的了');
});

test('往返：合并再剔除 ⇒ 回到学生自己那份（不多不少）', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1')], edges: [] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [edge('e9', 't1', 's1')] });
  const roundTrip = subtractFlowchart(mergeFlowchart(starter, mine), starter);
  assert.deepEqual(roundTrip.nodes.map((item) => item.id), ['s1']);
  assert.deepEqual(roundTrip.edges.map((item) => item.id), ['e9']);
});

test('坏数据不许把画板弄崩：缺 nodes/edges、混进没有 id 的条目', () => {
  assert.deepEqual(readFlowchartPayload(null), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: 'x', edges: [1, 2] }), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: [node('a'), { position: {} }, null] }).nodes.map((item) => item.id), ['a']);
});
