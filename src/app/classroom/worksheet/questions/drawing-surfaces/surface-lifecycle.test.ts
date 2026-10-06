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
/** 落点吸附的兜底：`const onConnectEnd = useCallback(` 的函数体。 */
const onConnectEndSource = (source: string) => blockAfter(source, 'const onConnectEnd = useCallback(', '\n  }, [');
/**
 * 「拆线那一份实现」被**几条入口**调用（`splitEdgeAt(` 的出现次数）。
 * ⚠️ 数的是**调用点**：一处是精确命中（`onConnect`）、一处是落点吸附（`onConnectEnd`）。
 *    「声明那一处」不算 —— 它写的是 `const splitEdgeAt = useCallback(`，后面没有紧跟 `(`。
 */
const splitterCallSites = (source: string) => (source.match(/splitEdgeAt\(/g) ?? []).length;
/** 唯一的删除出口：`const removeSelected = () => { … };`（切到下一个顶层 `const` 为止）。 */
const removeSelectedSource = (source: string) => blockAfter(source, 'const removeSelected = ', '\n  const ');

/**
 * ★ 2026-10-06（教师）：「锁定初始图」—— 工具条上「恢复初始图」那颗按钮的 JSX 块
 * （从它**出现条件**那句 `{starter …&& (` 一路取到按钮文字）。
 * ⚠️ 判据是「出现条件里有没有一个**取反的**锁标记」，不是逐字钉变量名（`starterLocked` / `starter.locked`
 *    都认）；把闸整个拿掉、或者忘了取反（`starter.locked &&`），它都必须判红。
 */
const RESTORE_GATE = /\{starter[^}]*&&\s*\(\s*<button[\s\S]{0,400}?恢复初始图/;
const restoreShownWhenUnlocked = (source: string): boolean => {
  const gate = source.match(RESTORE_GATE);
  return !!gate && /!\s*[\w.]*[Ll]ocked\b/.test(gate[0]);
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

test('★ 2026-10-06（教师）：判断框出来的两条线默认 Y / N，线上可以写字，且字要活下来', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const svg = stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-flowchart-svg.ts'), 'utf8'));
  // ① 判断框的出边自动 Y / N（其它节点不自动给字 —— 每条线都塞字是噪音）。
  assert.match(live, /source\?\.data\.kind === 'decision'/, '没有「从判断框出来」这条判据');
  assert.match(live, /used === 0 \? 'Y' : used === 1 \? 'N'/, '判断框的出边没有 Y / N 的默认值');
  // ② 交出去的数据必须带上 label（漏了它 = 线上写的字一刷新就没了，而屏幕上不报错）。
  assert.match(live, /\.\.\.\(label \? \{ label \} : \{\}\)/, 'toFlowPayload 把线上的字丢了');
  // ③ 线上能写字：点线之后工具条出现 Y / N / 是 / 否 / 清空。
  assert.match(live, /onEdgeClick=/, '点线没有反应 —— 学生没法给线标注');
  assert.match(live, /\['Y', 'N', '是', '否'\]\.map/, '线标注那一组按钮不见了');
  // ★ 2026-10-06（教师）：「加上去的字变成了小黑块」——根因是只引了 `base.css`（没有颜色），
  //   边的标签背景矩形拿不到 `fill` ⇒ SVG 默认黑填充。两条判据：① 引带主题的那份样式表；
  //   ② 我们自己的 CSS 再把标签颜色钉一遍（换主题也不会变成读不出来的颜色）。
  assert.match(live, /@xyflow\/react\/dist\/style\.css/, '还在用没有颜色的 base.css —— 线标签会渲染成小黑块');
  assert.ok(!/@xyflow\/react\/dist\/base\.css/.test(live), 'base.css 还留着（两份样式表会打架）');
  const flowCss = stripComments(CSS);
  assert.match(flowCss, /\.react-flow__edge-textbg\) \{ fill: #ffffff; \}/, '线标签的背景没有钉成白色');
  assert.match(flowCss, /\.react-flow__edge-text\) \{[\s\S]{0,120}?fill: #263b53;/, '线标签的文字颜色没有钉住');
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

test('★ 2026-10-06（教师）：底稿（A 不算学生作答 / B 锁定初始图 / 先做流程图）', async () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const body = stripComments(fs.readFileSync(path.resolve(HERE, '..', 'drawing-tool-body.tsx'), 'utf8'));
  // ① 学生端拿得到底稿，并交给画板。
  assert.match(body, /starter=\{readDrawingStarter\(node\)\}/, '学生端没有把底稿交给画板');
  // ② 读的时候合并（底稿 + 学生画的）—— ★ 必须把「锁定初始图」这一档**交给合并**；
  //    写的时候剔除（A：底稿不算他的作答）。
  assert.match(live, /const starterLocked = /, '学生端没有读「锁定初始图」这一档');
  assert.match(live, /mergeFlowchart\(starterPayload, readFlowchartPayload\(readFlowData\(data\)\), starterLocked\)/,
    '没有把「锁定初始图」交给合并 —— 两档会不分（要么全锁、要么老师取消了也还锁着）');
  assert.match(live, /onChange\(subtractFlowchart\(payload, starterPayload\)/, '交上去的作答没有剔除底稿（A）');
  // ③ 快照仍按**全部**画（教师预览/AI/报告要看到完整那张图）。
  assert.match(live, /lastFlow\.current = payload;/, '快照用的不是完整那份（教师/AI 会看到缺了底稿的图）');
  // ④ ★ B 现在是**条件性**的（「锁定初始图」一个开关）：
  //    · 未锁 ⇒ 「恢复初始图」必须出现（那是**唯一**的回退路径）；
  //    · 锁定 ⇒ 它必须**不**出现（学生动不了老师的东西，恢复只会误删他自己的补充）。
  assert.match(live, /restoreFlowchart\(starterPayload, starterLocked\)/, '没有「恢复初始图」的实现（或没认那一档开关）');
  assert.ok(restoreShownWhenUnlocked(live), '「恢复初始图」没有按「未锁」显示 —— 锁定的题也会给学生一颗恢复按钮');
  // ⚠️ 反面对照：把出现条件里那个取反去掉（回到「有初始图就显示」）⇒ 必须判违规。
  const restoreGate = live.match(RESTORE_GATE);
  assert.ok(restoreGate, '「恢复初始图」的按钮块没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const withoutGate = live.replace(restoreGate[0], restoreGate[0].replace(/!\s*[\w.]*[Ll]ocked\s*&&\s*/, ''));
  assert.notEqual(withoutGate, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!restoreShownWhenUnlocked(withoutGate), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 「打不打锁」这件事本身必须**真能分档** —— 这里真调一次纯函数（不猜实现写法；`locked` 必填）。
  //    ⚠️ 这也正是上一版那句「源码里不许出现 draggable: false」换来的东西：那时它守的是
  //    「底稿又被无条件锁住了」，现在换成**行为**判据 —— 未锁一个标记都不许有、锁定必须都带锁。
  const { mergeFlowchart } = await import('../../../../../lib/worksheet-drawing-starter.ts');
  const starter = { nodes: [{ id: 't1', data: { label: '开始' } }], edges: [{ id: 'e1', source: 't1', target: 't1' }] };
  const openGraph = mergeFlowchart(starter, { nodes: [], edges: [] }, false);
  assert.equal(openGraph.nodes[0].draggable, undefined, '未锁时底稿还被锁着不能拖（教师取消锁定后学生应当可以改）');
  assert.equal(openGraph.edges[0].deletable, undefined, '未锁时底稿的连线还被锁着不能删');
  const lockedGraph = mergeFlowchart(starter, { nodes: [], edges: [] }, true);
  assert.equal(lockedGraph.nodes[0].draggable, false, '锁定时底稿的框还能拖');
  assert.equal(lockedGraph.nodes[0].deletable, false, '锁定时底稿的框还能删');
  assert.equal(lockedGraph.edges[0].deletable, false, '锁定时底稿的连线还能删');
});

test('★ 2026-10-06（教师）：「锁定初始图」= 老师的不可动、学生自己的可动（判据按 id）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 判据**按 id**：初始图里出现过的 id 就是「老师的」（`starterNodeIds` / `starterEdgeIds`）。
      这正是「连到线中点」拆线后**头段沿用原 id** 的原因之一 —— 拆出来的头段仍是老师的，
      而尾段、交点，以及学生新拉的那根线都是他自己的（照旧随便改）。
    ⚠️ 这一条盯的是**学生能碰到老师东西的四条路**（源码级：本仓没有 jsdom）：
      ① 框的文字输入框；② 改线的文字（双击 / 工具条标注那一组 / 唯一的写入出口）；
      ③ 唯一的删除出口；④ 浮层那颗删除按钮。
    ⚠️ 「拖动 + 键盘 Delete」不在这里 —— 那两条由 `mergeFlowchart` 打上的 `draggable/deletable`
      交给库自己认，上面那条用例已经**真调**过纯函数验算了。
  */
  /** 「是不是老师的」那两个判断：必须**锁定 + id 在初始图里**，少一半都错。 */
  const judgeOf = (name: string, ids: string, source: string): void => {
    const body = blockAfter(source, `const ${name} = `, ';');
    assert.ok(body.length > 20, `${name} 没抠出来 —— 先修这条判据，别让它在空串上全绿`);
    assert.match(body, /starterLocked/, `${name} 没看「锁定初始图」这一档（教师取消锁定后它照样把老师的东西锁着）`);
    assert.match(body, new RegExp(`${ids}\\.has\\(`), `${name} 没有按 id 判（初始图里出现过的 id 就是老师的）`);
  };
  judgeOf('isStarterNode', 'starterNodeIds', live);
  judgeOf('isStarterEdge', 'starterEdgeIds', live);
  // ⚠️ 反面对照：把「锁定」那一半去掉 ⇒ 判据必须红（证明它不是恒真的）。
  const noSwitch = live.replace('starterLocked && starterNodeIds.has(id)', 'starterNodeIds.has(id)');
  assert.notEqual(noSwitch, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/const isStarterNode = [^;]*starterLocked/.test(blockAfter(noSwitch, 'const isStarterNode = ', ';')),
    '反面对照没被抓住 —— 这条判据是恒真的');

  /** 这一段里有没有「按 id 拦住老师的线」那道闸。 */
  const locksTeacherEdge = (snippet: string): boolean => /isStarterEdge\(/.test(snippet);

  // ① 框的文字：`visibleNodes` 里按 id 挂上 `locked`（输入框的 disabled 认它），且不许弄丢 `disabled`。
  const visibleBody = blockAfter(live, 'const visibleNodes = useMemo', '\n  const ');
  assert.ok(visibleBody.length > 40, 'visibleNodes 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(visibleBody, /starterNodeIds\.has\(node\.id\)/, '锁定时老师的框文字没有变只读（`visibleNodes` 里没按 id 判）');
  assert.match(visibleBody, /disabled/, '「只读展示」那一档（disabled）被弄丢了');
  // ② 线的文字：双击不进就地输入框 + 工具条那一组只给学生的线 + 唯一的写入出口自己拦截。
  const dblBody = blockAfter(live, 'onEdgeDoubleClick={', 'onMove={');
  assert.ok(dblBody.includes('setLabelingEdge'), 'onEdgeDoubleClick 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(locksTeacherEdge(dblBody), '锁定时双击老师的线仍然进就地输入框（能改它的文字）');
  assert.ok(locksTeacherEdge(blockAfter(live, 'const labelableEdgeId = ', ';')),
    '锁定时工具条仍然给老师的线「标注」那一组（能改它的文字）');
  assert.ok(locksTeacherEdge(blockAfter(live, 'const setEdgeLabel = ', '};')),
    '改标注的唯一出口没有拦住老师的线（工具条/就地输入框之外还能改）');
  // ③④ 删除：唯一的删除出口有第二道闸；浮层不为老师的东西画删除按钮。
  const removeBody = removeSelectedSource(live);
  assert.ok(/isStarterNode\(/.test(removeBody) && /isStarterEdge\(/.test(removeBody),
    '唯一的删除出口没有「老师的东西不放行」那道闸（选中的是线那一支是我们自己 filter 的，库的 deletable 管不着）');
  assert.ok(locksTeacherEdge(overlaySource(live)) && /isStarterNode\(/.test(overlaySource(live)),
    '锁定时选中老师的框/线仍然浮出删除按钮（点了也删不掉，学生只会以为坏了）');
  // ⚠️ 反面对照：把「改标注的唯一出口」那道闸拿掉 ⇒ 判据必须红（证明切片不是恒真的）。
  const noLabelGuard = live.replace('if (isStarterEdge(id)) return;', '');
  assert.notEqual(noLabelGuard, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!locksTeacherEdge(blockAfter(noLabelGuard, 'const setEdgeLabel = ', '};')), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⚠️ 再加一条反面对照：双击那道闸拿掉 ⇒ 也必须红。
  const noDblGuard = live.replace('if (!isStarterEdge(edge.id)) setLabelingEdge(edge.id);', 'setLabelingEdge(edge.id);');
  assert.notEqual(noDblGuard, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!locksTeacherEdge(blockAfter(noDblGuard, 'onEdgeDoubleClick={', 'onMove={')), '反面对照没被抓住 —— 这条判据是恒真的');
});

test('★ 2026-10-06（教师）：流程图工具加图形图标；点线浮出图标删除；双击线改文字', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  // ① 四个加节点按钮 + 恢复初始图都要有**形状图标**（画的正是它会放下的那个节点）。
  assert.match(live, /FLOW_ICONS: Record<FlowKind/, '没有图标表');
  for (const key of ['terminator', 'process', 'decision', 'io', 'restore', 'trash']) {
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
  // ④ ★ 两条偏移（教师 2026-10-06 认可）：删除按钮往 source 退 `EDGE_FLOAT_BACK`、
  //   中点句柄往目标端挪 `HANDLE_GAP`。两个距离都是**命名常量**（数值本身由几何用例验算）。
  assert.match(live, /\boffsetAlong\b/, '没有偏移函数 offsetAlong');
  // ⚠️ 判据**按语义**写：抠出各自的函数体，在**体内**查「有没有 offsetAlong + 用的是哪个常量」，
  //    不逐字钉格式（按猜的格式写实际是多行 + `anchors.` 前缀，自己把自己判红 ✗）。
  //    切函数体切到**下一个顶层 `const` 声明**为止 —— 固定长度切片会把隔壁函数吞进来，
  //    两个函数挨着只隔 ~250 字，「常量名在 endBody 里」就会靠泄漏恒真。
  const bodyOf = (name: string) => {
    const at = live.indexOf(`const ${name} = `);
    if (at === -1) return '';
    const next = live.indexOf('\n  const ', at + 1);
    return next === -1 ? live.slice(at) : live.slice(at, next);
  };
  const endBody = bodyOf('edgeEndAnchor');
  const midBody = bodyOf('edgeMidAnchor');
  assert.ok(endBody.length > 40 && midBody.length > 40, '两个锚点函数没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // 删除按钮 → 往 source 退 `EDGE_FLOAT_BACK`；中点浮层 → 往目标端挪 `HANDLE_GAP`。两个距离不许互换。
  // ⚠️ 数值（`EDGE_FLOAT_BACK` / `HANDLE_GAP` 各是多少）**只在组件里声明一次**，锚点函数里认的是**名字**
  //    ⇒ 这里也不抄数字（常量的数值行为由下面那条几何用例从源码读出来验算）；
  //    常量的**数值行为**由下面的几何用例（真喂短边）验算。
  assert.ok(/\bEDGE_FLOAT_BACK\b/.test(endBody) && !/\bHANDLE_GAP\b/.test(endBody),
    '删除按钮的距离不是命名常量 EDGE_FLOAT_BACK（或与中点那个互换了）');
  assert.ok(/offsetAlong\(/.test(midBody) && /\bHANDLE_GAP\b/.test(midBody) && !/\bEDGE_FLOAT_BACK\b/.test(midBody),
    '中点浮层没有走命名常量 HANDLE_GAP（会压住 Y/N 标签）');
  // ★ 删除按钮的退向必须是**目标句柄轴**（`backX/backY` = smoothstep 末段方向），**不许**退回
  //   「起点→终点」直线近似 —— 直线近似在拐弯的边上会偏出线外 ~21px（见 `backAxis` 的注释）。
  //   轴映射本身另有**几何用例**（backAxis 四个方位 + 短边 clamp）。
  assert.match(endBody, /backX|backY/, '删除按钮没有沿目标句柄轴退（拐弯的边上会偏出线外）');
  assert.ok(!/\boffsetAlong\(/.test(endBody), '删除按钮退回了「起点→终点」直线近似（拐弯的边上会偏出线外）');
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
  // ⚠️ 反面：**交点节点**必须用**精确中点**（`anchors.midX - junctionHalf`），偏移不许卷进 `onConnect` ——
  //    否则拆出来的两段与原来那条线对不上（当初正是按精确中点实测出「完全重合」）。
  //    判据**圈在 `onConnect` 体内**，不是「offsetAlong 后 200 字内有没有 junctionHalf」那种靠距离的写法
  //    （距离一变就恒真/恒假）。
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 400, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ★ 2026-10-06：插交点 + 拆线搬进了**共用的那一份实现**（`splitEdgeAt`，两条入口共用）
  //   ⇒ 「交点落在精确中点」要在**那一份**里判（`onConnect` 现在只负责认出落点是边）。
  //   下面那条反面对照仍然拿 `onConnect` 当靶子：往它里面塞 offsetAlong 也要红（它自己不许有偏移）。
  const splitBody = splitEdgeSource(live);
  assert.ok(splitBody.length > 400, '拆线那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/, '交点没有落在精确中点上');
  assert.ok(!/offsetAlong/.test(splitBody), '交点被卷进了浮层偏移（拆出来的两段会与原线对不上）');
  assert.ok(!/offsetAlong/.test(onConnectBody), '交点被卷进了浮层偏移（拆出来的两段会与原线对不上）');
  // 反面对照：往拆线那一份实现里塞一句 offsetAlong ⇒ 上面那句必须红（证明它不是恒真）。
  // ⚠️ 靶子必须选**有那两行**的那一块（`splitBody`）：拿 `onConnect` 当靶子会 replace 不上，
  //   于是「造不出反面对照」自己先红 —— 那是判据写错，不是实现坏。
  const poisonedConnect = splitBody.replace('const junctionHalf = 6;', 'const junctionHalf = offsetAlong({ x: 1, y: 1 }, { x: 2, y: 2 }, 6);');
  assert.notEqual(poisonedConnect, splitBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(/offsetAlong/.test(poisonedConnect), '反面对照没造出来 —— 这条判据会变成恒真');

  // ⑤ 浮层靠**视口换算**跟随（不引 Provider、也不复刻折线算法）。
  assert.match(live, /onMove=\{\(_, next\) => setViewport\(next\)\}/, '没有跟视口');
  // ★ 教师 2026-10-06：「距离太远，应该就在那根连接线上」——第一版取两节点中心的中点，
  //   而 `smoothstep` 是折线，中心点经常不在路径上。现在必须用库自己的路径函数取**标签点**。
  assert.match(live, /getSmoothStepPath\(\{/, '锚点没有用库的路径函数（第一版就是这里飘的）');
  assert.match(live, /const \[, labelX, labelY\] = getSmoothStepPath/, '没有取标签点 labelX/labelY');
  // ⑤ 浮层命中区：组件里的命名常量 `FLOAT_SIZE` 与样式表里那几处尺寸**必须一致**
  //    （CSS 读不到 TS 常量，所以只能靠这条判据把两份对起来；44px 这个**下限**由
  //    `worksheet-tap-targets.test.ts` 直接从 CSS 量）。
  const floatSize = Number((live.match(/const FLOAT_SIZE = (\d+);/) || [])[1]);
  assert.ok(Number.isFinite(floatSize) && floatSize > 0, `没有读到命名常量 FLOAT_SIZE（读到 ${floatSize}）`);
  assert.match(css, new RegExp(`\\.flowEdgeFloat \\{[\\s\\S]{0,200}?width: ${floatSize}px;`), '浮层删除按钮的命中区与 FLOAT_SIZE 不一致');
  assert.match(css, new RegExp(`\\.flowEdgeFloat \\{[\\s\\S]{0,200}?height: ${floatSize}px;`), '浮层删除按钮的命中区与 FLOAT_SIZE 不一致');
  assert.match(css, new RegExp(`\\.flowEdgeInput \\{[\\s\\S]{0,260}?min-height: ${floatSize}px;`), '就地输入框太矮（与 FLOAT_SIZE 不一致）');
});

test('★ 2026-10-06（教师，A 方案）：连接线中点可以连 —— 中点句柄 + 插交点 + 拆线', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const css = stripComments(CSS);
  /*
    ⚠️ 这一条盯的是**机制**（每一句都能在实现被改坏时变红），不是手感。
    🔴 下面这两件事是**实测**出来的（无头 Chrome 154 + 本仓 React Flow 12.11.6，用合成鼠标事件真拖过）：
       · 句柄必须住在 `EdgeLabelRenderer` 里 —— 边是 SVG，直接往里塞 `<div>` 渲染不出来；
       · 还必须自己补 `data-nodeid` = **边 id**（库的 `Handle` 在边里 `useNodeId()` 拿到 null）
         —— 不补的话拖上去 `onConnect` **一次都不响**（只有 onConnectEnd），控制台报 error#010。
  */
  assert.match(live, /function FlowEdgeLine\(/, '没有自定义边组件');
  assert.match(live, /const \[path, labelX, labelY\] = getSmoothStepPath\(\{/, '自定义边没有用库的路径函数取标签点');
  // ① 句柄：住在 EdgeLabelRenderer 里、是 target/Top/edge-mid、位置取自标签点。
  const labelRendererAt = live.indexOf('<EdgeLabelRenderer>');
  const midHandleAt = live.indexOf('id="edge-mid"');
  assert.ok(labelRendererAt !== -1 && midHandleAt !== -1 && labelRendererAt < midHandleAt, '中点句柄没有住在 EdgeLabelRenderer 里（边是 SVG，<div> 塞进去渲染不出来）');
  assert.match(live, /type="target"/, '中点句柄不是 target');
  assert.match(live, /position=\{Position\.Top\}/, '中点句柄没有用 Position.Top');
  // ★ 教师认可：句柄**不再**停在标签点上，而是沿「标签点 → 目标端」方向挪 `HANDLE_GAP`
  //   （原来与 Y/N 标签同点 ⇒ 悬停变实会盖字，且正落在中点的单击/双击被它吞掉）。
  // ⚠️ 判据按**语义**判，不逐字钉算术写法（上一版钉的是 `const handleX = labelX + ((targetX - labelX) / shiftLen) * <那个常量>`
  //    那种整句正则 —— 换个变量名/换成多行就红，正是今天连红五次的那类断言）。这里拆成两条**行为**：
  //    ① 位移必须从**库回的标签点**出发、朝**目标端**、距离取命名常量（来源判据保留，不能因为挪了就丢掉来源）；
  //    ② 样式必须用**位移后**的坐标（不能再是裸的 labelX/labelY）。
  const lineAt = live.indexOf('function FlowEdgeLine(');
  // ⚠️ 结束标记必须是 `\n}\n`：props 解构的结尾是 `\n}: EdgeProps)`（也是行首的 `}`），
  //    用 `\n}` 会在 134 字处就切断 ⇒ 下面几条会在**半个函数**上判，或者干脆判空。
  const lineBody = lineAt === -1 ? '' : live.slice(lineAt, live.indexOf('\n}\n', lineAt));
  assert.ok(lineBody.length > 400, '边组件没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const shiftArgs = lineBody.match(/offsetAlong\(([\s\S]{0,160}?)\)/);
  assert.ok(shiftArgs, '句柄没有用 offsetAlong 做位移');
  assert.match(shiftArgs[1], /\blabelX\b/, '句柄的位移不是从库回的标签点（labelX）出发的');
  assert.match(shiftArgs[1], /\blabelY\b/, '句柄的位移不是从库回的标签点（labelY）出发的');
  assert.match(shiftArgs[1], /\btargetX\b/, '句柄的位移方向不是朝目标端（targetX）');
  assert.match(shiftArgs[1], /\btargetY\b/, '句柄的位移方向不是朝目标端（targetY）');
  // ★ 第 2 步整理：距离认**命名常量** `HANDLE_GAP`（数值只在组件里声明一次；短边验算在几何用例里）。
  assert.match(shiftArgs[1], /\bHANDLE_GAP\b/, '句柄的位移距离不是命名常量 HANDLE_GAP');
  const handleStyle = lineBody.match(/style=\{\{ left: ([\w.]+), top: ([\w.]+) \}\}/);
  assert.ok(handleStyle, '句柄的 style 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/\blabel[XY]\b/.test(handleStyle[1]) && !/\blabel[XY]\b/.test(handleStyle[2]),
    '句柄仍停在标签点上（style 用的还是裸的 labelX/labelY，没有被位移后的坐标取代）');
  assert.match(live, /'data-nodeid': edgeId/, '句柄没有补 data-nodeid（没补 ⇒ 库在边里取不到 node id，拖上去 onConnect 不响）');
  // ② 线上的字自己画，且类名与库**逐字相同**（我们的配色 CSS 就是按这两个类写的）。
  assert.match(live, /className="react-flow__edge-textbg"/, '边的标签白底没有用库那个类名（配色会失效）');
  assert.match(live, /className="react-flow__edge-text"/, '边的标签文字没有用库那个类名（配色会失效）');
  // ③ 注册自定义边 + 每条边强制 type: 'flow'（老作答存的是 'smoothstep'，不强制老图就没有中点句柄）。
  assert.match(live, /const edgeTypes = useMemo\(\(\) => \(\{ flow: FlowEdgeLine \}\), \[\]\)/, '自定义边没有注册');
  assert.match(live, /edgeTypes=\{edgeTypes\}/, 'ReactFlow 没有用上自定义边');
  assert.match(live, /\.map\(\(edge\) => \(\{ \.\.\.edge, type: 'flow' \}\)\)/, "visibleEdges 没有给每条边强制 type: 'flow'（老作答的 'smoothstep' 就没有中点句柄）");
  // ④ onConnect：target 是**已存在的边 id** ⇒ 插一个交点 + 把原边拆成两段。
  // ⚠️ 切片走 `onConnectSource()`，它的**结束标记是代码**（useCallback 的 deps 那一行）：注释早就被
  //    `stripComments` 剥掉了，拿注释当标记会切出一个空串或者切到文件末尾（那会让下面几条在错误的范围上"全绿"）。
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 400, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ⚠️ 判据**圈在 `const hitEdge = …` 那一句里**：只断言「全函数里同时出现 connection 的两端」
  //    会漏 —— 下面那句 `connection.source === hitEdge.id` 正好把 source 带进来，于是「只认 target」
  //    的坏版本照样绿（变异测试实测过）。
  const hitGuard = onConnectBody.match(/const hitEdge = ([^;]+);/);
  assert.ok(hitGuard, 'hitEdge 那一句没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(hitGuard[1], /connection\.target/, '没有判「connection 的 target 是已存在的边 id」');
  assert.match(hitGuard[1], /connection\.source/, '没有判「connection 的 source 是已存在的边 id」—— 从节点的 target 句柄（菱形左侧那种）拖到中点那一路会漏（实测：会造出一条 source 是边 id 的悬空边，它渲染不出来、却写进作答）');
  // ★ 2026-10-06：插交点 + 拆线只留了**一份**实现（`const splitEdgeAt = useCallback(`），
  //   因为它现在要服务**两条入口**：① 库自己判定的精确命中（`onConnect`）、
  //   ② 落点吸附的兜底（`onConnectEnd`，见下面那条用例）。留两份必然分叉 ⇒ 这里必须抠出来判。
  const splitBody = splitEdgeSource(live);
  assert.ok(splitBody.length > 400, '拆线的那一份实现没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(splitterCallSites(live) >= 2,
    '拆线还是**多处各写一遍**（或只有一条入口在用）—— 精确命中与吸附松手必须是同一条实现，否则两条路的行为会分叉');
  assert.match(splitBody, /kind: 'junction'/, '没有插 junction 节点');
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/, '交点没有落在库算出来的标签点上（流坐标）');
  assert.ok(!/viewport/.test(splitBody), '交点的位置用了视口/屏幕坐标（画布一动就飘）');
  // 拆线的两步：① 原边变「原 source → 交点」；② 交点 → 原 target（过一次 addEdge）。
  assert.match(splitBody, /const head: Edge = \{ \.\.\.original, target: junctionId/, '原边没有被改成「原 source → 交点」那一段');
  // ⚠️ 断言到 `filter(...)` 为止，**不钉整句**：这一句后面还要排进学生拉的那根线（见下一条用例），
  //    钉住右括号等于「加了 link 就红」—— 那正是今天红过好几次的那种格式断言。
  assert.match(splitBody, /addEdge\(tail, current\.filter\(\(edge\) => edge\.id !== original\.id\)/, '没有把原边摘掉、再用 addEdge 接上第二段');
  // ⑤ 交点画成小圆点（不承袭 .flowNode 的 150×54），而且**没有**文字输入框。
  assert.match(css, /\.flowNode_junction \{[\s\S]{0,200}?min-width: 12px;[\s\S]{0,80}?min-height: 12px;/, '交点没有自己的尺寸（会承袭 .flowNode 的 150×54）');
  assert.match(css, /\.flowNode_junction \{[\s\S]{0,260}?border-radius: 50%/, '交点不是圆点');
  const editorBody = live.slice(live.indexOf('function FlowNodeEditor'), live.indexOf('const edgeHandleNodeId'));
  assert.ok(editorBody.length > 400, '节点编辑器没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(editorBody, /const isJunction = data\.kind === 'junction'/, '没有认出 junction 这一档');
  assert.match(editorBody, /\{!isJunction && \(\s*<input[\s\S]{0,240}?aria-label="节点文字"/, '交点也会渲染「节点文字」输入框（图上会多一个空框）');
  // ⑥ 中点句柄的可见性：常显但很轻 + 悬停变实；选中那一档由组件按 `selected` 挂类。
  assert.match(css, /\.thirdPartyCanvas \.flowEdgeHandle \{[\s\S]{0,240}?opacity: \.35;/, '中点句柄没有「常显但很轻」那一档');
  assert.match(css, /\.thirdPartyCanvas \.flowEdgeHandle:hover \{[\s\S]{0,140}?opacity: 1;/, '悬停中点句柄时没有变实');
  assert.match(live, /flowEdgeHandleOn/, '选中那条边时中点句柄没有变实（组件没有按 selected 挂类）');
});

test('★ 2026-10-06（教师报「连线加不上」）：连到线中点时，**学生拉的那根线本身**必须真的接上', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    🔴 实测（无头 Chrome 154 + 教师那张真底稿 `q_aac88ed0…`，用 CDP 真合成鼠标事件、跑本仓真组件）：
      · 修前（HEAD 0bc9609，同一拖、同一落点：从「过程」框的右句柄拖到另一条线中点那颗句柄）：
        `onConnect` **确实响了**（所以既不是「拖不动」也不是「落点被判无效」）、交点也插了、
        原线也拆成两段了 —— 但**学生拉的那根线没有被加进去**：交出去的 edges 只从 4 条变 5 条
        （那 5 条 = 原线拆出来的两段），作答里只有 `junction-…-tail`。
        ⇒ 屏幕上预览线一松手就没了、原线看上去还是原来那根（只是线上多了个小点）
        ⇒ 教师看到的就是「连线没有出现」。
      · 修后：同一拖、同一落点 ⇒ DOM 里的边 4 **→ 6**，作答里多出 `junction-…-link`
        （过程框 → 交点）—— 学生画的那根线真的出现了。
    ⚠️ 判据按**语义**判：那一支里必须出现一根「一端是交点、另一端是 connection 的那一端」的边，
      而且必须真的排进「加边」那句的返回数组里；**不**逐字钉三元表达式或返回语句的写法
      （今天已经因为钉格式红过五六次）。
  */
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 400, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ① 结构：边那一支必须在「落点是节点」那一支**之前**，并且自己提前 return
  //    （不 return 的话同一拖还会被下面那一支再处理一遍）。
  const edgeBranchAt = onConnectBody.indexOf('if (hitEdge) {');
  const nodeBranchAt = onConnectBody.indexOf('const source = nodes.find(');
  assert.ok(edgeBranchAt !== -1, '没有「落点是边」那一支');
  assert.ok(nodeBranchAt > edgeBranchAt, '「落点是节点」那一支跑到前面去了 —— 先修这条判据');
  const edgeBranch = onConnectBody.slice(edgeBranchAt, nodeBranchAt);
  assert.match(edgeBranch, /return;/, '边那一支没有提前 return —— 同一拖会被「落点是节点」那一支再走一遍');
  // ② 「学生拉的那根线」接全了吗？（本地判据函数 ⇒ 反面对照能直接复用它。）
  // ★ 2026-10-06：建 `link` 与「拆线」现在住在**那一份共用实现** `splitEdgeAt` 里（两条入口共用），
  //   而 `onConnect` 只剩「认出落点是边 + 把两端交给它」。判据因此要**跟到那一份实现里**去 ——
  //   否则它会在 `onConnect` 里找不到 `const link: Edge` 而**误红**（守的东西一条没少）。
  //   ⚠️ 仍然按语义判：要同时看到「交点 → 学生拖到的那一端」与「学生拖出的那一端 → 交点」**两向**，
  //     并且 `link` 必须真的排进 `addEdge` 那句的返回数组里（只声明不排 = 等于没接上）。
  //     两个方向的**输入名**在共用实现里是 `endpointId` / `endpointDraggedFromEdge`（不再是
  //     `connection.*`）⇒ 判的是「这一端在不在」，不是某个变量名。
  const alreadyInBranch = /const link: Edge/.test(edgeBranch);
  /** 拆线那一份共用实现（`link` 与「拆线」都住在这里）。 */
  const splitBody = splitEdgeSource(live);
  const missingLink = (branch: string): string[] => {
    const missing: string[] = [];
    if (!/splitEdgeAt\(/.test(branch)) missing.push('边那一支没有把两端交给共用的拆线实现（splitEdgeAt）');
    const at = branch.indexOf('const link: Edge');
    // ⚠️ 找不到那一句时必须把**已经攒下的缺失**一起返回：`return missing`（空数组）会让反面对照恒真
    //    —— 「拆线那一份里没有 link」这件事就悄悄变成「没有意见」（实测踩过）。
    if (at === -1) return [...missing, '根本没有给学生拉的那根线建边（只拆原线）'];
    const end = branch.indexOf('addEdge(', at);
    const body = end === -1 ? branch.slice(at) : branch.slice(at, end);
    if (!/junctionId[\s\S]{0,240}?(endpointId|connection\.target)/.test(body)) missing.push('少了「交点 → 学生拖到的那一端」那一向');
    if (!/(endpointId|connection\.source)[\s\S]{0,240}?junctionId/.test(body)) missing.push('少了「学生拖出的那一端 → 交点」那一向');
    const tailAt = branch.indexOf('addEdge(tail,');
    if (tailAt === -1) missing.push('第二段没走 addEdge');
    else if (!/\blink\b/.test(branch.slice(tailAt, branch.indexOf(';', tailAt)))) missing.push('link 只被声明、没排进返回的边数组（等于没接上）');
    return missing;
  };
  //   ⚠️ 拼接时只用 `onConnect` 的**边那一支**（`edgeBranch`），不要把整个 `onConnectBody` 接进来：
  //     那里面还有「落点是节点」那一支的 `setEdges`，会把 `addEdge(tail, …)` 之外的内容一起带进来，
  //     让反面对照（掐掉共用实现那一次调用）**replace 不干净** ⇒ 判据变成恒真（实测踩过）。
  const linkRegion = alreadyInBranch ? edgeBranch : edgeBranch + splitBody;
  assert.deepEqual(missingLink(linkRegion), [],
    `连到线中点时，学生拉的那根线没接上：${missingLink(linkRegion).join('、')}（教师报的「连线加不上」就是它）`);
  // ⚠️ 反面对照：把「接上学生那一拖」整段拿掉（回到修前那种「只拆不接」）⇒ 必须判违规。
  //    判**共用实现那一份**（`splitBody`）—— 掐掉 `onConnect` 里那句调用是没用的：`link` 在共用
  //    实现里还会被建出来，判据照样给空数组（反面对照恒真，实测踩过）。
  const linkDecl = /const link: Edge/;
  const withoutLink = linkDecl.test(splitBody)
    ? linkRegion.replace(/const link: Edge[\s\S]*?(?=return \[)/, '')
    : linkRegion.replace(/splitEdgeAt\([\s\S]*?\);/, '');
  assert.notEqual(withoutLink, linkRegion, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.notDeepEqual(missingLink(withoutLink), [], '反面对照没被抓住 —— 这条判据是恒真的');
  // ⚠️ 反向也要认：`connection.source` 是边 id 时（从节点的 target 句柄拖到中点），
  //    绝不能把那条边的 id 当成 source 节点（实测：那种边渲染不出来，却会写进作答）。
  assert.ok(!/source: hitEdge\.id/.test(live), '把边 id 当成节点用了 —— 那条边渲染不出来（悬空边）');
});

test('★ 2026-10-06（教师：「拖到线附近松手也要能连上」）：落点吸附 —— 几何兜底 + 同一条拆线实现', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const endBody = onConnectEndSource(live);
  const splitBody = splitEdgeSource(live);
  /*
    🔴 实测事实（无头 Chrome 154 + CDP 真合成鼠标事件，跑本仓真组件；探针只放 /private/tmp）：

      中点那颗句柄住在**自定义边**里、不是节点 ⇒ 它**不在库的 `nodeLookup` 里** ⇒ 库给节点句柄的
      `connectionRadius`（默认 20px）那套几何吸附**对它完全无效**；库对它的落点判定只剩
      `isValidHandle()` 里那条 `document.elementFromPoint(x, y)`。于是：

        · 改前（`HANDLE_GAP = 14`、句柄 10px、无兜底）：落点偏句柄圆心 0px ⇒ 连上；
          **偏 5px 就已经什么都不发生**（落点被边上那条 SVG path 抢走）；偏 15 / 20 / 25px 全落空。
        · 改后（`EDGE_SNAP_RADIUS = 22` 的几何兜底）：偏 0 / 5 / 15 / 20px ⇒ **都连上**
          （DOM 边 2→4、节点 3→4，作答里 `junction-…-tail` + `junction-…-link` 都在）；
          偏 **25 / 30px ⇒ 仍然不连**（该连的连上、不该连的不连）。
        · 拖到空白（中点下方 260px）⇒ DOM 边 2→2、节点 3→3、作答为空 —— **什么都不做**。

    ⚠️ 也试过「先把句柄自己撑大」那条最便宜的路（36 / 40px 的透明命中层）：连接确实好了，但
      探针量出来 `elementFromPoint(线上 Y/N 标签中心)` 会返回**句柄** ⇒「双击线上的字改文字」
      当场坏掉（那个盒子把标签白底框的下半截吃掉了）⇒ 那条路已废弃（CSS 里留了警告）。
  */
  assert.ok(endBody.length > 300, '落点吸附那段没抠出来 —— 先修这条判据，别让它在空串上全绿');
  // ① 半径必须是**命名常量**（数值只在组件里声明一次）。
  const radiusRaw = (live.match(/const EDGE_SNAP_RADIUS = ([^;]+);/) ?? [])[1];
  assert.ok(radiusRaw !== undefined, '没有命名常量 EDGE_SNAP_RADIUS（吸附半径会变成散落的魔法数）');
  const radius = Number(new Function(`return (${radiusRaw});`)());
  assert.ok(radius > 0, `EDGE_SNAP_RADIUS 不是正数（读到 ${radiusRaw}）`);
  assert.ok(endBody.includes('EDGE_SNAP_RADIUS'), '兜底没有用命名常量 EDGE_SNAP_RADIUS 做半径');
  // ② 「同一次拖拽只能生效一次」：`onConnect` 那条路成功时置位、兜底进来先看它。
  assert.match(live, /handledRef/, '没有「这一拖已经生效过」的记号 —— 同一次拖拽会插两个交点');
  assert.match(endBody, /handledRef\.current/, '兜底没有先看「已经生效过」这个记号（会与库那一次重复插交点）');
  assert.match(splitBody, /handledRef\.current = true/, '「已经生效过」的记号没有在**共用的那一份拆线实现**里置位（两条入口都会插交点）');
  // ⚠️ 反面对照：把兜底那道闸拿掉 ⇒ 上面两条必须红。
  const headless = endBody.replace('if (handledRef.current) return;', '');
  assert.notEqual(headless, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/handledRef\.current/.test(headless), '反面对照没被抓住 —— 这条判据是恒真的');
  // ③ 兜底必须走**同一条**拆线实现（不是自己又写一遍）。
  const usesSplitter = (body: string) => /splitEdgeAt\(/.test(body);
  assert.ok(usesSplitter(endBody), '兜底没有走共用的拆线实现（自己又写一遍 = 两条路的拆法必然分叉）');
  assert.ok(splitterCallSites(live) >= 2, '拆线只有一条入口在调用 —— 精确命中与吸附松手必须共用同一份实现');
  // ⚠️ 反面对照：把兜底那次调用掐掉 ⇒ 必须判违规。
  const noApply = endBody.replace(/splitEdgeAt\([^;]*\);/, '');
  assert.notEqual(noApply, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!usesSplitter(noApply), '反面对照没被抓住 —— 这条判据是恒真的');
  // ④ 🔴 拖到空白**不许**插交点：必须有「最近的一条边」这个筛选，而且**找不到就走人**。
  const blankDropOk = (body: string): boolean => {
    const filterAt = body.search(/distance\s*>\s*EDGE_SNAP_RADIUS/);
    if (filterAt === -1) return false;
    const after = body.slice(filterAt);
    return /if \(!nearest\) return;/.test(after) && /nearest\s*=/.test(after);
  };
  assert.ok(blankDropOk(endBody), '兜底没有「离最近那条边还在半径外就不做」这道闸 —— 拖到空白也会插一个交点出来');
  // ⚠️ 反面对照：把半径那道筛选改成恒真（永远「够近」）⇒ 必须判违规。
  const alwaysNear = endBody.replace(/distance\s*>\s*EDGE_SNAP_RADIUS/, 'false');
  assert.notEqual(alwaysNear, endBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!blankDropOk(alwaysNear), '反面对照没被抓住 —— 这条判据是恒真的');
  // ⑤ 半径筛的是**到那一段的锚点距离**，不是「指针下有没有边」这种 DOM 猜测。
  assert.match(endBody, /edgeFlowAnchors\(/, '兜底没有用锚点表算距离（拿不到「这条线在哪」）');
  assert.match(endBody, /midX|midY/, '兜底没有用库算出来的标签点当中点');
  // ⑥ 交点仍必须落在**精确中点**（吸附只决定「连哪条线」，不许把浮层那 18px 偏移卷进来）。
  assert.match(splitBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/,
    '吸附那条路把交点挪离了精确中点 —— 拆出来的两段会与原线对不上');
  assert.ok(!/offsetAlong|HANDLE_GAP/.test(splitBody), '拆线里混进了浮层偏移（交点会跟着浮层走）');
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
       ⚠️ 「0px 也连不上」那一格最刺眼：触屏下学生**正正落在线上**也连不上，只因为中点句柄
          按 `HANDLE_GAP` 挪开了 —— 教师说的「小学课堂上会大量发生」在 iPad 上是 100% 发生。
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

test('★ 2026-10-06（教师报「连线加不上」）：落点约定 —— Loose 模式 / 中点句柄是 target / data-nodeid=边 id', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const onConnectBody = onConnectSource(live);
  assert.ok(onConnectBody.length > 400, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  /*
    ⚠️ 这一条钉的是**三条相互咬合的约定**（每一条的「为什么」都写在断言消息里）：
      ① 普通连线（落点是**节点**）仍然要被加进去，而且那一支必须**走得到**；
      ② `connectionMode` 必须是 Loose；
      ③ 中点句柄必须是 `target`，并且自己补 `data-nodeid = 边 id`。
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
  // ③ 中点句柄（住在边里）必须是 `target` + 自己补 `data-nodeid = 边 id`：
  //    `isValidHandle` 就是靠「`elementFromPoint` 拿到这颗句柄」+「读它的 data-nodeid 当 target」
  //    才认出「连到线上」的（库的 `Handle` 在边里 `useNodeId()` 拿到 null，不补就没有这个属性）
  //    —— 这是整条路**唯一**的凭据，也是 `onConnect` 里认出「那是边 id」的唯一来源。
  assert.match(live, /id="edge-mid"/, '中点句柄的 id 不是 edge-mid');
  assert.match(live, /type="target"/, '中点句柄不是 target（库在到达端只认 target/source 的类名）');
  assert.match(live, /'data-nodeid': edgeId/, '中点句柄没有补 data-nodeid=边 id —— 库读不到 node id，往它上面拖 `onConnect` 一次都不响');
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
  // ⑦ 锚点必须是「节点上边缘**上方**」+ 与线的浮层同一套视口换算。
  const anchorAt = live.indexOf('const nodeFloatAnchor = ');
  assert.ok(anchorAt !== -1, '没有节点浮层的锚点 —— 先修这条判据');
  const anchorEnd = live.indexOf('\n  const ', anchorAt + 1);
  const anchorsBody = anchorAt === -1 ? '' : live.slice(anchorAt, anchorEnd === -1 ? undefined : anchorEnd);
  assert.ok(anchorsBody.length > 40, '节点锚点没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(anchorsBody, /node\.position\.y - NODE_FLOAT_GAP/, '锚点没有退到节点上边缘**上方**（`NODE_FLOAT_GAP`）');
  assert.match(anchorsBody, /viewport\.x \+ [\w.]+ \* viewport\.zoom/, '锚点没有做横向视口换算（浮层会飘）');
  assert.match(anchorsBody, /viewport\.y \+ [\w.]+ \* viewport\.zoom/, '锚点没有做纵向视口换算（浮层会飘）');
  // ⑧ 交点不做特例（教师没提它）：删除那条路、浮层描述式、锚点解析里都不许给 `junction` 开分支。
  const selectedAnchorBody = selectedAnchorSource(live);
  assert.ok(selectedAnchorBody.length > 40, '锚点解析没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/junction/.test(removeBody), '删除那条路上给交点开了特例 —— 教师没要求（删交点、连带删它两条线是可接受的）');
  assert.ok(!/junction/.test(overlayBody), '浮层给交点开了特例 —— 交点与普通框同一处浮层');
  assert.ok(!/junction/.test(selectedAnchorBody), '锚点解析给交点开了特例 —— 交点与普通框走同一条锚点');
});

test('★ 2026-10-06（教师，A 方案）：快照要认「交点」——一颗小圆点，不能落进默认的空矩形', async () => {
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
  assert.match(out.svg, /<circle[^>]*r="5"[^>]*fill="#527198"/, '交点没有画成一个实心小圆点');
  assert.ok(!/<rect[^>]*rx="8"/.test(out.svg), '交点被画成了默认矩形（AI 看到的图上会凭空多一个空框）');
});

test('★ 2026-10-06（教师）：「选中一个图形准备移动时，后面的图形都一起移动」——节点里的输入框不许再挂 nodrag', () => {
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
  const editorBody = live.slice(live.indexOf('function FlowNodeEditor'), live.indexOf('const edgeHandleNodeId'));
  assert.ok(editorBody.includes('aria-label="节点文字"'), '节点编辑器没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(!/nodrag/.test(editorBody), '节点里的输入框又挂上了 nodrag —— 「拖框」会变成「拖画布」（教师 2026-10-06 报的就是它）');
  // 反面对照：把那个类名塞回同一个函数体 ⇒ 上面那句必须红（这条判据不是恒真的）。
  const withNodrag = editorBody.replace('aria-label="节点文字"', 'className="nodrag"\n          aria-label="节点文字"');
  assert.notEqual(withNodrag, editorBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(/nodrag/.test(withNodrag), '反面对照没造出来 —— 这条判据会变成恒真');
});

test('★ 2026-10-06（教师截图）：删除浮层用**终点**锚点，就地输入框仍用**中点**锚点', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  /*
    ⚠️ 两个锚点必须**分开存在**、且分别被引用 —— 谁把它们换回来都要变红：
      · 中点（`midX/midY`）＝ `getSmoothStepPath` 回的**标签点**（线上的字就画在那儿）⇒ 就地输入框；
      · 终点（`endX/endY`）＝ **目标节点那一侧**的句柄点（`to`）＝ 箭头落点 ⇒ 选中后浮出的删除图标。
    ⚠️ 别拿起点（source 那端）当终点：教师指的是**箭头**落下的那一端。
  */
  // ⚠️ 判据**按语义**判（抠出 `edgeFlowAnchors` 的函数体，看**每个锚点是从哪个数据来的**），
  //    不逐字钉 `const { midX: labelX … } = anchors;` / 整条 `return { … }` —— 实现刚从单行
  //    解构改成了多行 offsetAlong，这类判据连红五次、还两次只同步一半 ✗。变量叫什么名字都行：
  //    先认出「库回的标签点」与「目标侧/起点侧的句柄点」这三个来源，再看锚点表用了谁。
  const anchorsAt = live.indexOf('const edgeFlowAnchors = useCallback');
  const anchorsBody = anchorsAt === -1 ? '' : live.slice(anchorsAt, live.indexOf('\n  const ', anchorsAt + 1));
  assert.ok(anchorsBody.length > 400, '锚点函数没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const labelPoint = anchorsBody.match(/const \[, (\w+), (\w+)\] = getSmoothStepPath/) || [];
  assert.ok(labelPoint[1] && labelPoint[2], '没有取库回的标签点 labelX/labelY');
  assert.match(anchorsBody, new RegExp(`midX: ${labelPoint[1]}[\\s\\S]{0,80}?midY: ${labelPoint[2]}`), '中点锚点没有取自 getSmoothStepPath 的标签点');
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
  assert.match(endFnBody, /y: node\.position\.y/, `句柄点函数 ${endPoint[2]} 的盒子不是从 node.position 来的`);
  assert.match(endFnBody, /box\.y \+ box\.height/, `句柄点函数 ${endPoint[2]} 没有把下侧的句柄点算在节点下边缘上`);
  assert.match(anchorsBody, new RegExp(`endX: ${endPoint[1]}\\.x`), '两个锚点没有从中点/终点分别给出（终点 x）');
  assert.match(anchorsBody, new RegExp(`endY: ${endPoint[1]}\\.y`), '两个锚点没有从中点/终点分别给出（终点 y）');
  // ★ 2026-10-06（教师认可的第一条偏移）：删除按钮要往 **source** 退 ⇒ 锚点表必须多吐起点。
  const startPoint = anchorsBody.match(/const (\w+) = (\w+)\(source, edge\.sourceHandle/) || [];
  assert.ok(startPoint[1], '起点句柄点没抠出来 —— 先修这条判据');
  assert.match(anchorsBody, new RegExp(`fromX: ${startPoint[1]}\\.x`), '锚点表没有给出起点 fromX（删除按钮没法往 source 退）');
  assert.match(anchorsBody, new RegExp(`fromY: ${startPoint[1]}\\.y`), '锚点表没有给出起点 fromY（删除按钮没法往 source 退）');
  // ★ 2026-10-06：删除按钮的退向改成**目标句柄轴** ⇒ 锚点表还必须吐这条轴，且它必须由
  //   `targetPosition` 决定（线从哪一侧进目标，就往那一侧退）。轴的具体方位由几何用例（backAxis）守。
  const backVec = anchorsBody.match(/const (\w+) = backAxis\(targetPosition\)/) || [];
  assert.ok(backVec[1], '删除按钮的退向不是由 targetPosition（目标句柄轴）决定的');
  assert.match(anchorsBody, new RegExp(`backX: ${backVec[1]}\\.x`), '锚点表没有给出目标句柄轴 backX');
  assert.match(anchorsBody, new RegExp(`backY: ${backVec[1]}\\.y`), '锚点表没有给出目标句柄轴 backY');
  // ⚠️ 按语义判（在函数体里查两轴），不逐字钉返回语句 —— 只同步 x 轴、y 轴没同步就是自己把自己判红 ✗。
  //    格式一变就红的断言本身就是负担。
  const endFn = blockAfter(live, 'const edgeEndAnchor = ', '\n  const ');
  assert.ok(endFn.length > 40, '终点锚点没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.ok(/viewport\.x \+ [\w.]+ \* viewport\.zoom/.test(endFn) && /viewport\.y \+ [\w.]+ \* viewport\.zoom/.test(endFn),
    '终点锚点没有做视口换算（浮层会飘）');
  // ★ 第 1 步整理：**一处锚点解析** —— 选中的是**线**时必须落到**终点**锚点（箭头那一端），
  //   不是中点（中点那句留给就地输入框）。判据按语义：看解析里「edge 那一支」接的是哪个锚点函数。
  const selectedAnchorBody = selectedAnchorSource(live);
  assert.ok(selectedAnchorBody.length > 40, '锚点解析没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const edgeUsesEndAnchor = (source: string): boolean => {
    const body = selectedAnchorSource(source);
    return /kind === 'edge'/.test(body) && /edgeEndAnchor\(/.test(body) && !/edgeMidAnchor\(/.test(body);
  };
  assert.ok(edgeUsesEndAnchor(live), '选中连线时的浮层没有落在终点锚点（教师要求它贴在箭头那一端）');
  // ⚠️ 反面对照：把线那一支换成**中点**锚点 ⇒ 必须判违规（这条判据不是恒真的）。
  const midInstead = live.replace(/(const selectedAnchor = [\s\S]{0,400}?)edgeEndAnchor\(/, '$1edgeMidAnchor(');
  assert.notEqual(midInstead, live, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!edgeUsesEndAnchor(midInstead), '反面对照没被抓住 —— 这条判据是恒真的');
  // 就地输入框那一块（`overlay` 的 label 形态）⇒ 只能用中点锚点（标签画在中点，就地编辑才顺手）。
  const overlayBody = overlaySource(live);
  assert.ok(overlayBody.length > 80, '浮层描述式没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(overlayBody, /edgeMidAnchor\(labelingEdge\)/, '就地输入框没有用中点锚点（与它要改的那个标签分家）');
  assert.ok(!/edgeEndAnchor/.test(overlayBody), '就地输入框被挪到了终点（与它要改的那个标签分家）');
  // ⚠️ 反面对照：把就地输入框挪到终点锚点 ⇒ 必须判违规。
  const labelAtEnd = overlayBody.replace('edgeMidAnchor(labelingEdge)', 'edgeEndAnchor(labelingEdge)');
  assert.notEqual(labelAtEnd, overlayBody, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!/edgeMidAnchor\(labelingEdge\)/.test(labelAtEnd), '反面对照没被抓住 —— 这条判据是恒真的');
});

/**
 * ★ 2026-10-06：**几何函数级**用例 —— 偏移的「上限」与「退向」必须能**真喂数据**验算，
 *   不能只靠正则猜实现（「有没有 clampOffset 这个调用」挡不住「比例写成 0.9」）。
 *
 * 🔴 为什么必须有这一条：「极短边」在源码级断言里没法验。学生把两个框拖到几乎贴住时，这一段
 *    可能只剩 ~20px —— `EDGE_FLOAT_BACK` / `HANDLE_GAP` 会越过中点、甚至在极短边上越过 source 端
 *    ⇒ 只能把纯函数抠出来**喂一条短边**量。这是上一轮报告里「拿不准」第 (C) 条的正式补丁。
 * ⚠️ 为什么抠文本求值、而不是 import：这个文件是 `'use client'` 的 React 组件，import 会把
 *    React Flow + React 一起拖进来（本仓没有 jsdom）。下面这三个函数只做加减乘除、不碰
 *    React/state，**类型都写在 `const` 那一侧** ⇒ 抠出来的 `(a, b) => { … }` 本身就是合法 JS。
 * ★ 第 2 步整理：喂进来的距离**从组件源码里读它自己的命名常量**（不在测试里再抄一遍 `EDGE_FLOAT_BACK` / `HANDLE_GAP`），
 *    测的就是生产代码真正在用的那个数。
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
  const FLOAT_SIZE = constOf('FLOAT_SIZE');
  const NODE_FLOAT_GAP = constOf('NODE_FLOAT_GAP', { FLOAT_SIZE });
  const EDGE_FLOAT_BACK = constOf('EDGE_FLOAT_BACK');
  const HANDLE_GAP = constOf('HANDLE_GAP');
  assert.ok(EDGE_FLOAT_BACK > 0 && HANDLE_GAP > 0, '两个偏移常量必须是正数');
  /*
    ★ 2026-10-06（教师按 CSS 算过像素）：`HANDLE_GAP` 的**数值下限**不是拍脑袋来的 —— 它是
      「中点句柄脱开线上的 Y/N 标签白底框」这条像素规则算出来的，所以这里把它**当成规则来验**：
        · 白底框高取自组件里那一句 `<rect className="react-flow__edge-textbg" … height={22}>`
          （以标签点为中心 ⇒ 上下各 11px）；
        · 句柄本体尺寸取自样式表 `.thirdPartyCanvas .flowEdgeHandle` 的 width（10px ⇒ ±5px）；
        · 竖直边：句柄只往**下方**挪 ⇒ 上沿离标签点 `HANDLE_GAP - 半个句柄`，要 ≥ 11；
        · 45° 斜边：位移的竖直分量只有 `HANDLE_GAP / √2`，也要 ≥ 11。
      ⇒ 两式都成立才算「脱开」。**14 两式都不成立**（9 < 11、9.9 < 11）；16 只过第一式；18 两式都过。
      ⚠️ 这样写而不是 `assert.equal(HANDLE_GAP, 18)`：钉的是**规则**（CSS/JSX 里的真实尺寸变了，
        这条下限会跟着重新算），而不是某个数字 —— 但谁把 18 改回 14，它一定红。
  */
  const bgRectHeight = Number((src.match(/react-flow__edge-textbg[\s\S]{0,300}?height=\{(\d+)\}/) ?? [])[1]);
  assert.ok(Number.isFinite(bgRectHeight) && bgRectHeight > 0,
    `没读到线上标签白底框的高度（读到 ${bgRectHeight}）—— 先修这条判据，别让它在 NaN 上全绿`);
  const handleDotSize = Number((CSS.match(/\.thirdPartyCanvas \.flowEdgeHandle \{[\s\S]{0,200}?width: (\d+)px;/) ?? [])[1]);
  assert.ok(Number.isFinite(handleDotSize) && handleDotSize > 0,
    `没读到中点句柄的尺寸（读到 ${handleDotSize}）—— 先修这条判据，别让它在 NaN 上全绿`);
  const labelHalf = bgRectHeight / 2;
  const dotHalf = handleDotSize / 2;
  /** 「中点句柄脱开 Y/N 标签」这条像素规则：竖直边与 45° 斜边**都要**成立。 */
  const clearsLabel = (gap: number) => gap - dotHalf >= labelHalf && gap / Math.SQRT2 >= labelHalf;
  assert.ok(clearsLabel(HANDLE_GAP),
    `HANDLE_GAP=${HANDLE_GAP} 会让中点句柄压住线上的 Y/N 标签（竖直边只剩 ${(HANDLE_GAP - dotHalf).toFixed(1)}px、45° 斜边只剩 ${(HANDLE_GAP / Math.SQRT2).toFixed(1)}px，而白底框半径是 ${labelHalf}px）`);
  // ⚠️ 反面对照：回到改前那个 14px（= 现在这个值再减 4）⇒ 必须判违规。
  assert.ok(!clearsLabel(HANDLE_GAP - 4),
    '反面对照没被抓住 —— 这条判据是恒真的（14px 那种取值必须判「压住标签」）');
  // ⚠️ 规则里那句「永不压住句柄」的数值落点：按钮要以自己中心定位，所以往上至少要半个按钮。
  assert.ok(NODE_FLOAT_GAP >= FLOAT_SIZE / 2, `删除图形的按钮会压住节点上边缘（NODE_FLOAT_GAP=${NODE_FLOAT_GAP} < 半个按钮 ${FLOAT_SIZE / 2}）`);
  const code = ['clampOffset', 'offsetAlong', 'backAxis'].map((name) => `const ${name} = ${grab(name)}`).join('\n');
  // ⚠️ 只喂给 `backAxis`：它内部拿 `Position.某` 做比较，所以给一份**同一个对象**即可（具体值不重要）。
  const Position = { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' } as const;
  const makeGeometry = new Function('Position', `${code}\nreturn { clampOffset, offsetAlong, backAxis };`);
  const geom = makeGeometry(Position) as {
    clampOffset: (distance: number, span: number) => number;
    offsetAlong: (point: { x: number; y: number }, toward: { x: number; y: number }, distance: number) => { x: number; y: number };
    backAxis: (position: string) => { x: number; y: number };
  };

  // ① 上限：**不超过段长的一半**（这正是不越过中点的理由），常见边长下不许打折。
  assert.equal(geom.clampOffset(EDGE_FLOAT_BACK, 1000), EDGE_FLOAT_BACK, '常见边长下删除按钮的距离被打了折（按钮会缩水）');
  assert.equal(geom.clampOffset(HANDLE_GAP, 1000), HANDLE_GAP, '常见边长下中点浮层的距离被打了折（句柄会缩水）');
  assert.ok(geom.clampOffset(EDGE_FLOAT_BACK, 20) < EDGE_FLOAT_BACK, '极短边上没有生效任何上限');
  assert.ok(geom.clampOffset(EDGE_FLOAT_BACK, 20) <= 10, '极短边上偏移没被压到中点之前（会越过中点）');
  assert.ok(geom.clampOffset(1000, 100) <= 50, '上限比例 ≥ 一半 —— 会越过中点');

  // ② 短边上的**删除按钮**：end=(0,200)、source=(0,180)（段长只有 20px）⇒ 必须仍落在**靠终点这一侧**。
  const endPt = { x: 0, y: 200 };
  const fromPt = { x: 0, y: 180 };
  const back = geom.backAxis(Position.Top);
  const step = geom.clampOffset(EDGE_FLOAT_BACK, Math.hypot(endPt.x - fromPt.x, endPt.y - fromPt.y));
  const movedEnd = { x: endPt.x + back.x * step, y: endPt.y + back.y * step };
  assert.ok(movedEnd.y < endPt.y, '删除按钮没有往 source 退（方向反了）');
  assert.ok(movedEnd.y > (endPt.y + fromPt.y) / 2, '短边上删除按钮退过了中点（44px 的它会盖住另一半线）');

  // ③ 短边上的**中点浮层**：中点 (0,190) → 目标 (0,200)（该段只有 10px）⇒ 挪完不许到达/越过目标端。
  const midPt = { x: 0, y: 190 };
  const shiftedMid = geom.offsetAlong(midPt, { x: 0, y: 200 }, HANDLE_GAP);
  assert.ok(shiftedMid.y > midPt.y, '中点浮层没有往目标端挪（方向反了）');
  assert.ok(shiftedMid.y < 200, '短边上中点浮层挪到了目标端（会压住目标节点的连接点）');

  // ④ **目标句柄轴**：四个方位各退到**远离目标节点**的一侧 —— 写反一个，删除按钮就压在箭头上。
  assert.deepEqual(geom.backAxis(Position.Top), { x: 0, y: -1 }, 'Top 的退向不对（线从上方进 ⇒ 该往 -y 退）');
  assert.deepEqual(geom.backAxis(Position.Bottom), { x: 0, y: 1 }, 'Bottom 的退向不对（该往 +y 退）');
  assert.deepEqual(geom.backAxis(Position.Left), { x: -1, y: 0 }, 'Left 的退向不对（该往 -x 退）');
  assert.deepEqual(geom.backAxis(Position.Right), { x: 1, y: 0 }, 'Right 的退向不对（该往 +x 退）');
  const axes = [Position.Top, Position.Bottom, Position.Left, Position.Right].map((p) => JSON.stringify(geom.backAxis(p)));
  assert.equal(new Set(axes).size, 4, '四个方位的退向有重复（有方位没被区分开）');

  // ⑤ 生产代码真的**接上**了这两个纯函数（不是只在测试里算了一遍）：中点那一段也必须吃上限。
  assert.match(grab('offsetAlong'), /clampOffset\(/, 'offsetAlong 没有接上 clampOffset（中点那一段就没有上限）');
  // ★ 第 2 步整理：**两个距离不许互换**（起点不同、方向不同、目的不同）—— 数值上也要能区分。
  assert.notEqual(EDGE_FLOAT_BACK, HANDLE_GAP, '两个偏移常量变成同一个数了 —— 「沿句柄轴退」与「往目标端挪」是两件事');
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

