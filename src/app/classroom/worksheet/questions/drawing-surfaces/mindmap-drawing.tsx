'use client';

import { useEffect, useRef } from 'react';
import MindElixir from 'mind-elixir';
import type { MindElixirData, MindElixirInstance } from 'mind-elixir';
import { zh_CN as zhCN } from 'mind-elixir/i18n';
import 'mind-elixir/style.css';

import { useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
// ★ 2026-10-07：底稿那一档的口径住在 `worksheet-drawing-starter.ts`（与流程图同一处），
//   连同「怎么读一份导图数据」——本组件原来自己抄了一份 `readMindData`，已收口。
import { mindMapOrStarter } from '@/lib/worksheet-drawing-starter.ts';
import { mindmapDragStarted } from '@/lib/worksheet-mindmap-pan.ts';

import type { DrawingSurfaceProps } from './types';
import DrawingToolbarIcon from './drawing-toolbar-icon';
import styles from '../../worksheet.module.css';

export default function MindmapDrawing({ data, backgroundUrl, disabled, onChange, onImage, starter }: DrawingSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const mind = useRef<MindElixirInstance | null>(null);
  const usesInfiniteDotGrid = typeof backgroundUrl === 'string'
    && backgroundUrl.split(/[?#]/, 1)[0].endsWith('/worksheet/drawing-backgrounds/dot-grid.svg');
  const scheduleRaster = useRef<() => void>(() => {});
  // ⚠️ 走 ref 而不是把 `scheduleRaster` 塞进那个 `[]` 依赖的 effect：实例只挂载一次，
  //    而 `capture` 每次渲染都是新的闭包 —— 用 ref 转发才能让副作用里的调用拿到最新的那一个。
  scheduleRaster.current = useDrawingRaster({
    capture: async () => {
      const blob = await mind.current?.exportPng(true);
      return blob ?? null;
    },
    onUrl: onImage,
  });

  useEffect(() => {
    if (!host.current) return;
    const instance = new MindElixir({
      el: host.current,
      direction: MindElixir.SIDE,
      editable: !disabled,
      /**
       * ★ 2026-10-06（教师）：「它有工具条就用它的，尽量不要自己画。」
       *
       * ⇒ 打开库**自带**的两条工具条（右下：全屏 / 回到中心 / 放大 / 缩小；
       *    左上：左 / 右 / 两侧方向）与**长按（右键）菜单**
       *    （插入子节点 / 父节点 / 同级节点、**删除节点**、上移 / 下移、专注、连接、摘要）。
       *
       * ⚠️ 菜单文案必须显式给中文：库内默认那份是英文
       *    （`dist/MindElixir.js` 里 `Yn = { addChild: 'Add child', … }`），
       *    中文包在 `mind-elixir/i18n` 的 `zh_CN` 里，在这里传进去。
       * 🔴 这条开关同时修掉一个**真实缺陷**：以前 `contextMenu: false` + iPad 上没有 Delete 键
       *    ⇒ 学生**删不掉**一个节点（只能用「撤销」一步步退回去）。
       */
      toolBar: true,
      contextMenu: { locale: zhCN },
      keypress: !disabled,
      allowUndo: true,
      /**
       * 🔴 **不要传 `overflowHidden: true`**（2026-10-06 定位到的一条硬结论）。
       *
       * 教师报「学生端思维导图画不了、点击选不中、也不能改文字」，DevTools 里那个
       * `.map-container` 上**只有** `keydown / copy / cut / paste` ——
       * `pointerdown / pointermove / pointerup / click / contextmenu / wheel` **一个都没有**。
       * 用无头 Chrome 逐个选项二分（干净原生页面，不带 React）：
       *
       *   只有 el+direction            → 有 pointerdown ✓ 点得中 ✓
       *   +editable / +toolBar / +contextMenu
       *   +keypress  / +allowUndo      → 仍然 ✓
       *   **+overflowHidden            → 只剩 copy/cut/paste/keydown ✗ 点不中 ✗**
       *   +theme / +mobileMultiSelect / +newTopicName → 一路坏到底（累加效应）
       *
       * ⇒ 这个选项让库**跳过整套指针交互层的安装**：画得出来、工具条能点（那是它自己的
       *   `onclick`）、我们直接调 API 也能加节点（`addChild(目标)`），但**画布上什么都点不动**。
       * ⚠️ 裁剪本来就不需要它：外层 `.thirdPartyCanvas` 自己就是 `overflow: hidden`
       *   （见 `worksheet.module.css`），画布溢出的部分照样被裁掉。
       */
      mobileMultiSelect: false,
      /**
       * ★ 2026-10-06（教师）：「可不可以和流程图一样，鼠标在空白区域是手型、可以移动整个画布」。
       * 🔴 库自己把「**左键**拖空白」判给了**框选**（`dist/MindElixir.js` 的指针处理里那句
       *    `if (e.editable && b.className === 'map-container' && f.button === 0 …) { ptState = BoxSelect; return; }`
       *    —— 它**不看** `mouseSelectionButton`，所以左键永远先被框选吃掉），而平移只留给
       *    「触屏拖动」或「空格 + 拖动」。
       * ⇒ 把**框选挪到右键**（`mouseSelectionButton: 2`，选择那一层认这个值），
       *    左键则由我们自己在**捕获阶段**接管成平移（见下面那段 pointerdown）——
       *    这样两件事都在，谁也不抢谁。
       */
      mouseSelectionButton: 2,
      /**
       * ★ 2026-10-06（教师）：「鼠标滚轮默认也应该是缩放功能」。
       *
       * 🔴 库的默认**反过来**：滚轮 = **平移**，`Ctrl/⌘ + 滚轮` 才是缩放
       *    （`dist/MindElixir.js` 里那个 wheel 处理器逐字如此）。它留了 `handleWheel`
       *    这个口子，所以这里接过来改成：**滚轮 = 以指针为中心缩放**（与流程图那边一致）。
       *
       * ⚠️ 缩放范围由库自己夹（`scaleMin 0.2` / `scaleMax 1.4`），越界的值它直接忽略。
       * ⚠️ 触控板的双指滚动也会走到这里（它就是 wheel 事件）⇒ 在触控板上双指也会缩放
       *    而不是平移 —— 与 React Flow 那边的手感一致，是**同一个约定**，不是这里的疏漏。
       * ⚠️ 用 `mind.current` 而不是闭包里的 `instance`：选项在 `new MindElixir(...)` 之前
       *    就要写出来，那时实例还不存在（实例建好后立刻赋给 `mind.current`）。
       */
      handleWheel: (event: WheelEvent) => {
        const instance = mind.current;
        if (!instance) return;
        event.preventDefault();
        /**
         * ⚠️ 步进必须**按 `deltaY` 成比例**，不能用固定档（教师 2026-10-06 实测：「滚动速度太快，
         *    步进值太大」）。原因很实在：**鼠标一格 ≈ ±100，触控板一次 ≈ ±1~4** ——
         *    固定档在鼠标上还算合适，在触控板上就是「一划就飞」（它一次滚动会发几十个事件）。
         * · `0.0008` ⇒ 鼠标一格约 **8%**；触控板一次约 **0.1%~0.3%**（细而顺）；
         * · 每事件再夹在 **±8%** 以内：快速甩动时不会一步跳掉半张图；
         * · `deltaMode` 是**单位**（0=像素 / 1=行 / 2=页），Firefox 在部分平台报「行」——
         *   不换算的话同一台机器上换个浏览器手感会差十几倍。
         */
        const perUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
        const step = Math.max(-0.08, Math.min(0.08, -event.deltaY * perUnit * 0.0008));
        if (step === 0) return;
        instance.scale(instance.scaleVal * (1 + step), {
          x: event.clientX,
          y: event.clientY,
        });
      },
      newTopicName: '新主题',
      theme: {
        ...MindElixir.THEME,
        name: 'ClassNode',
        palette: ['#527198', '#6b86a5', '#7893b1', '#879db8', '#607d9e', '#7590ad'],
        cssVar: {
          ...MindElixir.THEME.cssVar,
          '--main-color': '#27415f',
          '--main-bgcolor': '#eef3f8',
          '--color': '#24364b',
          '--bgcolor': backgroundUrl ? 'transparent' : '#ffffff',
          '--selected': '#527198',
          '--accent-color': '#527198',
          '--root-color': '#ffffff',
          '--root-bgcolor': '#527198',
          '--root-radius': '12px',
          '--main-radius': '10px',
        },
      },
    });
    /*
     * ★ 2026-10-07（教师裁定）：**底稿只作起点** ——
     *   · 他有自己的作答（哪怕删到只剩中心主题）⇒ 用他的，**整棵树都算他的**；
     *   · 还没有作答 ⇒ 拿底稿当起点。
     * 🔴 与流程图那档**刻意不同**：那边交上去时按 id 把底稿剔掉，而导图的底稿是**骨架**、
     *   学生要填的正是骨架本身 ⇒ 照搬会把学生填的内容连骨架一起删掉（见 `mindMapOrStarter`）。
     */
    instance.init((mindMapOrStarter(data, starter?.data) ?? MindElixir.new('中心主题')) as MindElixirData);
    if (disabled) instance.disableEdit();
    /**
     * 🔴 **建完就选中根节点**。`mind-elixir` 的 `addChild()` / `insertSibling()` 用的是
     * **当前选中节点**（`const n = e || this.currentNode; if (!n) return;` —— 逐字在
     * `dist/MindElixir.js` 里），而 `init()` 结束时**什么都没选中** ⇒ 在一张新图上
     * 调 `addChild()` 是**静默 no-op**。
     *
     * 这就是教师 2026-10-06 报的「学生端思维导图画不了、点了没反应」的第二个根因
     * （第一个是 `scale(0)`）：**按了「添加子主题」什么都不发生，而且不报错**。
     * 实测（headless Chrome，与本组件逐字同源的建法）：`init()` 后立刻 `addChild()`
     * ⇒ 节点数 **1 → 1**；先选中根节点再 `addChild()` ⇒ 1 → 2。
     * ⚠️ 老 iPad 上没有鼠标悬停，学生也未必知道「要先点一下那个方块」——所以这一步
     *    由我们替他做，而不是写进提示语里。
     */
    const rootElement = instance.findEle(instance.nodeData.id);
    if (rootElement) instance.selectNode(rootElement);

    /**
     * 鼠标拖空白 = 平移整个画布（教师 2026-10-06 要的「和流程图一样」）。
     *
     * 🔴 三个必须的细节：
     *   ① 监听挂在**捕获阶段**（`{ capture: true }`）：库自己的指针处理挂在容器上（冒泡阶段，
     *      而且它排在前面注册），不在捕获阶段拦下并 `stopPropagation`，左键仍会被它判成框选；
     *   ② 只接管 **鼠标左键**（`pointerType === 'mouse' && button === 0`）：**触屏本来就平移**
     *      （库对 touch 走的是 pan，不是框选），接管触屏只会把事情弄坏；
     *   ③ 落点必须是**空白处**（`.map-container` / `.map-canvas` 自己，不是节点）——
     *      否则点节点、拖节点、点连接点全会被抢走。
     */
    const hostEl = host.current;
    const isBlank = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (el.classList.contains('map-container') || el.classList.contains('map-canvas'));
    };
    let panning: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !isBlank(event.target)) return;
      event.stopPropagation();
      panning = { x: event.clientX, y: event.clientY };
      if (hostEl) hostEl.style.cursor = 'grabbing';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!panning) return;
      const dx = event.clientX - panning.x;
      const dy = event.clientY - panning.y;
      panning = { x: event.clientX, y: event.clientY };
      /**
       * ⚠️ 符号**是正的**（教师 2026-10-06 实测：「方向反了」）。
       * 我一开始把 `move()` 的参数理解成「内容往哪边走」，于是写了 `-dx` —— 反了。
       * 库自己的鼠标平移逐字就是 `e.move(t.clientX - this.lastX, t.clientY - this.lastY)`
       * （`dist/MindElixir.js` 的 `handlePointerMove`）⇒ `move(dx, dy)` 的语义是
       * **内容跟着指针走**：往右拖，图往右走 —— 也就是「抓住纸往哪拖，纸往哪走」。
       */
      instance.move(dx, dy);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!panning) return;
      /*
       * ★ 2026-10-07（教师）：「学生用鼠标点击思维导图的**空白区域**，应该能够取消所有节点的选择状态」。
       *
       * 🔴 为什么得自己补：空白处的左键被我们在**捕获阶段**接管了（平移画布），
       *   `stopPropagation()` 之后库自己那套「点空白 = 取消选中」**没机会跑**。
       * ⚠️ 只在**没拖动**时补（`mindmapDragStarted`，纯函数、有用例）——
       *   平移画布是「看一眼」，取消选中是「换个对象」，两件事不该顺手一起做。
       * ⚠️ `clearSelection()` 是库的公开方法，它把**节点 + 摘要 + 连接线**的选中一起清掉
       *   （`dist/MindElixir.js` 里就是 `unselectNodes + unselectSummary + unselectArrow`）。
       */
      const wasClick = !mindmapDragStarted(panning, { x: event.clientX, y: event.clientY });
      panning = null;
      if (hostEl) hostEl.style.cursor = '';
      if (wasClick) instance.clearSelection();
    };
    hostEl?.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    /**
     * 位图快照。🔴 传 `noForeignObject = true`：默认那条路把节点文字装进
     * `<foreignObject>` 再栅格化，而老 iPad（Safari 15）对它的支持很勉强 ——
     * 出来的可能是**空白图**且不报错。开着这个开关它会改成画 `<text>`。
     */
    const publish = (detail?: unknown) => {
      /**
       * MindElixir 在双击节点、刚把原文字隐藏并插入 `#input-box` 时，就先发送一次
       * `operation: { name: 'beginEdit' }`。这一刻数据一个字都没有改变；若马上把数据写回 React，
       * 教师底稿编辑器会同步重渲染，而库的双击处理器还在继续访问刚才那棵 DOM，某些子节点上
       * 就会撞到 `Cannot read properties of null (reading 'style')`。
       * 真正改完文字时库还会发送 `finishEdit`，只在那时保存与抓图即可。
       */
      if (
        typeof detail === 'object'
        && detail !== null
        && 'name' in detail
        && (detail as { name?: unknown }).name === 'beginEdit'
      ) return;
      onChange(instance.getData());
      scheduleRaster.current();
    };
    /**
     * ★ 2026-10-06（教师）：「设置成中心主题靠左的格式，然后点上面的全屏，中心主题自己就靠右了」。
     *
     * 🔴 根因：**全屏是换容器**（`drawing-tool-body.tsx` 里 `createPortal(content, document.body)`），
     *    React 会把这块子树**卸载重建** ⇒ 实例是照着 `data` 重建的。而库改方向时
     *    `initLeft/initRight/initSide` **只 fire `changeDirection`、不 fire `operation`**
     *    （`dist/MindElixir.js` 逐字如此）—— 我们原来只监听 `operation` ⇒ 那次改动**没被存下来**
     *    ⇒ 重建时读到旧方向，屏幕上就是「它自己靠右了」（刷新一下同样会丢）。
     *
     * ⇒ 把**所有会改变 `getData()` 的事件**都接上。⚠️ 纯视图事件**不接**
     *   （`scale` / `move` / `selectNode` / `selectNewNode` …）：它们按指针频率触发，
     *   接上等于「每移动一像素存一次」。
     * ⚠️ 以后库再新增「改数据」的事件时，这张名单要跟着补 —— 症状就是「某个操作刷新后丢失」。
     */
    const publishEvents = ['operation', 'changeDirection', 'expandNode'] as const;
    publishEvents.forEach((event) => instance.bus.addListener(event, publish));
    mind.current = instance;
    /**
     * 🔴 「适应画布」那一等**必须留句柄、并在清理里清掉**。这不是洁癖，是教师撞到的那个报错：
     *
     *   Runtime TypeError  Cannot read properties of undefined (reading 'offsetHeight')
     *   at MindmapDrawing.useEffect (…/mindmap-drawing.tsx:58:38)
     *    58 |     window.setTimeout(() => instance.scaleFit(), 0);
     *
     * 两层成因，缺一不成：
     *   ① App Router 在 `next.config` 没写 `reactStrictMode` 时**默认开严格模式**
     *      （`next/dist/build/define-env.js` 里 `__NEXT_STRICT_MODE_APP` 的注释就是
     *      「When next.config.js does not have reactStrictMode it's enabled by default」）
     *      ⇒ 开发模式下 effect 走 **挂载 → 卸载 → 再挂载**；
     *   ② `mind-elixir` 的 `destroy()` 把 `this.nodes` / `this.container` 全设成 `undefined`
     *      （`dist/MindElixir.js:2758` 逐字），而 `scaleFit()` 头一行就是
     *      `this.nodes.offsetHeight / this.container.offsetHeight`
     *      ⇒ 卸载时那颗 `setTimeout(…, 0)` 还在队列里，烧着的时候实例已经销毁了。
     *
     * ⚠️ 生产构建里 effect 只跑一遍，所以这个洞**只在 dev 里现形** —— 而 dev 正是教师
     *    平时待的地方（也是唯一能看着它跑起来的地方）。别因为「线上没报」把它删了。
     * ⚠️ 光加 `instance.nodes && …` 那种判空是治标：第二次挂载会新建一个实例，而这里
     *    引用的是**闭包里的那一个**（已经销毁的）—— 判空只是把这一步静默跳过，
     *    「适应画布」于是再也不生效，而且没有任何提示。清掉定时器才是本来的意图。
     */
    /**
     * 🔴 「适应画布」**必须等这块框真的有尺寸之后再算**。
     *
     * `toCenter()` / `scaleFit()` 算的是 `(容器尺寸 - 内容尺寸) / 2` 一类的东西
     * （`Ne()` 逐字读 `container.offsetWidth/offsetHeight`）。**容器量出来是 0 的时候**，
     * 这两个数就成了「把内容整体推出可视区」的量 —— 而库给画布按了 `transform`、
     * 外层又是 `overflow: hidden` ⇒ 屏幕上就是**一块空白画布 + 库自带的工具条**
     * （教师 2026-10-06 报的「学生端思维导图画不了，点工具按钮没反应」正是这个形状：
     * 图在，只是被平移到了框外）。
     *
     * ⇒ 所以：**量不出尺寸就先不算**，用 `ResizeObserver` 盯着，等它能量出真实尺寸的那一帧
     *   再适应一次；之后容器尺寸变了（全屏作图那条路）只**重新居中**，不覆盖学生自己的缩放。
     */
    let fitted = false;
    let alive = true;
    let retryTimer: number | null = null;
    const fitWhenSized = () => {
      const box = host.current?.getBoundingClientRect();
      if (!box || box.width < 40 || box.height < 40) return;   // 还没量出来 ⇒ 这一帧什么都不做
      // 第一次：适应画布（定缩放 + 粗居中）；紧接着「回到中心」把**根节点**摆到正中
      // （库自己的「回到中心」按钮就是这条 —— 对思维导图来说，根节点是视觉锚点）。
      if (!fitted) {
        fitted = true;
        if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
        instance.scaleFit();
        instance.toCenter();
        return;
      }
      instance.toCenter();
    };
    const rafId = window.requestAnimationFrame(fitWhenSized);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fitWhenSized) : null;
    observer?.observe(host.current);
    /**
     * 🔴 **兜底重试**，不能只靠 `ResizeObserver`：CSS 迟到、容器稍后才长出来、
     *    以及**某些环境根本不派发 observer 回调**（无头浏览器 + 虚拟时间实测如此）——
     *    那些情况下只挂 observer 就等于「永远不适配」，而这正是教师看到的空白画布。
     * ⚠️ 一旦适配成功就**停**：`fitted` 之后继续重试会覆盖学生自己的缩放/平移。
     */
    let attempts = 0;
    const retry = () => {
      if (!alive || fitted) return;
      attempts += 1;
      fitWhenSized();
      if (fitted) return;
      // ⚠️ 放弃之前**留一句话**：这条路上「一直没适配」在屏幕上就是一块空白画布，
      //    而没有日志的话，下一次只能再猜一遍（教师 2026-10-06 报的那次就是这样）。
      if (attempts === 15) {
        const box = host.current?.getBoundingClientRect();
        console.warn(
          '[思维导图] 一直没有量出画布尺寸，已放弃「适应画布」——画布可能是空白的。',
          { width: box?.width ?? null, height: box?.height ?? null },
        );
        return;
      }
      retryTimer = window.setTimeout(retry, 200);
    };
    retryTimer = window.setTimeout(retry, 60);

    return () => {
      alive = false;
      window.cancelAnimationFrame(rafId);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      observer?.disconnect();
      hostEl?.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      publishEvents.forEach((event) => instance.bus.removeListener(event, publish));
      instance.destroy();
      mind.current = null;
    };
  // 第三方实例只挂载一次；作答恢复值是初始输入，后续变化由实例自身维护。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 「恢复初始图」—— 把画布退回教师给的起点（★ 2026-10-07 教师：初始图其他绘图题也要）。
   *
   * 🔴 三件事缺一不可：
   *   ① **建完要选中根节点**：库的 `addChild()` 吃「当前选中节点」，而 `init()` 之后什么都没选中
   *      ⇒ 不选的话学生一按「添加子主题」就是**静默 no-op**（上面 `selectNode` 那一段有实测）；
   *   ② 要**主动 `onChange`**：与流程图不同 —— 那边「恢复」是改 React state、由既有的发布 effect
   *      带出去；这边只有一个库实例，不改 state ⇒ 不主动交就等于「恢复了但没保存」；
   *   ③ 要 `scheduleRaster()`：快照跟着更新，否则教师那一格仍是旧的那张。
   * ⚠️ 存的这一份是**整棵树**（教师裁定：底稿只作起点，学生交上去的整棵树都算他的）
   *   —— 所以恢复之后再交，交的仍是他自己那份，不需要任何「剔除」。
   */
  const restoreStarter = () => {
    const instance = mind.current;
    const base = mindMapOrStarter(null, starter?.data);
    if (!instance || !base) return;
    instance.init(base as MindElixirData);
    const rootElement = instance.findEle(instance.nodeData.id);
    if (rootElement) instance.selectNode(rootElement);
    onChange(instance.getData());
    scheduleRaster.current();
  };
  return (
    <div className={styles.thirdPartySurface}>
      {/*
        这里统一承载视图与编辑记录；节点增删仍交给库的长按菜单，方向仍使用库的左侧工具条。
        库原有的右下视图工具条由 CSS 隐藏，避免出现两套功能重复、样式不一致的入口。
      */}
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="思维导图工具">
        {/*
          ⊘ 2026-10-06 第二轮（教师）：「这两个不要了，其它按钮做得好看些」——「添加子主题 /
          添加同级主题」两颗**删掉**。
          🔴 为什么现在敢删（第一轮加它们是有理由的，那条理由仍成立、只是换了承担者）：
            当时的病根是「库的 addChild() 吃**当前选中节点**，而新图里什么都没选中 ⇒ 静默 no-op」。
            现在**建完图就选中根节点**（见上面 selectNode 那一段），加上指针交互层已经修好
            （overflowHidden 那条），学生的加节点入口回到**库自己的长按菜单**
            （插入子节点 / 父节点 / 同级节点）—— 工具条下方那行提示已经写明。
          ⚠️ 删的是「我们的按钮」，**不是**「加节点的能力」。
        */}
        {/* ★ 2026-10-07（教师：「初始图开关不仅流程图要，其他绘图题也要」）——
            「恢复初始图」与流程图那一档**同形**：只要这一题有底稿就**无条件**出现
            （它是唯一的回退路径：学生把底稿改乱了只能靠它回去）。 */}
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>视图</span>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="放大" data-tooltip="放大" onClick={() => { const instance = mind.current; if (instance) instance.scale(instance.scaleVal * 1.1); }}><DrawingToolbarIcon name="zoomIn" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="缩小" data-tooltip="缩小" onClick={() => { const instance = mind.current; if (instance) instance.scale(instance.scaleVal / 1.1); }}><DrawingToolbarIcon name="zoomOut" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="适应画布" data-tooltip="适应画布" onClick={() => { const instance = mind.current; if (instance) { instance.scaleFit(); instance.toCenter(); } }}><DrawingToolbarIcon name="fit" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={`${styles.drawingToolbarGroup} ${styles.drawingToolbarActions}`}>
          <span className={styles.drawingToolbarGroupLabel}>编辑记录</span>
          {starter && (
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="恢复初始图" data-tooltip="恢复初始图" disabled={disabled} onClick={restoreStarter}><DrawingToolbarIcon name="restore" className={styles.drawingToolbarIcon} /></button>
          )}
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="撤销" data-tooltip="撤销" disabled={disabled} onClick={() => mind.current?.undo()}><DrawingToolbarIcon name="undo" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="重做" data-tooltip="重做" disabled={disabled} onClick={() => mind.current?.redo()}><DrawingToolbarIcon name="redo" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={styles.drawingToolbarHint}>
          <strong className={styles.drawingToolbarHintLabel}>操作提示</strong>
          双击节点写字；长按节点打开菜单（增删、上移下移、连接）；滚轮缩放
        </span>
      </div>
      <div
        ref={host}
        className={`${styles.thirdPartyCanvas} ${styles.mindmapCanvas} ${backgroundUrl ? styles.mindmapCanvasWithBackground : ''}`}
        data-infinite-dot-grid={usesInfiniteDotGrid ? 'true' : undefined}
        style={backgroundUrl && !usesInfiniteDotGrid ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
      />
    </div>
  );
}
