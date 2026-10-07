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
  /*
   * ★ M3（审查留下的）：**找不到结束标记就返回空串**，不许 `source.slice(at)` 泄漏到文件末尾。
   * 泄漏出来的切片是一大坨文本 —— 那些「长度 > N」的**下界**断言反而**更容易**通过，
   * 判据的精度于是**静默下降**（审查实测：给那条 effect 的依赖数组加一项、本该让判据变严，却仍全绿）。
   * 返回空串 ⇒ 下界断言当场红，问题暴露在现场、而不是三个月后。
   */
  return end === -1 ? '' : source.slice(at, end);
}

/*
  ★ M3（审查留下的）：切片**找不到结束标记**时不许静默泄漏到文件末尾。
  原来 `blockBetween` 在 `end === -1` 时返回 `source.slice(at)` —— 切片退化成「从起点到文件结束」，
  于是那些「长度 > N」的下界断言**反而更容易通过**（一大坨文本当然够长），判据的精度静默下降。
  审查实测：给那条 effect 的依赖数组加一项（本该让某条判据变严）之后，判据**仍然全绿**。
  ✅ 改成找不到就返回**空串** ⇒ 立刻被下界断言抓住，红在现场。
*/
test('切片找不到结束标记时返回空串 —— 不许静默泄漏到文件末尾把判据泡软', () => {
  assert.equal(blockBetween('aaa START bbb', 'START', 'NEVER-APPEARS'), '', '找不到结束标记 ⇒ 空串');
  assert.equal(blockBetween('aaa bbb', 'NOT-THERE', 'x'), '', '找不到起点 ⇒ 也是空串');
  // 阳性对照：正常情况必须真的切出来（否则上面两条对一个恒返回空串的实现也成立）。
  assert.equal(blockBetween('aaa START bbb END ccc', 'START', 'END'), 'START bbb ');
});

/**
 * 变化检测那条 effect 的函数体。
 * ⚠️ 起点取 effect 的**第一个语句**（拖动守卫），**不能**取 `const sig = …` 那一行 ——
 * 它在守卫**之后**，那样切出来的片段看不见 `draggingRef`，判据必红（施工时实测踩到过一次）。
 */
/*
 * ⚠️ 结束标记写 `}, [nodes, edges`（**不带右括号**）：那条 effect 的依赖数组加过东西
 * （`persistHistory`），写死 `[nodes, edges])` 就会找不到 —— 而 `blockBetween` 现在
 * 「找不到就返回空串」，于是两条判据当场红。这正是 M3 那个修复想要的效果：
 * **依赖数组一变，切片立刻失效并喊出来**，而不是静默泄漏到文件末尾把判据泡软。
 */
const detectSource = (s: string) => blockBetween(s, 'if (typingRef.current', '}, [nodes, edges');

