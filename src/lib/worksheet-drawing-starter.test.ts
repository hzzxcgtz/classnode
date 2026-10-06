/**
 * 底稿 ⇄ 学生作答的换算（纯函数）。教师那几条决定都在这几条用例里：
 * 「先拿流程图当试点」/「A 底稿不算学生的作答」/「B **锁定初始图**（一题一个开关，默认锁）」。
 *
 * ★ 2026-10-06 第四版：B 从「学生不能改」→「学生可以随便改」→ **条件性**（开关说了算）。
 *   ⇒ 原来的单支判据（「合并之后不许有任何锁标记」）换成下面的**双分支**语义版：
 *     · 锁定   ⇒ 初始图的框/边**有**锁标记；
 *     · 未锁   ⇒ 一个标记都**不许**有（老数据里的那一版锁也要剥干净）。
 *   ⚠️ 两种情形**都要测**：只留下其中一支，另一支的 bug（「未锁也加锁」/「锁定不加锁」）
 *      就会静默溜过去 —— 这两条正是本轮变异测试命中的地方。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  drawingStarterLockPatch,
  mergeFlowchart,
  restoreFlowchart,
  readDrawingStarter,
  readFlowchartPayload,
  subtractFlowchart,
} from './worksheet-drawing-starter.ts';

const node = (id: string, label = id) => ({ id, type: 'flowNode', position: { x: 0, y: 0 }, data: { label } });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

/** 按 id 取一件（取不到就当场红 —— 不要用 `!` 把「没找到」静默掉）。 */
const pick = <T extends { id: string }>(items: T[], id: string): T => {
  const found = items.find((item) => item.id === id);
  assert.ok(found, `没找到 ${id}（这条用例的数据造错了）`);
  return found;
};

test('阳性对照：读得出底稿、认得出「没有底稿」，并读出「锁定初始图」（缺席 = 锁定）', () => {
  const starter = { tool: 'flowchart', data: { nodes: [node('a')], edges: [] } };
  const read = (data: Record<string, unknown>) => readDrawingStarter({ type: 'drawing', data });
  // ★ 没设过那个字段 ⇒ **锁定**（信息科技课的常态，教师不必手点）。
  assert.deepEqual(read({ drawingStarter: starter }), { ...starter, locked: true });
  assert.equal(read({ drawingStarter: starter })?.locked, true, '没设过的题必须当成「锁定初始图」');
  assert.equal(read({ drawingStarter: starter, drawingStarterLocked: true })?.locked, true);
  assert.equal(read({ drawingStarter: starter, drawingStarterLocked: 'nope' })?.locked, true, '乱值也只能当锁定');
  // 只有**显式 false**（教师主动取消锁定）才算未锁。
  assert.equal(read({ drawingStarter: starter, drawingStarterLocked: false })?.locked, false, '只有显式 false 才算未锁');
  // 反面对照：认不出的形状一律当「没有底稿」，不抛。
  assert.equal(read({}), null);
  assert.equal(read({ drawingStarter: { tool: 'nope', data: {} } }), null);
  assert.equal(read({ drawingStarter: { tool: 'flowchart' } }), null);
  assert.equal(readDrawingStarter({ type: 'single-choice', data: { drawingStarter: starter } }), null);
});

