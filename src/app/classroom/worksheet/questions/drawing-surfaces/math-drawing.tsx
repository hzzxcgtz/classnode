'use client';

import { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';

import { dataUrlToBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
import {
  MATH_TOOL_GROUPS,
  MATH_TOOL_ICONS,
  MATH_TOOLS,
  parallelogramOf,
  rectangleOf,
  toolHintOf,
  toolsInGroup,
  trapezoidOf,
  type MathEntry,
  type MathTool,
  type Pt,
} from '@/lib/worksheet-math-shapes.ts';

import type { DrawingSurfaceProps } from './types';
import styles from '../../worksheet.module.css';

/** 一条运行时记录：`coords` 是**作答里的那份坐标**，`points` 是 jsxgraph 里的可拖点。 */
type RuntimeEntry = {
  entry: MathEntry;
  points: JXG.Point[];
  objects: JXG.GeometryElement[];
  /** 自由线条没有可拖点（它是一串坐标画出来的曲线）⇒ 快照直接读它。 */
  freehand?: Pt[];
};

const isPt = (value: unknown): value is Pt => Array.isArray(value)
  && value.length === 2
  && value.every((part) => typeof part === 'number' && Number.isFinite(part));

/**
 * 从作答数据里读回图形。
 *
 * 🔴 **认不出的条目一律丢掉，不抛**：它是学生数据里的一段（可以被手改过），
 *    一条坏数据不该让整道题打不开。六种形状逐条校验（与 `MATH_TOOLS` 是同一份契约）。
 */
function readEntries(raw: unknown): MathEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const entries = (raw as Record<string, unknown>).elements;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry): entry is MathEntry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    if (row.kind === 'point') return isPt(row.p);
    if (row.kind === 'circle') return isPt(row.center) && isPt(row.edge);
    if (row.kind === 'segment' || row.kind === 'line' || row.kind === 'arrow') return isPt(row.a) && isPt(row.b);
    if (row.kind === 'polyline') return Array.isArray(row.points) && row.points.length >= 2 && row.points.every(isPt);
    if (row.kind === 'angle') return isPt(row.vertex) && isPt(row.a) && isPt(row.b);
    if (row.kind === 'label') return isPt(row.at) && typeof row.text === 'string';
    return false;
  });
}