test('拖动中不压栈 —— 一次拖动必须只记一步', () => {
  const block = detectSource(SOURCE);
  assert.ok(block.length > 100, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.ok(
    /typingRef\.current/.test(block),
    '打字期间要提前 return（工具条那颗「自定义」标注框每键写 store，不挡就一字一步）',
  );
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
  ★ 2026-10-07（教师第二次报障那一轮、施工时顺手发现的）：**拖控制柄**必须与拖节点同一个口径
  ——「一次拖动只记一步」。

  🔴 没有这条守卫时：拖动期间每个 `pointermove` 都写一次 `edges` ⇒ 指纹每次都变 ⇒ 那条 effect
     **每帧压一步**。50 步的撤销栈，拖一下（约 1 秒、60 帧）就**整个吃光**。
  🔴 这正是审查报过的 **C2**（当时那颗「路径调整圆点」就是这个毛病）。「全回原版」把它连同守卫
     一起删了；后来控制柄回来、**守卫却没回来** ⇒ 同一个坑又开了一次。
  ⚠️ 与节点那条**判据不同**：那条必须**自愈**（读库的 `dragging`，见上一条 —— 库有两条路径结束
     拖动时不回调）；这一条是**我们自己的** `pointerdown → pointerup/pointercancel` 配对，
     而且组件一卸载 ref 就没了 ⇒ 自己置位是安全的。
  🔴 但它有**自己的**坑：松手只把标记清掉**不会再触发任何 state 变化**，那条 effect 的依赖
     （`nodes`/`edges`）也没变 ⇒ 不主动催一次的话，这一拖**一步都不记**（撤销退不回去）。
     所以既要有 `dragEpoch` 去催，**又**要它在依赖数组里（否则催了也不重跑 —— 依赖数组就在
     切片里，那条 `assert.match(block, /dragEpoch/)` 同时管着这两件事）。
*/
test('拖控制柄期间不压栈，而且松手要主动催一次（否则这一拖一步都不记）', () => {
  const block = detectSource(SOURCE);
  assert.ok(block.length > 100, `切片太短（${block.length}），判据可能在空串上假绿`);
  assert.match(block, /routeDragRef\.current/, '拖控制柄期间没有提前 return —— 一次拖动会把整个撤销栈吃光（C2 重现）');
  /*
   * ⚠️ 「催」要**两件事都对**才成立：`dragEpoch` 得被 `setDragEpoch` 改（下面那段），
   *    而且得在**依赖数组**里 —— 否则催了 effect 也不会重跑。
   *    ⚠️ 依赖数组不在 `detectSource` 的切片里（那个结束标记就停在 `[nodes, edges` 之前）；
   *    也不能拿 `}, [nodes, edges` 去 `blockBetween` —— 文件里**前面还有一条**同样开头的
   *    依赖数组（落盘那条 effect），切出来的是它，判据会红在一个跟本判据无关的地方（施工时实测）。
   */
  assert.match(
    SOURCE,
    /\}, \[nodes, edges,[^\]]{0,80}dragEpoch\]/,
    '`dragEpoch` 不在变化检测那条 effect 的依赖数组里 —— 松手催了也不会重跑，这一拖照样一步不记',
  );
  const setter = blockBetween(SOURCE, 'const setRouteDragging = useCallback', '}, []);');
  assert.ok(setter.length > 100, `控制柄拖动起止那段没抠出来（${setter.length}）—— 先修这条判据`);
  assert.match(setter, /routeDragRef\.current = dragging/, '没有按拖动状态置位/清位');
  assert.match(setter, /if \(!dragging\) setDragEpoch\(/, '催的时机不对 —— 必须在**松手**那一下催；拖动中催等于每帧压一步');
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
  ⊘ 2026-10-06（教师：「全回原版」）：这里原有条判据「拖『路径调整圆点』也只记一步」
  —— 那颗圆点（连同它的处理器 `moveSelectedEdgeRoute` 和 `draggingRef`）已经**整段删除**了：
  边交回库内置的 `smoothstep`，绕行点这一层不存在了，也就没有「拖它要记几步」这回事。
  ⚠️ 那一整套是**审查发现 C2** 的产物（每个 pointermove 压一步、冲掉 50 步上限）——
  现在问题随功能一起消失，**不是**被压住了。若将来又把某颗自定义浮层加回来，
  这条判据要跟着回来（判据原文在 git 历史里：commit 315198b）。
*/

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
  ★ 2026-10-06（教师真机发现全屏坏掉之后）：**撤销历史必须能活过 portal 重挂**。

  全屏切 portal ⇒ React 卸载再挂载整棵子树 ⇒ 住在 `useRef` 里的历史归零。
  解法是把历史存到**模块级的表**里、按题目 id 索引（见 `worksheet-flowchart-history.ts` 的
  `loadHistory` / `saveHistory`）。

  ⚠️ 这条判据钉三件事，少任何一件「切全屏不丢撤销」都是空话：宿主**传了** key、
  画板**取**了它、画板**存**回去。
*/
test('撤销历史跨挂载存活：宿主传 key、画板取它、画板存回去', () => {
  const HOST = fs.readFileSync(path.join(HERE, '..', 'drawing-tool-body.tsx'), 'utf8');
  assert.match(HOST, /historyKey=\{node\.id\}/, '宿主要把题目 id 当 key 传下去');
  assert.match(SOURCE, /historyKey\s*\}/, '画板要从 props 里解构出 historyKey');
  assert.match(SOURCE, /loadHistory</, '画板初始化历史时要从表里取');
  assert.match(SOURCE, /saveHistory\(/, '画板要把历史存回表');
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
  ★ 2026-10-06（**教师在真机上发现，推翻了上一轮的做法**）：**portal 是必需的，去掉它反而坏事**。

  上一轮我为了「保住撤销历史」把 portal 去掉了。但那个代价更大：去掉之后全屏靠
  `.thirdPartyWorkspaceMaximized` 的 `position: fixed`，而 `fixed` 在有些祖先下会**退化成相对
  那个祖先**（`transform` / `filter` / `backdrop-filter` / `contain` / `will-change` 任一即可）。
  教师真机实测：**全屏后那层只覆盖题目卡那么大、根本没铺满**，还盖住了旁边的画板，
  看起来像「一层层递归进去」。

  🔴 我没能在 CSS 里定位到那个祖先（`worksheet` / `shell` / `globals` 三个文件都查过，其余
  `transform` 全是 `translateY(1px)` 这类小元素）—— 但 **portal 到 `document.body` 能绕开这一切**
  （body 之上没有祖先可以劫持它）。这大概就是当初写 portal 的真正理由。

  ✅ 结论：**portal 加回来**；「切全屏丢历史」改用「模块级的表 + 跨挂载稳定的 key」正面解决
  （见紧随其后的那条判据）。
  ⚠️ 判据只看**代码行**：本文件的说明注释里就写着 `createPortal`，直接对整个文件做正则会被
  自己的注释绊倒（上一轮实测踩到过）。
*/
test('全屏必须走 portal —— fixed 会被祖先劫持，portal 到 body 才绕得开', () => {
  // ⚠️ 宿主文件在**上一层**（`questions/`），不在 `drawing-surfaces/` —— 写错路径的表现是 ENOENT，
  //    而那条错误同样让判据「红」，很容易被误当成「变异命中」（施工时踩过：连着几次假红）。
  const HOST = fs.readFileSync(path.join(HERE, '..', 'drawing-tool-body.tsx'), 'utf8');
  assert.ok(HOST.length > 500, '宿主文件读空了');
  const codeLines = HOST.split('\n').filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
  });
  assert.ok(codeLines.length > 10, `过滤后只剩 ${codeLines.length} 行代码，判据可能在空集上假绿`);
  assert.ok(
    codeLines.some((line) => line.includes('createPortal(content, document.body)')),
    '全屏必须把画板 portal 到 body（见注释：去掉之后 fixed 会被祖先劫持、全屏铺不满）',
  );
});

test('快捷键的作用域收在这台画板里 —— 多道流程图题不会一起撤销', () => {
  const block = blockBetween(SOURCE, 'const onKeyDown = (event: KeyboardEvent)', 'window.addEventListener');
  assert.ok(block.length > 100, `快捷键处理器的切片太短（${block.length}）`);
  assert.match(block, /lastTouchedRef\.current/, '要判定「这台画板是不是最后被碰过的那台」');
  /*
    ★ M5（审查留下的）：`/rootRef/` 这种判据只要文件里**出现过这个词**就过 —— 声明了却忘了挂、
      或挂在别的元素上，它都照过。收紧成「有声明 **且** 挂到了根元素上」两问。
  */
  assert.match(SOURCE, /const rootRef = useRef/, '要有根元素 ref 的声明');
  assert.match(SOURCE, /ref=\{rootRef\}/, '而且要真的挂上去 —— 只声明不挂等于没做');
});

/*
  ★ M1（审查留下的）：工具条那颗「自定义」标注输入框原本**每敲一个键就压一步**。
  它是**受控**的（值来自 `edges.find`），`onChange` 直接写 `edges` ⇒ 指纹每键一变。
  受 `maxLength={12}` 与输入法事件数限制，最多十几步，不致命 —— 但它与**同一批**刚修好的节点文字
  （本地草稿 + 提交一次 = 一步）口径不一致，撤销时会看到字**一个一个字地退**。
  ⚠️ **不改成非受控**：那条注释说的理由是对的（受控才能在切换线、清空、撤销后回到正确内容）。
  改用同一套「先别记历史」的标记：聚焦置位、失焦清位。
*/
test('工具条「自定义」标注框打字期间不压栈 —— 否则一个字一步', () => {
  const block = blockBetween(SOURCE, 'aria-label="这条线上的自定义文字"', '/>');
  assert.ok(block.length > 50, `切片太短（${block.length}）`);
  /*
   * ⚠️ **别只断言「切片里出现过 `typingRef`」**：那个词在别处也有（声明、effect 的条件），
   * 于是在输入框上**根本没接线**的情况下判据照样全绿 —— 审查对 M5 说的就是这一族问题，
   * 而我在自己的 M1 判据上又犯了一次（变异实测：删掉 `onFocus` 那一行，那种写法不红）。
   * ⇒ 两头都钉死，一句一个字。
   */
  assert.match(block, /onFocus=\{\(\) => \{ typingRef\.current = true; \}\}/, '聚焦要置位（否则打字仍一字一步）');
  assert.match(block, /onBlur=\{\(\) => \{ typingRef\.current = false; \}\}/, '失焦要清位（否则此后一直不记历史）');
});
