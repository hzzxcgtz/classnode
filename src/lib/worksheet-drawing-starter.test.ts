/**
 * 底稿 ⇄ 学生作答的换算（纯函数）。教师那几条决定都在这几条用例里：
 * 「先拿流程图当试点」/「A 底稿不算学生的作答」/「B **初始图永远可改可删**」。
 *
 * ★ 2026-10-06（教师最终拍板，逐字）：「我觉得教师把初始图锁定也不对，这样学生端很多操作都无法
 *   进行了，我觉得还是不要锁定，因为学生端已经有恢复初始图功能了。」
 *   ⇒ 「锁定初始图」那一档**整个撤掉**：合并 / 恢复都只剥老数据里的锁标记、**一个都不打**，
 *     底稿的框/线永远可拖可删、文字可改；回退只靠「恢复初始图」（学生端那颗按钮无条件出现）。
 *   ⇒ 题目数据上的历史字段（`drawingStarterLocked`）**一律忽略**（不迁移、不写回、不报错）。
 *   ⚠️ 判据是**单档语义**，而且**不许判空**：这里既有「读出来的形状里没有 locked 这个键」，
 *      也有「真调一次合并 / 恢复 ⇒ 一个锁标记都找不到」——两条都能被变异测试打红。
 *   ⊘ 原来那一对「锁定 ⇒ 都带锁 / 未锁 ⇒ 一个标记都不许有」的双分支判据**整条换掉**，
 *     不是删空：单档语义的两条（读得出来 + 合并/恢复不打锁 + 老标记剥干净）一条不少。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as starterModule from './worksheet-drawing-starter.ts';
import {
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

test('阳性对照：读得出底稿、认得出「没有底稿」，且**不再回 locked**（旧字段一个字都不读）', () => {
  const starter = { tool: 'flowchart', data: { nodes: [node('a')], edges: [] } };
  const read = (data: Record<string, unknown>) => readDrawingStarter({ type: 'drawing', data });
  // ★ 「锁定初始图」撤掉之后，读出来的东西**只有 tool + data** 两个键（`locked` 这个键不存在）。
  assert.deepEqual(read({ drawingStarter: starter }), starter);
  assert.deepEqual(Object.keys(read({ drawingStarter: starter }) ?? {}), ['tool', 'data'],
    '`readDrawingStarter` 又往外吐多余的键了（旧字段被重新消费了？）');
  // 反面对照：认不出的形状一律当「没有底稿」，不抛。
  assert.equal(read({}), null);
  assert.equal(read({ drawingStarter: { tool: 'nope', data: {} } }), null);
  assert.equal(read({ drawingStarter: { tool: 'flowchart' } }), null);
  assert.equal(readDrawingStarter({ type: 'single-choice', data: { drawingStarter: starter } }), null);
});

test('★ 2026-10-06（教师最终拍板）：旧字段 `drawingStarterLocked` 一律忽略 —— 任何取值读出来都一样', () => {
  const data = { nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] };
  const read = (locked: unknown) => readDrawingStarter({
    type: 'drawing', data: { drawingStarter: { tool: 'flowchart', data }, drawingStarterLocked: locked },
  });
  // ① 读出来的形状**逐字**等于「不带那个字段」的那一份：`true` / `false` / 乱值 / 缺席，四种都一样。
  for (const value of [true, false, 'nope', undefined]) {
    assert.deepEqual(read(value), { tool: 'flowchart', data },
      `drawingStarterLocked=${String(value)} 时读出来的东西变了 —— 旧字段又被消费了`);
  }
  // ② 而且**真调一次**合并：不管题目上那个字段是什么值，合并出来的图都必须能拖、能删、文字能改。
  for (const value of [true, false, 'nope', undefined]) {
    const starter = read(value);
    assert.ok(starter, '读不出底稿 —— 先修这条用例');
    const graph = mergeFlowchart(readFlowchartPayload(starter.data), readFlowchartPayload({ nodes: [node('s1')], edges: [] }));
    for (const item of graph.nodes) {
      assert.equal(item.draggable, undefined, `drawingStarterLocked=${String(value)} 让底稿的框拖不动了（旧字段不该有任何效力）`);
      assert.equal(item.deletable, undefined, `drawingStarterLocked=${String(value)} 让底稿的框删不掉了`);
      assert.equal((item.data as Record<string, unknown>)?.locked, undefined, `drawingStarterLocked=${String(value)} 让底稿的文字只读了`);
    }
    assert.equal(pick(graph.edges, 'e1').deletable, undefined, `drawingStarterLocked=${String(value)} 让底稿的连线删不掉了`);
  }
  // ③ 「写回那个字段」的纯函数**必须不存在**（撤掉这一档之后它就是半套行为的凭据）。
  assert.ok(!('drawingStarterLockPatch' in starterModule),
    '`drawingStarterLockPatch` 又回来了 —— 「锁定初始图」那一档已经撤掉，这个写回函数不许再生出来');
  // ⚠️ 反面对照：字段名换一个也不该被认成底稿的一部分（读的是 `drawingStarter`，不是别的名字）。
  assert.equal(readDrawingStarter({ type: 'drawing', data: { drawingStarterUnlocked: data } }), null,
    '换了个字段名居然也能读出底稿 —— 这条判据变成恒真了');
});

test('★ 2026-10-06（教师最终拍板）：初始图永远可改可删 —— 合并 / 恢复都一个锁标记都不打', () => {
  const starter = readFlowchartPayload({ nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] });
  const mine = readFlowchartPayload({ nodes: [node('s1')], edges: [edge('s2', 's1', 't1')] });
  const graph = mergeFlowchart(starter, mine);
  // ① 合并的集合没变（底稿在前、学生那份在后，按 id 去重）。
  assert.deepEqual(graph.nodes.map((item) => item.id), ['t1', 't2', 's1']);
  assert.deepEqual(graph.edges.map((item) => item.id), ['e1', 's2']);
  // ② 底稿那两件、学生那件 —— **逐件**都不许出现任何锁标记（能拖 / 能删 / 文字能改）。
  for (const item of graph.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 又被锁住不能拖了（初始图永远可改）`);
    assert.equal(item.deletable, undefined, `${item.id} 又被锁住不能删了（初始图永远可删）`);
    assert.equal((item.data as Record<string, unknown>)?.locked, undefined, `${item.id} 的文字又变只读了`);
  }
  for (const item of graph.edges) {
    assert.equal(item.deletable, undefined, `${item.id} 这条线又被锁住不能删了`);
  }
  // ③ 「恢复初始图」同样不许打锁（两个入口的语义不许分叉）。
  const restored = restoreFlowchart(starter);
  assert.deepEqual(restored.nodes.map((item) => item.id), ['t1', 't2']);
  assert.deepEqual(restored.edges.map((item) => item.id), ['e1']);
  for (const item of restored.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 恢复之后又改不动了`);
    assert.equal(item.deletable, undefined, `${item.id} 恢复之后又删不掉了`);
    assert.equal((item.data as Record<string, unknown>)?.locked, undefined, `${item.id} 恢复之后文字又只读了`);
  }
  assert.equal(restored.edges[0].deletable, undefined, '恢复之后底稿的连线又删不掉了');
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
  assert.deepEqual(roundTrip.nodes.map((item) => item.id), ['s1'], '往返多出/少了节点');
  assert.deepEqual(roundTrip.edges.map((item) => item.id), ['e9'], '往返多出/少了边');
});

test('坏数据不许把画板弄崩：缺 nodes/edges、混进没有 id 的条目', () => {
  assert.deepEqual(readFlowchartPayload(null), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: 'x', edges: [1, 2] }), { nodes: [], edges: [] });
  assert.deepEqual(readFlowchartPayload({ nodes: [node('a'), { position: {} }, null] }).nodes.map((item) => item.id), ['a']);
});

test('★ 教师 2026-10-06：「初始图中有的东西我改不了」——老数据里的锁标记必须被剥掉（合并与恢复两条路）', () => {
  // 更早那一版把锁**写进了数据**：draggable / deletable / data.locked。
  const legacy = readFlowchartPayload({
    nodes: [
      { id: 't1', data: { label: '开始/结束', kind: 'terminator', locked: true }, draggable: false, deletable: false, position: { x: 0, y: 0 } },
      { id: 't2', data: { label: '过程', kind: 'process', locked: true }, draggable: false, deletable: false, position: { x: 0, y: 120 } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 't2', deletable: false }],
  });
  // ① 合并：老标记一个都不许剩（只改代码不改数据，表现就是「有的东西改不了」）。
  const merged = mergeFlowchart(legacy, readFlowchartPayload(null));
  for (const item of merged.nodes) {
    assert.equal(item.draggable, undefined, `${item.id} 还带着老数据的 draggable:false（拖不动）`);
    assert.equal(item.deletable, undefined, `${item.id} 还带着老数据的 deletable:false`);
    assert.equal((item.data as Record<string, unknown>).locked, undefined, `${item.id} 的文字还是只读（data.locked 没剥掉）`);
    // 别的字段不许被剥掉（只剥锁那三个）。
    assert.ok(typeof (item.data as Record<string, unknown>).label === 'string', `${item.id} 的 label 被剥没了`);
  }
  assert.equal(merged.edges[0].deletable, undefined, '边还带着老数据的 deletable:false');
  // ② 「恢复初始图」那条路同样要剥（否则恢复完又变回改不了）。
  for (const item of restoreFlowchart(legacy).nodes) {
    assert.equal(item.draggable, undefined, '恢复之后又拖不动了');
    assert.equal((item.data as Record<string, unknown>).locked, undefined, '恢复之后文字又变只读了');
    assert.ok(typeof (item.data as Record<string, unknown>).label === 'string', `${item.id} 的 label 被剥没了（恢复那一档也不能剥掉别的字段）`);
  }
  assert.equal(restoreFlowchart(legacy).edges[0].deletable, undefined, '恢复之后底稿的连线又删不掉了');
  // ③ 学生自己那份同样要剥（存量草稿里若混进过 data.locked，它会原样复发）。
  const mine = mergeFlowchart(readFlowchartPayload(null), readFlowchartPayload({
    nodes: [{ id: 's1', data: { label: '我的', kind: 'process', locked: true }, draggable: false, position: { x: 0, y: 0 } }],
    edges: [{ id: 'e9', source: 's1', target: 's1', deletable: false }],
  }));
  assert.equal(mine.nodes[0].draggable, undefined, '学生自己的框还带着老数据的 draggable:false');
  assert.equal((mine.nodes[0].data as Record<string, unknown>).locked, undefined, '学生自己的框文字还只读');
  assert.equal(mine.edges[0].deletable, undefined, '学生自己的线还带着老数据的 deletable:false');
});
