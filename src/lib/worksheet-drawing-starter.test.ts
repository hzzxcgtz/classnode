/**
 * 底稿 ⇄ 学生作答的换算（纯函数）。教师三条决定都在这几条用例里：
 * 「先拿流程图当试点」/「A 底稿不算学生的作答」/「B 学生不能改删底稿」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeFlowchart,
  restoreFlowchart,
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

test('★ 学生可以改底稿（教师澄清 2 反转了原来的 B）：合并之后**不锁**任何东西', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [] });
  const merged = mergeFlowchart(starter, mine);
  assert.deepEqual(merged.nodes.map((item) => item.id), ['t1', 't2', 's1']);
  for (const item of merged.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 还被锁着不能拖（学生应当可以修改底稿）`);
    assert.equal(item.deletable, undefined, `${item.id} 还被锁着不能删`);
    assert.equal((item.data as Record<string, unknown>)?.locked, undefined, `${item.id} 的文字还是只读`);
  }
  assert.equal(merged.edges[0].deletable, undefined, '底稿的边还被锁着不能删');
});

test('「恢复初始图」：把画板内容退回教师给的那份（不管学生改了什么）', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const restored = restoreFlowchart(starter);
  assert.deepEqual(restored.nodes.map((item) => item.id), ['t1', 't2']);
  assert.deepEqual(restored.edges.map((item) => item.id), ['e1']);
  // 与合并结果同源，但**不带**学生后来加的东西。
  const merged = mergeFlowchart(starter, readFlowchartPayload({ nodes: [node('s9')], edges: [] }));
  assert.equal(merged.nodes.length, 3);
  assert.equal(restoreFlowchart(starter).nodes.length, 2);
  // 反面对照：恢复出来的是**副本**，改它不该动到底稿本身。
  restored.nodes.push(node('x'));
  assert.equal(starter.nodes.length, 2, '恢复时返回了同一份引用，改它会污染底稿');
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