test('★ 锁定初始图（教师 2026-10-06）：锁定 ⇒ 老师的框/线都带锁；未锁 ⇒ 一个标记都不许有', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [edge('s2', 's1', 't1')] });

  // ── ① 未锁（教师把开关关掉）：一个标记都不许有 —— 学生可以随便改，回退靠「恢复初始图」 ──────
  const open = mergeFlowchart(starter, mine, false);
  assert.deepEqual(open.nodes.map((item) => item.id), ['t1', 't2', 's1']);
  for (const item of open.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 未锁时还被锁着不能拖（教师取消锁定后学生应当可以改底稿）`);
    assert.equal(item.deletable, undefined, `${item.id} 未锁时还被锁着不能删`);
    assert.equal((item.data as Record<string, unknown>)?.locked, undefined, `${item.id} 未锁时文字还是只读`);
  }
  assert.equal(pick(open.edges, 'e1').deletable, undefined, '未锁时老师的线还被锁着不能删');

  // ── ② 锁定（**默认档**）：初始图那一份带锁，学生自己那份一个标记都不带 ────────────────────
  const lockedGraph = mergeFlowchart(starter, mine, true);
  assert.deepEqual(lockedGraph.nodes.map((item) => item.id), ['t1', 't2', 's1'], '锁定不该改变节点集合');
  for (const id of ['t1', 't2']) {
    const item = pick(lockedGraph.nodes, id);
    assert.equal(item.draggable, false, `${id} 锁定后还能拖（老师的框学生不许动）`);
    assert.equal(item.deletable, false, `${id} 锁定后还能删`);
    assert.equal((item.data as Record<string, unknown>)?.locked, true, `${id} 锁定后文字还能改`);
  }
  assert.equal(pick(lockedGraph.edges, 'e1').deletable, false, '锁定后老师的线还能删');
  // ⚠️ 学生自己那份**两种情形下都不许被锁**（「老师的不可动、学生自己的可动」）。
  for (const graph of [open, lockedGraph]) {
    const studentNode = pick(graph.nodes, 's1');
    assert.equal(studentNode.draggable, undefined, '学生自己的框被锁住了');
    assert.equal((studentNode.data as Record<string, unknown>)?.locked, undefined, '学生自己的框文字被锁住了');
    assert.equal(pick(graph.edges, 's2').deletable, undefined, '学生自己的线被锁住了');
  }
});

test('「恢复初始图」：把画板内容退回教师给的那份（不管学生改了什么）', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const restored = restoreFlowchart(starter, false);
  assert.deepEqual(restored.nodes.map((item) => item.id), ['t1', 't2']);
  assert.deepEqual(restored.edges.map((item) => item.id), ['e1']);
  // 与合并结果同源，但**不带**学生后来加的东西。
  const merged = mergeFlowchart(starter, readFlowchartPayload({ nodes: [node('s9')], edges: [] }), false);
  assert.equal(merged.nodes.length, 3);
  assert.equal(restoreFlowchart(starter, false).nodes.length, 2);
  // 反面对照：恢复出来的是**副本**，改它不该动到底稿本身。
  restored.nodes.push(node('x'));
  assert.equal(starter.nodes.length, 2, '恢复时返回了同一份引用，改它会污染底稿');
  // ★ 恢复也要认那一档开关：未锁 ⇒ 恢复完必须是**能改**的；锁定 ⇒ 恢复出来的仍是老师的（带锁）那份。
  assert.equal(pick(restoreFlowchart(starter, false).nodes, 't1').draggable, undefined, '未锁时「恢复初始图」之后又改不动了');
  assert.equal(pick(restoreFlowchart(starter, true).nodes, 't1').draggable, false, '锁定时恢复出来的初始图没有锁');
});

test('★ 教师端「锁定初始图」开关写回题目什么：缺席 = 锁定，只有取消锁定时才写 false', () => {
  const data = { nodes: [node('t1')], edges: [] } as unknown as Record<string, unknown>;
  // ① 勾上（锁）⇒ 把字段**清掉**：题目上「缺席」就是锁定，不必再存一个 true。
  const on = drawingStarterLockPatch(true);
  assert.equal(on.drawingStarterLocked, undefined, '「锁定」不该往题目上写值 —— 语义是**缺席 = 锁定**');
  // ② 取消 ⇒ 明确写 `false`（这是唯一会被读成「未锁」的值）。
  const off = drawingStarterLockPatch(false);
  assert.deepEqual(off, { drawingStarterLocked: false }, '取消锁定没有写回 drawingStarterLocked: false（学生端读不出来）');
  // ③ 往返（这一条才是真正守**字段名 + 有没有写反**的）：把补丁原样合并进题目数据再读回来。
  const read = (patch: Record<string, unknown>) => readDrawingStarter({
    type: 'drawing', data: { drawingStarter: { tool: 'flowchart', data }, ...patch },
  });
  assert.equal(read(on)?.locked, true, '「锁定」那一档经过「写回 → 读回」之后变成了未锁（写反了？）');
  assert.equal(read(off)?.locked, false, '「取消锁定」那一档经过「写回 → 读回」之后还是锁的（字段名写错了？）');
  // ⚠️ 反面对照：字段名换一个（写错字段名的那种坏版本）⇒ 读回来必然还是锁的，上面那句就会红。
  assert.equal(
    readDrawingStarter({ type: 'drawing', data: { drawingStarter: { tool: 'flowchart', data }, drawingStarterUnlocked: false } })?.locked,
    true,
    '换了个字段名居然也能读成未锁 —— 这条往返判据变成恒真了',
  );
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

test('往返：合并再剔除 ⇒ 回到学生自己那份（不多不少，两档开关都一样）', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1')], edges: [] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [edge('e9', 't1', 's1')] });
  for (const locked of [true, false]) {
    const roundTrip = subtractFlowchart(mergeFlowchart(starter, mine, locked), starter);
    assert.deepEqual(roundTrip.nodes.map((item) => item.id), ['s1'], `locked=${locked} 时往返多出/少了节点`);
    assert.deepEqual(roundTrip.edges.map((item) => item.id), ['e9'], `locked=${locked} 时往返多出/少了边`);
  }
});

test('坏数据不许把画板弄崩：缺 nodes/edges、混进没有 id 的条目', () => {
  assert.deepEqual(readFlowchartPayload(null), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: 'x', edges: [1, 2] }), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: [node('a'), { position: {} }, null] }).nodes.map((item) => item.id), ['a']);
});

test('★ 教师 2026-10-06：「初始图中有的东西我改不了」——未锁时老数据里的锁必须被剥掉（锁定时才重新打上）', () => {
  // 上一版按 B 决定把锁**写进了数据**：draggable/deletable/data.locked。
  const legacy = readFlowchartPayload({
    nodes: [
      { id: 't1', data: { label: '开始/结束', kind: 'terminator', locked: true }, draggable: false, deletable: false, position: { x: 0, y: 0 } },
      { id: 't2', data: { label: '过程', kind: 'process', locked: true }, draggable: false, deletable: false, position: { x: 0, y: 120 } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 't2', deletable: false }],
  });
  // ① 未锁：老标记一个都不许剩（只改代码不改数据，表现就是「有的东西改不了」）。
  const open = mergeFlowchart(legacy, readFlowchartPayload(null), false);
  for (const item of open.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 还带着老数据的 draggable:false（拖不动）`);
    assert.equal(item.deletable, undefined, `${item.id} 还带着老数据的 deletable:false`);
    assert.equal((item.data as Record<string, unknown>).locked, undefined, `${item.id} 的文字还是只读（data.locked 没剥掉）`);
    // 别的字段不许被剥掉（只剥锁那三个）。
    assert.ok(typeof (item.data as Record<string, unknown>).label === 'string', `${item.id} 的 label 被剥没了`);
  }
  assert.equal(open.edges[0].deletable, undefined, '边还带着老数据的 deletable:false');
  // 「恢复初始图」那条路同样要剥（否则恢复完又变回改不了）。
  for (const item of restoreFlowchart(legacy, false).nodes) {
    assert.equal((item.data as Record<string, unknown>).locked, undefined, '恢复之后文字又变只读了');
  }
  // ② 锁定：不是「留着老数据的锁」，而是**先剥干净、再按开关统一打上**（两个来源不许打架）。
  const lockedGraph = mergeFlowchart(legacy, readFlowchartPayload(null), true);
  for (const item of lockedGraph.nodes) {
    assert.equal(item.draggable, false, `${item.id} 锁定后没有拖动锁`);
    assert.equal(item.deletable, false, `${item.id} 锁定后没有删除锁`);
    assert.equal((item.data as Record<string, unknown>).locked, true, `${item.id} 锁定后文字还能改`);
    assert.ok(typeof (item.data as Record<string, unknown>).label === 'string', `${item.id} 的 label 被剥没了（锁定那一档也不能剥掉别的字段）`);
  }
  assert.equal(lockedGraph.edges[0].deletable, false, '锁定后老师的线没有删除锁');
  // 反面对照：学生自己那条边没被误伤（无论哪一档）。
  const mine = mergeFlowchart(legacy, readFlowchartPayload({ nodes: [], edges: [{ id: 'e9', source: 't1', target: 't2' }] }), true);
  assert.equal(mine.edges.find((item) => item.id === 'e9')?.deletable, undefined, '学生自己的线被锁上了');
});
