/**
 * 第三方画板挂载的**生命周期网**：effect 里 arm 的定时器，必须在清理里清掉。
 *
 * 教师报的错（原样，报告里引的就是这一段）：
 *
 *   Runtime TypeError
 *   Cannot read properties of undefined (reading 'offsetHeight')
 *   at MindmapDrawing.useEffect (src/app/classroom/worksheet/questions/drawing-surfaces/mindmap-drawing.tsx:58:38)
 *    58 |     window.setTimeout(() => instance.scaleFit(), 0);
 *
 * 两层成因，缺一不成：
 *   ① App Router 在 `next.config` 没写 `reactStrictMode` 时**默认开严格模式**
 *      （`next/dist/build/define-env.js`：`__NEXT_STRICT_MODE_APP` 那句注释就是
 *      「When next.config.js does not have reactStrictMode it's enabled by default」）
 *      ⇒ 开发模式下 effect 走 **挂载 → 卸载 → 再挂载**；
 *   ② `mind-elixir` 的 `destroy()` 把 `this.nodes` / `this.container` 全设成 `undefined`
 *      （`dist/MindElixir.js:2758` 逐字），而 `scaleFit()` 头一行就读
 *      `this.nodes.offsetHeight / this.container.offsetHeight`
 *      ⇒ 卸载时那颗 `setTimeout(…, 0)` 还在队列里，烧着的时候实例已经销毁了。
 *
 * ⚠️ 本仓没有 jsdom（也就没有「挂载两次看它炸不炸」这条路），这一条是**源码级**的网：
 *    它能挡的是「有人把 clearTimeout 那行删了 / 又写一颗没人管的定时器」，
 *    挡不住「定时器语义本身写错了」。真机行为只能靠 dev 里把四种画板逐个开一遍。
 * ⚠️ 所以**反面对照是必须的**：只断言「四个文件都过」的话，一条恒真的网也会过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 本目录下**会挂载第三方实例**的那四个画板（`types.ts` 只有类型，不读）。 */
const SURFACES = ['basic-drawing.tsx', 'math-drawing.tsx', 'mindmap-drawing.tsx', 'flowchart-drawing.tsx'];
/** 画板的样式表（流程图那三条批注里有两条是 CSS 层面的）。 */
const CSS = fs.readFileSync(path.resolve(HERE, '..', '..', 'worksheet.module.css'), 'utf8');

/**
 * ★ 2026-10-06（教师认可的第 1 步整理）：三套浮层合并成**一个选中模型 + 一处锚点解析 + 一处渲染**
 *   之后，判据要抠的几块结构。
 *
 * ⚠️ 这些只是**切片**（把一段代码取出来再按**语义**判），不是判据本身；切不出来时必须**如实报错**
 *    （下面每个用例都有一条长度断言），不许静默在空串上全绿 —— 假绿比红更坏。
 * ⚠️ 结束标记一律用**代码**：注释早被 `stripComments` 剥掉了，拿注释当标记会切出空串或切到文件末尾；
 *    而 `onConnect` 的结束标记用 useCallback 的 deps 那一行 ⇒ **不认变量名**，改个名不会误红。
 */
function blockAfter(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? source.slice(at) : source.slice(at, end);
}
/** `onConnect` 的函数体（到 useCallback 的 deps 那一行为止）。 */
const onConnectSource = (source: string) => blockAfter(source, 'const onConnect = useCallback', '\n  }, [');
/** ★ 第 1 步整理后的**唯一**浮层描述式：`const overlay = (() => { … })();`。 */
const overlaySource = (source: string) => blockAfter(source, 'const overlay = ', '})();');
/** 「一处锚点解析」：`const selectedAnchor = (() => { … })();`。 */
const selectedAnchorSource = (source: string) => blockAfter(source, 'const selectedAnchor = ', '})();');
/**
 * ★ 2026-10-06：**拆线那一份实现**（`const splitEdgeAt = useCallback(`）的函数体 —— 到 deps 那一行为止。
 * ⚠️ 结束标记用**代码**（`\n  }, [`）：这是本文件惯用的写法，注释早被 `stripComments` 剥掉了。
 */
const splitEdgeSource = (source: string) => blockAfter(source, 'const splitEdgeAt = useCallback(', '\n  }, [');
/** 落点吸附：`const onConnectEnd = useCallback(` 的函数体。 */
const onConnectEndSource = (source: string) => blockAfter(source, 'const onConnectEnd = useCallback(', '\n  }, [');
/**
 * ★ 2026-10-06：「离最近那条边」的距离算法 —— `const nearestEdgeAt = useCallback(` 的函数体。
 * 🔴 这一份是**吸附**与**拖动中高亮**共用的（两份必然分叉，而分叉的表现是「高亮的是 A、
 *    真吸上去的是 B」，屏幕上不报错）⇒ 它自己必须能被单独抠出来判。
 */
const nearestEdgeSource = (source: string) => blockAfter(source, 'const nearestEdgeAt = useCallback(', '\n  }, [');
/**
 * 拖动中高亮那一份 effect 的函数体（从 `const track = (event:` 到 deps 那一行）。
 * ⚠️ 结束标记用**代码**（`}, [connecting`）：注释早被 `stripComments` 剥掉了。
 */
const highlightEffectSource = (source: string) => blockAfter(source, 'const track = (event:', '}, [connecting');
/**
 * ★ 2026-10-06：`FlowNodeEditor` 的函数体。
 * 🔴 结束标记原来写的是 `const edgeHandleNodeId` —— 那个常量随**自定义边**一起删掉了，
 *    标记变成 -1，而 `slice(x, -1)` **不会报错**：它会从 FlowNodeEditor 一路切到文件末尾。
 *    于是「节点里的输入框不许挂 nodrag」那条判据当场变成**恒真**（实测：改了源码它照样绿）。
 *    ⇒ 换成还活着的顶层常量，并且切不出来时**返回空串**让用例自己报错。
 * ⚠️ 2026-10-07：那之后 `FLOAT_SIZE` 也删了（教师把删除按钮挪到左上角顶点之后，`NODE_FLOAT_GAP`
 *    与它一起没了对象）⇒ 结束标记再换一次，这次用 `const EDGE_FLOAT_BACK = `（它还在）。
 *    🔴 **教训**：结束标记**不能挑一个「可能被删掉」的常量** —— 每删一次就要改一次，
 *    而漏改的表现是「静默切到文件末尾、判据变恒真」（这个坑已经踩过两回）。
 */
const editorBodyOf = (source: string): string => {
  const at = source.indexOf('function FlowNodeEditor');
  const end = at === -1 ? -1 : source.indexOf('const EDGE_FLOAT_BACK = ', at);
  return at === -1 || end === -1 ? '' : source.slice(at, end);
};
/**
 * ★ 2026-10-06：「拆线」还有**几份实现** / 被调用了几次。
 * ⚠️ 原来这里数的是**调用点**、要求 ≥ 2 —— 那是在数「精确命中 + 吸附松手两条入口」，
 *    而自定义边删掉之后只剩吸附那一条入口了。「**只有一份实现**、而且吸附那一路走它」
 *    才是真正要守的东西（两份实现必然分叉）。
 */
const splitterCalls = (source: string) => (source.match(/splitEdgeAt\(/g) ?? []).length;
const splitterDecls = (source: string) => (source.match(/const splitEdgeAt = useCallback\(/g) ?? []).length;
/** 唯一的删除出口：`const removeSelected = () => { … };`（切到下一个顶层 `const` 为止）。 */
const removeSelectedSource = (source: string) => blockAfter(source, 'const removeSelected = ', '\n  const ');

/**
 * ★ 2026-10-06（教师最终拍板）：「恢复初始图」那颗按钮 —— 它的**出现条件**必须只认
 * 「这一题有没有初始图」，**不许**再出现任何锁标记（教师：「还是不要锁定，因为学生端已经有
 * 恢复初始图功能了」）。把闸整个拿掉、或者又加回 `!starterLocked` / `starter.locked`，都必须判红。
 * ⚠️ 判据不逐字钉写法：从「恢复初始图」那几个字**往前**找到最近的一句 `{starter…` 门（`&&` / `?`
 *    都认），再看这一段里有没有 `locked` 这样的词。
 */
const restoreShownWheneverStarter = (source: string): boolean => {
  const at = source.indexOf('恢复初始图');
  if (at === -1) return false;
  const before = source.slice(Math.max(0, at - 500), at);
  const gateAt = before.lastIndexOf('{starter');
  if (gateAt === -1) return false;
  return !/[Ll]ocked/.test(before.slice(gateAt));
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 抠出每个 `useEffect(...)` 的**函数体**。
 *
 * ⚠️ 判据是「到下一个 `}, [` 为止」——本目录四个文件的 deps 数组都写成这个形状
 *    （`}, []);` / `}, [nodes, edges, onChange]);`）。解析不住就**如实报错**，
 *    不静默退回空数组：那样四条断言会在空集上全绿（假绿比红更坏）。
 */
function effectBodies(source: string): string[] {
  const text = stripComments(source);
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('useEffect(', from);
    if (start === -1) break;
    const end = text.indexOf('}, [', start);
    assert.notEqual(end, -1, '这个 effect 没有本文件惯用的 `}, [` 结尾 —— 先修解析，别让它静默漏掉一个 effect');
    out.push(text.slice(start, end));
    from = end + 1;
  }
  return out;
}

/**
 * 这个 effect 体里 arm 了什么**却没人收**？
 *
 * 三条同源的纪律（都是「销毁之后还会有人来碰它」这一族）：
 *   · 定时器  `setTimeout(`   ⇒ 清理里要有 `clearTimeout(`
 *   · 帧回调  `requestAnimationFrame(` ⇒ 清理里要有 `cancelAnimationFrame(`
 *   · 观察者  `new ResizeObserver(` ⇒ 清理里要有 `.disconnect(`
 */
function uncleanedArms(body: string): string[] {
  const missing: string[] = [];
  if (body.includes('setTimeout(') && !body.includes('clearTimeout(')) missing.push('setTimeout');
  if (body.includes('requestAnimationFrame(') && !body.includes('cancelAnimationFrame(')) missing.push('requestAnimationFrame');
  if (body.includes('new ResizeObserver(') && !body.includes('.disconnect(')) missing.push('ResizeObserver');
  return missing;
}

test('阳性对照：四个画板都读到了，effect 也解析出来了（否则下面几条在空集上永远绿）', () => {
  for (const name of SURFACES) {
    const source = fs.readFileSync(path.join(HERE, name), 'utf8');
    assert.ok(stripComments(source).length > 800, `${name} 剥完注释只剩一点点，路径或文件不对`);
    assert.ok(effectBodies(source).length >= 1, `${name} 一个 effect 都没解析出来`);
  }
});

test('🔴 effect 里 arm 的定时器 / 帧回调 / 观察者都必须在清理里收掉（教师那个 offsetHeight 报错就是它）', () => {
  const offenders: string[] = [];
  let armedInEffects = 0;
  for (const name of SURFACES) {
    const bodies = effectBodies(fs.readFileSync(path.join(HERE, name), 'utf8'));
    bodies.forEach((body, index) => {
      if (body.includes('setTimeout(') || body.includes('requestAnimationFrame(') || body.includes('new ResizeObserver(')) {
        armedInEffects += 1;
      }
      const missing = uncleanedArms(body);
      if (missing.length > 0) offenders.push(`${name} 第 ${index + 1} 个 effect（${missing.join('/')} 没收）`);
    });
  }
  assert.deepEqual(offenders, [], `这些 effect 里的定时器没人清：${offenders.join('、')}`);
  // 🔴 这一条同时是「网不是恒真」的保证：真有几个 effect arm 了定时器，
  //    上面那句 empty 才有意义（一个都没有 ⇒ 它天然为真）。
  assert.ok(armedInEffects >= 2, `effect 里 arm 的东西只剩 ${armedInEffects} 处 —— 网快变成恒真的了，去看一眼`);
});

test('🔴 反面对照：这条判据本身能红（不然它只是装饰）', () => {
  // 教师报错那一行的形状：arm 了、没清 ⇒ 必须判违规。
  assert.deepEqual(uncleanedArms('useEffect(() => { window.setTimeout(() => instance.scaleFit(), 0); return () => { instance.destroy(); }; }'), ['setTimeout']);
  // 修好之后的形状 ⇒ 必须放过（清掉的定时器是**修好了**，不是违规）。
  assert.deepEqual(uncleanedArms('useEffect(() => { const fitTimer = window.setTimeout(fit, 0); return () => { window.clearTimeout(fitTimer); }; }'), []);
  // 帧回调与观察者同一条纪律。
  assert.deepEqual(uncleanedArms('useEffect(() => { const id = window.requestAnimationFrame(fit); return () => {}; })'), ['requestAnimationFrame']);
  assert.deepEqual(uncleanedArms('useEffect(() => { const o = new ResizeObserver(fit); o.observe(el); return () => {}; })'), ['ResizeObserver']);
  // 没 arm 东西的 effect 与这条判据无关。
  assert.deepEqual(uncleanedArms('useEffect(() => { board.addEventListener("up", tick); return () => board.removeEventListener("up", tick); })'), []);
});

test('🔴 思维导图那一处：量出尺寸之前不许「适应画布」（教师报的空白画布就是它）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'mindmap-drawing.tsx'), 'utf8'));
  // 🔴 判据的核心：**先问尺寸，再动 transform**。`toCenter()`/`scaleFit()` 读的是容器尺寸，
  //    容器量出来是 0 时它们算出的位移会把整张图推出可视区（而外层是 overflow:hidden）。
  assert.match(live, /getBoundingClientRect\(\)/, '没有量容器尺寸就动手 —— 空白画布就是这么来的');
  assert.match(live, /box\.width < 40 \|\| box\.height < 40/, '没有「太小就先不画」的那道闸');
  assert.match(live, /new ResizeObserver\(/, '没有盯着容器尺寸 —— 首帧量不出来就永远量不出来');
  assert.match(live, /observer\?\.disconnect\(\)/, 'ResizeObserver 没有 disconnect（卸载后还会回调）');
  assert.match(live, /window\.cancelAnimationFrame\(rafId\)/, 'rAF 没有取消（那条纪律与定时器同源）');
  // ⚠️ 库自带工具条里**没有**「加节点」⇒ 这一颗必须我们自己给，否则学生按遍工具栏都没反应。
  // ★ 2026-10-06 第二轮（教师）：「这两个不要了」⇒ 「添加子主题 / 添加同级主题」两颗删掉了，
  //   加节点回到**库自己的长按菜单**。判据因此是这三条：
  //   ① 我们**不再**自己画加节点按钮（不许悄悄加回来 —— 那是「用它的 UI」这条原则的落点）；
  assert.ok(!/addChild\(/.test(live), '又自己画了「添加子主题」——加节点应当走库自带的长按菜单');
  //   ② 但**建完图选中根节点**必须留着：库的键盘路径（Tab/Enter）与「当前选中」那套都吃它，
  //      而且它是当初「按了没反应」那个病的另一半解药；
  assert.match(live, /instance\.selectNode\(rootElement\)/, '建完图没有选中根节点 —— 库的增删都吃「当前选中」');
  //   ③ 提示语必须还在（学生靠它知道「长按节点」这条入口）。
  assert.match(live, /长按节点打开菜单/, '工具条下方那行提示没了 —— 学生不知道去哪加节点');
  assert.match(live, /toolBar: true/, '库自带的工具条被关掉了（视图操作应当用它的）');
  assert.match(live, /contextMenu: \{ locale: zhCN \}/, '长按菜单没有开或没给中文包');
  // 🔴 2026-10-06：`overflowHidden: true` 会让库**跳过整套指针交互层**（无头 Chrome 逐项二分
  //   实测：加上它之后容器上只剩 keydown/copy/cut/paste，节点点不中、也改不了文字）。
  //   裁剪由外层 `.thirdPartyCanvas` 的 `overflow: hidden` 负责，不需要这个选项。
  assert.ok(!/overflowHidden/.test(live), '又传了 overflowHidden —— 它会让整个画布点不动（实测）');
  assert.match(live, /toolBar: true/, '库自带的工具条被关掉了');

});

test('🔴 流程图三问（2026-10-06）：看图柄、箭头、判断框', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // ① 「每个图形的操作柄为什么一直显示？」⇒ 默认隐形，悬停/选中才显形。
  const handle = css.slice(css.indexOf('.flowNode :global(.react-flow__handle)'), css.indexOf('.flowNode :global(.react-flow__handle)') + 700);
  assert.match(handle, /opacity: 0/, '操作柄默认没有隐形');
  assert.match(handle, /:\s*hover\s+:global\(\.react-flow__handle\)/, '悬停时不显形');
  // 🔴 但触屏必须留一档：iPad 没有 hover，全隐形 = 没法连线。
  assert.match(css, /@media \(hover: none\)/, '没有给触屏留「一直半透明」那一档 —— iPad 上连不了线');
  // ② 「连接线默认没箭头的吗？」⇒ 每条边都要补箭头，**存量作答也算**。
  assert.match(live, /markerEnd/, '边没有箭头');
  assert.match(live, /edges\.map\(\(edge\) => \(edge\.markerEnd \? edge : \{ \.\.\.edge, markerEnd: FLOW_ARROW \}\)\)/, '箭头只补了新连的线（老作答一打开还是没箭头）');
  assert.match(live, /edges=\{visibleEdges\}/, 'ReactFlow 用的还是没补箭头的 edges');
  // ③ 「判断框怎么这个形状？」⇒ 不再是旋转 45° 的方块，改成画出来的菱形。
  assert.ok(!/rotate\(45deg\)/.test(css), '判断框还是旋转 45° 的方块');
  assert.match(live, /flowNodeShape/, '判断框没有那块 SVG 菱形');
  // ④ 「菱形内部怎么加文字？」——那一块 SVG 是绝对定位，会盖住静态的输入框 ⇒
  //    输入框必须抬到它上面（`position: relative; z-index: 1`），否则菱形是空的。
  assert.match(css, /\.flowNode input \{ position: relative; z-index: 1; \}/, '菱形里的输入框没有抬到 SVG 之上（文字会被白底盖住）');
});

test('★ 2026-10-06（教师）：判断框出来的两条线带上默认标注，线上可以写字，且字要活下来', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const svg = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-flowchart-svg.ts'), 'utf8'));
  // ① 判断框的出边自动带默认标注（其它节点不自动给字 —— 每条线都塞字是噪音）。
  //    ★ 2026-10-06（教师拍板）：默认值从 `Y / N` 换成「是 / 否」—— 数值行为由下面那条
  //    「是 / 否」的用例**真调用**验；这里只钉「判断框那一支确实把计数交给它了」。
  assert.match(live, /source\?\.data\.kind === 'decision'/, '没有「从判断框出来」这条判据');
  assert.match(live, /decisionBranchLabel\(used\)/, '判断框的出边没有走那个默认标注的映射（或计数没有交给它）');
  // ② 交出去的数据必须带上 label（漏了它 = 线上写的字一刷新就没了，而屏幕上不报错）。
  assert.match(live, /\.\.\.\(label \? \{ label \} : \{\}\)/, 'toFlowPayload 把线上的字丢了');
  // ③ 线上能写字：点线之后工具条出现 Y / N / 是 / 否 / 清空。
  assert.match(live, /onEdgeClick=/, '点线没有反应 —— 学生没法给线标注');
  assert.match(live, /\['Y', 'N', '是', '否'\]\.map/, '线标注那一组按钮不见了');
  // ★ 2026-10-06（教师）：「加上去的字变成了小黑块」——根因是只引了 `base.css`（没有颜色），
  //   边的标签拿不到 `fill` ⇒ SVG 默认黑填充。两条判据：① 引带主题的那份样式表；
  //   ② 我们自己的 CSS 再把标签颜色钉一遍（换主题也不会变成读不出来的颜色）。
  /*
   * ★ 2026-10-06（教师：「**全回原版**」）：这里原来钉的是「`.flowEdgeLabel` 的 fill 是深色」
   *   +「**不许**有 `.react-flow__edge-textbg`（白底框）」—— 那是给**我们自己**摆的标签配的
   *   （偏在线侧、不压线，所以用不着白底框）。
   *   标签交回库之后，配色与白底框都由库那条样式管 ⇒ 反过来钉「这两样都不该再由我们管」。
   * ⚠️ 上面那两条**仍然必须**：库那份带主题的 `style.css` 一定要引 —— 只引 `base.css` 的话
   *   SVG 标签拿不到 `fill`，会渲染成**黑块**（教师报过的原话：「加上去的字变成了小黑块」）。
   */
  const flowCss = stripComments(CSS);
  assert.ok(!/\.flowEdgeLabel/.test(flowCss), '`.flowEdgeLabel` 还留着 —— 标签已交回库，这份样式没人用了');
  // 老师问「可不可以用户加自定义的字？」⇒ 那一组里必须有一个自由输入框（受控）。
  assert.match(live, /aria-label="这条线上的自定义文字"/, '没有自定义文字输入框');
  assert.match(live, /value=\{editingLabel\}/, '输入框不是受控的（切走线会残留上一条的字）');
  // ④ 快照（教师预览 / AI 联系表 / Word 报告）必须把线上的字画出来，否则三处与编辑器不一致。
  assert.match(svg, /edge\.label/, '快照没读线上的字');
  assert.match(svg, />\$\{escapeXml\(edge\.label\)\}</, '快照没有把线上的字画进 SVG');
});

test('★ 2026-10-06（教师）：鼠标拖空白 = 平移画布（与流程图一致）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'mindmap-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // 库把左键拖空白判给了框选（那句 `f.button === 0 && b.className === 'map-container'`）⇒
  // 只能在**捕获阶段**拦下并 stopPropagation，否则左键永远先被它吃掉。
  assert.match(live, /addEventListener\('pointerdown', onPointerDown, \{ capture: true \}\)/, '没有在捕获阶段接管 pointerdown');
  assert.match(live, /event\.stopPropagation\(\)/, '没有 stopPropagation —— 库的框选分支仍会先吃掉左键');
  // 只接管鼠标左键：触屏本来就平移（库对 touch 走 pan，不是框选），接管它只会弄坏。
  assert.match(live, /event\.pointerType !== 'mouse' \|\| event\.button !== 0/, '没有把接管的范围限定在「鼠标左键」');
  // 落点必须是空白（点节点/连接点不能被抢走）。
  assert.match(live, /classList\.contains\('map-container'\)/, '没有判断「落点是不是空白」');
  // 框选让位到右键。
  assert.match(live, /mouseSelectionButton: 2/, '框选没有让位到右键');
  // 平移真的调了库的 move()，并且方向取反（鼠标往右拖 = 画布往左走）。
  // ⚠️ 符号必须是**正的**：`move(dx, dy)` = 内容跟着指针走（库自己的平移就是这个符号）。
  //    我第一版写成 `-dx`，教师一上手就发现「方向反了」——这条断言就是那次实测。
  assert.match(live, /instance\.move\(dx, dy\)/, '没有调用 move() 平移，或者方向又反了');
  // 空白处是抓取手型（节点仍由库自己的 `cursor: pointer` 管）。
  assert.match(css, /\.mindmapCanvas :global\(\.map-container\),[\s\S]*?cursor: grab;/, '空白区域没有抓取手型');
  // ★ 2026-10-06（教师）：「设置成靠左、点全屏之后自己靠右了」——全屏是**换容器**（portal）
  //   ⇒ 子树卸载重建，实例照 `data` 重建；而库改方向只 fire `changeDirection`（不 fire `operation`）
  //   ⇒ 漏接它 = 那次改动没存下来 = 重建后打回旧方向。
  assert.match(live, /\['operation', 'changeDirection', 'expandNode'\] as const/, '「会改数据的事件」名单不完整 —— 方向/展开状态会丢');
  assert.match(live, /publishEvents\.forEach\(\(event\) => instance\.bus\.addListener\(event, publish\)\)/, '没有把名单接上');
  assert.match(live, /publishEvents\.forEach\(\(event\) => instance\.bus\.removeListener\(event, publish\)\)/, '清理里没有摘掉（重复挂载会累积监听）');
  // ⚠️ 反面：**不许**把视图事件（scale/move）也接上 —— 它们按指针频率触发，等于每像素存一次。
  assert.ok(!/'scale'|'move'/.test(live), '把视图事件也接上了 —— 会变成每移动一像素存一次');
  // ★ 2026-10-06（教师）：「鼠标滚轮默认也应该是缩放功能」——库的默认是**平移**
  //   （`Ctrl/⌘ + 滚轮`才缩放），所以必须显式接管 `handleWheel`。
  assert.match(live, /handleWheel: \(event: WheelEvent\)/, '没有接管 handleWheel —— 滚轮还是平移');
  // ⚠️ 步进必须按 deltaY **成比例**并**夹紧**：固定档在触控板上会「一划就飞」
  //    （教师 2026-10-06：「滚动速度太快、步进值太大」）。
  assert.match(live, /Math\.max\(-0\.08, Math\.min\(0\.08, -event\.deltaY \* perUnit \* 0\.0008\)\)/, '步进没有成比例/夹紧');
  assert.match(live, /event\.deltaMode === 1 \? 16/, '没有换算 deltaMode（换浏览器手感会差十几倍）');
  assert.match(live, /instance\.scale\(instance\.scaleVal \* \(1 \+ step\)/, '接管了却没有真的缩放');
  assert.match(live, /x: event\.clientX,[\s\S]{0,40}?y: event\.clientY,/, '缩放没有以指针为中心');
  // ⚠️ 反面：接管之后**不许**再顺手平移（那会让滚轮同时缩放+平移，屏幕上像「抖」）。
  const wheelBlock = live.slice(live.indexOf('handleWheel:'), live.indexOf('handleWheel:') + 700);
  assert.ok(!/\.move\(/.test(wheelBlock), '滚轮处理器里还在平移 —— 会与缩放打架');
  // 反面对照：这条判据本身能红。
  assert.ok(!/cursor: grab;/.test('.nope { cursor: default; }'));
});

test('★ 2026-10-06（教师）：数学作图补齐工具（撤销 / 自由线条 / 多边形族 / 角 / 平行线垂线 / 中点 / 平分线 / 文字）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  const shapes = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-math-shapes.ts'), 'utf8'));
  const preview = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', 'teacher', 'classroom', 'drawing-document-preview.tsx'), 'utf8'));
  // ① 工具条由**工具表**生成（写死几个按钮就与几何表分叉了）；表里必须有教师点名的那些。
  for (const tool of ['point', 'segment', 'arrow', 'circle', 'free', 'triangle', 'rectangle', 'parallelogram', 'trapezoid', 'angle', 'parallel', 'perpendicular', 'label', 'select']) {
    assert.ok(shapes.includes(`value: '${tool}'`), `工具表里少了 ${tool}`);
  }
  // ⊘ 教师 2026-10-06 划掉的五个：直线 / 正方形 / 中点 / 垂直平分线 / 角平分线
  //   —— 工具表与几何实现都要清干净（不留没有入口的死代码）。
  for (const gone of ['line', 'square', 'midpoint', 'perp-bisector', 'bisector']) {
    assert.ok(!shapes.includes(`value: '${gone}'`), `划掉的工具还在工具表里：${gone}`);
  }
  for (const dead of ['squareOf', 'midpointOf', 'perpendicularBisectorOf', 'bisectorEndOf']) {
    assert.ok(!shapes.includes(dead), `划掉的工具的几何实现还留着：${dead}`);
  }
  // ★ 图标 + 分组：按钮是「图标 + 文字」，工具条按 基础/多边形/角与线/其他 分组渲染。
  assert.match(shapes, /MATH_TOOL_ICONS: Record<MathTool, string>/, '没有图标表');
  assert.match(live, /MATH_TOOL_ICONS\[item\.value\]/, '工具条按钮没有用图标');
  assert.match(live, /MATH_TOOL_GROUPS\.map\(/, '工具条没有分组渲染（归类应当来自数据）');
  assert.match(live, /toolsInGroup\(group\.value\)/, '分组没有走 toolsInGroup（会与工具表分叉）');
  // ② 撤销：历史栈 + 一个按钮（原来画错只能清空重来）。
  assert.match(live, /history\.current\.push\(snapshot\(\)\)/, '没有把每一步压进撤销栈');
  assert.match(live, /onClick=\{\(\) => undoRef\.current\?\.\(\)\}/, '工具条上没有撤销按钮');
  // ③ 自由线条：捕获阶段接管指针，且**只在 free 这一档**（别的工具一点也不能拦）。
  // 拖动只发生在「自由线条」或工具表里标了 drag 的档位（别的工具一点也不能拦）。
  assert.match(live, /currentTool === 'free'/, '自由线条没有走拖动那条路');
  assert.match(live, /addEventListener\('pointerdown', onDragDown, \{ capture: true \}\)/, '拖动没有在捕获阶段接管');
  // ④ 文字：受控输入 + 空文字不落标签。
  assert.match(live, /aria-label="要写上去的文字"/, '没有写文字的输入框');
  assert.match(live, /if \(!text\) return;/, '空文字也会落一个看不见的标签');
  // ⑤ 三种新形状在**教师端预览**里也要画得出来（否则学生画了、教师看不见）。
  for (const kind of ["item.kind === 'polyline'", "item.kind === 'angle'", "item.kind === 'label'"]) {
    assert.ok(preview.includes(kind), `教师端预览没有渲染 ${kind}`);
  }
  // ⑥ 读回作答时要认这六种形状（认不出就丢，但不抛）。
  for (const kind of ["row.kind === 'polyline'", "row.kind === 'angle'", "row.kind === 'label'"]) {
    assert.ok(live.includes(kind), `readEntries 不认 ${kind}`);
  }
});