export default function MathDrawing({ data, backgroundUrl, disabled, onChange, onImage }: DrawingSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  /** 拖动过程的实时线条画在这块覆盖层上（见 effect 里 `drawPreview` 的注释）。 */
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const boardRef = useRef<JXG.Board | null>(null);
  const runtime = useRef<RuntimeEntry[]>([]);
  /** 多击工具已经点下的那些位置（三角形要 3 个、梯形要 4 个……）。 */
  const pending = useRef<{ tool: MathTool; ats: Pt[]; marks: JXG.Point[] } | null>(null);
  /** 撤销栈：每一步之前的那份**坐标**（不含 jsxgraph 对象）。 */
  const history = useRef<MathEntry[][]>([]);
  const [tool, setTool] = useState<MathTool>('point');
  const [labelText, setLabelText] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  /** ★ 2026-10-06：选中了第几条（`null` = 没选中）。「删除选中」按它动手。 */
  const [selected, setSelected] = useState<number | null>(null);
  /**
   * 选中图形在**屏幕**上的锚点 ⇒ 就地浮出的那个「删除」小按钮挂在这里。
   * `null` = 算不出来（拿不到坐标换算时）⇒ 不画浮动按钮，工具条上的「删除选中」照旧可用。
   */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const labelTextRef = useRef(labelText);
  labelTextRef.current = labelText;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;
  const selectRef = useRef<((index: number | null) => void) | null>(null);

  /** 撤销 / 清空由 effect 里实现、工具条上的按钮调用（工具条在 effect 之外）。 */
  const undoRef = useRef<(() => void) | null>(null);
  const clearRef = useRef<(() => void) | null>(null);
  const deleteSelectedRef = useRef<(() => void) | null>(null);
  /** 视图：放大 / 缩小 / 复位（替代库自带那条导航条）。 */
  const viewRef = useRef<((action: 'in' | 'out' | 'reset') => void) | null>(null);
  const scheduleRasterRef = useRef<() => void>(() => {});
  scheduleRasterRef.current = useDrawingRaster({
    capture: async () => {
      const canvasEl = host.current?.querySelector('canvas');
      const dataUrl = canvasEl?.toDataURL('image/png');
      return dataUrl ? dataUrlToBlob(dataUrl) : null;
    },
    onUrl: onImage,
  });

  useEffect(() => {
    if (!host.current) return;
    const board = JXG.JSXGraph.initBoard(host.current, {
      /** ★ 2026-10-06：**明确用 canvas 渲染**（位图快照直接读这块 canvas；老 iPad 上 SVG 更慢）。 */
      renderer: 'canvas',
      boundingbox: [-10, 8, 10, -8],
      /**
       * ★ 2026-10-06（教师）：「为什么背景里还有直角坐标系？」
       * 🔴 因为**画板自带**的那套坐标系一直在画（`axis: true, grid: true`），
       *    而参考线本来就该由**这一题的背景预设**决定（点阵/小方格/坐标纸/数轴，
       *    教师在编辑器里选）—— 两套一起出现时，小学的画线段题上会凭空多出 x/y 轴。
       * ⇒ 画板一律**不画**坐标系与网格；要坐标系的题让教师选「坐标纸」那张背景。
       */
      axis: false,
      grid: false,
      keepaspectratio: true,
      showCopyright: false,
      /**
       * ★ 2026-10-06：**关掉库自带的悬停信息框**（`showInfobox` 默认是**开**的）。
       *
       * 🔴 两条理由，缺一都不足以关它：
       *   ① 它和「**选中高亮** / 浮层那颗删除按钮」**抢注意力** —— 指针只要划过图形就冒一条
       *      小信息（坐标 / 名字那一套），而学生此刻要找的是「我选中了哪一件、删除按钮在哪」；
       *      两个东西同时闪，44px 的删除按钮反而更难被看见。
       *   ② 学生端跑的是**老 iPad / Safari 15**，触摸屏**没有 hover** ⇒ 这条信息他们**永远看不到**，
       *      留着它只是让桌面端与学生的操作感受分叉（老师演示时看得到、学生手上没有）。
       * ⚠️ 关掉它**不损失功能**：信息框从来不是操作入口（只是个只读提示），选中态由 `selected`
       *    高亮 + 浮动删除按钮表达，两者与它无关。
       */
      showInfobox: false,
      /**
       * ★ 2026-10-06 第二轮（教师截图）：「这个只有一种样式吗？有点难看，而且不实用」
       *   —— 指的是库自带那条导航条（`-` `100%` `+` `全屏` + 四个平移箭头）。
       *
       * 🔴 它**只有这一种长相**（库渲染的，改不了结构，只能整条换掉），而那四个平移箭头
       *    在触摸屏上尤其没用（学生本来就该直接拖）。⇒ 关掉它，改成我们自己工具条右侧的
       *    「放大 / 缩小 / 复位」三颗（与整个应用的观感一致，也是 44px 命中区）。
       *    这**推翻了**我先前那句「有工具条就用它的」—— 那句话在**能用**的前提下成立，
       *    而这条导航条的实际观感被教师否掉了。
       */
      showNavigation: false,
      showScreenshot: false,
      /**
       * 平移改为**双指**（`needTwoFingers`）：单指在画板上要么作图、要么拖控制点，
       * 让单指同时还能平移画布会让「点一下」和「挪一下」分不清（老 iPad 上尤其明显）。
       * 缩放仍然支持滚轮（桌面）与**捏合**（触屏）—— 那两个是库自己处理的。
       */
      pan: { enabled: !disabled, needTwoFingers: true },
      zoom: { wheel: !disabled },
    });
    boardRef.current = board;
    const pointAttrs = { size: 3, strokeColor: '#527198', fillColor: '#ffffff', fixed: disabled, name: '' };
    const lineAttrs = { strokeColor: '#365b82', strokeWidth: 2, fixed: disabled };

    /**
     * ★ 2026-10-07（教师）：「线段两端的点只有当我选中这个线段的时候才会出现；
     *   我不选择的时候，它就是一根看不见端点的线条」。
     *
     * 🔴 两种工厂、**不是**一个带默认参数的工厂：它们的用途是两件事 ——
     *   · `mkHandle` 是图形的**端点**（学生只是画了条线，不该看起来像"标了两个点"）；
     *   · `mkMark` 是**反馈**（多击工具点到第几下）与**作答本身**（独立的「点」）。
     *   一个带默认值的工厂会让调用点写成 `mkPoint(at)` / `mkPoint(at, true)` ——
     *   而"哪个参数是什么意思"没人看得出来，加一个调用点就会选错。
     *
     * ⚠️ 靠库的一个性质省掉一整套判断：`Board.getAllObjectsUnderMouse` 先判
     *   `visPropCalc.visible`（我核过 jsxgraph 的产物）⇒ 不可见的点**也点不中、也拖不动**。
     *   所以"未选中时藏端点"和"未选中时端点不可拖"是**同一件事**，不用各写一遍。
     *   代价：想拖端点得先选中它 —— 而那正是这一版要的心智（先选、再改）。
     */
    const mkHandle = (at: Pt) => board.create('point', at, { ...pointAttrs, visible: false }) as JXG.Point;
    const mkMark = (at: Pt) => board.create('point', at, pointAttrs) as JXG.Point;

    /**
     * 把一条记录画到画板上。**六种形状一处定义**（挂载、撤销重画、学生新画都走它）——
     * 三处各写一份必然分叉，而分叉的表现只是「撤销之后某个图形画得不一样」。
     */
    const renderEntry = (entry: MathEntry): RuntimeEntry => {
      if (entry.kind === 'point') {
        // ⚠️ 独立的「点」用 `mkMark`：那一个点**就是**学生的作答本身，藏了等于没画上。
        const p = mkMark(entry.p);
        return { entry, points: [p], objects: [p] };
      }
      if (entry.kind === 'circle') {
        const a = mkHandle(entry.center);
        const b = mkHandle(entry.edge);
        const shape = board.create('circle', [a, b], lineAttrs) as JXG.GeometryElement;
        return { entry, points: [a, b], objects: [a, b, shape] };
      }
      if (entry.kind === 'segment' || entry.kind === 'line' || entry.kind === 'arrow') {
        const a = mkHandle(entry.a);
        const b = mkHandle(entry.b);
        const shape = board.create(entry.kind, [a, b], lineAttrs) as JXG.GeometryElement;
        return { entry, points: [a, b], objects: [a, b, shape] };
      }
      if (entry.kind === 'polyline') {
        // 闭合（三角形/长方形/正方形/平行四边形/梯形）：把顶点做成**可拖的点** ⇒ 学生能微调。
        if (entry.closed) {
          const points = entry.points.map((point) => mkHandle(point));
          const shape = board.create('polygon', points, { ...lineAttrs, borders: lineAttrs }) as JXG.GeometryElement;
          return { entry, points, objects: [...points, shape] };
        }
        // 开放（自由线条）：直接按坐标画一条曲线（几十上百个点，不必建 JXG.Point）。
        const xs = entry.points.map(([x]) => x);
        const ys = entry.points.map(([, y]) => y);
        const shape = board.create('curve', [xs, ys], { ...lineAttrs, strokeWidth: 2 }) as JXG.GeometryElement;
        return { entry, points: [], objects: [shape], freehand: entry.points };
      }
      if (entry.kind === 'angle') {
        // ⚠️ **历史形状**（老「角」画的：两条臂 + 一段弧）：工具已砍掉，但老作答要靠这一支画出来。
        const a = mkHandle(entry.a);
        const vertex = mkHandle(entry.vertex);
        const b = mkHandle(entry.b);
        const arm1 = board.create('segment', [vertex, a], lineAttrs) as JXG.GeometryElement;
        const arm2 = board.create('segment', [vertex, b], lineAttrs) as JXG.GeometryElement;
        const arc = board.create('angle', [a, vertex, b], { radius: 0.8, name: '', ...lineAttrs }) as JXG.GeometryElement;
        // ⚠️ 顺序固定为 [a, vertex, b]：快照与预览都靠这个约定，不额外存字段。
        return { entry, points: [a, vertex, b], objects: [a, vertex, b, arm1, arm2, arc] };
      }
      if (entry.kind === 'label') {
        const text = board.create('text', [entry.at[0], entry.at[1], entry.text], {
          fontSize: 14, strokeColor: '#263b53', fixed: disabled,
        }) as JXG.GeometryElement;
        return { entry, points: [], objects: [text] };
      }
      // 六种形状在上面都 return 了；这一行只为让类型收敛（真走到这里说明有形状漏了实现）。
      return { entry, points: [], objects: [] };
    };

    const clearAll = () => {
      runtime.current.forEach((item) => item.objects.forEach((object) => board.removeObject(object)));
      runtime.current = [];
      if (pending.current) {
        pending.current.marks.forEach((mark) => board.removeObject(mark));
        pending.current = null;
      }
    };
    const renderAll = (entries: MathEntry[]) => {
      clearAll();
      runtime.current = entries.map(renderEntry);
    };

    /** 画板上现在真正是什么 ⇒ 存回作答里的那串坐标（拖过的点也按拖动后的位置算）。 */
    const snapshot = (): MathEntry[] => runtime.current.map((item) => {
      const { entry } = item;
      if (entry.kind === 'point') {
        const p = item.points[0];
        return { kind: 'point', p: [round3(p.X()), round3(p.Y())] };
      }
      if (entry.kind === 'circle') {
        return {
          kind: 'circle',
          center: [round3(item.points[0].X()), round3(item.points[0].Y())],
          edge: [round3(item.points[1].X()), round3(item.points[1].Y())],
        };
      }
      if (entry.kind === 'segment' || entry.kind === 'line' || entry.kind === 'arrow') {
        return {
          kind: entry.kind,
          a: [round3(item.points[0].X()), round3(item.points[0].Y())],
          b: [round3(item.points[1].X()), round3(item.points[1].Y())],
        };
      }
      if (entry.kind === 'polyline') {
        return entry.closed
          ? { kind: 'polyline', closed: true, points: item.points.map((p) => [round3(p.X()), round3(p.Y())] as Pt) }
          : { kind: 'polyline', points: (item.freehand ?? []).map(([x, y]) => [round3(x), round3(y)] as Pt) };
      }
      if (entry.kind === 'angle') {
        return {
          kind: 'angle',
          a: [round3(item.points[0].X()), round3(item.points[0].Y())],
          vertex: [round3(item.points[1].X()), round3(item.points[1].Y())],
          b: [round3(item.points[2].X()), round3(item.points[2].Y())],
        };
      }
      if (entry.kind === 'label') {
        const el = item.objects[0] as unknown as { X: () => number; Y: () => number };
        return { kind: 'label', at: [round3(el.X()), round3(el.Y())], text: entry.text };
      }
      return entry;
    });

    const publish = () => {
      onChange({ elements: snapshot() });
      // 选中的图形被拖动/改过之后，浮动按钮要跟着它走（否则它会留在原地指着空气）。
      if (selectedRef.current !== null) setAnchor(anchorOf(snapshot()[selectedRef.current]));
      scheduleRasterRef.current();
    };
    /**
     * ★ 2026-10-06（教师）：「画上去的东西怎么删除？是不是应该有个选择工具？」
     *
     * ⇒ 「选择」档：点一下图形 ⇒ 它被选中（描边加粗变暖色）；再点工具条的「删除选中」才删。
     * 🔴 **两步是有意的**：直接「点一下就删」在 iPad 上误触代价太大（学生画了十分钟的图，
     *    一指头没对准就少一块），而撤销栈只帮得上一步。选择 + 明确删除则误触无代价。
     * ⚠️ 高亮的做法是**整体重画一遍再给选中的那条换色**（`renderAll` 本来就是幂等的）——
     *    逐个恢复 `strokeColor` 要记住每种形状的原始属性，那是第二份真源，迟早对不上。
     */
    const applySelection = (index: number | null) => {
      // ⚠️ 顺序要紧：先整体重画（上一条选中的端点会随重画消失），再给这一条露端点。
      renderAll(runtime.current.map((item) => item.entry));
      if (index === null) return;
      const item = runtime.current[index];
      item?.objects.forEach((object) => {
        const shape = object as unknown as { setAttribute?: (attrs: Record<string, unknown>) => void };
        shape.setAttribute?.({ strokeColor: '#b45309', strokeWidth: 3, highlight: false });
      });
      /*
       * ★ 2026-10-07：端点只在这一刻露出来，而且**放大** —— 它现在是唯一的抓手，
       *   而 `size: 3` 是"顺带可见"时代的尺寸，在 iPad 上抓不住。
       */
      item?.points.forEach((point) => point.setAttribute({ visible: true, size: 6 }));
    };
    /**
     * 一条记录在屏幕上的代表点（浮动删除按钮的锚点）。
     *
     * 🔴 用 `JXG.Coords` 换算，**不能用我们自己的线性映射**：画板可以被学生平移/缩放
     *    （导航条与双指），静态映射在动过视图之后会把按钮飘到别处。
     * ⚠️ `usr2screen` 在 `JXG.Coords` 上，**不在 board 上**（我核过 core 与类型定义）；
     *    拿不到时回 `null` ⇒ 不画浮动按钮（而不是画在错误的位置）。
     */
    const anchorOf = (entry: MathEntry | undefined): { x: number; y: number } | null => {
      if (!entry) return null;
      const pts: Pt[] = entry.kind === 'point' ? [entry.p]
        : entry.kind === 'circle' ? [entry.center, entry.edge]
          : entry.kind === 'angle' ? [entry.a, entry.vertex, entry.b]
            : entry.kind === 'label' ? [entry.at]
              : entry.kind === 'polyline' ? entry.points
                : [entry.a, entry.b];
      if (pts.length === 0) return null;
      const mid = pts.reduce(([ax, ay], [x, y]) => [ax + x / pts.length, ay + y / pts.length] as Pt, [0, 0] as Pt);
      try {
        const coords = new JXG.Coords(JXG.COORDS_BY_USER, [mid[0], mid[1]], board);
        return { x: coords.scrCoords[1], y: coords.scrCoords[2] };
      } catch {
        return null;
      }
    };
    selectRef.current = (index: number | null) => {
      applySelection(index);
      setSelected(index);
      setAnchor(index === null ? null : anchorOf(snapshot()[index]));
    };
    /** 每一步之前先把「当前这份坐标」压进撤销栈。 */
    const pushHistory = () => {
      history.current.push(snapshot());
      if (history.current.length > 50) history.current.shift();
      setCanUndo(true);
    };
    const addEntry = (entry: MathEntry) => {
      runtime.current.push(renderEntry(entry));
    };

    /**
     * 点一下画板：按**当前工具**决定这是第几下、以及什么时候成形。
     * 每个工具要几下，全在 `MATH_TOOLS`（纯数据）里；这里只做分派。
     */
    const handleDown = (event: PointerEvent) => {
      if (disabled) return;
      /**
       * 「选择」档：点图形选中它，点空白取消。⚠️ 必须排在下面那句「点到图形就 return」**之前**——
       * 那句是给绘图工具用的（点既有图形时只让内核拖动它），选择档恰恰要处理「点到了图形」。
       */
      if (toolRef.current === 'select') {
        const hits = board.getAllObjectsUnderMouse(event);
        // `getAllObjectsUnderMouse` 的类型是 `unknown[]`（库的历史包袱）⇒ 这里只做一次窄化。
        const target = hits[0] as JXG.GeometryElement | undefined;
        const index = target === undefined ? -1 : runtime.current.findIndex((item) => item.objects.includes(target));
        selectRef.current?.(index >= 0 ? index : null);
        return;
      }
      // 拖动既有控制点时 JSXGraph 同样会发 down；此时只让内核处理拖动，不再新建图形。
      if (board.getAllObjectsUnderMouse(event).length > 0) return;
      const coords = board.getUsrCoordsOfMouse(event);
      const at: Pt = [round3(coords[0]), round3(coords[1])];
      const currentTool = toolRef.current;
      const spec = MATH_TOOLS.find((item) => item.value === currentTool);
      if (!spec) return;

      if (currentTool === 'free') return;                       // 自由线条走拖动，不走点击
      /*
       * ⊘ ★ 2026-10-07：这里原来是「平行线 / 垂线」两支 —— 参照线只在自己画的线里找
       *   （下面那句 `runtime.current`），而**底图上的边不是画板对象** ⇒ 学生站在老师给的
       *   几何图前面点它们，什么都不会发生，屏幕上也不解释。两个工具已砍掉。
       * ⚠️ 真要加回来，先解决"参照得到底图上的边"这件事，别只把这段贴回来。
       */
      if (currentTool === 'label') {
        const text = labelTextRef.current.trim();
        if (!text) return;                                      // 空文字不落一个看不见的标签
        pushHistory();
        addEntry({ kind: 'label', at, text: text.slice(0, 12) });
        publish();
        return;
      }
      if (spec.clicks <= 1) {
        pushHistory();
        addEntry({ kind: 'point', p: at });
        publish();
        return;
      }

      // 多击工具：记下已经点过的位置，凑够次数再成形。
      if (!pending.current || pending.current.tool !== currentTool) {
        if (pending.current) pending.current.marks.forEach((mark) => board.removeObject(mark));
        pending.current = { tool: currentTool, ats: [], marks: [] };
      }
      pending.current.ats.push(at);
      pending.current.marks.push(mkMark(at));
      if (pending.current.ats.length < spec.clicks) return;

      const ats = pending.current.ats;
      const marks = pending.current.marks;
      pending.current = null;
      marks.forEach((mark) => board.removeObject(mark));
      const formed = buildEntry(currentTool, ats);
      if (!formed) return;
      pushHistory();
      formed.forEach(addEntry);
      publish();
    };

    /** 手势点完 ⇒ 该长出什么形状（几何全在 `@/lib/worksheet-math-shapes.ts`，这里只拼数据）。 */
    const buildEntry = (currentTool: MathTool, ats: Pt[]): MathEntry[] | null => {
      switch (currentTool) {
        case 'segment': case 'arrow':
          return [{ kind: currentTool, a: ats[0], b: ats[1] }];
        case 'circle':
          return [{ kind: 'circle', center: ats[0], edge: ats[1] }];
        case 'triangle':
          return [{ kind: 'polyline', closed: true, points: ats.slice(0, 3) }];
        case 'rectangle':
          return [{ kind: 'polyline', closed: true, points: rectangleOf(ats[0], ats[1]) }];
        case 'parallelogram':
          return [{ kind: 'polyline', closed: true, points: parallelogramOf(ats[0], ats[1], ats[2]) }];
        case 'trapezoid':
          return [{ kind: 'polyline', closed: true, points: trapezoidOf(ats) }];
        /*
         * ⊘ ★ 2026-10-07：`case 'angle'`（画两条臂 + 一段弧）随「角」这个工具一起删了。
         *   ⚠️ 但 `kind: 'angle'` 这个**形状**必须一直读得回来、画得出来 ——
         *   老作答里还有（见 `renderEntry` 那一支与 `readEntries` 的校验）。
         *   **删的是入口，不是历史。**
         */
        default:
          return null;
      }
    };

    /**
     * ★ 2026-10-06（教师两条批注合成一条路）：
     *   ① 「能不能在画图时使用拖拽的方式，不要用不同位置点鼠标的方式」；
     *   ② 「自由线条拖拽过程中线条要可见」。
     *
     * ⇒ 统一成**拖动绘制**：按下 → 过程画在覆盖层上（必然可见）→ 松手一次性成正式图形。
     *   · 两类工具走这条路：`free`（自由线条）与 `drag: true` 的两点图形
     *     （线段/直线/射线/圆/长方形/正方形）；
     *   · 三点以上的图形（三角形、梯形、角、平分线、中点、垂直平分线）**只能继续多点** ——
     *     几何上两个位置定不下来，这不是交互偏好问题；
     *   · 走捕获阶段并 `stopPropagation`：不然 JSXGraph 会把这次按下也当成「在画板上点了一下」；
     *   · 落点在任何既有图形上时**不接管**（那多半是要拖那个控制点）。
     */
    const hostEl = host.current;
    const overlayEl = overlay.current;
    const overlayCtx = overlayEl?.getContext('2d') ?? null;
    const clearOverlay = () => {
      if (overlayEl && overlayCtx) overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    };
    /** 覆盖层的像素尺寸跟着画板走（含 devicePixelRatio，否则线上会有锯齿）。 */
    const syncOverlaySize = () => {
      if (!overlayEl || !overlayCtx) return;
      const rect = hostEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      overlayEl.width = Math.max(1, Math.round(rect.width * dpr));
      overlayEl.height = Math.max(1, Math.round(rect.height * dpr));
      overlayEl.style.width = `${rect.width}px`;
      overlayEl.style.height = `${rect.height}px`;
      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeStyle = '#365b82';
      overlayCtx.lineJoin = 'round';
      overlayCtx.lineCap = 'round';
    };
    const toLocal = (event: PointerEvent): Pt => {
      const rect = hostEl.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    let drag: { tool: MathTool; start: Pt; user: Pt[]; screen: Pt[] } | null = null;

    /**
     * 拖动过程中的实时预览：**纯屏幕坐标**，直接画在覆盖层上。
     *
     * ⚠️ 刻意不做「用户坐标 → 屏幕坐标」的换算（`board.usr2screen` 在我们的 jsxgraph 类型里
     *    并不存在，去断言它就等于把类型闸关掉）。这里能这么省，是因为画板是
     *    `keepaspectratio: true` ⇒ 用户空间与屏幕之间只差**一个等比缩放 + 翻转**
     *    ⇒ 用户空间的矩形/正方形/圆映射到屏幕仍然是矩形/正方形/圆，形状不变。
     *    正式图形（松手时）仍然按**用户坐标**建，所以作答里的数据与预览无关。
     */
    const drawPreview = (currentTool: MathTool, screenStart: Pt, screenNow: Pt) => {
      if (!overlayCtx || !drag) return;
      clearOverlay();
      overlayCtx.beginPath();
      if (currentTool === 'free') {
        drag.screen.forEach(([x, y], index) => { if (index === 0) overlayCtx.moveTo(x, y); else overlayCtx.lineTo(x, y); });
      } else if (currentTool === 'circle') {
        overlayCtx.arc(screenStart[0], screenStart[1], Math.hypot(screenNow[0] - screenStart[0], screenNow[1] - screenStart[1]), 0, Math.PI * 2);
      } else if (currentTool === 'rectangle') {
        overlayCtx.rect(screenStart[0], screenStart[1], screenNow[0] - screenStart[0], screenNow[1] - screenStart[1]);
      } else {
        overlayCtx.moveTo(screenStart[0], screenStart[1]);
        overlayCtx.lineTo(screenNow[0], screenNow[1]);
      }
      overlayCtx.stroke();
    };

    const onDragDown = (event: PointerEvent) => {
      if (disabled || event.button !== 0) return;
      const currentTool = toolRef.current;
      const isDragTool = currentTool === 'free'
        || (MATH_TOOLS.find((item) => item.value === currentTool)?.drag ?? false);
      if (!isDragTool) return;
      if (board.getAllObjectsUnderMouse(event).length > 0) return;   // 让内核去拖那个控制点
      event.stopPropagation();
      event.preventDefault();
      syncOverlaySize();
      const coords = board.getUsrCoordsOfMouse(event);
      const at: Pt = [round3(coords[0]), round3(coords[1])];
      const local = toLocal(event);
      drag = { tool: currentTool, start: at, user: [at], screen: [local] };
      drawPreview(currentTool, local, local);
    };
    const onDragMove = (event: PointerEvent) => {
      if (!drag) return;
      event.stopPropagation();
      const coords = board.getUsrCoordsOfMouse(event);
      const at: Pt = [round3(coords[0]), round3(coords[1])];
      const local = toLocal(event);
      drag.screen.push(local);
      // ⚠️ 抽稀：贴得太近的点不记（一条自由线几十个点就够，几百个会让作答体积翻十倍）。
      const last = drag.user[drag.user.length - 1];
      if (Math.hypot(at[0] - last[0], at[1] - last[1]) >= 0.08) drag.user.push(at);
      drawPreview(drag.tool, drag.screen[0], local);
    };
    const onDragUp = (event: PointerEvent) => {
      if (!drag) return;
      const { tool: currentTool, start, user } = drag;
      const coords = board.getUsrCoordsOfMouse(event);
      const end: Pt = [round3(coords[0]), round3(coords[1])];
      drag = null;
      clearOverlay();
      if (currentTool === 'free') {
        // 只点一下不拖 ⇒ 不算一条线（别留一个看不见的碎点）。
        if (user.length < 3) return;
        pushHistory();
        addEntry({ kind: 'polyline', points: user });
        publish();
        return;
      }
      // 拖得太短 ⇒ 不成形（避免一个零长度的线段/半径 0 的圆）。
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.3) return;
      const formed = buildEntry(currentTool, [start, end]);
      if (!formed) return;
      pushHistory();
      formed.forEach(addEntry);
      publish();
    };
    hostEl.addEventListener('pointerdown', onDragDown, { capture: true });
    hostEl.addEventListener('pointermove', onDragMove, { capture: true });
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);

    renderAll(readEntries(data));
    board.on('down', handleDown);
    board.on('up', () => { if (!drag) publish(); });

    // 撤销/清空要给外面的按钮用（工具条在 effect 之外）。
    viewRef.current = (action) => {
      if (action === 'in') board.zoomIn();
      else if (action === 'out') board.zoomOut();
      // 「复位」= 回到**初始那框视野**（也把学生平移过的偏移一起收回来）。
      // ⚠️ 用 `setBoundingBox` 而不是 `zoom100()`：后者只复位缩放，不管平移。
      else board.setBoundingBox([-10, 8, 10, -8], true);
    };
    deleteSelectedRef.current = () => {
      const index = selectedRef.current;
      if (index === null) return;
      const remaining = runtime.current.filter((_, itemIndex) => itemIndex !== index).map((item) => item.entry);
      pushHistory();
      renderAll(remaining);
      selectRef.current?.(null);
      publish();
    };
    undoRef.current = () => {
      const previous = history.current.pop();
      setCanUndo(history.current.length > 0);
      if (!previous) return;
      renderAll(previous);
      publish();
    };
    clearRef.current = () => {
      if (runtime.current.length === 0) return;
      pushHistory();
      clearAll();
      publish();
    };

    return () => {
      hostEl.removeEventListener('pointerdown', onDragDown, { capture: true });
      hostEl.removeEventListener('pointermove', onDragMove, { capture: true });
      window.removeEventListener('pointerup', onDragUp);
      window.removeEventListener('pointercancel', onDragUp);
      undoRef.current = null;
      clearRef.current = null;
      deleteSelectedRef.current = null;
      selectRef.current = null;
      viewRef.current = null;
      JXG.JSXGraph.freeBoard(board);
      boardRef.current = null;
      runtime.current = [];
      pending.current = null;
      history.current = [];
    };
  // 第三方画板只挂载一次，工具通过 ref 读取，避免切工具时销毁学生已画内容。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseTool = (next: MathTool) => {
    const board = boardRef.current;
    // 换工具时把「点了一半」的那些标记清掉（否则画板上会留一串没用的点）。
    if (board && pending.current) pending.current.marks.forEach((mark) => board.removeObject(mark));
    pending.current = null;
    // 换工具时取消选中（否则「删除选中」会对着一个已经看不见高亮的图形动手）。
    selectRef.current?.(null);
    setTool(next);
  };

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="数学作图工具">
        {/*
          ★ 2026-10-06（教师）：「其它工具要在文字前加图标，整个工具栏 UI 重新设计一下，归类要科学。」
          ⇒ 按 `MATH_TOOL_GROUPS` 分成 基础 / 多边形 / 角与线 / 其他 四组，组间一条细分割线，
            每个按钮 = **图标 + 文字**（图标取自 `MATH_TOOL_ICONS`，14 个工具一个不少，有用例点名）。
          ⚠️ 分组是**数据**（`group` 字段），不是写死在这里的几段 JSX —— 加一个工具时只需要在
            工具表里给它一个 `group`，工具栏自己会归位。
        */}
        {MATH_TOOL_GROUPS.map((group) => {
          const items = toolsInGroup(group.value);
          if (items.length === 0) return null;
          return (
            <span className={styles.drawingToolbarGroup} key={group.value}>
              <span className={styles.drawingToolbarGroupLabel}>{group.label}</span>
              {items.map((item) => (
                <button className={styles.drawingToolbarButton} key={item.value} type="button" aria-pressed={tool === item.value} disabled={disabled} onClick={() => chooseTool(item.value)}>
                  <svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={MATH_TOOL_ICONS[item.value]} /></svg>
                  {item.label}
                </button>
              ))}
            </span>
          );
        })}
        {tool === 'label' && (
          <input
            className={styles.drawingToolbarEdgeLabel}
            type="text"
            maxLength={12}
            disabled={disabled}
            aria-label="要写上去的文字"
            placeholder="写文字"
            value={labelText}
            onChange={(event) => setLabelText(event.target.value)}
          />
        )}
        <span className={styles.drawingToolbarHint}>{toolHintOf(tool)}</span>
        <span className={styles.drawingToolbarSpacer} />
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>视图</span>
          {([['in', '放大'], ['out', '缩小'], ['reset', '复位']] as const).map(([action, label]) => (
            <button className={styles.drawingToolbarButton} key={action} type="button" disabled={disabled} onClick={() => viewRef.current?.(action)}>
              <svg className={styles.drawingToolbarIcon} viewBox="0 0 24 24" aria-hidden="true">
                <path d={action === 'reset'
                  ? 'M5 5h14v14H5Z M5 12h14 M12 5v14'
                  : `M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13 M20 20l-4.2-4.2${action === 'in' ? ' M11 8.2v5.6 M8.2 11h5.6' : ' M8.2 11h5.6'}`} />
              </svg>
              {label}
            </button>
          ))}
        </span>
        {tool === 'select' && (
          <button className={styles.drawingToolbarButton} type="button" disabled={disabled || selected === null} onClick={() => deleteSelectedRef.current?.()}>删除选中</button>
        )}
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled || !canUndo} onClick={() => undoRef.current?.()}>撤销</button>
        <button className={styles.drawingToolbarButton} type="button" disabled={disabled} onClick={() => clearRef.current?.()}>清空</button>
      </div>
      <div className={styles.mathStage}>
        <div
          ref={host}
          className={`${styles.thirdPartyCanvas} ${styles.mathCanvas}`}
          style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
        />
        {/* 拖动预览层：`pointer-events: none`（在 CSS 里），绝不抢指针事件。 */}
        <canvas ref={overlay} className={styles.mathOverlay} aria-hidden="true" />
        {/*
          ★ 2026-10-06（教师选的是 A）：「选中后就地浮出『删除』小按钮（iPad 也能用，省一趟）」。
          ⚠️ 只有「选择」档 + 选中了图形 + 算得出位置时才出现；其余情况走工具条上的「删除选中」。
          ⚠️ 它自己带 `pointer-events: auto`（父层 `.mathOverlay` 是 none）——按钮必须能点。
        */}
        {tool === 'select' && selected !== null && anchor && (
          <button
            className={styles.mathFloatingDelete}
            type="button"
            disabled={disabled}
            style={{ left: anchor.x, top: anchor.y }}
            aria-label="删除选中的图形"
            onClick={() => deleteSelectedRef.current?.()}
          >删除</button>
        )}
      </div>
    </div>
  );
}

/** 坐标统一留三位小数：与 `worksheet-math-shapes.ts` 里那几个构造器同一口径。 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
