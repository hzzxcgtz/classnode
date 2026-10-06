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

test('★ 2026-10-06（教师）：底稿（A 不算学生作答 / B 不能改删 / 先做流程图）', () => {
  const live = stripComments(fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8'));
  const body = stripComments(fs.readFileSync(path.resolve(HERE, '..', 'drawing-tool-body.tsx'), 'utf8'));
  // ① 学生端拿得到底稿，并交给画板。
  assert.match(body, /starter=\{readDrawingStarter\(node\)\}/, '学生端没有把底稿交给画板');
  // ② 读的时候合并（底稿 + 学生画的），写的时候剔除（A：底稿不算他的作答）。
  assert.match(live, /mergeFlowchart\(starterPayload, readFlowchartPayload\(readFlowData\(data\)\)\)/, '没有把底稿合并进画板');
  assert.match(live, /onChange\(subtractFlowchart\(payload, starterPayload\)/, '交上去的作答没有剔除底稿（A）');
  // ③ 快照仍按**全部**画（教师预览/AI/报告要看到完整那张图）。
  assert.match(live, /lastFlow\.current = payload;/, '快照用的不是完整那份（教师/AI 会看到缺了底稿的图）');
  // ④ B：底稿的节点是锁的，而且**不会**被 `disabled` 反向解锁。
  // ⊘ 2026-10-06 第三版：底稿**不再锁**（教师澄清 2「学生可以修改底稿」），
  //   改成「可恢复」⇒ 学生端必须有一颗「恢复初始图」按钮（那是唯一的回退路径）。
  assert.match(live, /restoreFlowchart\(starterPayload\)/, '没有「恢复初始图」的实现');
  assert.match(live, /\{starter && \(/, '「恢复初始图」没有按「这一题有没有初始图」显示');
  assert.ok(!/draggable: false/.test(stripComments(fs.readFileSync(path.resolve(HERE, '..', '..', '..', '..', '..', 'lib', 'worksheet-drawing-starter.ts'), 'utf8'))), '底稿又被锁住了（学生应当可以修改）');
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
  // ② 单击选中 ⇒ 浮出**图标型**删除按钮（不是文字按钮）。
  assert.match(live, /aria-label="删除这条连线"/, '没有浮层删除按钮');
  assert.match(live, /className=\{styles\.flowEdgeFloat\}/, '删除按钮没有用浮层样式');
  assert.match(live, /onClick=\{\(\) => removeEdge\(editingEdge\)\}/, '浮层删除按钮没接上删除');
  // ③ 双击 ⇒ 就地输入框（回车提交 / Esc 取消），且改文字时不显示删除按钮（双击必然先触发一次单击）。
  assert.match(live, /onEdgeDoubleClick=/, '双击连线没有接');
  // ★ 2026-10-06（教师截图）：删除按钮改用**终点**锚点 ⇒ 这条判据跟着改成 `edgeEndAnchor`
  //   （它要守的是「两个浮层不同时出现」，与用哪个锚点无关；锚点本身由下面那条新判据守）。
  assert.match(live, /editingEdge && !labelingEdge && edgeEndAnchor\(editingEdge\)/, '两个浮层会同时出现（叠在一起互相压）');
  assert.match(live, /aria-label="这条连线上的文字"/, '没有就地输入框');
  assert.match(live, /event\.key === 'Enter'/, '回车没有提交');
  assert.match(live, /event\.key === 'Escape'/, 'Esc 没有取消');
  // ④ 🔴 浮层必须**落在画布舞台里面**：教师 2026-10-06 实测「删除图标在最上面」——
  //   当时浮层被插到了舞台**外面**，于是按外层卡片定位，y 差了「卡片头 + 工具条」那约 280px。
  //   这条判据用**位置关系**钉死它（顺序错了就红，不必靠真机截图才发现）。
  const stageAt = live.indexOf('styles.flowStage');
  const reactFlowAt = live.indexOf('</ReactFlow>');
  const floatAt = live.indexOf('styles.flowEdgeFloat');
  assert.ok(stageAt !== -1 && reactFlowAt !== -1 && floatAt !== -1, '舞台/ReactFlow/浮层有缺失');
  assert.ok(stageAt < reactFlowAt && reactFlowAt < floatAt, '浮层没有落在画布舞台里（会在卡片上乱飘）');
  // ④ 浮层靠**视口换算**跟随（不引 Provider、也不复刻折线算法）。
  assert.match(live, /onMove=\{\(_, next\) => setViewport\(next\)\}/, '没有跟视口');
  assert.match(live, /viewport\.x \+ labelX \* viewport\.zoom/, '坐标换算不对（浮层会飘）');
  // ★ 教师 2026-10-06：「距离太远，应该就在那根连接线上」——第一版取两节点中心的中点，
  //   而 `smoothstep` 是折线，中心点经常不在路径上。现在必须用库自己的路径函数取**标签点**。
  assert.match(live, /getSmoothStepPath\(\{/, '锚点没有用库的路径函数（第一版就是这里飘的）');
  assert.match(live, /const \[, labelX, labelY\] = getSmoothStepPath/, '没有取标签点 labelX/labelY');
  // ⑤ 两个浮层都要 44px 命中区（那条用例逐个 <button> 量）。
  assert.match(css, /\.flowEdgeFloat \{[\s\S]{0,200}?width: 44px;/, '浮层删除按钮的命中区小于 44px');
  assert.match(css, /\.flowEdgeInput \{[\s\S]{0,260}?min-height: 44px;/, '就地输入框太矮');
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
  assert.match(live, /style=\{\{ left: labelX, top: labelY \}\}/, '中点句柄没有落在 getSmoothStepPath 的标签点上');
  assert.match(live, /'data-nodeid': edgeId/, '句柄没有补 data-nodeid（没补 ⇒ 库在边里取不到 node id，拖上去 onConnect 不响）');
  // ② 线上的字自己画，且类名与库**逐字相同**（我们的配色 CSS 就是按这两个类写的）。
  assert.match(live, /className="react-flow__edge-textbg"/, '边的标签白底没有用库那个类名（配色会失效）');
  assert.match(live, /className="react-flow__edge-text"/, '边的标签文字没有用库那个类名（配色会失效）');
  // ③ 注册自定义边 + 每条边强制 type: 'flow'（老作答存的是 'smoothstep'，不强制老图就没有中点句柄）。
  assert.match(live, /const edgeTypes = useMemo\(\(\) => \(\{ flow: FlowEdgeLine \}\), \[\]\)/, '自定义边没有注册');
  assert.match(live, /edgeTypes=\{edgeTypes\}/, 'ReactFlow 没有用上自定义边');
  assert.match(live, /\.map\(\(edge\) => \(\{ \.\.\.edge, type: 'flow' \}\)\)/, "visibleEdges 没有给每条边强制 type: 'flow'（老作答的 'smoothstep' 就没有中点句柄）");
  // ④ onConnect：target 是**已存在的边 id** ⇒ 插一个交点 + 把原边拆成两段。
  // ⚠️ 切片的**结束标记必须是代码**（`const [editingEdge, …`）：注释早就被 `stripComments` 剥掉了，
  //    拿注释当标记会切出一个空串或者切到文件末尾（那会让下面几条在错误的范围上"全绿"）。
  const onConnectBody = live.slice(live.indexOf('const onConnect = useCallback'), live.indexOf('const [editingEdge, setEditingEdge]'));
  assert.ok(onConnectBody.length > 400, 'onConnect 没抠出来 —— 先修这条判据，别让它在空串上全绿');
  assert.match(onConnectBody, /edges\.find\(\(edge\) => edge\.id === connection\.target\)/, '没有判「target 是已存在的边 id」');
  assert.match(onConnectBody, /kind: 'junction'/, '没有插 junction 节点');
  assert.match(onConnectBody, /position: \{ x: anchors\.midX - junctionHalf, y: anchors\.midY - junctionHalf \}/, '交点没有落在库算出来的标签点上（流坐标）');
  assert.ok(!/viewport/.test(onConnectBody), '交点的位置用了视口/屏幕坐标（画布一动就飘）');
  // 拆线的两步：① 原边变「原 source → 交点」；② 交点 → 原 target（过一次 addEdge）。
  assert.match(onConnectBody, /const head: Edge = \{ \.\.\.original, target: junctionId/, '原边没有被改成「原 source → 交点」那一段');
  assert.match(onConnectBody, /addEdge\(tail, current\.filter\(\(edge\) => edge\.id !== original\.id\)\)/, '没有把原边摘掉、再用 addEdge 接上第二段');
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
  assert.match(live, /const \{ midX: labelX, midY: labelY \} = anchors;/, '中点锚点没有取自 getSmoothStepPath 的标签点');
  assert.match(live, /const to = handlePoint\(boxOf\(target\), targetPosition\);/, '终点锚点不是「目标节点那一侧的句柄点」');
  assert.match(live, /return \{ midX: labelX, midY: labelY, endX: to\.x, endY: to\.y \};/, '两个锚点没有从中点/终点分别给出');
  assert.match(live, /return \{ x: viewport\.x \+ anchors\.endX \* viewport\.zoom, y: viewport\.y \+ anchors\.endY \* viewport\.zoom \};/, '终点锚点没有做视口换算');
  // 删除浮层那一块 ⇒ 只能用终点锚点。
  const floatAt = live.indexOf('styles.flowEdgeFloat');
  const inputAt = live.indexOf('styles.flowEdgeInput');
  assert.ok(floatAt !== -1 && inputAt !== -1 && floatAt < inputAt, '两个浮层没抠出来 —— 先修这条判据');
  const floatBlock = live.slice(live.lastIndexOf('{editingEdge && !labelingEdge', floatAt), inputAt);
  assert.match(floatBlock, /edgeEndAnchor\(editingEdge\)/, '删除浮层没有用终点锚点（教师要求它落在箭头那一端）');
  assert.ok(!/edgeAnchor\(editingEdge\)/.test(floatBlock), '删除浮层用回了中点锚点');
  // 就地输入框那一块 ⇒ 只能用中点锚点（标签画在中点，就地编辑才顺手）。
  const inputBlock = live.slice(inputAt, live.indexOf('</div>', inputAt));
  assert.match(inputBlock, /edgeAnchor\(labelingEdge\)/, '就地输入框没有用中点锚点');
  assert.ok(!/edgeEndAnchor/.test(inputBlock), '就地输入框被挪到了终点（与它要改的那个标签分家）');
  // 反面对照：把两个锚点**换回来**（删除浮层改用中点）⇒ 上面那条必须红。
  const swapped = live.replaceAll('edgeEndAnchor(editingEdge)', 'edgeAnchor(editingEdge)');
  const swappedFloat = swapped.slice(swapped.lastIndexOf('{editingEdge && !labelingEdge', floatAt), inputAt);
  assert.ok(!/edgeEndAnchor\(editingEdge\)/.test(swappedFloat), '反面对照没造出来 —— 这条判据会变成恒真');
});
