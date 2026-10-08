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
  flowchartPreviewImage,
  mergeFlowchart,
  restoreFlowchart,
  blankStarterFor,
  mindMapOrStarter,
  readDrawingStarter,
  readMindMapPayload,
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
  // ★ 2026-10-07：题目的 `drawingTool` 必须与底稿的 `tool` 一致（见下面那条用例）。
  const read = (data: Record<string, unknown>) => readDrawingStarter({ type: 'drawing', data: { drawingTool: 'flowchart', ...data } });
  // ★ 「锁定初始图」撤掉之后，读出来的东西**只有 tool + data** 两个键（`locked` 这个键不存在）。
  assert.deepEqual(read({ drawingStarter: starter }), starter);
  assert.deepEqual(Object.keys(read({ drawingStarter: starter }) ?? {}), ['tool', 'data'],
    '`readDrawingStarter` 又往外吐多余的键了（旧字段被重新消费了？）');
  // 反面对照：认不出的形状一律当「没有底稿」，不抛。
  assert.equal(read({}), null);
  assert.equal(read({ drawingStarter: { tool: 'nope', data: {} } }), null);
  assert.equal(read({ drawingStarter: { tool: 'flowchart' } }), null);
  assert.equal(readDrawingStarter({ type: 'single-choice', data: { drawingStarter: starter } }), null);
  // ⚠️ 下面那条「串档」用例管的是另一半：画板与底稿不是同一档。
});

