/**
 * 撤销/重做的**接线**判据（★ 2026-10-06）。
 *
 * ⚠️ 本仓没有 jsdom ⇒ 组件里的行为只能用**源码级**判据（读文件文本 + 切片）。
 *    它挡的是「接线又断了一处」这类形态，挡不住时序问题 —— 时序只能靠真机。
 * ⚠️ 每条否定断言都配长度断言：切片切空了也会「全绿」，那是假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? source.slice(at) : source.slice(at, end);
}

/**
 * 变化检测那条 effect 的函数体。
 * ⚠️ 起点取 effect 的**第一个语句**（拖动守卫），**不能**取 `const sig = …` 那一行 ——
 * 它在守卫**之后**，那样切出来的片段看不见 `draggingRef`，判据必红（施工时实测踩到过一次）。
 */
const detectSource = (s: string) => blockBetween(s, 'if (draggingRef.current', '}, [nodes, edges])');

test('拖动中不压栈 —— 一次拖动必须只记一步', () => {
  const block = detectSource(SOURCE);
  assert.ok(block.length > 100, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.ok(/draggingRef\.current/.test(block), '拖动中要提前 return，否则每个 mousemove 都会压一步');
});

/*
  ★ 2026-10-06（**审查发现 I1 + I3a**）：这条判据原来只断言**两个 prop 名字出现在整个文件里**。
  审查实测：写成 `onNodeDragStop={disabled ? undefined : () => {}}`（**只留名字、不清标记**）
  它照样全绿 —— 而那正是「拖一次之后撤销永久失灵」的形态。

  🔴 根因：React Flow 有**两条路径结束拖动时不调用 `onNodeDragStop`** —— 多点触控的第二根手指、
  以及拖动中被删掉的那个节点（d3 的 end 处理器开头就是 `if (!dragStarted || abortDrag) return`）。
  靠回调置的标记会**永久卡在 true**，此后那条 effect 每次 `return`、`lastSigRef` 也不再更新 ⇒
  **整个会话不再记录任何新步骤**，撤销键变灰后再也不会亮起来。学生端就是 iPad，一只手拿机器、
  另一只手拖框时第二根手指落下是现实场景。
  ✅ 所以信号要**自愈**：改读节点上的 `dragging` 标记 —— 库在 `updateNodePositions(dragItems, false)`
  里会把它置回 false，**abort 路径也走这一句**。
*/
test('「正在拖节点」的信号要能自愈 —— 读 nodes 上的 dragging，不靠只置位不清位的回调', () => {
  const block = detectSource(SOURCE);
  assert.ok(block.length > 100, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.match(block, /nodes\.some\(/, '要读 nodes 上的 dragging（abort 路径下库会把它置回 false）');
  assert.match(block, /dragging/, '要认 dragging 这个字段');
});

/*
  ⚠️ 下面这三条测的是 Task 3 才写出来的 `undo` / 两颗按钮。
  第四条（「撤销后必须同步指纹」）原属 Task 2 的 brief，施工时挪到了这里 —— 原因见
  `.superpowers/sdd/…-plan/progress.md` 的 pre-flight 裁定：它引用 `const undo = `，
  而 `undo` 要到 Task 3 才存在，留在 Task 2 会让那个任务结束时必红。
*/
/*
  ★ 2026-10-06（**审查发现 I3b**）：下面两条原来**只对 `undo` 跑** —— 切片是从 `const undo = `
  到**第一个** `setHistoryVersion`，**根本到不了 `redo`**。审查实测：把 `redo` 里的同步三行整个删掉，
  判据照样全绿。而 redo 的指纹不同步与 undo 是**同一个**危险（那条 effect 会把「重做」当成一次新操作）。
  「与 undo 逐字对称」此前只是注释里的承诺，没有任何网 ⇒ 现在按**函数名**参数化、两个各跑一遍。
*/
const undoSource = (s: string) => blockBetween(s, 'const undo = ', 'setHistoryVersion');
const redoSource = (s: string) => blockBetween(s, 'const redo = ', 'setHistoryVersion');

for (const [label, pick] of [['撤销', undoSource], ['重做', redoSource]] as const) {
  test(`${label}后必须同步指纹 —— 否则那条 effect 会把它当成新操作（死循环）`, () => {
    const block = pick(SOURCE);
    assert.ok(block.length > 100, `${label}函数的切片太短（${block.length}）`);
    assert.match(block, /lastSigRef\.current\s*=/, `${label}后不同步 lastSigRef ⇒ 图会自己弹回去`);
  });

  test(`${label}会清掉选中态 —— 被撤掉的那个框不该还「选中着」`, () => {
    const block = pick(SOURCE);
    assert.ok(block.length > 100, `${label}函数的切片太短（${block.length}）`);
    assert.match(block, /setSelected\(null\)/, `${label}后选择态要清掉`);
    assert.match(block, /setLabelingEdge\(null\)/, `${label}后「正在改标注」也要清掉`);
  });

  /*
    ★ 2026-10-06（**审查留下的 M2**）：`setSelected(null)` 清的是**本组件那份单选槽位**，
    而节点上的 `selected` 是 **React Flow 自己的字段**（渲染成 `data-selected`）。
    快照里那个框当时若是选中的，撤销后它会带着蓝框渲染，而删除浮层与提示文字都没了 ——
    学生看到的是「一个亮着的框，但什么按钮都没有」。
    ⚠️ 只在 setNodes 时清，**不动快照本身**：快照记的是「当时的样子」，那是事实。
  */
  test(`${label}后要清掉节点上的 selected —— 否则留下「发光但没按钮」的框`, () => {
    const block = pick(SOURCE);
    assert.ok(block.length > 100, `${label}函数的切片太短（${block.length}）`);
    assert.match(block, /selected: false/, `${label}恢复节点时要一并清掉 React Flow 的 selected`);
  });
}

test('两颗按钮的禁用态跟着 canUndo / canRedo', () => {
  assert.match(SOURCE, /disabled=\{disabled \|\| !canUndo\(historyRef\.current\)\}/, '撤销按钮的禁用态不对');
  assert.match(SOURCE, /disabled=\{disabled \|\| !canRedo\(historyRef\.current\)\}/, '重做按钮的禁用态不对');
});

/*
  ★ 2026-10-06（审查发现 C2）：**拖「路径调整圆点」也必须只记一步**。
  那颗圆点是画布上的一层自定义浮层，它自己的 `move` 监听的是 **window 的 pointermove** ——
  不归 React Flow 的 `onNodeDragStart/Stop` 管。于是变化检测里那道 `draggingRef` 守卫**看不见它**，
  每个 pointermove 都满足「守卫为假 + 指纹变了（routeX/routeY 在指纹里）」⇒ **压一步**。
  一次 1 秒的拖动约 60–120 个事件 ⇒ 超过 `HISTORY_LIMIT=50`，`pushHistory` 会把**最老的那一头丢掉**，
  学生此前所有可撤销的步骤**不可恢复地消失**。
*/
test('拖「路径调整圆点」也只记一步 —— 它走画布外的浮层，不是 React Flow 的节点拖动', () => {
  const block = blockBetween(SOURCE, 'const moveSelectedEdgeRoute = ', '\n  };');
  assert.ok(block.length > 200, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.ok(block.length < 1500, `切片太长（${block.length}）—— 结束标记没找到、泄漏到文件末尾了`);
  assert.match(block, /draggingRef\.current = true/, '拖动开始要置位，否则每个 pointermove 都压一步');
  assert.match(block, /draggingRef\.current = false/, '拖动结束要清位，否则拖动标记卡死、撤销永久失灵');
});

test('快捷键在输入框里让位给浏览器原生撤销', () => {
  const block = blockBetween(SOURCE, 'const onKeyDown = (event: KeyboardEvent)', 'window.addEventListener');
  assert.ok(block.length > 100, `快捷键处理器的切片太短（${block.length}）`);
  assert.match(block, /INPUT/, '要认 INPUT');
  assert.match(block, /TEXTAREA/, '要认 TEXTAREA');
  assert.match(block, /isContentEditable/, '要认 contentEditable');
  // ★ 2026-10-06（审查发现 I3c）：**顺序**才是这条判据的实质 —— 只断言三个词「出现过」，
  // 把 `preventDefault()` 挪到守卫**之前**照样全绿，而那等于把浏览器原生撤销也一并挡掉了。
  const guard = block.indexOf('isContentEditable');
  const prevent = block.indexOf('preventDefault');
  assert.ok(guard > -1 && prevent > -1, '守卫或 preventDefault 不见了');
  assert.ok(guard < prevent, '先 preventDefault 再判输入框 ⇒ 输入框里的原生撤销也被挡掉了（顺序反了）');
});

/*
  ★ 2026-10-06（**审查发现 I2**）：快捷键必须**只作用于最后被碰过的那台画板**。
  监听挂在 `window` 上，而 `worksheet-panel.tsx` 会把同一个可见分组里的题**全部**渲染出来 ——
  一份学习单里若有两道流程图题，两个实例各挂一个 window 监听 ⇒ 按一次 `Cmd+Z`，
  **两道题各退一步**，并各自重新上报一份作答（`onChange` + 位图快照）。
  学生眼前的题看起来「没反应」，另一道（可能已经画好、也可能不在视口里）被静默改了一步 ——
  这类「改到别处」的错最难被发现。
  ✅ 判据收进本实例：`rootRef` 记根元素，window 上的 `pointerdown`（捕获相）记「最后被碰的是不是我」。
*/
/*
  ★ 2026-10-06（**审查留下的 M4**）：全屏画板**不许换渲染位置**。

  `drawing-tool-body.tsx` 原来在全屏时走 `createPortal(content, document.body)` —— 同一个 JSX 元素
  换个位置渲染，React 会**卸载再挂载**整棵子树 ⇒ 画板实例重建 ⇒ **撤销历史（住在 ref 里）归零**。
  学生画了半天、切一下全屏，撤销键就灰了，而且没有任何提示。

  ✅ 全屏本来就该由 CSS 负责：`.thirdPartyWorkspaceMaximized` 已经是 `position: fixed; inset: 0`
  （在「portal 到 body」的前提下那句其实是冗余的 —— 它的存在恰好说明当初的意图就是 CSS 全屏）。

  🔴 这条判据**证明不了**的事：`position: fixed` 在祖先链带 `transform` / `filter` / `will-change`
  时会退化成相对那个祖先，那种情况下全屏会坏。**必须真机确认一次。**
*/
test('全屏不许换渲染位置 —— 换位置会把整棵子树重挂、撤销历史归零', () => {
  // ⚠️ 宿主文件在**上一层**（`questions/`），不在 `drawing-surfaces/` —— 写错路径的表现是 ENOENT，
  //    而那条错误同样让判据「红」，很容易被误当成「变异命中」（施工时踩过：连着几次假红）。
  const HOST = fs.readFileSync(path.join(HERE, '..', 'drawing-tool-body.tsx'), 'utf8');
  assert.ok(HOST.length > 500, '宿主文件读空了');
  /*
    ⚠️ **必须只看代码行**：上面那段说明注释里就写着 `createPortal` 这个词 —— 直接对整个文件做正则，
    判据会被自己的注释绊倒（施工时实测：修好之后它仍然红）。剥注释在本仓有先例，但这里不需要那么重：
    本文件的注释都是独立行，按行首过滤即可。
  */
  const codeLines = HOST.split('\n').filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
  });
  assert.ok(codeLines.length > 10, `过滤后只剩 ${codeLines.length} 行代码，判据可能在空集上假绿`);
  assert.ok(
    !codeLines.some((line) => line.includes('createPortal')),
    '全屏切换不许用 portal 换位置（重挂子树 ⇒ 清空撤销历史）',
  );
  assert.match(HOST, /thirdPartyWorkspaceMaximized/, '全屏要靠 CSS 类，不靠换容器');
});

test('快捷键的作用域收在这台画板里 —— 多道流程图题不会一起撤销', () => {
  const block = blockBetween(SOURCE, 'const onKeyDown = (event: KeyboardEvent)', 'window.addEventListener');
  assert.ok(block.length > 100, `快捷键处理器的切片太短（${block.length}）`);
  assert.match(block, /lastTouchedRef\.current/, '要判定「这台画板是不是最后被碰过的那台」');
  assert.match(SOURCE, /rootRef/, '要有根元素 ref 供「碰的是不是我」判定');
});