test('★ 2026-10-06（教师）数学作图三问：不要坐标系、拖动绘制、拖动过程要看得见', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // ① 「为什么背景里还有直角坐标系？」——画板自带的那套关掉，参考线交给**这一题的背景预设**。
  assert.match(live, /axis: false,/, '画板还在画 x/y 轴');
  assert.match(live, /grid: false,/, '画板还在画自己的网格');
  // ② 「用拖拽的方式，不要不同位置点鼠标」——两点图形按住拖动；三点以上仍多点（几何决定）。
  assert.match(live, /isDragTool/, '没有区分「拖动类」工具');
  assert.match(live, /MATH_TOOLS\.find\(\(item\) => item\.value === currentTool\)\?\.drag/, '拖动类没有从工具表里取（写死名单会与表分叉）');
  // ③ 「自由线条拖拽过程中线条要可见」——预览画在覆盖层上，不依赖 jsxgraph 的增量更新。
  assert.match(live, /mathOverlay/, '没有那块拖动预览层');
  assert.match(live, /overlayCtx\.stroke\(\)/, '预览层上什么都没画');
  assert.match(live, /const drawPreview = \(currentTool: MathTool, screenStart: Pt, screenNow: Pt\)/, '预览不是屏幕坐标的（用户坐标换算那条路在我们的类型里不存在）');
  assert.match(css, /\.mathOverlay \{ position: absolute; inset: 0; pointer-events: none; \}/, '预览层没有铺满画板 / 会抢指针事件');
  // 拖动过程中**不许**顺手建正式图形（那正是「看不见」的老路）。
  const dragMove = live.slice(live.indexOf('const onDragMove'), live.indexOf('const onDragUp'));
  assert.ok(!/board\.create/.test(dragMove), '拖动过程中在往画板上堆图形 —— 又回到「看不见」那条路');
});

test('★ 2026-10-06（教师）：「画上去的东西怎么删除？是不是应该有个选择工具？」', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  const shapes = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-math-shapes.ts'), 'utf8'));
  // ①「选择」必须是一个真正的工具档（不是藏在别处的一次性动作）。
  assert.ok(shapes.includes("value: 'select'"), '工具表里没有「选择」档');
  // ② 选择档要在「点到图形就 return」那句**之前**处理 —— 顺序反了它永远选不中东西。
  const selectBranch = live.indexOf("toolRef.current === 'select'");
  const earlyReturn = live.indexOf('if (board.getAllObjectsUnderMouse(event).length > 0) return;');
  assert.ok(selectBranch !== -1, '没有处理「选择」档');
  assert.ok(earlyReturn !== -1 && selectBranch < earlyReturn, '「选择」档排在了那句 return 之后 —— 点图形会被提前 return 掉');
  // ③ 删除要有明确的按钮与实现（两步：选中 → 删除选中，避免 iPad 误触即删）。
  assert.match(live, /aria-label|删除选中/, '没有「删除选中」');
  assert.match(live, /const deleteSelectedRef|deleteSelectedRef\.current = \(\) => \{/, '没有实现删除选中');
  assert.match(live, /pushHistory\(\);\n      renderAll\(remaining\)/, '删除没有进撤销栈 / 没有重画');
  // ④ 换工具要取消选中（否则「删除选中」会对着一个看不见高亮的图形动手）。
  assert.match(live, /selectRef\.current\?\.\(null\);\n    setTool\(next\)/, '换工具没有取消选中');
});

test('★ 2026-10-06（教师选 A）：选中图形后就地浮出「删除」小按钮', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // ① 按钮只在「选择」档 + 选中了图形 + 算得出位置时出现（其余情况走工具条那条路）。
  assert.match(live, /tool === 'select' && selected !== null && anchor &&/, '浮动按钮的出现条件不对');
  assert.match(live, /aria-label="删除选中的图形"/, '浮动按钮没有无障碍名字');
  // ② 位置必须用 JXG.Coords 换算 —— 静态线性映射在画板被平移/缩放之后会把按钮飘到别处。
  assert.match(live, /new JXG\.Coords\(JXG\.COORDS_BY_USER, \[mid\[0\], mid\[1\]\], board\)/, '没有用 JXG.Coords 换算屏幕位置');
  assert.match(live, /coords\.scrCoords\[1\], y: coords\.scrCoords\[2\]/, '没有取 scrCoords');
  // ⚠️ 换算失败要回 null（不画按钮），而不是画在错误的位置。
  assert.match(live, /catch \{\n        return null;\n      \}/, '换算失败没有回退');
  // ③ 选中图形被拖动之后，按钮要跟着走。
  assert.match(live, /if \(selectedRef\.current !== null\) setAnchor\(anchorOf\(snapshot\(\)\[selectedRef\.current\]\)\)/, '拖动后按钮不会跟着图形走');
  // ④ 样式：命中区 44px（那条用例逐个 <button> 量）+ 自己是 auto（父层是 none）。
  assert.match(css, /\.mathFloatingDelete \{[\s\S]{0,220}?width: 44px;/, '浮动按钮的命中区小于 44px');
  assert.match(css, /\.mathFloatingDelete \{[\s\S]{0,300}?pointer-events: auto;/, '浮动按钮点不动（父层是 pointer-events: none）');
});

test('★ 2026-10-06（教师截图）：库自带那条导航条换掉，改成我们自己的「放大/缩小/复位」', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  // ① 库那条导航条关掉（它只有一种长相，而且四个平移箭头在触摸屏上没用）。
  assert.match(live, /showNavigation: false,/, '库自带的导航条还开着');
  // ② 换成我们工具条里的三颗（放大 / 缩小 / 复位）。
  for (const label of ['放大', '缩小', '复位']) {
    assert.ok(live.includes(`'${label}'`), `视图按钮少了「${label}」`);
  }
  assert.match(live, /board\.zoomIn\(\)/, '「放大」没接上库的 zoomIn');
  assert.match(live, /board\.zoomOut\(\)/, '「缩小」没接上库的 zoomOut');
  // ⚠️「复位」必须把**平移**也收回来 —— `zoom100()` 只管缩放，学生挪过的画布会留在原地。
  assert.match(live, /board\.setBoundingBox\(\[-10, 8, 10, -8\], true\)/, '「复位」没有回到初始视野（用 zoom100 只复位缩放）');
  assert.ok(!/zoom100\(/.test(live), '「复位」用的是 zoom100 —— 它不管平移');
  // ③ 单指不再平移画布（单指要留给作图与拖控制点），双指仍然可以。
  assert.match(live, /pan: \{ enabled: !disabled, needTwoFingers: true \}/, '单指还在平移画布 —— 会把「点一下」和「挪一下」混在一起');
});

test('★ 2026-10-06：库自带的**悬停信息框**必须关掉（`showInfobox: false`）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'math-drawing.tsx'), 'utf8'));
  /**
   * ⚠️ 只在 `initBoard` 的**选项那一块**里找，不查整个文件：将来某个图形自己的 `attrs` 里出现
   *    一个同名键不该算数 —— 这里要盯的是**画板级**那一个。
   * ⚠️ 抠不出选项块时**如实报错**，不许在空串上全绿。
   */
  const options = blockAfter(live, 'JXG.JSXGraph.initBoard(', '});');
  assert.ok(options.length > 200, 'initBoard 的选项没抠出来 —— 先修这条判据，别让它在空串上全绿');
  /** 语义判：**显式关掉**就算过（`false` / `!1` / `0` 都认），不逐字钉写法。 */
  const turnsInfoboxOff = (source: string): boolean => /showInfobox:\s*(?:false|!1|0)\b/.test(source);
  // 🔴 为什么是硬要求：① 它与「选中高亮 / 浮层那颗删除按钮」抢注意力（指针划过图形就冒一条小信息）；
  //    ② 学生端是老 iPad / Safari 15，**触屏没有 hover** ⇒ 这条信息学生永远看不到。
  assert.ok(turnsInfoboxOff(options),
    '库自带的悬停信息框还开着（它与「选中高亮 / 浮层删除按钮」抢注意力，而触屏根本没有 hover）');
  // ⚠️ 反面对照：改回 `true`、或把那一句整个删掉 ⇒ 必须判违规（这条判据不是恒真的）。
  const onInstead = options.replace(/showInfobox:\s*false/, 'showInfobox: true');
  assert.notEqual(onInstead, options, '反面对照没造出来（没找到可替换的那一句）—— 这条判据会变成恒真');
  assert.ok(!turnsInfoboxOff(onInstead), '反面对照（改成 true）没被抓住 —— 这条判据是恒真的');
  const dropped = options.replace(/[^\n]*showInfobox[^\n]*\n/, '');
  assert.notEqual(dropped, options, '反面对照没造出来（那一句没被删掉）—— 这条判据会变成恒真');
  assert.ok(!turnsInfoboxOff(dropped), '反面对照（整句删掉）没被抓住 —— 这条判据是恒真的');
});