test('★ 2026-10-06（教师最终拍板）：旧字段 `drawingStarterLocked` 一律忽略 —— 任何取值读出来都一样', () => {
  const data = { nodes: [node('t1'), node('t2')], edges: [edge('e1', 't1', 't2')] };
  const read = (locked: unknown) => readDrawingStarter({
    type: 'drawing',
    data: { drawingTool: 'flowchart', drawingStarter: { tool: 'flowchart', data }, drawingStarterLocked: locked },
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

/*
  ★ 2026-10-07（教师两条，同一根因）：①「教师的**初始图还是没有一次性出来** —— 期望的是，
  如果教师有初始图，那么学生在真正画图之前，初始图已经出现在了监控面板里」；
  ②「刚开始显示的**菱形图形会显示成矩形**，刷新几次后才正常」。

  🔴 那两条都出在**教师看板在快照还没到时的兜底画法**上：它原来是自己一套「近似渲染」，
     只会画圆角矩形、而且**不含底稿**（底稿按设计不在学生交的那份数据里）。
  ✅ 现在兜底与快照**共用同一个渲染器**、输入是「底稿 + 学生画的」——
     下面这条用例验的就是它（**行为**判据：把 SVG 解出来看里面有什么）。
*/
test('★ 快照没到时的兜底：底稿要画出来、菱形要是菱形（教师 2026-10-07）', () => {
  const starter = {
    tool: 'flowchart',
    data: {
      nodes: [{ id: 's1', position: { x: 0, y: 0 }, measured: { width: 220, height: 110 }, data: { label: '判断条件', kind: 'decision' } }],
      edges: [],
    },
  };
  const decode = (src: string | null) => decodeURIComponent(String(src).split(',')[1] ?? '');
  const onlyStarter = decodeURIComponent(String(flowchartPreviewImage(starter, { nodes: [], edges: [] })).split(',')[1] ?? '');
  assert.ok(onlyStarter.includes('判断条件'), '底稿里的节点没画出来 —— 学生还没动笔时教师看到的是白纸（①）');
  assert.match(onlyStarter, /<polygon/, '菱形被画成了矩形（②）');

  const withMine = decode(flowchartPreviewImage(starter, {
    nodes: [{ id: 'm1', position: { x: 320, y: 0 }, measured: { width: 150, height: 54 }, data: { label: '我加的框', kind: 'process' } }],
    edges: [],
  }));
  assert.ok(withMine.includes('我加的框'), '学生自己画的那份也要合进来（底稿 + 他画的）');
  assert.ok(withMine.includes('判断条件'), '合上之后底稿仍然要在');
});

/*
  ★ 2026-10-07（审计抓到的「串档」）—— 与**服务端**同一条尺子：
  底稿的画板工具必须与**题目当前**的画板一致。
  🔴 为什么两边都要：服务端据此决定提示词要不要说「图里有教师的初始图」，
  而两边口径不一致时，一边说、一边不说 —— 那正是这个判据要防的
  （服务端那条用例的抬头写着「与前端 `readDrawingStarter` 同一把尺子」，那句话必须是真的）。
*/
test('🔴 底稿的画板必须与题目当前的画板一致（串档 ⇒ 学生端根本不显示它）', () => {
  const starter = { tool: 'flowchart', data: { nodes: [node('a')], edges: [] } };
  assert.deepEqual(
    readDrawingStarter({ type: 'drawing', data: { drawingTool: 'flowchart', drawingStarter: starter } }),
    starter, '工具一致 ⇒ 正常读出来（正常情形，别把这条也一起挡掉）',
  );
  assert.equal(
    readDrawingStarter({ type: 'drawing', data: { drawingTool: 'mind-map', drawingStarter: starter } }), null,
    '题目的画板是思维导图、底稿却是流程图的 —— 导图画板不接底稿，读出来只会让下游以为有底稿',
  );
  assert.equal(
    readDrawingStarter({ type: 'drawing', data: { drawingStarter: starter } }), null,
    '题目没写 drawingTool ⇒ 画布不是流程图 ⇒ 那份流程图底稿不会被显示',
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   ★ 2026-10-07（教师裁定）：思维导图的底稿**只作起点** —— 学生一旦动手，
   **整棵树都是他的作答**。（流程图那边不是这样：它是「写的时候按 id 把底稿剔掉」。）

   🔴 为什么两档必须不同：思维导图的底稿通常是一个**骨架**，而学生要做的恰恰是
   **往骨架里填**（改的正是教师那些节点的文字）⇒ 照搬流程图那套按 id 剔除，
   会把学生填的内容**连同骨架一起删掉**，交上去是空的。
   ⚠️ 于是「底稿不算学生的成果」这件事在这里**只靠提示词里那句话**承担
   （`analysis-agent.ts` 的 `DRAWING_STARTER_NOTE`，服务端按 `hasDrawingStarter` 决定发不发）。
   ══════════════════════════════════════════════════════════════════════════ */

const MINE = { nodeData: { id: 'm1', topic: '我填的' } };
const SKELETON = { nodeData: { id: 's1', topic: '教师给的骨架' } };

test('★ 有自己的作答 ⇒ 用他的（整棵树都算他的，不许被底稿盖掉）', () => {
  assert.deepEqual(mindMapOrStarter(MINE, SKELETON), MINE,
    '学生的作答被底稿盖掉了 —— 他填的东西会当场消失');
});

test('★ 还没有作答 ⇒ 底稿当起点', () => {
  assert.deepEqual(mindMapOrStarter(null, SKELETON), SKELETON);
  assert.deepEqual(mindMapOrStarter(undefined, SKELETON), SKELETON);
  assert.deepEqual(mindMapOrStarter({}, SKELETON), SKELETON, '空对象 = 没作答（不是「一份空的导图」）');
});

test('两个都没有 / 形状不对 ⇒ null（调用方给一张空导图，别在这儿编一个）', () => {
  assert.equal(mindMapOrStarter(null, null), null);
  assert.equal(mindMapOrStarter(null, { nope: 1 }), null, '形状不对的底稿不算底稿');
  assert.equal(readMindMapPayload({ nodeData: 'x' }), null, '`nodeData` 不是对象 ⇒ 读不出来');
  assert.deepEqual(readMindMapPayload(SKELETON), SKELETON);
});

/*
  ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）——
  打开那个开关时，**该给哪一档写什么形状的空底稿**。
  🔴 它是个**纯函数**、不是界面里的一段 if：写错的表现是「挂着一份别的画板的底稿」，
  而那种数据会让服务端对模型说一句假话（「图里有教师的初始图」），两边都不报错。
*/
test('★ 开关打开时按**当前画板**写空底稿（不是恒写流程图）', () => {
  assert.deepEqual(blankStarterFor('flowchart'), { tool: 'flowchart', data: { nodes: [], edges: [] } });
  const mind = blankStarterFor('mind-map');
  assert.equal(mind?.tool, 'mind-map', '思维导图那一档写了一份**流程图**的底稿 —— 那就是审计抓到的串档');
  assert.ok(
    mind && typeof (mind.data as Record<string, unknown>).nodeData === 'object',
    '空底稿缺 `nodeData` ⇒ 学生端读不出来，等于没底稿（而面板上开关是开着的）',
  );
  assert.equal(
    ((mind?.data as Record<string, unknown>).nodeData as Record<string, unknown>).topic, '中心主题',
    '给一张只有中心主题的图，学生从它开始长',
  );
});

test('★ 数学作图使用 elements 底稿；自由画仍不创建结构化底稿', () => {
  assert.deepEqual(blankStarterFor('math'), { tool: 'math', data: { elements: [] } });
  assert.equal(blankStarterFor('free'), null);
});