test('★ 2026-10-06（教师）：底稿（A 不算学生作答 / B 初始图永远可改可删 / 先做流程图）', async () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const body = stripComments(fs.readFileSync(path.resolve(HERE, '..', 'drawing-tool-body.tsx'), 'utf8'));
  // ① 学生端拿得到底稿，并交给画板。
  assert.match(body, /starter=\{readDrawingStarter\(node\)\}/, '学生端没有把底稿交给画板');
  // ② 读的时候合并（底稿 + 学生画的）；写的时候剔除（A：底稿不算他的作答）。
  assert.match(live, /mergeFlowchart\(starterPayload, readFlowchartPayload\(data\)\)/,
    '没有把「底稿 + 学生画的」交给合并');
  assert.match(live, /onChange\(subtractFlowchart\(payload, starterPayload\)/, '交上去的作答没有剔除底稿（A）');
  // ③ 快照仍按**全部**画（教师预览/AI/报告要看到完整那张图）。
  assert.match(live, /lastFlow\.current = payload;/, '快照用的不是完整那份（教师/AI 会看到缺了底稿的图）');
  // ④ ★ B（教师最终拍板）：「锁定初始图」撤掉 ⇒ 回退**只靠**「恢复初始图」，它**无条件出现**
  //    （只要这一题有初始图）。出现条件里**不许**再出现任何锁标记。
  assert.match(live, /restoreFlowchart\(starterPayload\)/, '没有「恢复初始图」的实现');
  assert.ok(restoreShownWheneverStarter(live), '「恢复初始图」的出现条件里又出现了锁标记（或者那颗按钮整块没了）');
  // ⚠️ 反面对照：把出现条件加回一个锁标记 ⇒ 必须判违规（证明这条判据不是恒真的）。
  const gatedAgain = live.replace('{starter && (', '{starter && !starterLocked && (');
  assert.notEqual(gatedAgain, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!restoreShownWheneverStarter(gatedAgain), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 「初始图永远可改可删」这件事必须**真调纯函数**验（不猜实现写法）：
  //    · 旧字段 `drawingStarterLocked: true` 一个字都不读（读出来的形状里没有 locked）；
  //    · 合并之后底稿的每一件都不带任何锁标记。
  //    ⚠️ 这也正是上一版那句「源码里不许出现 draggable: false」换来的东西：现在换成**行为**判据。
  const { mergeFlowchart, readDrawingStarter, readFlowchartPayload } = await import('../../../../../lib/worksheet-drawing-starter.ts');
  const payload = { nodes: [{ id: 't1', data: { label: '开始' } }], edges: [{ id: 'e1', source: 't1', target: 't1' }] };
  const starter = readDrawingStarter({
    type: 'drawing', data: { drawingTool: 'flowchart', drawingStarter: { tool: 'flowchart', data: payload }, drawingStarterLocked: true },
  });
  assert.ok(starter, '带 `drawingStarterLocked: true` 的题读不出底稿了');
  assert.deepEqual(starter, { tool: 'flowchart', data: payload },
    '读底稿时又消费了 `drawingStarterLocked` —— 旧字段必须被忽略（不迁移、不写回、不报错）');
  const graph = mergeFlowchart(readFlowchartPayload(starter.data), { nodes: [], edges: [] });
  assert.equal(graph.nodes[0].draggable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的框变成不可编辑（不能拖）');
  assert.equal(graph.nodes[0].deletable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的框变成不可删的');
  assert.equal(graph.edges[0].deletable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的连线变成不可删的');
});

test('★ 2026-10-06（教师最终拍板）：「锁定初始图」撤干净 —— 学生端不再消费任何锁标记（四条路全开）', async () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 教师原话（逐字）：「我觉得教师把初始图锁定也不对，这样学生端很多操作都无法进行了，我觉得
       还是不要锁定，因为学生端已经有恢复初始图功能了。」
    ⇒ 底稿的框**可以拖 / 可以删 / 文字可改**，底稿的连线**可以删 / 可以改标注**；
      「判据按 id 认老师的东西」那两个判断（`isStarterNode` / `isStarterEdge`）随这一档一起删了。
    ⚠️ 这一条盯的是**学生能碰到老师东西的四条路**（源码级：本仓没有 jsdom）：
      ① 框的文字输入框；② 改线的文字（双击 / 工具条标注那一组 / 唯一的写入出口）；
      ③ 唯一的删除出口；④ 浮层那颗删除按钮 —— 一个都不许再按 id 拦「老师的」。
    ⚠️ 「拖动 + 键盘 Delete」由 `mergeFlowchart`（不再打 `draggable/deletable`）保证，上面那条
      用例已经**真调**过纯函数验算了。
    ⚠️ 判据**不是「删空」**：四条路各自既有「不许再拦老师的东西」的反面，也有「这条路本身还在」
      的正面（下面 ③ 那一组）—— 把整块删掉会当场红。
  */
  // ① 全文件审计：锁标记一个都不许再被消费（`starterLocked` / `drawingStarterLocked` / `starter.locked`）。
  const lockRefs = live.match(/starterLocked|drawingStarterLocked|starter\s*\.\s*locked/g) ?? [];
  assert.deepEqual(lockRefs, [], `学生端又在消费锁标记：${lockRefs.join('、')}（「锁定初始图」已经撤掉了）`);
  // ⚠️ 反面对照：塞一个回去 ⇒ 必须判违规（证明这条审计不是恒真的）。
  const withLockBack = live.replace('const selectedEdgeId =', 'const starterLocked = starter?.locked === true;\n  const selectedEdgeId =');
  assert.notEqual(withLockBack, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok((withLockBack.match(/starterLocked|drawingStarterLocked|starter\s*\.\s*locked/g) ?? []).length > 0,
    '反面对照没被抓住 —— 这条判据是恒真的');

  // ② ★ 旧字段 `drawingStarterLocked: true` **一个字都不读** —— 真调纯函数走一遍「读 + 合并」。
  const { mergeFlowchart, readDrawingStarter, readFlowchartPayload } = await import('../../../../../lib/worksheet-drawing-starter.ts');
  const payload = { nodes: [{ id: 't1', data: { label: '过程' } }], edges: [{ id: 'e1', source: 't1', target: 't1' }] };
  const starter = readDrawingStarter({
    type: 'drawing', data: { drawingTool: 'flowchart', drawingStarter: { tool: 'flowchart', data: payload }, drawingStarterLocked: true },
  });
  assert.ok(starter, '带 `drawingStarterLocked: true` 的题读不出底稿了');
  assert.deepEqual(starter, { tool: 'flowchart', data: payload },
    '读底稿时又消费了 `drawingStarterLocked` —— 老题目里那个字段必须被忽略');
  const graph = mergeFlowchart(readFlowchartPayload(starter.data), { nodes: [], edges: [] });
  for (const item of graph.nodes) {
    assert.equal(item.draggable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的框变成不可编辑（不能拖）');
    assert.equal(item.deletable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的框变成不可删');
    assert.equal((item.data as Record<string, unknown>)?.locked, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的文字只读');
  }
  assert.equal(graph.edges[0].deletable, undefined, '旧字段 `drawingStarterLocked: true` 让底稿的连线变成不可删');

  /** 这一段里有没有「按 id 拦住老师的东西」那道闸（块切不出来时必须红）。 */
  const blocksTeacher = (snippet: string): boolean => /isStarterNode\(|isStarterEdge\(/.test(snippet);

  // ③ 框的文字：`visibleNodes` 里只由 `disabled` 决定只读，**不许**再按 id 判。
  const visibleBody = blockAfter(live, 'const visibleNodes = useMemo', '\n  const ');
  assert.ok(visibleBody.length > 40, 'visibleNodes 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/starterNodeIds\.has\(node\.id\)/.test(visibleBody), '底稿的框文字又变回只读了（`visibleNodes` 里又按 id 判了）');
  assert.match(visibleBody, /disabled/, '「只读展示」那一档（disabled）被弄丢了');
  // ④ 线的文字：双击进就地输入框 + 工具条那一组 + 唯一的写入出口，三处都不许再拦底稿的线。
  const dblBody = blockAfter(live, 'onEdgeDoubleClick={', 'onMove={');
  assert.ok(dblBody.includes('setLabelingEdge'), 'onEdgeDoubleClick 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!blocksTeacher(dblBody), '双击底稿的线又进不了就地输入框（改不了它的文字）');
  const labelableBody = blockAfter(live, 'const labelableEdgeId = ', ';');
  assert.ok(!blocksTeacher(labelableBody), '工具条又不给底稿的线「标注」那一组（改不了它的文字）');
  const setLabelBody = blockAfter(live, 'const setEdgeLabel = ', '};');
  assert.ok(setLabelBody.length > 40, 'setEdgeLabel 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!blocksTeacher(setLabelBody), '改标注的唯一出口又拦住了底稿的线（工具条/就地输入框之外还能改）');
  // ⑤ 删除：唯一的删除出口 + 浮层，都不许再拦底稿的框/线。
  const removeBody = removeSelectedSource(live);
  assert.ok(removeBody.length > 40, '唯一的删除出口没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!blocksTeacher(removeBody), '唯一的删除出口又把底稿的框/线拦住了（教师给的也能删）');
  const overlayBody = overlaySource(live);
  assert.ok(overlayBody.length > 80, '浮层描述式没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!blocksTeacher(overlayBody), '浮层又不为底稿的框/线画删除按钮（教师给的也能删）');

  // ⑥ ★ 正面：这四条路**一条都没被删掉**（判据不是「把拦人的代码删空」就算过）。
  assert.match(dblBody, /setLabelingEdge\(edge\.id\)/, '双击进就地输入框这条交互被删掉了（线文字改不了）');
  assert.match(labelableBody, /selectedEdgeId/, '工具条「这条线标注」那一组被删掉了');
  assert.match(setLabelBody, /setEdges\(/, '改标注的唯一写入出口被删掉了');
  assert.match(removeBody, /deleteElements\(/, '删图形那条路被删掉了（相连的线不会跟着没）');
  assert.match(removeBody, /kind === 'edge'/, '删连线那一支被删掉了');
  assert.match(overlayBody, /mode: 'delete'/, '浮层那颗删除按钮被删掉了');
  assert.ok((live.match(/\{starter && \(/g) ?? []).length >= 1, '「恢复初始图」那颗按钮整块没了');
});

test('★ 初始流程图可编辑：移动/改字/删除在重新进入后仍保留', async () => {
  const { mergeFlowchart, subtractFlowchart } = await import('../../../../../lib/worksheet-drawing-starter.ts');
  const starter = {
    nodes: [
      { id: 'start', type: 'flow', position: { x: 0, y: 0 }, data: { kind: 'terminator', label: '开始' } },
      { id: 'work', type: 'flow', position: { x: 0, y: 100 }, data: { kind: 'process', label: '处理' } },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'work', sourceHandle: 'bottom', targetHandle: 'top', type: 'flowLabel' }],
  };
  const editedAll = {
    nodes: [
      { ...starter.nodes[0], position: { x: 40, y: 20 }, data: { kind: 'terminator', label: '新的开始' } },
      starter.nodes[1],
    ],
    edges: [],
  };
  const answer = subtractFlowchart(editedAll, starter);
  assert.deepEqual(answer.nodes.map((node) => node.id), ['start'], '修改过的底稿节点被当成未修改底稿剔除了');
  assert.deepEqual(answer.deletedEdgeIds, ['e1'], '删除底稿连线没有留下删除标记');
  const reopened = mergeFlowchart(starter, answer);
  assert.deepEqual(reopened.nodes.find((node) => node.id === 'start')?.position, { x: 40, y: 20 }, '重进后节点位置没有保留');
  assert.equal((reopened.nodes.find((node) => node.id === 'start')?.data as Record<string, unknown>).label, '新的开始', '重进后文字修改没有保留');
  assert.equal(reopened.edges.length, 0, '重进后已删除的底稿连线又复活了');
});

test('★ 2026-10-06（教师）：流程图工具加图形图标；点线浮出图标删除；双击线改文字', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // ① 四个加节点按钮 + 恢复初始图都要有**形状图标**（画的正是它会放下的那个节点）。
  assert.match(live, /FLOW_ICONS: Record<FlowKind/, '没有图标表');
  // ⚠️ 最后那个键 2026-10-06 从 `trash` 改成了 `close`（教师：「可以换成一个小叉叉图标」）
  //    —— 删除按钮的图标不再是垃圾桶。判据跟着改，键名对不上会当场红。
  for (const key of ['terminator', 'process', 'decision', 'io', 'restore', 'close']) {
    assert.ok(live.includes(`${key}:`), `图标表里少了 ${key}`);
    assert.ok(live.includes(`FLOW_ICONS.${key}`), `${key} 的图标没有挂到按钮上`);
  }
  // ② 单击选中（框或线）⇒ 浮出**图标型**删除按钮（不是文字按钮）。
  //    ★ 第 1 步整理：三套浮层合并成**一处渲染** ⇒ 删除按钮与就地输入框是同一个 `overlay`
  //      描述式的两个形态，按钮的名字按选中种类取（框 ⇒ 删除这个图形 / 线 ⇒ 删除这条连线）。
  assert.match(live, /删除这个图形/, '没有「删除这个图形」这个名字');
  assert.match(live, /删除这条连线/, '没有「删除这条连线」这个名字');
  assert.match(live, /aria-label=\{overlay\.label\}/, '删除按钮的无障碍名字没有跟着选中的种类走');
  assert.match(live, /className=\{styles\.flowEdgeFloat\}/, '删除按钮没有用浮层样式');
  assert.match(live, /onClick=\{removeSelected\}/, '浮层删除按钮没接上「删掉当前选中的那一件」');
  // ③ 双击 ⇒ 就地输入框（回车提交 / Esc 取消），且改文字时**不出现**删除按钮
  //    （双击必然先触发一次单击 ⇒ 两个形态必须互斥，否则 44px 的按钮会压在那个输入框上）。
  //    ★ 第 1 步整理之后互斥是**结构性**的：`overlay` 里标签形态优先，删除形态在它后面。
  assert.match(live, /onEdgeDoubleClick=/, '双击连线没有接');
  assert.match(live, /aria-label="这条连线上的文字"/, '没有就地输入框');
  assert.match(live, /event\.key === 'Enter'/, '回车没有提交');
  assert.match(live, /event\.key === 'Escape'/, 'Esc 没有取消');
  const overlaySrc = overlaySource(live);
  assert.ok(overlaySrc.length > 80, '浮层描述式没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(overlaySrc, /if \(labelingEdge\)/, '正在改文字时没有优先返回就地输入框 —— 删除按钮会压在它上面');
  // ⚠️ 反面对照：把那个优先分支改成永不进入（`if (false)`）⇒ 必须判违规。
  const noLabelFirst = overlaySrc.replace('if (labelingEdge)', 'if (false)');
  assert.notEqual(noLabelFirst, overlaySrc, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/if \(labelingEdge\)/.test(noLabelFirst), '反面对照没被抓住 —— 这条判据是恒真的');
  // ④b 🔴 浮层必须**落在画布舞台里面**：教师 2026-10-06 实测「删除图标在最上面」——
  //   当时浮层被插到了舞台**外面**，于是按外层卡片定位，y 差了「卡片头 + 工具条」那约 280px。
  //   这条判据用**位置关系**钉死它（顺序错了就红，不必靠真机截图才发现）。
  const stageAt = live.indexOf('styles.flowStage');
  const reactFlowAt = live.indexOf('</ReactFlow>');
  const floatAt = live.indexOf('styles.flowEdgeFloat');
  assert.ok(stageAt !== -1 && reactFlowAt !== -1 && floatAt !== -1, '舞台/ReactFlow/浮层有缺失');
  assert.ok(stageAt < reactFlowAt && reactFlowAt < floatAt, '浮层没有落在画布舞台里（会在卡片上乱飘）');
  // ⚠️ 再加一条**包含关系**：浮层必须是舞台里 `</ReactFlow>` 的**直接兄弟** ——
  //    `</ReactFlow>` 与浮层之间**不许出现 `</div>`**（出现 = 浮层排在舞台收尾之后，
  //    于是按外层卡片定位 —— 正是「y 差约 280px」那次事故）。
  assert.ok(!/<\/div>/.test(live.slice(reactFlowAt, floatAt)), '浮层排在舞台的收尾 </div> 之后（会按外层卡片定位、差出卡片头 + 工具条）');
  // ④ ★ 偏移（教师 2026-10-06 认可）：删除按钮往 source 退 `EDGE_FLOAT_BACK`（**命名常量**，数值由几何用例验算）。
  //    ⊘ 中点浮层那一份偏移（`HANDLE_GAP` + `offsetAlong`）随**自定义边**一起删了：句柄没了就没有
  //      「压住 Y/N 标签 / 吞掉中点单击」的问题，就地输入框回到**裸标签点**。
  // ⚠️ 判据**按语义**写：抠出各自的函数体，在**体内**查「用的是哪个常量」，
  //    不逐字钉格式（按猜的格式写实际是多行 + `anchors.` 前缀，自己把自己判红 ✗）。
  //    切函数体切到**下一个顶层 `const` 声明**为止 —— 固定长度切片会把隔壁函数吞进来，
  //    两个函数挨着只隔 ~250 字，「常量名在 endBody 里」就会靠泄漏恒真。
  const bodyOf = (name: string) => {
    const at = live.indexOf(`const ${name} = `);
    if (at === -1) return '';
    const next = live.indexOf('\n  const ', at + 1);
    return next === -1 ? live.slice(at) : live.slice(at, next);
  };
  const endBody = bodyOf('edgeStartAnchor');
  const midBody = bodyOf('edgeMidAnchor');
  assert.ok(endBody.length > 40 && midBody.length > 40, '两个锚点函数没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // 删除按钮 → 往 source 退 `EDGE_FLOAT_BACK`（**不许**退回「起点→终点」直线近似那种偏移）。
  assert.match(endBody, /\bEDGE_FLOAT_BACK\b/, '删除按钮的距离不是命名常量 EDGE_FLOAT_BACK');
  assert.ok(!/\boffsetAlong\(/.test(endBody), '删除按钮退回了「起点→终点」直线近似（拐弯的边上会偏出线外）');
  assert.ok(!/\bHANDLE_GAP\b/.test(live), '已经把中点浮层那份偏移加回来了（`HANDLE_GAP` 随中点句柄一起删掉了）');
  // 🔴 中点浮层（就地输入框）**必须落在裸标签点上**：不许再有任何「沿中点→目标端推开」的偏移。
  //    这是本轮删掉自定义边之后**行为上真正变了**的那一处（实测：改前锚点 = 标签点 + 27 屏幕 px，
  //    改后 = 标签点本身），所以判据盯的是「这一块里没有偏移」而不是某个函数名。
  assert.ok(!/offsetAlong|EDGE_FLOAT_BACK|clampOffset/.test(midBody),
    '中点浮层又被推离了标签点（就地输入框会与它要改的那个字分家）');
  /*
   * ★ 删除按钮的方向必须是**起点句柄轴**（`outX/outY` = `smoothstep` 首段方向），**不许**退回
   *   「起点→终点」直线近似 —— 直线近似在拐弯的边上会偏出线外 ~21px（见 `handleOutwardAxis` 的注释）。
   * ⊘ 2026-10-06（**教师改主意**）：这一条原来盯的是**目标句柄轴**（`backX/backY`，按钮在**终点**侧）。
   *   教师要求把按钮挪到**起点那一侧**（「压在靠近起点的线上」）⇒ 方向随之换成起点轴。
   *   轴映射本身另有**几何用例**（`handleOutwardAxis` 四个方位 + 短边 clamp）。
   */
  assert.match(endBody, /outX|outY/, '删除按钮没有沿起点句柄轴走（拐弯的边上会偏出线外）');
  // 距离必须过**上限**（否则极短边上会越过中点）。clamp 的数值行为由下面的几何用例喂短边验算。
  assert.match(endBody, /clampOffset\(/, '删除按钮的偏移没有上限（极短边上会越过中点）');
  // 退的方向/长度都取自锚点表：起点锚点算段长 + 目标句柄轴定方向。
  assert.match(endBody, /fromX|fromY/, '删除按钮没有引用起点锚点（算不出段长）');
  // ★ 两个浮层都要**视口换算**（局部坐标 = `viewport + 流坐标 × zoom`），少一轴就会飘。
  //   这条正是原来那句 `/viewport\.x \+ labelX \* viewport\.zoom/` 真正守的东西 ——
  //   但它把中点浮层的变量名（`labelX`）也钉死了，实现一改就红。这里改成**不认变量名**的写法。
  const convertX = /viewport\.x \+ [\w.]+ \* viewport\.zoom/;
  const convertY = /viewport\.y \+ [\w.]+ \* viewport\.zoom/;
  assert.ok(convertX.test(midBody) && convertY.test(midBody), '中点浮层没有做视口换算（浮层会飘）');
  assert.ok(convertX.test(endBody) && convertY.test(endBody), '终点浮层没有做视口换算（浮层会飘）');
  // ⚠️ 反面：**交点节点**必须用**精确中点**（`anchors.midX - junctionHalf`），偏移不许卷进取交点那一句 ——
  //    否则拆出来的两段与原来那条线对不上（当初正是按精确中点实测出「完全重合」）。
  //    判据**圈在拆线那一份实现体内**，不是「某函数后 200 字内有没有 junctionHalf」那种靠距离的写法
  //    （距离一变就恒真/恒假）。
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 200, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const splitBody = splitEdgeSource(live);
  assert.ok(splitBody.length > 400, '拆线那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/, '交点没有落在精确中点上');
  assert.ok(!/offsetAlong/.test(splitBody), '交点被卷进了浮层偏移（拆出来的两段会与原线对不上）');
  assert.ok(!/offsetAlong/.test(onConnectBody), '交点被卷进了浮层偏移（拆出来的两段会与原线对不上）');
  // 反面对照：往拆线那一份实现里塞一句浮层偏移 ⇒ 上面那句必须红（证明它不是恒真）。
  // ⚠️ 靶子必须选**有那一行**的那一块（`splitBody`）：拿 `onConnect` 当靶子会 replace 不上，
  //   于是「造不出反面对照」自己先红 —— 那是判据写错，不是实现坏。
  // ⚠️ 毒药从 `offsetAlong`（已随自定义边删掉、现在是死符号）换成**还活着**的 `clampOffset`：
  //    这样反面对照证明的仍是「这一块里不许出现偏移」这条真判据，而不是「一个字面量不在」。
  // ⚠️ 靶子那句**用正则**（`const junctionHalf = 4 + 2;` 那种也能当靶子），不逐字钉那个数 ——
  //    本轮尺寸从 12 改成 8（`junctionHalf` 6 ⇒ 4）时，钉数字的写法自己先红了。
  const poisonedConnect = splitBody.replace(/const junctionHalf = (\d+);/, 'const junctionHalf = clampOffset($1, 100);');
  assert.notEqual(poisonedConnect, splitBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(/offsetAlong|clampOffset/.test(poisonedConnect), '反面对照没造出来 —— 这条判据会变成恒真');

  // ⑤ 浮层靠**视口换算**跟随（不引 Provider、也不复刻折线算法）。
  assert.match(live, /onMove=\{\(_, next\) => setViewport\(next\)\}/, '没有跟视口');
  // ★ 教师 2026-10-06：「距离太远，应该就在那根连接线上」——第一版取两节点中心的中点，
  //   而 `smoothstep` 是折线，中心点经常不在路径上。锚点必须用库自己的路径函数取**标签点**。
  // ★ 教师 2026-10-07：「控制点必须**永远压在线上面**」——于是更进一步：锚点走的必须是
  //   **画线那一路同一个函数**（`flowEdgeGeometry`），否则线一动、浮层与把手就留在原地。
  //   ⚠️ 上一版这里是**裸的** `getSmoothStepPath`（绕行点一个都不带）⇒ 算的是**默认路**的中点。
  assert.match(live, /const \[, labelX, labelY\] = flowEdgeGeometry\(/, '锚点没有取那条**画出来的路径**的标签点（第一版就是这里飘的）');
  assert.match(live, /const smoothStepPath: SmoothStepFn = \(params\) => \{[\s\S]{0,160}?getSmoothStepPath\(/, '那个路径函数没有真的落到库上');
  /*
   * ⑤ 浮层命中区的尺寸**只有一个真源：样式表**。
   * ⊘ 2026-10-07：这里原来拿组件里的 `FLOAT_SIZE` 与 CSS 对（「两份必须一致」）。
   *   那个 TS 常量删了 —— 它只是 CSS 的副本、代码里没有第二个消费者
   *   ⇒ 判据改成直接钉**样式表自身**（正方形 + 与就地输入框的下限同值）。
   * ⚠️ 44px 这个**下限**由 `worksheet-tap-targets.test.ts` 从 CSS 直接量，这里不重复钉。
   */
  // ⚠️ 变量名带 `hit` 前缀：这个用例里已经有一个 `floatAt` 了（`const` 重复声明会直接编译错）。
  const hitRuleAt = css.indexOf('.flowEdgeFloat {');
  assert.notEqual(hitRuleAt, -1, '样式表里没有 `.flowEdgeFloat` 那条规则 —— 先修这条判据');
  const hitRule = css.slice(hitRuleAt, css.indexOf('}', hitRuleAt) + 1);
  assert.ok(hitRule.length > 40, '`.flowEdgeFloat` 那条规则没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const hitW = Number((hitRule.match(/[^-]width:\s*(\d+)px/) ?? [])[1]);
  const hitH = Number((hitRule.match(/[^-]height:\s*(\d+)px/) ?? [])[1]);
  assert.ok(Number.isFinite(hitW) && hitW > 0, `读不到浮层命中区的宽（读到 ${hitW}）`);
  assert.equal(hitW, hitH, '删除按钮的命中区不是正方形');
  assert.match(css, new RegExp(`\\.flowEdgeInput \\{[\\s\\S]{0,260}?min-height: ${hitW}px;`), '就地输入框太矮（与浮层命中区不一致）');
});

test('★ 2026-10-06：连到线中点 —— **自定义边 / 中点句柄已删干净**，插交点 + 拆线只留一份', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  /*
    🔴 这一条盯的是**这一轮删掉了什么**，以及删完之后「连到线中点」还剩哪一条路。
    🔴 删它的硬理由（读 `@xyflow/system@0.0.82` + 无头 Chrome 154 实测，不是审美）：
       · 那颗中点句柄住在 `EdgeLabelRenderer` 里 ⇒ 库的 `useNodeId()` 拿到 **null**
         ⇒ `XYHandle.onPointerDown` 里 `getHandle()` 拿 `nodeLookup.get(null)` 得 undefined
         ⇒ **在挂任何监听之前就 return** ⇒ 它只能「接」、**不能「起」**（边中点 → 框结构性不通）；
       · 它还得自己补 `data-nodeid = 边 id`（不补的话连「接」都接不上，库报 error#010）；
       · 而「接」这一侧已经有更好的一份（几何吸附，见 `EDGE_SNAP_RADIUS`），两条并存只会
         「精确命中」与「附近松手」走两套判据；
       · 它还**压住线上的 Y/N 标签**、并且会**吞掉正落在中点的单击/双击**（所以才要 `HANDLE_GAP`)。
    ⚠️ 反面判据要**逐条**钉：只把组件名删掉、把句柄留在那儿，或者只删句柄、把 `data-nodeid`
      那种凭据留在别处，都必须判红。
  */
  assert.ok(!/FlowEdgeLine|EdgeLabelRenderer|edge-mid\b/.test(live),
    '自定义边 / 中点句柄又回来了（它们是库的结构限制：「只能接不能起」+ 吞掉中点单击，见上面那段）');
  assert.ok(!/'data-nodeid': edgeId/.test(live), '中点句柄那颗 `data-nodeid = 边 id` 的补丁又回来了（它是已删机制的唯一凭据）');
  assert.ok(!/\bHANDLE_GAP\b/.test(live), '`HANDLE_GAP` 又回来了 —— 它的唯一用途就是避让那颗已删的中点句柄');
  /*
   * ★ 2026-10-06（教师：「**全回原版**」）：这一段原来钉的是「**必须**有一份自定义边
   *   （`FlowLabelEdge`）+ `FLOW_EDGE_TYPE` 不许是内置类型 + `edgeTypes` 必须注册」——
   *   那条要求已被教师推翻：边交回库内置的 `smoothstep`，线、标签、箭头全归库管。
   * ⇒ 现在反过来钉「**不许**再长出那一套」。
   *
   * ⚠️ 上面那三条（`FlowEdgeLine` / `EdgeLabelRenderer` / `edge-mid` / `data-nodeid` /
   *    `HANDLE_GAP`）**仍然有效**，与「标签摆哪儿」无关 —— 它们记的是库的结构限制
   *    （那颗中点句柄只能「接」不能「起」、还吞掉中点的单击/双击）。
   * ⚠️ 下面「归一化」那条判据也仍然有效：`visibleEdges` 还是要把所有边归到同一个类型
   *    （老作答里存着 `'flow'` / `'flowLabel'` 这些我们自造的名字）。
   */
  /*
   * ★ 2026-10-07（教师）：又注册了一份自定义边 —— 但它**不是** 2026-10-06 删掉的那份
   *   （`FlowLabelEdge`，那版还顺手把标签挪到了线旁边）。
   * 🔴 关键区别：**类型名是我們自己造的**（`FLOW_EDGE_TYPE !== 'smoothstep'`）⇒ `edgeTypes`
   *   注册的是**新增**的一种边，而不是**替换**库内置的那份；而且新那份**不碰标签**
   *   （`label`/`labelX`/`labelY`/`labelShowBg` 原样转交给 `BaseEdge`）。
   */
  const edgeTypeName = (live.match(/const FLOW_EDGE_TYPE = '([^']+)'/) ?? [])[1];
  assert.ok(edgeTypeName, '没有命名常量 FLOW_EDGE_TYPE');
  assert.notEqual(edgeTypeName, 'smoothstep',
    `FLOW_EDGE_TYPE=${edgeTypeName} —— 用库内置的名字会**替换**掉库那份，而不是新增一种`);
  assert.match(live, /edgeTypes=\{edgeTypes\}/, '`<ReactFlow>` 没有接上 edgeTypes');
  assert.ok(!/FlowLabelEdge/.test(live),
    '`FlowLabelEdge`（2026-10-06 那份「顺手挪标签」的自定义边）又回来了 —— 教师否掉的是那个');
  // ② 旧类型记号**全部**规范化成它（只换 `'flow'` 不够：上一版把 `'smoothstep'` 写进了作答）。
  const normalizesAll = (source: string): boolean => {
    const body = blockAfter(source, 'const visibleEdges = useMemo', '[edges, snapCandidateId]');
    return /edge\.type === FLOW_EDGE_TYPE \? edge : \{ \.\.\.edge, type: FLOW_EDGE_TYPE \}/.test(body);
  };
  assert.ok(normalizesAll(live), '`visibleEdges` 没有把所有非本类型的边规范化 —— 老作答里的内置类型会让标签继续压线');
  assert.ok(!/\.map\(\(edge\) => \(\{ \.\.\.edge, type: 'flow' \}\)\)/.test(live),
    "`visibleEdges` 又给每条边强制 `type: 'flow'` 了（那是已删的自定义边记号）");
  // ⚠️ 反面对照：只换 `'flow'`（回到旧写法）⇒ 上面那条必须红。
  const legacyOnly = live.replace('edge.type === FLOW_EDGE_TYPE ? edge : { ...edge, type: FLOW_EDGE_TYPE }',
    "edge.type === 'flow' ? { ...edge, type: FLOW_EDGE_TYPE } : edge");
  assert.notEqual(legacyOnly, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!normalizesAll(legacyOnly), '反面对照没被抓住 —— 这条判据是恒真的');
  /*
   * ★ 2026-10-06（「全回原版」）：这里原来钉的是「线上的字由**我们自己**那份边摆 ⇒ 配色写在
   *   `.flowEdgeLabel` 上、而且**不许**有 `.react-flow__edge-textbg`（白底框）」。
   *   标签交回库之后那份样式作废了 ⇒ 反过来钉：**不许**再留着它 ——
   *   留着的唯一效果是骗下一个人以为标签还是我们摆的。
   */
  assert.ok(!/\.flowEdgeLabel/.test(css),
    '`.flowEdgeLabel` 还留在样式表里 —— 标签已交回库，这份样式不会再被任何元素用上');
  // ③ 拆线只留**一份实现**：声明恰好一处、而且吸附那一路真的调用它（它现在也是唯一一条入口）。
  const splitBody = splitEdgeSource(live);
  assert.ok(splitBody.length > 400, '拆线的那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.equal(splitterDecls(live), 1, '拆线实现不止一份（多处各写一遍必然分叉：一条路一种拆法）');
  assert.ok(splitterCalls(live) >= 1, '拆线那一份实现根本没人调用 —— 这个交互等于没了');
  const endBody = onConnectEndSource(live);
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(endBody, /splitEdgeAt\(/, '吸附那一路没有走那一份拆线实现');
  assert.match(splitBody, /kind: 'junction'/, '没有插 junction 节点');
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/, '交点没有落在库算出来的标签点上（流坐标）');
  assert.ok(!/viewport/.test(splitBody), '交点的位置用了视口/屏幕坐标（画布一动就飘）');
  // 拆线的两步：① 原边变「原 source → 交点」；② 交点 → 原 target（过一次 addEdge）。
  assert.match(splitBody, /const head: Edge = \{ \.\.\.original, target: junctionId/, '原边没有被改成「原 source → 交点」那一段');
  // ⚠️ 断言到 `filter(...)` 为止，**不钉整句**：这一句后面还要排进学生拉的那根线（见下一条用例），
  //    钉住右括号等于「加了 link 就红」—— 那正是今天红过好几次的那种格式断言。
  assert.match(splitBody, /addEdge\(tail, current\.filter\(\(edge\) => edge\.id !== original\.id\)/, '没有把原边摘掉、再用 addEdge 接上第二段');
  // ④ `onConnect` 不再认「落点是边」（那条凭据已经不存在）—— 它只处理「落点是节点」。
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 200, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/hitEdge/.test(onConnectBody), '`onConnect` 又在认「落点是边」了 —— 自定义边删掉之后没有任何句柄会回一个边 id');
  assert.match(onConnectBody, /addEdge\(\{[\s\S]{0,40}\.\.\.connection/, '「落点是节点」那一支没有把 connection 交给库的 addEdge（最基本的「框 → 框」连线会断）');
  // ⑤ 交点画成**小圆点**（不承袭 .flowNode 的 150×54），而且**没有**文字输入框。
  //    ★ 2026-10-06（教师截图）：「**大大的圆点其实是不需要的**」⇒ 从 12×12 的实心深色点
  //      改成 8×8 的**描边空心小环**。判据按语义：
  //      ① 尺寸**读 CSS 里那个数**（不逐字钉 8）；② 组件里那个 `junctionHalf` 必须正好是它的一半
  //      （节点 position 是左上角，对不上线就会岔开）—— 这条把两份常量对起来；
  //      ③ 尺寸明显**变小**了；④ 不再是「实心深色」。
  const junctionRuleAt = css.indexOf('.flowNode_junction {');
  assert.notEqual(junctionRuleAt, -1, '样式表里没有 `.flowNode_junction` 那条规则 —— 先修这条判据');
  const junctionRule = css.slice(junctionRuleAt, css.indexOf('}', junctionRuleAt) + 1);
  assert.ok(junctionRule.length > 40, '`.flowNode_junction` 那条规则没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ⚠️ `[^-]width:` 才不会命中 `min-width:`（`box-sizing: border-box` 下宽高含描边 ⇒ 这就是外框）。
  const junctionSize = Number((junctionRule.match(/[^-]width:\s*(\d+)px/) ?? [])[1]);
  assert.ok(Number.isFinite(junctionSize) && junctionSize > 0, `没有读到交点的尺寸（读到 ${junctionSize}）`);
  const junctionHalfRaw = Number((live.match(/const junctionHalf = (\d+);/) ?? [])[1]);
  assert.ok(Number.isFinite(junctionHalfRaw), '没有读到拆线里那个 `junctionHalf` 常量');
  assert.equal(junctionHalfRaw * 2, junctionSize,
    `交点半径常量（${junctionHalfRaw}）与 CSS 里的尺寸（${junctionSize}px）对不上 —— 圆点会偏离精确中点`);
  // ⚠️ `min-width/min-height` 也必须写死成同一个数：少了它们，交点会承袭 `.flowNode` 的 150×54。
  const junctionMin = Number((junctionRule.match(/min-width:\s*(\d+)px/) ?? [])[1]);
  assert.equal(junctionMin, junctionSize, '交点的 min-width 没跟着尺寸走（会承袭 .flowNode 的 150×54）');
  assert.ok(junctionSize <= 10, `交点圆点还是太大（${junctionSize}px）—— 教师：「大大的圆点其实是不需要的」`);
  assert.match(junctionRule, /border-radius: 50%/, '交点不是圆点');
  // 减淡：不许再是「实心深色大圆」⇒ 要么空心（白底 + 描边），要么至少不再是原来那个深色实心。
  const hollow = /background:\s*#fff/i.test(junctionRule) && /border:\s*[^;]*solid/i.test(junctionRule);
  assert.ok(hollow, '交点又变回实心点了（教师要求「缩小/减淡」—— 空心环 + 描边才对得上参考图里的干净线条）');
  assert.ok(!/background:\s*#365b82/.test(junctionRule), '交点的填充还是原来那个深色实心（教师截图里那个大圆点）');
  // ⚠️ 反面对照：把尺寸改回 12×12 的实心深色 ⇒ 上面那三条必须红（证明判据不是恒真的）。
  const bigBack = junctionRule.replace(/width:\s*\d+px/, 'width: 12px').replace(/background:\s*#fff/i, 'background: #365b82').replace(/border:\s*2px solid #6b86a5/, 'border: 0');
  assert.notEqual(bigBack, junctionRule, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!(/background:\s*#fff/i.test(bigBack) && /border:\s*[^;]*solid/i.test(bigBack)), '反面对照没被抓住 —— 这条判据是恒真的');
  const editorBody = editorBodyOf(live);
  assert.ok(editorBody.length > 400, '节点编辑器没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(editorBody, /const isJunction = data\.kind === 'junction'/, '没有认出 junction 这一档');
  assert.match(editorBody, /\{!isJunction && \(editing && !data\.locked \? \(\s*<input[\s\S]{0,240}?aria-label="节点文字"/, '交点也会渲染「节点文字」输入框（图上会多一个空框）');
  // ⑥ 死 CSS / 死类名都不许留在样式表或组件里。
  assert.ok(!/flowEdgeHandle/.test(css), '`.flowEdgeHandle`（中点句柄的样式）还留在样式表里 —— 那是已删机制的类');
  assert.ok(!/flowEdgeHandle/.test(live), '组件还在挂中点句柄的类名');
});

/*
  ⊘ 2026-10-06（教师：「**全回原版**」）：这里原有整条判据「线标签摆在**线的旁边**（竖线 ⇒ 右侧 /
    横线 ⇒ 上方），不压线」—— 它是围着自定义边（\`FlowLabelEdge\` + \`EDGE_LABEL_GAP\`）写的。
    教师看过原版行为之后定了「全回原版」：标签交回库（中点 + 白底框），那条要求连同它的判据一起撤了。
    ⚠️ 若将来又要「标签摆在线旁」，这份判据的原文在 git 历史里（commit 315198b 之后的那几批）。
    相关的还有 \`worksheet-flowchart-svg.test.ts\` 里的「快照与画板标签摆法一致」——
    那一条是**跨文件绑定**，改画板时它必须一起改（本轮也一起处理了）。
*/
test('★ 2026-10-06（教师报「连线加不上」）：连到线中点时，**学生拉的那根线本身**必须真的接上', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 实测（无头 Chrome 154 + 教师那张真底稿 `q_aac88ed0…`，用 CDP 真合成事件、跑本仓真组件）：
      · 修前（HEAD 0bc9609，同一拖、同一落点：从「过程」框的右句柄拖到另一条线的中点）：
        交点也插了、原线也拆成两段了 —— 但**学生拉的那根线没有被加进去**：交出去的 edges 只从 4 条
        变 5 条（那 5 条 = 原线拆出来的两段），作答里只有 `junction-…-tail`。
        ⇒ 屏幕上预览线一松手就没了、原线看上去还是原来那根（只是线上多了个小点）
        ⇒ 教师看到的就是「连线没有出现」。
      · 修后：同一拖、同一落点 ⇒ DOM 里的边 4 **→ 6**，作答里多出 `junction-…-link`
        （过程框 → 交点）—— 学生画的那根线真的出现了。
      · ★ 本轮（自定义边删掉之后）复测：鼠标与触屏、source 句柄与 target 句柄四个组合
        都仍是 DOM 边 1→3、节点 3→4、作答里 `junction-…-tail` + `junction-…-link` 两条都在。
    ⚠️ 判据按**语义**判：拆线那一份实现里必须出现一根「一端是交点、另一端是学生那一拖的那一端」
      的边，而且必须真的排进「加边」那句的返回数组里；**不**逐字钉三元表达式或返回语句的写法
      （今天已经因为钉格式红过五六次）。
  */
  /** 拆线那一份实现 —— 「拆线」与「接上学生那一拖」都住在这里（本轮起它也是**唯一**一条入口的实现）。 */
  const splitBody = splitEdgeSource(live);
  assert.ok(splitBody.length > 400, '拆线那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const missingLink = (branch: string): string[] => {
    const missing: string[] = [];
    const at = branch.indexOf('const link: Edge');
    // ⚠️ 找不到那一句时必须把**已经攒下的缺失**一起返回：`return missing`（空数组）会让反面对照恒真
    //    —— 「拆线那一份里没有 link」这件事就悄悄变成「没有意见」（实测踩过）。
    if (at === -1) return [...missing, '根本没有给学生拉的那根线建边（只拆原线）'];
    const end = branch.indexOf('addEdge(', at);
    const body = end === -1 ? branch.slice(at) : branch.slice(at, end);
    if (!/junctionId[\s\S]{0,240}?endpointId/.test(body)) missing.push('少了「交点 → 学生拖到的那一端」那一向');
    if (!/endpointId[\s\S]{0,240}?junctionId/.test(body)) missing.push('少了「学生拖出的那一端 → 交点」那一向');
    const tailAt = branch.indexOf('addEdge(tail,');
    if (tailAt === -1) missing.push('第二段没走 addEdge');
    else if (!/\blink\b/.test(branch.slice(tailAt, branch.indexOf(';', tailAt)))) missing.push('link 只被声明、没排进返回的边数组（等于没接上）');
    return missing;
  };
  assert.deepEqual(missingLink(splitBody), [],
    `连到线中点时，学生拉的那根线没接上：${missingLink(splitBody).join('、')}（教师报的「连线加不上」就是它）`);
  // ⚠️ 反面对照：把「接上学生那一拖」整段拿掉（回到修前那种「只拆不接」）⇒ 必须判违规。
  const withoutLink = splitBody.replace(/const link: Edge[\s\S]*?(?=return \[)/, '');
  assert.notEqual(withoutLink, splitBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.notDeepEqual(missingLink(withoutLink), [], '反面对照没被抓住 —— 这条判据是恒真的');
  // ② 唯一的入口（吸附）**必须**把两端交给它（不然拆线永远不响、等于这个交互没了）。
  const endBody = onConnectEndSource(live);
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(endBody, /splitEdgeAt\(/, '吸附那一路没有把两端交给那一份拆线实现');
  // ⚠️ 反面对照：把那次调用掐掉 ⇒ 必须判违规。
  assert.ok(!/splitEdgeAt\(/.test(endBody.replace(/splitEdgeAt\([^;]*\);/, '')), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⚠️ 反向也要认：任何地方都绝不能把**边 id** 当成节点 id 用（实测：那种边渲染不出来，却会写进作答）。
  assert.ok(!/source: hitEdge\.id|target: hitEdge\.id/.test(live), '把边 id 当成节点用了 —— 那条边渲染不出来（悬空边）');
});

test('★ 2026-10-06（教师：「拖到线附近松手也要能连上」）：落点吸附 —— 几何兜底 + 唯一一份拆线实现', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const endBody = onConnectEndSource(live);
  const nearestBody = nearestEdgeSource(live);
  const splitBody = splitEdgeSource(live);
  /*
    🔴 实测（无头 Chrome 154 + CDP 真合成事件，跑本仓真组件；探针只放 /private/tmp）。
       ★ 本轮复测的是**自定义边删掉之后**的（B）——它现在是「连到线上」唯一的一条路，
         所以「精确命中线上中点」这一格也归它管（以前那一格由库的句柄接住）。

       · 鼠标（从 n3 句柄拖到 e1 中点，落点相对中点偏 dx）：
         dx = **0 / 15 / 20px ⇒ 都连上**（DOM 边 1→3、节点 3→4、恰好 1 个交点，
         作答里 `junction-…-tail` + `junction-…-link` 都在）；
         dx = **25px ⇒ 什么都不做**；拖到空白（中点左 300px）⇒ 什么都不做。
       · 触屏（`setTouchEmulationEnabled` + `dispatchTouchEvent`，touchStart→touchMove×10→touchEnd）：
         **同一组数字**：0 / 15 / 20px 连上，25px 不连 —— 0px 那一格是这轮的重点。
       · 「框的句柄 → 线上」两个子方向（source 句柄 / target 句柄）鼠标 + 触屏四个组合全部连上。

    ⚠️ 也试过「先把句柄自己撑大」那条最便宜的路（36 / 40px 的透明命中层）：连接确实好了，但
      探针量出来 `elementFromPoint(线上 Y/N 标签中心)` 会返回**句柄** ⇒「双击线上的字改文字」
      当场坏掉（那个盒子把标签白底框的下半截吃掉了）⇒ 那条路废弃，「撑大」不再出现在代码里。
  */
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(nearestBody.length > 200, '「离最近那条边」那一份算法没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ① 半径必须是**命名常量**（数值只在组件里声明一次）。
  const radiusRaw = (live.match(/const EDGE_SNAP_RADIUS = ([^;]+);/) ?? [])[1];
  assert.ok(radiusRaw !== undefined, '没有命名常量 EDGE_SNAP_RADIUS（吸附半径会变成散落的魔法数）');
  const radius = Number(new Function(`return (${radiusRaw});`)());
  assert.ok(radius > 0, `EDGE_SNAP_RADIUS 不是正数（读到 ${radiusRaw}）`);
  assert.ok(nearestBody.includes('EDGE_SNAP_RADIUS') && endBody.includes('EDGE_SNAP_RADIUS'),
    '吸附没有用命名常量 EDGE_SNAP_RADIUS 做半径');
  // ② 「同一次拖拽只能生效一次」：置位在**那一份拆线实现**里、吸附进来先看它。
  assert.match(live, /handledRef/, '没有「这一拖已经生效过」的记号 —— 同一次拖拽会插两个交点');
  assert.match(endBody, /handledRef\.current/, '吸附没有先看「已经生效过」这个记号（会与库那一次重复插交点）');
  assert.match(splitBody, /handledRef\.current = true/, '「已经生效过」的记号没有在**拆线那一份实现**里置位');
  // ⚠️ 反面对照：把吸附那道闸拿掉 ⇒ 上面那条必须红。
  const headless = endBody.replace('if (handledRef.current) return;', '');
  assert.notEqual(headless, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/handledRef\.current/.test(headless), '反面对照没被抓住 —— 这条判据是恒真的');
  // ③ 只许有**一份**拆线实现，而且吸附那一路必须走它。
  const usesSplitter = (body: string) => /splitEdgeAt\(/.test(body);
  assert.equal(splitterDecls(live), 1, '拆线出现了**多份**实现（多处各写一遍必然分叉：一条路一种拆法）');
  assert.ok(usesSplitter(endBody), '吸附没有走那一份拆线实现（自己又写一遍 = 两条路的拆法必然分叉）');
  // ⚠️ 反面对照：把吸附那次调用掐掉 ⇒ 必须判违规。
  const noApply = endBody.replace(/splitEdgeAt\([^;]*\);/, '');
  assert.notEqual(noApply, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!usesSplitter(noApply), '反面对照没被抓住 —— 这条判据是恒真的');
  // ④ 🔴 拖到空白**不许**插交点：必须有「最近的一条边」这个筛选，而且**找不到就走人**。
  //    ⚠️ 筛选住在 `nearestEdgeAt` 里（吸附与拖动中高亮**共用**那一份）⇒ 判据要跟过去判，
  //       留在 `onConnectEnd` 里判会变成「恒假」（那段里已经没有循环了）。
  const blankDropOk = (body: string): boolean => {
    const filterAt = body.search(/distance\s*>\s*EDGE_SNAP_RADIUS/);
    if (filterAt === -1) return false;
    const after = body.slice(filterAt);
    return /nearest\s*=/.test(after);
  };
  assert.ok(blankDropOk(nearestBody), '没有「离最近那条边还在半径外就不选它」这道闸 —— 拖到空白也会插一个交点出来');
  assert.match(endBody, /if \(!nearest\) return;/, '吸附拿到「没有候选」时没有整段走人（拖到空白也会插一个交点出来）');
  // ⚠️ 反面对照：把半径那道筛选改成恒真（永远「够近」）⇒ 必须判违规。
  const alwaysNear = nearestBody.replace(/distance\s*>\s*EDGE_SNAP_RADIUS/, 'false');
  assert.notEqual(alwaysNear, nearestBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!blankDropOk(alwaysNear), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 半径筛的是**到那一段的锚点距离**，不是「指针下有没有边」这种 DOM 猜测。
  assert.match(nearestBody, /edgeFlowAnchors\(/, '没有用锚点表算距离（拿不到「这条线在哪」）');
  assert.match(nearestBody, /midX|midY/, '没有用库算出来的标签点当中点');
  // ⑥ 🔴 **精确命中线上中点**那一格（这轮最容易漏的一条：以前它由库的句柄接住）。
  //    两条语义：
  //      · 「落点在线上」**不是**让位的理由 —— 让位条件只认**句柄**（`.react-flow__handle`）。
  //        实测：正落在中点时 `elementFromPoint` 拿到的是**边**（标签白底框 / 交互 path），
  //        一旦把让位条件写成「落点是不是边」，0px 那一格当场连不上（而 15/20px 仍好）。
  //      · 半径只有**上界**：不许出现「太近也不连」的下界（那样恰好把 0px 排除掉）。
  const onLineBails = /react-flow__edge/.test(endBody);
  assert.ok(!onLineBails, '吸附把「落点在线上」当成让位条件 —— 正落在中点会连不上（那一格现在是它的责任）');
  // ⚠️ 判据要**认得出下界**、又不能误伤「比上一个候选更近」那句（`distance < nearest.distance`）：
  //    下界只会拿**半径常量或数字**去比，所以只认这两种写法。
  const lowerBound = (body: string) => /distance\s*<\s*(EDGE_SNAP_RADIUS|\d)|distance\s*<=\s*0|distance\s*===\s*0/.test(body);
  assert.ok(!lowerBound(nearestBody), '「离得最近」那道闸带了**下界** —— 距离为 0（正落在中点）会被排除掉');
  // ⚠️ 反面对照：给筛选加一条下界 ⇒ 上面那条必须红（证明它不是恒真）。
  const withLowerBound = nearestBody.replace('if (distance > EDGE_SNAP_RADIUS) continue;', 'if (distance < 1 || distance > EDGE_SNAP_RADIUS) continue;');
  assert.notEqual(withLowerBound, nearestBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(lowerBound(withLowerBound), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⚠️ 反面对照：往让位那句里塞一条「落点是边就让位」⇒ 上面那条必须红（证明它不是恒真）。
  const bailOnEdge = endBody.replace("hit.closest('.react-flow__handle')", "hit.closest('.react-flow__edge')");
  assert.notEqual(bailOnEdge, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(/react-flow__edge/.test(bailOnEdge), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑦ 交点必须落在**精确中点**（吸附只决定「连哪条线」，不许把浮层偏移卷进来）。
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/,
    '吸附那条路把交点挪离了精确中点 —— 拆出来的两段会与原线对不上');
  assert.ok(!/offsetAlong|HANDLE_GAP|clampOffset/.test(splitBody), '拆线里混进了浮层偏移（交点会跟着浮层走）');
  // ⑧ ★ 拖动中高亮用的必须是**同一份**距离算法（两份必然分叉：高亮 A、真吸上去 B）。
  const hlBody = highlightEffectSource(live);
  assert.ok(hlBody.length > 200, '拖动中高亮那段 effect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(hlBody, /nearestEdgeAt\(/, '拖动中高亮没有用与吸附同一份 `nearestEdgeAt`（会高亮到另一条线）');
});

test('★ 2026-10-06（教师拍板）：四个工具按钮用**教材名称**，而「放到画布上的默认文字」一个字不动', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    ★ 教师 2026-10-06（截图圈了那四颗按钮 + 「这些文字都没有改」）拍板：按钮上用**信息科技课
      教材的名称** —— 起止框 / 处理框 / 判断框 / 输入输出框。
    🔴 **按钮文字 ≠ 节点默认文字**，这是两件事，别统一回去：
      · 按钮文字 = **形状的名字**（教材术语，学生按课本找得到）；
      · `addNode(kind, '…')` 的第二个参数 = 放到画布上以后**框里默认写的内容**
        （「开始/结束」「处理过程」「判断条件」「输入/输出」）。
    ⇒ 这条用例**两边一起钉**：可见文字必须是教材名称，默认标签必须仍是内容。
    ⚠️ 判据从 JSX 里**按结构抠**（`addNode('kind', '默认文字')…</svg>可见文字</button>`），
      不逐字钉整行 —— 改 className / 图标不会红，改文字才会。
  */
  const toolbar = blockAfter(live, 'role="toolbar" aria-label="流程图工具"', '</div>');
  assert.ok(toolbar.length > 500, '工具条没抠出来 —— 先修这条判据，别让它在空串上全绿');
  /** 四颗加节点按钮：`addNode('kind', '默认文字')` 后面紧跟的可见文字。 */
  const buttonsOf = (source: string) => [...source.matchAll(/addNode\('(\w+)',\s*'([^']*)'\)[\s\S]{0,260}?<\/svg>([^<]*)<\/button>/g)]
    .map((match) => ({ kind: match[1], defaultLabel: match[2], text: match[3] }));
  const kinds = ['terminator', 'process', 'decision', 'io'];
  const buttons = buttonsOf(toolbar);
  assert.equal(buttons.length, 4, `四颗加节点按钮没抠出来（抠到 ${buttons.length} 颗）—— 先修这条判据，别让它在空串上全绿`);
  const byKind = new Map(buttons.map((button) => [button.kind, button]));
  for (const kind of kinds) assert.ok(byKind.has(kind), `工具条里少了 ${kind} 那一颗按钮`);
  // ① 可见文字 = 教材名称。
  assert.deepEqual(kinds.map((kind) => byKind.get(kind)?.text),
    ['起止框', '处理框', '判断框', '输入输出框'],
    '四颗按钮的可见文字不是教材名称（起止框 / 处理框 / 判断框 / 输入输出框）');
  // ② 而 `addNode` 的**默认标签**（放到画布上以后框里写什么）必须仍是「内容」。
  assert.deepEqual(kinds.map((kind) => byKind.get(kind)?.defaultLabel),
    ['开始/结束', '处理过程', '判断条件', '输入/输出'],
    '节点默认文字被一起改了 —— 按钮文字是**形状名**，节点默认文字是**框里的内容**，两件事不许统一');
  // ⚠️ 反面对照 1：把按钮文字改回旧写法（内容）⇒ 必须判违规。
  const oldButtonText = toolbar.replace('</svg>起止框</button>', '</svg>开始/结束</button>');
  assert.notEqual(oldButtonText, toolbar, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.notDeepEqual(kinds.map((kind) => buttonsOf(oldButtonText).find((b) => b.kind === kind)?.text),
    ['起止框', '处理框', '判断框', '输入输出框'], '反面对照没被抓住 —— 这条判据是恒真的');
  // ⚠️ 反面对照 2：把**默认标签**也改成教材名称 ⇒ 必须判违规（证明两件事是分开钉的）。
  const wrongDefault = toolbar.replace("addNode('terminator', '开始/结束')", "addNode('terminator', '起止框')");
  assert.notEqual(wrongDefault, toolbar, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.notDeepEqual(kinds.map((kind) => buttonsOf(wrongDefault).find((b) => b.kind === kind)?.defaultLabel),
    ['开始/结束', '处理过程', '判断条件', '输入/输出'], '反面对照没被抓住 —— 默认标签那条判据是恒真的');
});

test('★ 2026-10-06（教师拍板 + 参考图）：判断框出边的**默认**标注是「是 / 否」（工具条那五个快按钮不动）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    ★ 教师 2026-10-06（回话）：「判断框默认标注改成『是 / 否』」（与参考图一致）。
    🔴 **只改默认值**：已经存在的作答 / 底稿里那条 `label: 'Y'` **不许迁移**（照原样渲染）——
      数据不动、不做兼容层（`toFlowPayload` / `readFlowchartPayload` 都不碰 `label`）。
    🔴 计数逻辑一个字不动：0 条已标注的出边 ⇒ 第一个、1 条 ⇒ 第二个、**再多不猜**。
    ⚠️ 判据是**真调用**那个纯函数（喂 0/1/2/3），不是在源码里猜三元表达式的写法。
  */
  // ① 命名常量：默认标注必须是「是 / 否」。
  const labelsRaw = (live.match(/const DECISION_BRANCH_LABELS = (\[[^\]]*\])(?:\s+as const)?;/) ?? [])[1];
  assert.ok(labelsRaw, '没有命名常量 DECISION_BRANCH_LABELS（默认标注会变成散落的字面量）');
  const labels = new Function(`return (${labelsRaw});`)() as string[];
  assert.deepEqual(labels, ['是', '否'], '判断框出边的默认标注不是「是 / 否」（教师已拍板，参考图也是汉字）');
  // ② 计数语义：把那个纯函数**抠出来真跑**（0 ⇒ 是、1 ⇒ 否、更多 ⇒ 不给）。
  const decl = live.indexOf('const decisionBranchLabel: ');
  assert.notEqual(decl, -1, '没有模块级的 `decisionBranchLabel` 纯函数（计数语义没法真调用验）');
  const arrow = live.indexOf('= (', decl);
  const end = arrow === -1 ? -1 : live.indexOf('\n};', arrow);
  assert.ok(arrow !== -1 && end !== -1, '`decisionBranchLabel` 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const body = live.slice(arrow + 2, end + 3);
  const build = (source: string) => new Function(
    `const DECISION_BRANCH_LABELS = ${labelsRaw};\nconst decisionBranchLabel = ${source}\nreturn decisionBranchLabel;`,
  )() as (used: number) => string | undefined;
  const decisionBranchLabel = build(body);
  assert.equal(decisionBranchLabel(0), '是', '第一条出边的默认标注不是「是」');
  assert.equal(decisionBranchLabel(1), '否', '第二条出边的默认标注不是「否」');
  assert.equal(decisionBranchLabel(2), undefined, '第三条出边也硬凑了一个字 —— 计数逻辑要求「再多就不猜」');
  assert.equal(decisionBranchLabel(3), undefined, '第四条出边也硬凑了一个字 —— 计数逻辑要求「再多就不猜」');
  // ⚠️ 反面对照：把计数改成「恒定给第一个」⇒ 上面那条必须被抓住（证明判据不是恒真的）。
  const alwaysFirst = body.replace(/DECISION_BRANCH_LABELS\[used\]/, 'DECISION_BRANCH_LABELS[0]');
  assert.notEqual(alwaysFirst, body, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.notEqual(build(alwaysFirst)(1), '否', '反面对照没被抓住 —— 「0→第一个 / 1→第二个」这条计数判据是恒真的');
  // ③ 接线：`onConnect` 里判断框那一支必须走它（计数仍然按「这个判断框已有几条带标注的出边」）。
  const onConnectBody = onConnectSource(live);
  assert.match(onConnectBody, /decisionBranchLabel\(used\)/, '判断框的出边没有走那个默认标注的映射');
  assert.match(onConnectBody, /filter\(\(edge\) => edge\.source === connection\.source && edge\.label\)\.length/,
    '计数不再是「这个判断框已有几条带标注的出边」');
  // ④ 工具条那五个**快按钮**一个字都不动（学生想用字母随时点）。
  assert.match(live, /\['Y', 'N', '是', '否'\]\.map/, '工具条那五个快按钮（Y / N / 是 / 否 / 清空）被改了');
  // ⑤ 不做数据迁移：`label` 读写两条路都不许被碰。
  assert.ok(!/'Y'/.test(live.replace(/\['Y', 'N', '是', '否'\]/, '')), "代码里又在写死一个 'Y'（老数据不许迁移，新默认值也不该是字母）");
});

test('★ 2026-10-06（教师截图）：**框的句柄优先** —— 落点附近有节点句柄就让位给库（不再吸到框下那条竖线上）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 教师截图里那个病（逐字）：「一条从右侧绕回来的线，本来应该直接以一个向左的箭头进入
       『处理过程』框的右侧；实际却吸附到框下方那条竖线上、把竖线拆成了两段并留下一个交点」
       ⇒ 画面上多出一个大大的圆点，箭头也变成从上往下进框底。
    根因：兜底原来**只**看「落点正下方压着 `.react-flow__handle`」—— 学生拖到框**附近**时
      落点没压住那颗 10px 的句柄，于是照旧按距离去吸线下那条竖线。
    ⇒ 判据改成**句柄优先**：落点 ≤ `NODE_HANDLE_PRIORITY_RADIUS`（比 `EDGE_SNAP_RADIUS` 大）内有
      **某个节点句柄** ⇒ 整段兜底不做（让库自己去连那个框）。
    ⚠️ 这一条**不逐字钉写法**：只认「吸附那一路里有一句『附近有句柄就 return』」这件事，
      以及「那个半径是命名常量、比吸附半径大、而且与库的 `connectionRadius` 是同一个值」。
    📏 实测数字（无头 Chrome + CDP，真组件）：离右侧句柄 10/20/30/40px ⇒ 连框；拖到线中点附近
      （离任何句柄都很远）⇒ 仍走 22px 吸附、连线上。
  */
  const endBody = onConnectEndSource(live);
  assert.ok(endBody.length > 400, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ① 半径是**命名常量**，而且**比吸附半径大**（否则「框的句柄优先」只是把吸附半径再缩一圈）。
  const rawPriority = (live.match(/const NODE_HANDLE_PRIORITY_RADIUS = ([^;]+);/) ?? [])[1];
  assert.ok(rawPriority !== undefined, '没有命名常量 NODE_HANDLE_PRIORITY_RADIUS（节点优先半径会变成魔法数）');
  const priority = Number(new Function(`return (${rawPriority});`)());
  const snapRadius = Number(new Function(`return (${(live.match(/const EDGE_SNAP_RADIUS = ([^;]+);/) ?? [])[1]});`)());
  assert.ok(priority > 0 && Number.isFinite(priority), `NODE_HANDLE_PRIORITY_RADIUS 不是正数（读到 ${rawPriority}）`);
  assert.ok(priority > snapRadius, `节点优先半径（${priority}）没有比吸附半径（${snapRadius}）大 —— 「拖到框附近连框」不会发生`);
  // ② 「附近有没有句柄」是**独立的一份距离算法**，用的是那四个句柄（不是节点中心）。
  const handleBody = blockAfter(live, 'const nearestHandleAt = useCallback(', '\n  }, [');
  assert.ok(handleBody.length > 150, '「落点附近有没有句柄」那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(handleBody, /NODE_HANDLE_PRIORITY_RADIUS/, '句柄距离没有用命名常量 NODE_HANDLE_PRIORITY_RADIUS');
  assert.match(handleBody, /FLOW_HANDLE_IDS/, '句柄距离不是按四个句柄逐个算的（只算节点中心会误判「离框近」）');
  assert.match(handleBody, /handleFlowPoint\(/, '句柄的屏幕坐标没有走既有的 `handleFlowPoint`（两份算法必然分叉）');
  // ⚠️ 必须**排除这一拖的起点句柄本身**（与库 `getClosestHandle` 跳过 `fromHandle` 一致）。
  assert.match(handleBody, /handleId === origin\.handleId/, '没有排除「这一拖的起点句柄」—— 从那颗句柄拖出去一点点会被自己挡住');
  // ③ 接线：吸附那一路先问「附近有没有句柄」，有就整段走人；而且这一句必须排在拆线调用**之前**。
  const bailsOnNearbyHandle = (body: string) => /nearestHandleAt\(/.test(body) && /nearestHandleAt\([^;]*\)\s*\)\s*return;/.test(body);
  assert.ok(bailsOnNearbyHandle(endBody), '吸附那一路没有「落点附近有句柄就让位」这道闸（教师截图那一格会继续吸到竖线上）');
  const bailAt = endBody.indexOf('nearestHandleAt(');
  const splitAt = endBody.indexOf('splitEdgeAt(');
  assert.ok(bailAt !== -1 && splitAt !== -1 && bailAt < splitAt, '「让位」那句排在了拆线之后 —— 等于没让位');
  // ⚠️ 反面对照：把让位那句拿掉 ⇒ 必须判违规（证明这条判据不是恒真的）。
  const noBail = endBody.replace(/if \(nearestHandleAt\([^;]*\)\) return;/, '');
  assert.notEqual(noBail, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!bailsOnNearbyHandle(noBail), '反面对照没被抓住 —— 这条判据是恒真的');
  // ④ 库那边必须落在**同一个屏幕半径**上：`connectionRadius` 比的是**流坐标**（`getClosestHandle`
  //    + `pointToRendererPoint` 两端都是流坐标）⇒ 必须把让位半径除以 zoom 再传进去。
  //    ⚠️ 直接传 `NODE_HANDLE_PRIORITY_RADIUS`（当成流单位）会让库那边的屏幕半径变成 40×zoom
  //      —— zoom>1 时那一圈里「库连了框」与「兜底吸了线」会**同时**发生（实测 zoom=1.42 时是 57px）。
  const sameScreenRadius = (source: string): boolean => /connectionRadius=\{NODE_HANDLE_PRIORITY_RADIUS \/ viewport\.zoom\}/.test(source);
  assert.ok(sameScreenRadius(live),
    '`<ReactFlow>` 的 connectionRadius 没有换算成屏幕半径（`NODE_HANDLE_PRIORITY_RADIUS / viewport.zoom`）—— 库与兜底的半径会错位成一圈环');
  assert.match(live, /connectionRadius=\{NODE_HANDLE_PRIORITY_RADIUS \/ viewport\.zoom\}/, '同上：接的必须是命名常量除以 zoom，不是别的写法');
  // ⚠️ 反面对照：把单位错误的那一版塞回去（当成流单位直接传）⇒ 必须判违规。
  const wrongUnit = live.replace('connectionRadius={NODE_HANDLE_PRIORITY_RADIUS / viewport.zoom}', 'connectionRadius={NODE_HANDLE_PRIORITY_RADIUS}');
  assert.notEqual(wrongUnit, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!sameScreenRadius(wrongUnit), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 既有行为不许被这次改动弄坏：22px 的吸附半径、拖到空白不插交点、精确命中中点仍能连。
  assert.match(live, /const EDGE_SNAP_RADIUS = 22;/, '22px 的吸附半径被改了（既有行为）');
  assert.match(endBody, /if \(!nearest\) return;/, '「拿到没有候选就走人」（拖到空白不插交点）被弄丢了');
});

test('★ 2026-10-06（可发现性补偿）：拖动连线**过程中**高亮「松手会吸上去的那条边」', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  /*
    ★ 为什么要补这一条：删掉中点句柄之后，「拖到线附近就能连」这件事在屏幕上**看不见**了 ——
      学生只能靠试。⇒ 拖动过程中把当前会吸附到的那条边先描出来。
    🔴 三条硬要求（每条都在下面钉住，并且都有反面对照）：
      ① **只有真的有候选时才挂类**（拖到空白 / 离最近那条线还在半径外 ⇒ 一个类都不挂）；
      ② **收尾要收干净**：正常松手（`onConnectEnd`）与拖拽被取消（指针抬起/取消那一族）都要清；
      ③ 样式**克制**：只是描边加粗换色，没有动画、没有发光 —— 学生端是老 iPad。
  */
  // ① 状态：候选边（`null` = 现在松手什么也不会发生）+ 「这一拖正在进行」的开关。
  assert.match(live, /const \[snapCandidateId, setSnapCandidateId\] = useState<string \| null>\(null\)/,
    '没有「当前会吸到哪条边」的状态（高亮无从谈起）');
  assert.match(live, /const \[connecting, setConnecting\] = useState\(false\)/,
    '没有「这一拖正在进行」的开关（高亮会在拖动结束后继续跟着指针跑）');
  // ② 逐边 `className`：**只在 id 命中时**挂（恒真 = 画布上永远有一条线是加粗的，学生分不出「能连」）。
  const visibleBody = blockAfter(live, 'const visibleEdges = useMemo', '[edges, snapCandidateId]');
  assert.ok(visibleBody.length > 120, '`visibleEdges` 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const attachesOnlyWhenHit = (body: string) => /edge\.id\s*===\s*snapCandidateId/.test(body) && /styles\.flowEdgeSnap/.test(body);
  assert.ok(attachesOnlyWhenHit(visibleBody), '`visibleEdges` 没有「命中候选才挂高亮类」这条判据');
  // ⚠️ 反面对照：把条件改成恒真（每条边都挂）⇒ 必须判违规。
  const alwaysSnap = visibleBody.replace(/edge\.id\s*===\s*snapCandidateId/, 'true');
  assert.notEqual(alwaysSnap, visibleBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!attachesOnlyWhenHit(alwaysSnap), '反面对照没被抓住 —— 这条判据是恒真的');
  // ③ 正常松手：`onConnectEnd` **在任何一个 return 之前**就把高亮收掉
  //    （拖到句柄上 / 拿不到落点 / 半径外 / 空白这几格都会提前 return）。
  const endBody = onConnectEndSource(live);
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const clearsHere = (body: string) => /setConnecting\(false\)/.test(body) && /setSnapCandidateId\(null\)/.test(body);
  assert.ok(clearsHere(endBody), '松手时没有把「拖动中」与候选边清掉（会留下一根永久高亮的线）');
  const firstReturn = endBody.indexOf('return');
  const clearAt = endBody.indexOf('setSnapCandidateId(null)');
  assert.ok(clearAt !== -1 && firstReturn !== -1 && clearAt < firstReturn,
    '清高亮排在第一个 `return` 之后 —— 「拖到句柄上 / 拿不到落点 / 半径外」那几格会留下永久高亮');
  // ④ 拖拽被取消：指针抬起 / 取消那一族也要清（`onConnectEnd` 不一定来）。
  const hlBody = highlightEffectSource(live);
  assert.ok(hlBody.length > 200, '拖动中高亮那段 effect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(clearsHere(hlBody), '拖拽被取消时没有把高亮收掉 —— 取消一次就留下一根永久高亮的线');
  // ⚠️ 判据**不认变量名**：先认出「会清状态的那个回调」，再看四个取消事件是不是都接到它身上。
  const stopDecl = hlBody.match(/const (\w+)\s*=\s*\(\)\s*=>\s*\{[^}]*setConnecting\(false\)[^}]*setSnapCandidateId\(null\)[^}]*\}/);
  assert.ok(stopDecl, '没有「清掉高亮」那一个回调（收尾只剩 onConnectEnd 一条路）');
  for (const ev of ["'pointerup'", "'pointercancel'", "'touchend'", "'touchcancel'"]) {
    assert.match(hlBody, new RegExp(`addEventListener\\(${ev},\\s*${stopDecl[1]}\\b`),
      `${ev} 没有接到「清掉高亮」那个回调上 —— 触屏/CDP 抬起指针的那一格会留下永久高亮`);
    assert.match(hlBody, new RegExp(`removeEventListener\\(${ev},\\s*${stopDecl[1]}\\b`),
      `清理里没有摘掉 ${ev} 的监听（拖完还被别人拿着引用）`);
  }
  // ⚠️ 反面对照：把 `pointerup` 从「清」改接成「跟踪」⇒ 上面那条必须红。
  const upTracks = hlBody.replace(/'pointerup',\s*(\w+)/, "'pointerup', track");
  assert.notEqual(upTracks, hlBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!new RegExp(`addEventListener\\('pointerup',\\s*${stopDecl[1]}\\b`).test(upTracks), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 拖动中跟踪指针：`pointermove` 与 `touchmove` **两个都听**（少一个，那类设备上高亮永远不出来）；
  //    坐标与距离都走**与吸附同一份**的东西（`pointerClientPoint` / `nearestEdgeAt`）。
  for (const ev of ["'pointermove'", "'touchmove'"]) {
    assert.match(hlBody, new RegExp(`addEventListener\\(${ev},\\s*\\w+`),
      `${ev} 没有听 —— 那类设备（鼠标 / 触屏）上「会吸到哪条边」高亮永远不出来`);
  }
  assert.match(hlBody, /pointerClientPoint\(event\)/, '拖动中高亮没有走坐标纯函数（触屏上拿不到落点）');
  assert.match(hlBody, /nearestEdgeAt\(/, '拖动中高亮没有用与吸附同一份 `nearestEdgeAt`（会高亮到另一条线）');
  // ⚠️ 反面对照：把触屏那一路摘掉 ⇒ 必须判违规。
  const noTouchMove = hlBody.replace(/window\.addEventListener\('touchmove',[^;]*;/, '');
  assert.notEqual(noTouchMove, hlBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/addEventListener\('touchmove'/.test(noTouchMove), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑥ 样式：打在 `.react-flow__edge-path` 上（库给路径自己定了 stroke，写在外层 `<g>` 上会被盖掉），
  //    而且**没有动画 / 发光**（老 iPad 上拖动本来就在重绘）。
  const snapRuleAt = css.indexOf('.flowEdgeSnap');
  assert.notEqual(snapRuleAt, -1, '样式表里没有拖动中高亮那条规则（学生看不到「这条线能接」）');
  // ⚠️ 只取**那一条规则**（到它自己的 `}` 为止）：多取 400 字会把隔壁 `.drawingToolbarEdgeLabel`
  //    的 `box-shadow` 也吞进来 ⇒ 「没有动画/发光」那条判据会**恒假**（自己把自己判红）。
  const snapRuleEnd = css.indexOf('}', snapRuleAt);
  assert.ok(snapRuleEnd > snapRuleAt, '高亮那条规则没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const snapRule = css.slice(snapRuleAt, snapRuleEnd + 1);
  assert.match(snapRule, /react-flow__edge-path/,
    '高亮没有打到 `.react-flow__edge-path` 上 —— 库给那条路径自己定了 stroke，写在外层 `<g>` 上会被盖掉');
  assert.match(snapRule, /stroke-width:\s*[2-9]/, '高亮没有把描边加粗（学生看不出是哪条线）');
  assert.ok(!/animation|@keyframes|box-shadow|transition/.test(snapRule),
    '高亮带了动画 / 发光 / 过渡 —— 学生端是老 iPad，拖动时的画布动画是已知的卡顿来源');
  // ⚠️ 反面对照：把高亮打到外层 `<g>` 上（去掉路径那一截）⇒ 必须判违规。
  const gOnly = css.replace(/\.flowEdgeSnap[^{]*\{/, '.flowEdgeSnap {');
  assert.notEqual(gOnly, css, '反面对照没造出来 —— 这条判据会变成恒真');
  const gOnlyAt = gOnly.indexOf('.flowEdgeSnap');
  const gOnlyRule = gOnly.slice(gOnlyAt, gOnly.indexOf('}', gOnlyAt) + 1);
  assert.ok(!/react-flow__edge-path/.test(gOnlyRule), '反面对照没被抓住 —— 这条判据是恒真的');
});

test('★ 2026-10-06（教师：「拖到线附近松手也要能连上」）：落点坐标必须认**触屏**（iPad 才是主设备）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 为什么单独立一条：学生用的是 **iPad** ⇒ 拖拽走的是 **`TouchEvent`**，而 `TouchEvent` **没有**
       `clientX/clientY` —— 那两个坐标挂在 `touches` / `changedTouches` 里**每一根 Touch** 上。
       上一版的闸是 `if (!('clientX' in event)) return;` ⇒ 触屏整段被挡在门外。

       🔴 实测（无头 Chrome 154 + `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`
          合成 touchStart/touchMove×10/touchEnd；**同一套探针、同一张底图，只换那一行闸**）：

         · 改前：偏 **0px（正落在线上中点）** / 15px / 20px / 25px / 拖到空白 ⇒ **全是「什么都不发生」**
                 （DOM 边 2→2、节点 4→4、作答为空）；只有精确压在那颗 10px 点上才连得上（2→4）。
         · 改后：偏 **0 / 15 / 20px ⇒ 都连上**（DOM 边 2→4、节点 4→5、**恰好 1 个交点**，
                 作答里 `junction→n2` 与 `junction→n3` 都在）；
                 偏 **25px 不连**、**拖到空白不插交点**（两条反面仍然成立）。
       ★ 本轮（自定义边 / 中点句柄删掉之后）复测：触屏 0 / 15 / 20px **仍然都连上**，
         25px 与空白仍然什么都不做 —— 0px 那一格现在完全由几何吸附负责。
       ⚠️ 「0px 也连不上」那一格最刺眼：触屏下学生**正正落在线上**也连不上，只因为当时那颗
          中点句柄被挪开了 18px —— 教师说的「小学课堂上会大量发生」在 iPad 上是 100% 发生。
  */
  // ① 源码级：坐标读取必须是**模块级的命名纯函数**（下面要把它抠出来真跑）。
  const decl = live.indexOf('const pointerClientPoint: ');
  assert.notEqual(decl, -1, '没有模块级的坐标纯函数 pointerClientPoint（触屏坐标会散落在各处）');
  const arrow = live.indexOf('= (', decl);
  const end = arrow === -1 ? -1 : live.indexOf('\n};', arrow);
  assert.ok(arrow !== -1 && end !== -1, 'pointerClientPoint 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const pointBody = live.slice(arrow + 2, end + 3);
  assert.ok(pointBody.length > 60, `pointerClientPoint 太短（${pointBody.length} 字）—— 先修这条判据`);
  // ② 语义（源码级）：`changedTouches` 是**首选**、`touches` 是**兜底**。
  //    ⚠️ `\btouches\b` **不会**命中 `changedTouches` 里的那一截（T 是大写）⇒ 这个先后判据是准的。
  const changedAt = pointBody.search(/\bchangedTouches\b/);
  const touchesAt = pointBody.search(/\btouches\b/);
  assert.notEqual(changedAt, -1,
    '没有读 changedTouches —— `touchend` 那一刻 `touches` 已经空了，抬起来的那一根只在 changedTouches 里（而松手那一格才决定连不连）');
  assert.notEqual(touchesAt, -1, '没有读 touches 兜底 —— touchmove 那一格会漏掉');
  assert.ok(changedAt < touchesAt, 'changedTouches 不是首选 —— 会在「松手」那一格拿到 undefined');
  assert.match(pointBody, /changedTouches[\s\S]{0,90}?(\?\?|\|\|)[\s\S]{0,90}?\btouches\b/,
    '两个来源不是「changedTouches 优先、touches 兜底」的关系');
  // ③ 行为级：把纯函数抠出来**真喂四种假事件**（这条不认写法、只认结果）。
  // ⚠️ 抠出来的那一段**带着结尾的 `;`**（它是条 `const … = (event) => { … };` 语句，不是表达式）
  //    ⇒ 必须当**语句**拼回去再取出来；写成 `return (${…});` 会多一个分号、当场语法错。
  const buildPoint = (src: string) => new Function(`const fn = ${src}\nreturn fn;`)() as (event: unknown) => { x: number; y: number } | null;
  const point = buildPoint(pointBody);
  const cases: Array<[string, unknown, { x: number; y: number } | null]> = [
    ['鼠标 / 指针（PointerEvent 继承 MouseEvent）', { clientX: 5, clientY: 6 }, { x: 5, y: 6 }],
    ['touchend：touches 已空、changedTouches 里才有那一根', { changedTouches: [{ clientX: 7, clientY: 8 }], touches: [] }, { x: 7, y: 8 }],
    ['touchmove：只有 touches（changedTouches 为空）', { changedTouches: [], touches: [{ clientX: 9, clientY: 10 }] }, { x: 9, y: 10 }],
    ['两样都没有（拿不到落点）', {}, null],
  ];
  for (const [label, event, expected] of cases) {
    assert.deepEqual(point(event), expected, `pointerClientPoint 对「${label}」不对 —— 落点会取错或取不到`);
  }
  // ⚠️ 反面对照：把 `changedTouches` 那半拿掉（只留 `touches`）⇒ touchend 那一格必须被抓住。
  //    （这条正是「先读 touches 会在松手那一格拿到 undefined」的机器化版本。）
  const noChanged = pointBody.replace(/event\.changedTouches[\s\S]{0,40}?(\?\?|\|\|)\s*/, '');
  assert.notEqual(noChanged, pointBody, '反面对照没造出来 —— 这条判据会变成恒真');
  // ⚠️ 反面对照本身也要**是一份合法变体**（只砍掉 changedTouches、仍读 touches）：
  //    否则「它红了」可能只是因为那段变异代码根本编译不过（假红 = 判据恒真）。
  assert.ok(!/\bchangedTouches\b/.test(noChanged) && /\btouches\b/.test(noChanged),
    '反面对照没造干净（应当只剩 touches 那一支）—— 这条判据会变成恒真');
  const pointNoChanged = buildPoint(noChanged);
  assert.notDeepEqual(pointNoChanged(cases[1][1]), cases[1][2],
    '反面对照没被抓住 —— 「changedTouches 优先」这条判据是恒真的（touchend 会取不到坐标）');
  // ④ 接线：兜底必须**只**通过这个函数拿坐标，而且不许再有「没有 clientX 就走人」那道闸。
  const endBody = onConnectEndSource(live);
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(endBody, /pointerClientPoint\(event\)/, 'onConnectEnd 没有走坐标纯函数（触屏拿不到落点）');
  assert.ok(!/'clientX' in event/.test(endBody),
    "还留着 `'clientX' in event` 那道闸 —— 它正是把触屏整段挡在门外的根因");
  // ⚠️ 「拿不到落点就走人」必须**盯住接住这次调用的那个变量**，不能只写 `/if \(!\w+\) return;/`：
  //    同一段里还有 `if (!origin) return;` / `if (!nearest) return;` ⇒ 那种松判据会被它们**顶绿**
  //    （变异测试实测：把 `if (!point) return;` 改成 `if (!point) { void point; }`，松判据照样绿 ✗）。
  const pointCall = endBody.match(/const (\w+) = pointerClientPoint\(event\);/);
  assert.ok(pointCall, '没抠出「接住落点的那次调用」—— 先修这条判据，别让它在空串上全绿');
  assert.match(endBody, new RegExp(`!\\s*${pointCall[1]}\\b[\\s\\S]{0,40}?return`),
    `拿不到落点（\`${pointCall[1]}\` 为 null）时没有整段走人 —— 会在 undefined 上算距离`);
  // ⑤ 全文件审计：除这个纯函数之外**不许**再有人直接读 `event.clientX/clientY`
  //    （`TouchEvent` 上没有这两个属性 ⇒ 那样写出来的每一处都是「触屏上拿到 undefined」）。
  const outsideReads = live.replace(pointBody, '').match(/event\.client[XxYy]/g) ?? [];
  assert.deepEqual(outsideReads, [],
    '除坐标纯函数之外还有人直接读 event.clientX/clientY —— TouchEvent 上没有这两个属性，触屏那一格会拿到 undefined');
});

test('★ 2026-10-06（教师报「连线加不上」）：落点约定 —— Loose 模式 / 落点只可能是节点', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 200, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  /*
    ⚠️ 这一条钉的是**两条相互咬合的约定**（每一条的「为什么」都写在断言消息里）：
      ① 普通连线（落点是**节点**）仍然要被加进去，而且那一支必须**走得到**；
      ② `connectionMode` 必须是 Loose。
    ⊘ 原来还有第③条「中点句柄必须是 `target` 且自己补 `data-nodeid = 边 id`」—— 那颗句柄随
      **自定义边**一起删了（它只能接不能起、还吞掉中点单击）。它留下的那条约定现在由
      「落点只可能是节点」这条**反面**判据守：`onConnect` 里不许再出现认「边 id」的分支。
  */
  // ① 普通连线：那一支把 connection 交给库的 addEdge（这是最基本的「框 → 框」那条路）。
  const nodeBranchAt = onConnectBody.indexOf('const source = nodes.find(');
  const nodeBranch = nodeBranchAt === -1 ? '' : onConnectBody.slice(nodeBranchAt);
  assert.ok(nodeBranch.length > 120, '「落点是节点」那一支没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const passesConnection = (branch: string) => /addEdge\(\{[\s\S]{0,40}\.\.\.connection/.test(branch);
  assert.ok(passesConnection(nodeBranch),
    '「落点是节点」那一支没有把 connection 交给库的 addEdge —— 最基本的「框 → 框」连线会断（教师截图里那一路就是它）');
  // ⚠️ 反面对照：把 connection 换掉 ⇒ 必须判违规。
  assert.ok(!passesConnection(nodeBranch.replace('...connection', '...{ source: null }')), '反面对照没被抓住 —— 这条判据是恒真的');
  // ② Loose：库在 loose 下**不要求 source/target 反向**，所以「从任意句柄拖到任意句柄」才通；
  //    严模式（默认）下 target→target 会被 `isValidHandle` 直接判无效。而我们的四个句柄里
  //    上/左是 target、右/下是 source（见 `FlowNodeEditor`）—— 学生不会管这个。
  assert.match(live, /connectionMode=\{ConnectionMode\.Loose\}/,
    '不是 Loose 模式 —— 学生从 target 句柄（判定框左侧那种）拖到另一个 target 句柄会被库直接判无效');
  // ③ 反面：**落点只可能是节点**。自定义边删掉之后，没有任何句柄会回一个「边 id」当落点
  //    ⇒ `onConnect` 里再出现认边 id 的分支就是死代码（而它一次都不会响，谁也看不出来）。
  assert.ok(!/connection\.(target|source)\b[\s\S]{0,60}edges\.find/.test(onConnectBody),
    '`onConnect` 又在认「落点是某条边」了 —— 那条凭据（句柄上的 data-nodeid=边 id）已经删掉了');
  assert.ok(!/hitEdge/.test(onConnectBody), '`onConnect` 里又长出 `hitEdge` 那一支了（死分支：永远进不去）');
});

test('★ 2026-10-06（教师）：选中一个图形 ⇒ 浮出删除按钮，删它**连带删掉相连的线**（与选中连线共用一处浮层）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 实测（无头 Chrome 154 + 教师那张真底稿，CDP 真合成鼠标事件点过）：
      · 点「处理过程」框（左上角内侧 12px，避开四个句柄）⇒ 出现 `[aria-label="删除这个图形"]`：
        44×44、水平中心与框的中心重合（451 vs 451.5）、在框**上边缘上方 35px**
        （= 28 流坐标 × zoom 1.25175，正是 `NODE_FLOAT_GAP`）。
      · 点它 ⇒ 那个框没了，**与它相连的两条线也一起没了**：DOM 里的边 4 → 2
        （剩下的是 1→2 与 1→0，都不挨着它）。
    ★ 第 1 步整理之后，这一条按**语义**判（一个选中模型 / 一处浮层 / 一条删除路），不再钉
      `selectedNode` / `selectedNodeAnchor` / `removeNode` 这些旧写法 —— 但它守的东西一条不少。
  */
  const overlayBody = overlaySource(live);
  assert.ok(overlayBody.length > 80, '浮层描述式没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ① **一个选中模型**：`{ kind, id }` 的**单一**槽位（点框 / 点线 / 点空白都只写它）。
  assert.match(live, /type FlowSelection = \{[\s\S]{0,40}?kind: 'node' \| 'edge'[\s\S]{0,40}?id: string/,
    '没有统一的选中模型（`{ kind: "node" | "edge"; id }`）');
  assert.match(live, /const \[selected, setSelected\] = useState<FlowSelection \| null>\(null\)/, '没有唯一的选中状态');
  // ⚠️ 旧的两个槽位（`selectedNode` / `editingEdge`）不许再长回来：「点框清线、点线清框」
  //    靠的正是**只有这一个**槽位（两个槽位就得靠三处手工互相清）。
  assert.ok(!/setSelectedNode|setEditingEdge/.test(live), '旧的第二个选中槽位又回来了 —— 单选只该有一个状态');
  // ② 出现条件必须**认「有没有选中」**（恒真 = 画布上永远挂着一颗按钮）。
  const deleteGateOk = (source: string): boolean => {
    const body = overlaySource(source);
    // 既要有「没选中就什么都不浮」，也要「删除那一支用选中 + 那一处锚点解析」。
    return /if \(!\s*selected\s*\)\s*return null/.test(body) && /mode: 'delete'/.test(body) && /selectedAnchor/.test(body);
  };
  assert.ok(deleteGateOk(live), '浮层的出现条件没认「有没有选中」—— 恒真就等于画布上永远挂着一颗删除按钮');
  // ⚠️ 反面对照：把那道闸拿掉（`if (!selected) return null;`）⇒ 必须判违规。
  //    （只改**浮层描述式那一块**：同名的闸在 `selectedAnchor` 里也有一句，全局 replace 会先改到它。）
  const alwaysOnFloat = live.replace(overlayBody, overlayBody.replace('if (!selected) return null;', ''));
  assert.notEqual(alwaysOnFloat, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!deleteGateOk(alwaysOnFloat), '反面对照没被抓住 —— 这条判据是恒真的');
  // ③ 删图形必须**连带删掉与它相连的线**：走库的 `deleteElements`。
  //    （`@xyflow/system` 的 `getElementsToRemove` 里有 `getConnectedEdges(matchingNodes, deletableEdges)`
  //      —— 相连的边是**它自己算的**；自己 filter nodes 只会把线留在画布上，而且是两条悬空段。）
  const removeBody = removeSelectedSource(live);
  assert.ok(removeBody.length > 40, '删除出口没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const removesConnectedEdges = (body: string) => /deleteElements\(\{[\s\S]{0,100}?nodes: \[/.test(body);
  assert.ok(removesConnectedEdges(removeBody),
    '删图形没有走库的 deleteElements —— 它是唯一会自己算「与它相连的边」的那条路；只 filter nodes 会把相连的线留在画布上');
  // ⚠️ 反面对照：改成「只 filter 节点」（= 只删框、不删线）⇒ 必须判违规。
  const manualNodeOnly = removeBody.replace(/void deleteElements\([\s\S]*?\);/, 'setNodes((current) => current.filter((node) => node.id !== id));');
  assert.notEqual(manualNodeOnly, removeBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!removesConnectedEdges(manualNodeOnly), '反面对照没被抓住 —— 这条判据是恒真的');
  // ③b 同一个出口也要真的删**连线**（选中的是线时）。
  const removesEdge = (body: string) => /kind === 'edge'/.test(body) && /\.id !== target\.id/.test(body);
  assert.ok(removesEdge(removeBody), '同一条删除路没有「选中的是线」那一支 —— 选中连线时的按钮会点了没反应');
  const noEdgeBranch = removeBody.replace(/if \(target\.kind === 'edge'\)[\s\S]*?return;/, '');
  assert.notEqual(noEdgeBranch, removeBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!removesEdge(noEdgeBranch), '反面对照没被抓住 —— 这条判据是恒真的');
  // ④ 点空白 ⇒ 选中清掉（「选中」是单选，点空就是没有选中），就地输入框也一起退掉。
  const paneAt = live.indexOf('onPaneClick={');
  assert.ok(paneAt !== -1, '没有 onPaneClick');
  const paneHandler = live.slice(paneAt, live.indexOf('}', paneAt));
  assert.match(paneHandler, /setSelected\(null\)/, '点空白没有清掉选中 —— 那颗删除按钮会留在画布上');
  // ⑤ 点图形 / 点线**写的是同一个槽位**（所以「点框清线、点线清框」结构性成立）。
  const nodeClickAt = live.indexOf('onNodeClick={');
  const edgeClickAt = live.indexOf('onEdgeClick={');
  assert.ok(nodeClickAt !== -1 && edgeClickAt > nodeClickAt, 'onNodeClick/onEdgeClick 没抠出来 —— 先修这条判据');
  const nodeClickHandler = live.slice(nodeClickAt, edgeClickAt);
  assert.match(nodeClickHandler, /setSelected\(\{ kind: 'node', id: node\.id \}\)/, '点图形没有把它设成「选中的框」');
  const edgeClickHandler = live.slice(edgeClickAt, live.indexOf('onEdgeDoubleClick={'));
  assert.match(edgeClickHandler, /setSelected\(\{ kind: 'edge', id: edge\.id \}\)/, '点线没有把它设成「选中的线」');
  // ⑥ 位置与命中区：复用线段浮层那套样式（44px 是硬要求；`worksheet-tap-targets.test.ts` 会逐个量），
  //    并且必须住在画布舞台**里面**（跑到外面就会按外层卡片定位、差出两百多像素）。
  //    ★ 整理之后画布上只有**一处**浮层渲染 ⇒ 这个类名只该出现一次。
  const floatAt = live.indexOf('styles.flowEdgeFloat');
  assert.ok(floatAt !== -1, '没有浮层删除按钮');
  // ⚠️ 整个**开标签**都取出来（属性是多行的）：从它的 `<button` 起到那个收尾的 `>` 为止。
  const btnTag = live.slice(live.lastIndexOf('<button', floatAt), live.indexOf('>', floatAt) + 1);
  assert.match(btnTag, /styles\.flowEdgeFloat/, '删除浮层没复用 44px 的浮层样式（命中区会跌破 44px）');
  assert.match(btnTag, /onClick=\{removeSelected\}/, '删除浮层的点击没有接到唯一的删除出口');
  const reactFlowAt = live.indexOf('</ReactFlow>');
  assert.ok(reactFlowAt < floatAt, '删除浮层跑到画布舞台外面了（会按外层卡片定位）');
  // ⚠️ 包含关系也钉住：`</ReactFlow>` 与浮层之间不许有 `</div>` —— 有就说明浮层排在舞台收尾之后。
  assert.ok(!/<\/div>/.test(live.slice(reactFlowAt, floatAt)), '删除浮层排在舞台的收尾 </div> 之后（会按外层卡片定位）');
  assert.equal(live.split('styles.flowEdgeFloat').length - 1, 1, '删除浮层画了两处 —— 第 1 步整理要求「一处渲染」');
  /*
   * ⑦ 锚点必须是「图形区域的**左上角顶点**」+ 与线的浮层同一套视口换算。
   *
   * ⊘ 2026-10-07（**教师改主意**）：原来是「节点上边缘**上方**」（`NODE_FLOAT_GAP` = 28）——
   *   那颗按钮悬在框外，正好压住从上方下来的连线。教师看过效果之后要求挪到左上角，
   *   而且「**切记要压在图形的线条上**」⇒ 圆心落在那个顶点上（一半在框内），
   *   正好压住左边与上边那两条线。
   */
  const anchorAt = live.indexOf('const nodeFloatAnchor = ');
  assert.ok(anchorAt !== -1, '没有节点浮层的锚点 —— 先修这条判据');
  const anchorEnd = live.indexOf('\n  const ', anchorAt + 1);
  const anchorsBody = anchorAt === -1 ? '' : live.slice(anchorAt, anchorEnd === -1 ? undefined : anchorEnd);
  assert.ok(anchorsBody.length > 40, '节点锚点没抠出来 —— 先修这条判据，别让它在空串上全绿');
  /*
   * ★ 2026-10-07（教师，四张图）：锚点**不再是「外接框的左上角」**了 —— 那个角只有**矩形**
   *   落在轮廓上（菱形那个角在图形外面一大截、平行四边形的上边被 skew 推走、胶囊的角在圆弧外）。
   *   挑点挪进了纯函数 `flowNodeCornerPoint`；**逐形状验「点在不在轮廓上」**的判据在
   *   `src/lib/worksheet-flowchart-node.test.ts`（那边验轮廓、不验坐标数字）。
   * ⚠️ 这里只钉**接线**：锚点是那个纯函数按**节点自己的盒子**算出来的。
   */
  assert.match(anchorsBody, /flowNodeCornerPoint\(/, '锚点没有走「按形状挑左上那一点」的纯函数（又回到外接框的角了）');
  assert.match(anchorsBody, /x: node\.position\.x,/, '锚点的盒子不是从 node.position 来的');
  assert.match(anchorsBody, /node\.measured\?\.width/, '锚点的尺寸没有用库量出来的 measured（形状会挑错）');
  assert.ok(!/NODE_FLOAT_GAP/.test(anchorsBody), '锚点又退到框上方去了 —— 教师要求的是左上角');
  assert.match(anchorsBody, /viewport\.x \+ [\w.]+ \* viewport\.zoom/, '锚点没有做横向视口换算（浮层会飘）');
  assert.match(anchorsBody, /viewport\.y \+ [\w.]+ \* viewport\.zoom/, '锚点没有做纵向视口换算（浮层会飘）');
  // ⑧ 交点不做特例（教师没提它）：删除那条路、浮层描述式、锚点解析里都不许给 `junction` 开分支。
  const selectedAnchorBody = selectedAnchorSource(live);
  assert.ok(selectedAnchorBody.length > 40, '锚点解析没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/junction/.test(removeBody), '删除那条路上给交点开了特例 —— 教师没要求（删交点、连带删它两条线是可接受的）');
  assert.ok(!/junction/.test(overlayBody), '浮层给交点开了特例 —— 交点与普通框同一处浮层');
  assert.ok(!/junction/.test(selectedAnchorBody), '锚点解析给交点开了特例 —— 交点与普通框走同一条锚点');
});

test('★ 2026-10-06（教师，A 方案）：快照要认「交点」——一颗小圆点（现在是与画板一致的**空心小环**），不能落进默认的空矩形', async () => {
  const svg = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-flowchart-svg.ts'), 'utf8'));
  // ① 源码级：junction 那一支必须**排在默认矩形之前**（排在后面 = 永远走不到）。
  const junctionAt = svg.indexOf("if (node.kind === 'junction') {");
  const defaultRectAt = svg.indexOf('rx="8" ry="8"');
  assert.ok(junctionAt !== -1, '快照没有 junction 这一支');
  assert.ok(defaultRectAt !== -1 && junctionAt < defaultRectAt, 'junction 那一支必须排在默认矩形之前（否则交点被画成一个空矩形）');
  // ② 运行时：真喂一份带交点的数据进去 —— 图里要有实心小圆、且**没有**那个默认矩形。
  const { flowchartSvg } = await import('../../../../../lib/worksheet-flowchart-svg.ts');
  const out = flowchartSvg({
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 120, height: 44 }, data: { label: '开始', kind: 'terminator' } },
      { id: 'j', position: { x: 54, y: 100 }, data: { label: '', kind: 'junction' } },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'j', sourceHandle: 'bottom', targetHandle: 'top' }],
  });
  assert.ok(out, '带交点的数据应当画得出图');
  // ★ 2026-10-06：画板把交点改成了 8×8 的描边空心小环（白底 + 2px #6b86a5 描边 ⇒ 半径 4），
    //   快照已同步 ⇒ 这条旧断言（钉 10px 实心 r=5）随之过期，改成与画板一致的样子。
    assert.match(out.svg, /<circle[^>]*r="4"[^>]*fill="#fff"[^>]*stroke="#6b86a5"/, '交点没有画成画板那样的空心小环');
  assert.ok(!/<rect[^>]*rx="8"/.test(out.svg), '交点被画成了默认矩形（AI 看到的图上会凭空多一个空框）');
});

test('★ 流程图节点：平时整框可拖，双击文字才进入 nodrag 编辑态', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 根因（已核实，不是猜的）：React Flow 的节点拖动过滤器里有一句
      `!hasSelector(target, `.nodrag`, domNode)`（`@xyflow/system` 的 `XYDrag` `.filter(...)`）
      ⇒ 在 `.nodrag` 元素上按下拖动**不拖那个节点**，事件穿透到画布 ⇒ 变成整块画布平移
      （教师的感受就是「选中一个图形准备移动时，后面的图形都一起移动」）。
    🔴 实测（无头 Chrome 154 + 本仓 React Flow 12.11.6，合成鼠标事件真拖过同一段距离）：
      · 输入框**不带** nodrag ⇒ 节点从 (40,40) 走到 (77.5,77.5)；
      · 输入框**带** nodrag   ⇒ 节点纹丝不动（画布在平移）。
    ⚠️ 判据只盯**节点编辑器里那一格**：将来别处若合法地需要 `.nodrag`（按钮/工具条之类），
      不该被这条判据误伤 —— 所以先抠出 `FlowNodeEditor` 的函数体再断言。
  */
  const editorBody = editorBodyOf(live);
  assert.ok(editorBody.includes('aria-label="节点文字"'), '节点编辑器没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(editorBody, /editing && !data\.locked/, '节点没有区分“拖动”与“文字编辑”状态');
  assert.match(editorBody, /<span[\s\S]{0,260}?onDoubleClick=/, '平时没有用可拖动文字层，或不能双击进入编辑');
  assert.match(editorBody, /<input[\s\S]{0,100}?className="nodrag"/, '编辑文字时输入框还会触发节点拖动，无法稳定输入/选择文字');
});

test('★ 2026-10-06（教师截图）：删除浮层用**终点**锚点，就地输入框仍用**中点**锚点', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    ⚠️ 两个锚点必须**分开存在**、且分别被引用 —— 谁把它们换回来都要变红：
      · 中点（`midX/midY`）＝ **画出来的那条路径**的标签点（线上的字就画在那儿）⇒ 就地输入框；
        ★ 2026-10-07 起它由 `flowEdgeGeometry` 给（与画线同一个函数，绕行点一起算进去）——
          上一版是裸的 `getSmoothStepPath`，学生一拖控制柄，这个点就留在原地。
      · 终点（`endX/endY`）＝ **目标节点那一侧**的句柄点（`to`）＝ 箭头落点 ⇒ 选中后浮出的删除图标。
    ⚠️ 别拿起点（source 那端）当终点：教师指的是**箭头**落下的那一端。
  */
  // ⚠️ 判据**按语义**判（抠出 `edgeFlowAnchors` 的函数体，看**每个锚点是从哪个数据来的**），
  //    不逐字钉 `const { midX: labelX … } = anchors;` / 整条 `return { … }` —— 实现刚从单行
  //    解构改成了多行 offsetAlong，这类判据连红五次、还两次只同步一半 ✗。变量叫什么名字都行：
  //    先认出「那条路径的标签点」与「目标侧/起点侧的句柄点」这三个来源，再看锚点表用了谁。
  const anchorsAt = live.indexOf('const edgeFlowAnchors = useCallback');
  const anchorsBody = anchorsAt === -1 ? '' : live.slice(anchorsAt, live.indexOf('\n  const ', anchorsAt + 1));
  assert.ok(anchorsBody.length > 400, '锚点函数没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const labelPoint = anchorsBody.match(/const \[, (\w+), (\w+)\] = flowEdgeGeometry\(/) || [];
  assert.ok(labelPoint[1] && labelPoint[2], '没有取那条路径的标签点');
  assert.match(anchorsBody, new RegExp(`midX: ${labelPoint[1]}[\\s\\S]{0,80}?midY: ${labelPoint[2]}`), '中点锚点没有取自那条路径的标签点');
  // ⚠️ ★ 2026-10-06：「句柄点在节点那一侧的哪儿」抽成了模块级 `handleFlowPoint(node, handleId, fallback)`
  //    （锚点表与 `onConnectEnd` 的几何兜底共用同一份 —— 两份必然分叉）。判据因此认**语义**：
  //    端点必须由「**目标**节点 + 那条边的 targetHandle」算出来；变量名/调用形状随便改。
  const endPoint = anchorsBody.match(/const (\w+) = (\w+)\(target, edge\.targetHandle/) || [];
  assert.ok(endPoint[1], '终点锚点不是「目标节点那一侧的句柄点」');
  // ⚠️ 认**函数名**（`const X = (node: FlowNode`），不认参数名：`(node: FlowNode, handleId: unknown` 那种
  //    多参数写法也要过（上一版把参数列表钉成 `(node: FlowNode)` ⇒ 自己把自己判红 ✗）。
  //    ⚠️ 分两条判**语义**：① 盒子的 y 就是 `node.position.y`；② 下/左/右三侧的句柄点落在
  //    `box.y + box.height` / `box.x + box.width` 那一族上。上一版把两条揉进一个跨 600 字的窗口正则，
  //    自己把自己判红（跨行 + 惰性量词的组合又长又脆）—— 拆开就稳。
  const endFnAt = live.indexOf(`const ${endPoint[2]} = (node: FlowNode`);
  assert.notEqual(endFnAt, -1, `句柄点函数 ${endPoint[2]} 没找到 —— 先修这条判据`);
  const endFnBody = live.slice(endFnAt, live.indexOf('\n};', endFnAt));
  assert.ok(endFnBody.length > 80, `句柄点函数 ${endPoint[2]} 没抠出来 —— 先修这条判据，别让它在空串上全绿`);
  assert.match(endFnBody, /x: node\.position\.x/, `句柄点函数 ${endPoint[2]} 的盒子不是从 node.position 来的`);
  /*
   * ★ 2026-10-07（教师第二次报障）：「端点在哪」这件事**交给 `flowAnchorPoint`** ——
   *   它与库的 `getEdgePosition` / `getHandlePosition` 同一个约定（落点在**句柄方块的边**上，
   *   比节点边框再往外 6px）。**行为**由那条纯函数的用例守（`worksheet-flowchart-edge.test.ts`），
   *   这里只钉「画板没有再自己写一遍」—— 两份必然分叉，而分叉的表现是
   *   「拖到最两端时控制柄偏出线外一点」这种**不报错**的错。
   * 🔴 上一版这里钉的是「下侧的句柄点落在 `box.y + box.height`」—— **那正是错的那一版**：
   *   按边框算 ⇒ 绕行点的能走范围比库画出来的那条线宽 6px ⇒ 到头了控制柄还在动。
   */
  assert.match(endFnBody, /flowAnchorPoint\(/, `句柄点函数 ${endPoint[2]} 没有走那个与库同约定的纯函数（自己在算端点）`);
  assert.match(anchorsBody, new RegExp(`endX: ${endPoint[1]}\\.x`), '两个锚点没有从中点/终点分别给出（终点 x）');
  assert.match(anchorsBody, new RegExp(`endY: ${endPoint[1]}\\.y`), '两个锚点没有从中点/终点分别给出（终点 y）');
  // ★ 2026-10-06（教师认可的第一条偏移）：删除按钮要往 **source** 退 ⇒ 锚点表必须多吐起点。
  const startPoint = anchorsBody.match(/const (\w+) = (\w+)\(source, edge\.sourceHandle/) || [];
  assert.ok(startPoint[1], '起点句柄点没抠出来 —— 先修这条判据');
  assert.match(anchorsBody, new RegExp(`fromX: ${startPoint[1]}\\.x`), '锚点表没有给出起点 fromX（删除按钮没法往 source 退）');
  assert.match(anchorsBody, new RegExp(`fromY: ${startPoint[1]}\\.y`), '锚点表没有给出起点 fromY（删除按钮没法往 source 退）');
  // ★ 2026-10-06：删除按钮的退向改成**目标句柄轴** ⇒ 锚点表还必须吐这条轴，且它必须由
  //   `targetPosition` 决定（线从哪一侧进目标，就往那一侧退）。轴的具体方位由几何用例（handleOutwardAxis）守。
  const backVec = anchorsBody.match(/const (\w+) = handleOutwardAxis\(targetPosition\)/) || [];
  assert.ok(backVec[1], '删除按钮的退向不是由 targetPosition（目标句柄轴）决定的');
  assert.match(anchorsBody, new RegExp(`backX: ${backVec[1]}\\.x`), '锚点表没有给出目标句柄轴 backX');
  assert.match(anchorsBody, new RegExp(`backY: ${backVec[1]}\\.y`), '锚点表没有给出目标句柄轴 backY');
  // ⚠️ 按语义判（在函数体里查两轴），不逐字钉返回语句 —— 只同步 x 轴、y 轴没同步就是自己把自己判红 ✗。
  //    格式一变就红的断言本身就是负担。
  const endFn = blockAfter(live, 'const edgeStartAnchor = ', '\n  const ');
  assert.ok(endFn.length > 40, '终点锚点没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(/viewport\.x \+ [\w.]+ \* viewport\.zoom/.test(endFn) && /viewport\.y \+ [\w.]+ \* viewport\.zoom/.test(endFn),
    '终点锚点没有做视口换算（浮层会飘）');
  // ★ 第 1 步整理：**一处锚点解析** —— 选中的是**线**时必须落到**终点**锚点（箭头那一端），
  //   不是中点（中点那句留给就地输入框）。判据按语义：看解析里「edge 那一支」接的是哪个锚点函数。
  const selectedAnchorBody = selectedAnchorSource(live);
  assert.ok(selectedAnchorBody.length > 40, '锚点解析没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const edgeUsesEndAnchor = (source: string): boolean => {
    const body = selectedAnchorSource(source);
    return /kind === 'edge'/.test(body) && /edgeStartAnchor\(/.test(body) && !/edgeMidAnchor\(/.test(body);
  };
  assert.ok(edgeUsesEndAnchor(live), '选中连线时的浮层没有落在终点锚点（教师要求它贴在箭头那一端）');
  // ⚠️ 反面对照：把线那一支换成**中点**锚点 ⇒ 必须判违规（这条判据不是恒真的）。
  const midInstead = live.replace(/(const selectedAnchor = [\s\S]{0,400}?)edgeStartAnchor\(/, '$1edgeMidAnchor(');
  assert.notEqual(midInstead, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!edgeUsesEndAnchor(midInstead), '反面对照没被抓住 —— 这条判据是恒真的');
  // 就地输入框那一块（`overlay` 的 label 形态）⇒ 只能用中点锚点（标签画在中点，就地编辑才顺手）。
  const overlayBody = overlaySource(live);
  assert.ok(overlayBody.length > 80, '浮层描述式没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(overlayBody, /edgeMidAnchor\(labelingEdge\)/, '就地输入框没有用中点锚点（与它要改的那个标签分家）');
  assert.ok(!/edgeStartAnchor/.test(overlayBody), '就地输入框被挪到了终点（与它要改的那个标签分家）');
  // ⚠️ 反面对照：把就地输入框挪到终点锚点 ⇒ 必须判违规。
  const labelAtEnd = overlayBody.replace('edgeMidAnchor(labelingEdge)', 'edgeStartAnchor(labelingEdge)');
  assert.notEqual(labelAtEnd, overlayBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/edgeMidAnchor\(labelingEdge\)/.test(labelAtEnd), '反面对照没被抓住 —— 这条判据是恒真的');
});

/**
 * ★ 2026-10-06：**几何函数级**用例 —— 偏移的「上限」与「退向」必须能**真喂数据**验算，
 *   不能只靠正则猜实现（「有没有 clampOffset 这个调用」挡不住「比例写成 0.9」）。
 *
 * 🔴 为什么必须有这一条：「极短边」在源码级断言里没法验。学生把两个框拖到几乎贴住时，这一段
 *    可能只剩 ~20px —— `EDGE_FLOAT_BACK` 会越过中点、甚至在极短边上越过 source 端
 *    ⇒ 只能把纯函数抠出来**喂一条短边**量。这是上一轮报告里「拿不准」第 (C) 条的正式补丁。
 * ⚠️ 为什么抠文本求值、而不是 import：这个文件是 `'use client'` 的 React 组件，import 会把
 *    React Flow + React 一起拖进来（本仓没有 jsdom）。下面这几个函数只做加减乘除、不碰
 *    React/state，**类型都写在 `const` 那一侧** ⇒ 抠出来的 `(a, b) => { … }` 本身就是合法 JS。
 * ★ 第 2 步整理：喂进来的距离**从组件源码里读它自己的命名常量**（不在测试里再抄一遍 `EDGE_FLOAT_BACK`），
 *    测的就是生产代码真正在用的那个数。
 * ⊘ 2026-10-06：`offsetAlong` 与它服务的 `HANDLE_GAP`、以及那条「句柄脱开 Y/N 标签」的像素规则
 *    （从 JSX 读 `<rect height={22}>` + 从 CSS 读句柄 width）**随自定义边一起删掉**了 ——
 *    句柄不存在，就没有「脱开它」这件事。`clampOffset` + `handleOutwardAxis` 的验算一条没少。
 * ⚠️ 反面对照（变异测试，见本轮报告）：把 clamp 去掉、或把某个方位的轴写反 ⇒ 下面这几条必须红。
 */
test('★ 2026-10-06：偏移的**上限**与**目标句柄轴** —— 真喂一条短边验算（几何函数级）', () => {
  const src = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /** 抠 `const NAME: (…) => … = (params) => { … };` 里 `= (` 之后那一段（参数/函数体都无类型标注）。 */
  const grab = (name: string) => {
    const decl = src.indexOf(`const ${name}: `);
    assert.ok(decl !== -1, `没找到纯几何函数 ${name} —— 先修这条判据`);
    const arrow = src.indexOf('= (', decl);
    const end = arrow === -1 ? -1 : src.indexOf('\n};', arrow);
    assert.ok(arrow !== -1 && end !== -1, `纯几何函数 ${name} 没抠出来 —— 先修这条判据，别让它在空串上全绿`);
    return src.slice(arrow + 2, end + 3);
  };
  /**
   * 读一个**只由数字与算术组成**的模块级常量（`44` / `FLOAT_SIZE / 2 + 6` 都认）。
   * ⚠️ 变量名在 `scope` 里，所以 `NODE_FLOAT_GAP` 那种「由别的常量推出来」的写法也能读。
   */
  const constOf = (name: string, scope: Record<string, number> = {}): number => {
    const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
    assert.ok(m, `没找到命名常量 ${name} —— 先修这条判据`);
    const value = new Function(...Object.keys(scope), `return (${m[1]});`)(...Object.values(scope));
    assert.equal(typeof value, 'number', `${name} 不是一个数（读出来是 ${String(value)}）`);
    return value as number;
  };
  /*
   * ⚠️ 命中区那个 44px **从 CSS 读**（`·flowEdgeFloat` 的 `width`）—— 代码里那份 TS 常量
   *   2026-10-07 删掉了（它只是 CSS 的副本、没有第二个消费者）。
   *   `worksheet-tap-targets.test.ts` 量的也是样式表那一份 ⇒ 唯一的真源本来就是 CSS。
   */
  const cssLive = stripComments(CSS);
  const floatRuleAt = cssLive.indexOf('.flowEdgeFloat {');
  assert.notEqual(floatRuleAt, -1, '样式表里没有 `.flowEdgeFloat` 那条规则 —— 先修这条判据');
  const floatHit = cssLive.slice(floatRuleAt, cssLive.indexOf('}', floatRuleAt) + 1);
  const FLOAT_SIZE = Number((floatHit.match(/[^-]width:\s*(\d+)px/) ?? [])[1]);
  assert.ok(Number.isFinite(FLOAT_SIZE) && FLOAT_SIZE > 0, `读不到浮层命中区的尺寸（读到 ${FLOAT_SIZE}）`);
  const EDGE_FLOAT_BACK = constOf('EDGE_FLOAT_BACK');
  assert.ok(EDGE_FLOAT_BACK > 0, '偏移常量 EDGE_FLOAT_BACK 必须是正数');
  /*
   * ⊘ 2026-10-07（教师改主意）：这里原来读 `NODE_FLOAT_GAP` 并断言它 ≥ 半个按钮
   *   （理由：「按钮以自己中心定位，往上至少要半个按钮才不压住上边缘」）。
   *   现在节点的按钮改到**左上角顶点**上、而且**故意压线** ⇒ 那个约束没有对象了，常量也删了。
   * ⚠️ 线的按钮那条 `EDGE_FLOAT_BACK` **不变**（它仍然不许盖住箭头那一段）。
   * ⇒ 换成一条**仍然成立**的硬约束：命中区不许小于 44px（老 iPad 的手指下限）。
   */
  assert.ok(FLOAT_SIZE >= 44, `命中区不能小于 44px（老 iPad 的手指下限），读到 ${FLOAT_SIZE}`);
  const code = ['clampOffset', 'handleOutwardAxis'].map((name) => `const ${name} = ${grab(name)}`).join('\n');
  // ⚠️ 只喂给 `handleOutwardAxis`：它内部拿 `Position.某` 做比较，所以给一份**同一个对象**即可（具体值不重要）。
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' } as const;
  const makeGeometry = new Function('Position', `${code}\nreturn { clampOffset, handleOutwardAxis };`);
  const geom = makeGeometry(Position) as {
    clampOffset: (distance: number, span: number) => number;
    handleOutwardAxis: (position: string) => { x: number; y: number };
  };

  // ① 上限：**不超过段长的一半**（这正是不越过中点的理由），常见边长下不许打折。
  assert.equal(geom.clampOffset(EDGE_FLOAT_BACK, 1000), EDGE_FLOAT_BACK, '常见边长下删除按钮的距离被打了折（按钮会缩水）');
  assert.ok(geom.clampOffset(EDGE_FLOAT_BACK, 20) < EDGE_FLOAT_BACK, '极短边上没有生效任何上限');
  assert.ok(geom.clampOffset(EDGE_FLOAT_BACK, 20) <= 10, '极短边上偏移没被压到中点之前（会越过中点）');
  assert.ok(geom.clampOffset(1000, 100) <= 50, '上限比例 ≥ 一半 —— 会越过中点');

  // ② 短边上的**删除按钮**：end=(0,200)、source=(0,180)（段长只有 20px）⇒ 必须仍落在**靠终点这一侧**。
  const endPt = { x: 0, y: 200 };
  const fromPt = { x: 0, y: 180 };
  const back = geom.handleOutwardAxis(Position.Top);
  const step = geom.clampOffset(EDGE_FLOAT_BACK, Math.hypot(endPt.x - fromPt.x, endPt.y - fromPt.y));
  const movedEnd = { x: endPt.x + back.x * step, y: endPt.y + back.y * step };
  assert.ok(movedEnd.y < endPt.y, '删除按钮没有往 source 退（方向反了）');
  assert.ok(movedEnd.y > (endPt.y + fromPt.y) / 2, '短边上删除按钮退过了中点（44px 的它会盖住另一半线）');

  // ③ **目标句柄轴**：四个方位各退到**远离目标节点**的一侧 —— 写反一个，删除按钮就压在箭头上。
  assert.deepEqual(geom.handleOutwardAxis(Position.Top), { x: 0, y: -1 }, 'Top 的退向不对（线从上方进 ⇒ 该往 -y 退）');
  assert.deepEqual(geom.handleOutwardAxis(Position.Bottom), { x: 0, y: 1 }, 'Bottom 的退向不对（该往 +y 退）');
  assert.deepEqual(geom.handleOutwardAxis(Position.Left), { x: -1, y: 0 }, 'Left 的退向不对（该往 -x 退）');
  assert.deepEqual(geom.handleOutwardAxis(Position.Right), { x: 1, y: 0 }, 'Right 的退向不对（该往 +x 退）');
  const axes = [Position.Top, Position.Bottom, Position.Left, Position.Right].map((p) => JSON.stringify(geom.handleOutwardAxis(p)));
  assert.equal(new Set(axes).size, 4, '四个方位的退向有重复（有方位没被区分开）');
});


// ⊘ 2026-10-06：这里原有几条**逐字钉实现写法**的断言（整条 `return { x: … }` 语句、
//   `const { midX: labelX, midY: labelY } = anchors;`、整条 `return { midX: labelX, … };` 之类），
//   以及 `viewport.x + labelX * viewport.zoom` 那句（它把中点浮层的**变量名**也钉死了）。
//   它们钉的是**格式**而不是行为 —— 今天实现一改就连红五次，每次都要跟着同步
//   （还两次只同步了一半，自己把自己判红 ✗）。真正的判据在别处，并且按**语义**判：
//   「一处锚点解析里线那一支用终点锚点 / 就地输入框用中点锚点」「两个浮层有没有视口换算（不认变量名）」
//   「交点必须用精确中点」「删除走 deleteElements」—— 改写法不会红、改行为才会红。
//
// ★ 2026-10-06（第 1 步整理）之后同理：上面那些用例**不再**钉 `selectedNode` / `editingEdge` /
//   `edgeAnchor` / `selectedNodeAnchor` / `removeNode` 这些旧结构（它们已经被合并掉了），
//   改成切出「选中模型 / 浮层描述式 / 锚点解析 / 删除出口」这四块，再按语义判 ——
//   守的东西一条没少（单选、出现条件、连带删边、锚点各就各位、交点不开特例）。
