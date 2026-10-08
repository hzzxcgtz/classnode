'use client';

import { useEffect, useRef, useState } from 'react';
import JXG from 'jsxgraph';

import { dataUrlToBlob, useDrawingRaster } from '@/lib/worksheet-drawing-raster.ts';
import {
  MATH_TOOL_GROUPS,
  MATH_TOOLS,
  arcLabelAt,
  arcPathOf,
  backgroundPlacement,
  equalMarkOf,
  fitMathBoundingBox,
  parallelMarkOf,
  parallelogramOf,
  rectangleOf,
  rightAngleCornerOf,
  rightAngleOf,
  rotatePolygonPoints,
  snapPolygonVertex,
  triangleOf,
  toolHintOf,
  toolsInGroup,
  trapezoidOf,
  type MathEntry,
  type MathTool,
  type Pt,
} from '@/lib/worksheet-math-shapes.ts';

import type { DrawingSurfaceProps } from './types';
import DrawingToolbarIcon from './drawing-toolbar-icon';
import MathToolbarIcon from './math-toolbar-icon';
import styles from '../../worksheet.module.css';

/** 一条运行时记录：`coords` 是**作答里的那份坐标**，`points` 是 jsxgraph 里的可拖点。 */
type RuntimeEntry = {
  entry: MathEntry;
  points: JXG.Point[];
  objects: JXG.GeometryElement[];
  /** 命中时还要认多边形自动创建的各条 border；它们不单独参与清理。 */
  hitObjects?: JXG.GeometryElement[];
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
    if (row.kind === 'angleArc' || row.kind === 'rightAngle') return isPt(row.vertex) && isPt(row.a) && isPt(row.b);
    if (row.kind === 'equalMark' || row.kind === 'parallelMark') return isPt(row.a) && isPt(row.b);
    if (row.kind === 'coordinateSystem' || row.kind === 'numberLine') return isPt(row.a) && isPt(row.b);
    if (row.kind === 'label') return isPt(row.at) && typeof row.text === 'string';
    return false;
  });
}

export default function MathDrawing({ data, backgroundUrl, disabled, onChange, onImage, starter }: DrawingSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  /** 拖动过程的实时线条画在这块覆盖层上（见 effect 里 `drawPreview` 的注释）。 */
  const overlay = useRef<HTMLCanvasElement | null>(null);
  const runtime = useRef<RuntimeEntry[]>([]);
  /** 撤销栈：每一步之前的那份**坐标**（不含 jsxgraph 对象）。 */
  const history = useRef<MathEntry[][]>([]);
  const [tool, setTool] = useState<MathTool>('select');
  const [labelDraft, setLabelDraft] = useState('');
  const [labelEditor, setLabelEditor] = useState<{ at: Pt; x: number; y: number } | null>(null);
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
  const labelEditorRef = useRef(labelEditor);
  labelEditorRef.current = labelEditor;
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;
  const selectRef = useRef<((index: number | null) => void) | null>(null);

  /** 撤销 / 清空由 effect 里实现、工具条上的按钮调用（工具条在 effect 之外）。 */
  const undoRef = useRef<(() => void) | null>(null);
  const clearRef = useRef<(() => void) | null>(null);
  const deleteSelectedRef = useRef<(() => void) | null>(null);
  const commitLabelRef = useRef<((text: string) => void) | null>(null);
  /** 视图：放大 / 缩小 / 适应画布（替代库自带那条导航条）。 */
  const viewRef = useRef<((action: 'in' | 'out' | 'fit') => void) | null>(null);
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
    /**
     * ⚠️ 把 props 收一个局部名：下面（取底图那段）会用一个同名的局部变量装 blob URL，
     *   而 `backgroundUrl` 是 `DrawingSurfaceProps` 的字段、四个画板共用 ⇒ **不许为了消歧改 props**。
     */
    const backgroundUrlProp = backgroundUrl;
    const usesInfiniteDotGrid = typeof backgroundUrlProp === 'string'
      && backgroundUrlProp.split(/[?#]/, 1)[0].endsWith('/worksheet/drawing-backgrounds/dot-grid.svg');
    host.current.dataset.infiniteDotGrid = usesInfiniteDotGrid ? 'true' : 'false';
    const starterData = starter?.tool === 'math' ? starter.data : null;
    const hasSavedMathData = !!data && typeof data === 'object' && !Array.isArray(data)
      && Array.isArray((data as Record<string, unknown>).elements);
    if (host.current) host.current.dataset.toolCursor = 'select';
    const board = JXG.JSXGraph.initBoard(host.current, {
      /** ★ 2026-10-06：**明确用 canvas 渲染**（位图快照直接读这块 canvas；老 iPad 上 SVG 更慢）。 */
      renderer: 'canvas',
      boundingbox: [-10, 8, 10, -8],
      /**
       * JSXGraph 自带网格会连坐标轴一起带出来，因此继续关闭；默认点阵由容器无限重复铺设，
       * 直角坐标系与数轴则由工具栏按需添加，三者职责不混在一起。
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
       *    「放大 / 缩小 / 适应画布」三颗（与整个应用的观感一致，也是 44px 命中区）。
       *    这**推翻了**我先前那句「有工具条就用它的」—— 那句话在**能用**的前提下成立，
       *    而这条导航条的实际观感被教师否掉了。
       */
      showNavigation: false,
      showScreenshot: false,
      /**
       * 选择档在空白处直接拖动画布；绘图档的拖动由下面捕获阶段的监听接管，不会误触平移。
       * 鼠标不要求 Shift、触屏不要求双指，才符合“空白处抓住整张纸移动”的直觉。
       */
      pan: { enabled: !disabled, needShift: false, needTwoFingers: false },
      // 默认 1.25 倍变化太猛；每格只变化 1.02 倍，并继续以指针位置为中心。
      zoom: { wheel: !disabled, needShift: false, factorX: 1.02, factorY: 1.02 },
    });
    const pointAttrs = { size: 3, strokeColor: '#527198', fillColor: '#ffffff', fixed: disabled, name: '' };
    const lineAttrs = { strokeColor: '#365b82', strokeWidth: 2, fixed: disabled, highlight: false };
    const starterObjects = new Set<JXG.GeometryElement>();

    /**
     * ★ 2026-10-07（教师）：「线段两端的点只有当我选中这个线段的时候才会出现；
     *   我不选择的时候，它就是一根看不见端点的线条」。
     *
     * 🔴 两种工厂、**不是**一个带默认参数的工厂：它们的用途是两件事 ——
     *   · `mkHandle` 是图形的**端点**（学生只是画了条线，不该看起来像"标了两个点"）；
     *   · `mkMark` 只用于兼容历史作答里的独立「点」（新工具栏已经不再提供“点”）。
     *   一个带默认值的工厂会让调用点写成 `mkPoint(at)` / `mkPoint(at, true)` ——
     *   而"哪个参数是什么意思"没人看得出来，加一个调用点就会选错。
     *
     * ⚠️ `visible: false` 不能用来“藏”端点：JSXGraph 会同时把它移出命中检测，结果是
     *   线段和多边形的顶点都无法拖动。这里让点保持 visible，只把描边和填充设为透明；
     *   点自己的 `precision` 继续提供鼠标 / 触控命中区，所以视觉上没有大圆，交互仍在。
     *   选中图形后再恢复不透明度，露出小控制点，告诉学生哪些位置可以微调。
     */
    const mkHandle = (at: Pt) => board.create('point', at, {
      ...pointAttrs,
      visible: true,
      strokeOpacity: 0,
      fillOpacity: 0,
      highlightStrokeOpacity: 0,
      highlightFillOpacity: 0,
      precision: { mouse: 8, pen: 12, touch: 30 },
    }) as JXG.Point;
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
          points.forEach((point, movedIndex) => {
            point.on('drag', () => {
              const candidate: Pt = [point.X(), point.Y()];
              const current = points.map((item) => [item.X(), item.Y()] as Pt);
              // 12px 是吸附视觉半径；换成用户坐标后，缩放前后力度保持一致。
              const pixelsPerUnit = Number.isFinite(board.unitX) && board.unitX > 0 ? board.unitX : 48;
              const snapped = snapPolygonVertex(current, movedIndex, candidate, 12 / pixelsPerUnit);
              if (snapped[0] !== candidate[0] || snapped[1] !== candidate[1]) {
                point.setPositionDirectly(JXG.COORDS_BY_USER, snapped);
              }
            });
          });
          // JSXGraph 运行时 Polygon 有公开的 `borders`，但当前随包类型漏掉了这个字段。
          const shape = board.create('polygon', points, {
            ...lineAttrs,
            hasInnerPoints: true,
            fillColor: 'none',
            fillOpacity: 0,
            highlightFillColor: 'none',
            highlightFillOpacity: 0,
            borders: { ...lineAttrs, highlightStrokeWidth: 2 },
          }) as unknown as JXG.GeometryElement & { borders: JXG.GeometryElement[] };
          const cornerObjects: JXG.GeometryElement[] = [];
          points.forEach((vertex, vertexIndex) => {
            const prev = points[(vertexIndex - 1 + points.length) % points.length];
            const next = points[(vertexIndex + 1) % points.length];
            const corner = () => rightAngleCornerOf(
              [vertex.X(), vertex.Y()],
              [prev.X(), prev.Y()],
              [next.X(), next.Y()],
            );
            const markerPoints = [0, 1, 2].map((markerIndex) => board.create('point', [
              () => corner()?.[markerIndex][0] ?? vertex.X(),
              () => corner()?.[markerIndex][1] ?? vertex.Y(),
            ], { visible: false, fixed: true, name: '' }) as JXG.Point);
            const markerAttrs = {
              ...lineAttrs,
              fixed: true,
              strokeColor: '#647b94',
              strokeWidth: 1.4,
              visible: () => corner() !== null,
            };
            const first = board.create('segment', [markerPoints[0], markerPoints[1]], markerAttrs) as JXG.GeometryElement;
            const second = board.create('segment', [markerPoints[1], markerPoints[2]], markerAttrs) as JXG.GeometryElement;
            cornerObjects.push(...markerPoints, first, second);
          });
          return {
            entry,
            points,
            objects: [...points, shape, ...cornerObjects],
            hitObjects: [...points, shape, ...shape.borders],
          };
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
      if (entry.kind === 'coordinateSystem' || entry.kind === 'numberLine') {
        /*
         * 两个透明端点是整组坐标工具的尺寸控制柄。选中后沿用普通线段的规则露出小圆点；
         * 轴、刻度与文字全部使用动态坐标，因此拖动控制柄时整组实时缩放，不必销毁重建。
         */
        const a = mkHandle(entry.a);
        const b = mkHandle(entry.b);
        if (entry.kind === 'numberLine') {
          let aligning = false;
          const keepHorizontal = (moved: JXG.Point, other: JXG.Point) => {
            if (aligning) return;
            aligning = true;
            other.setPositionDirectly(JXG.COORDS_BY_USER, [other.X(), moved.Y()]);
            aligning = false;
          };
          a.on('drag', () => keepHorizontal(a, b));
          b.on('drag', () => keepHorizontal(b, a));
        }
        const minX = () => Math.min(a.X(), b.X());
        const maxX = () => Math.max(a.X(), b.X());
        const centerX = () => (a.X() + b.X()) / 2;
        const centerY = () => (a.Y() + b.Y()) / 2;
        const minY = () => Math.min(a.Y(), b.Y());
        const maxY = () => Math.max(a.Y(), b.Y());
        const attrs = { ...lineAttrs, fixed: true, highlight: false };
        const objects: JXG.GeometryElement[] = [a, b];
        const hitObjects: JXG.GeometryElement[] = [a, b];
        const supportPoint = (x: () => number, y: () => number) => {
          const point = board.create('point', [x, y], { visible: false, fixed: true, name: '' }) as JXG.Point;
          objects.push(point);
          return point;
        };
        const segment = (from: JXG.Point, to: JXG.Point, extra: Record<string, unknown> = {}) => {
          const line = board.create('segment', [from, to], { ...attrs, ...extra }) as JXG.GeometryElement;
          objects.push(line);
          hitObjects.push(line);
          return line;
        };
        const left = supportPoint(minX, centerY);
        const right = supportPoint(maxX, centerY);
        segment(left, right, {
          ...attrs, lastArrow: true,
        });
        const tickRatios = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
        for (const ratio of tickRatios) {
          const x = () => minX() + (maxX() - minX()) * ratio;
          segment(
            supportPoint(x, () => centerY() - 0.16),
            supportPoint(x, () => centerY() + 0.16),
            { strokeWidth: 1.35 },
          );
        }
        if (entry.kind === 'coordinateSystem') {
          segment(supportPoint(centerX, minY), supportPoint(centerX, maxY), { lastArrow: true });
          for (const ratio of tickRatios) {
            const y = () => minY() + (maxY() - minY()) * ratio;
            segment(
              supportPoint(() => centerX() - 0.16, y),
              supportPoint(() => centerX() + 0.16, y),
              { strokeWidth: 1.35 },
            );
          }
          objects.push(board.create('text', [() => maxX() - 0.35, () => centerY() - 0.45, 'x'], {
            fontSize: 13, strokeColor: '#365b82', fixed: true,
          }) as JXG.GeometryElement);
          objects.push(board.create('text', [() => centerX() + 0.25, () => maxY() - 0.35, 'y'], {
            fontSize: 13, strokeColor: '#365b82', fixed: true,
          }) as JXG.GeometryElement);
        }
        const zero = board.create('text', [centerX, () => centerY() - 0.42, '0'], {
          fontSize: 12, strokeColor: '#365b82', fixed: true, anchorX: 'middle', anchorY: 'top',
        }) as JXG.GeometryElement;
        objects.push(zero);
        hitObjects.push(zero);
        return { entry, points: [a, b], objects, hitObjects };
      }
      /*
       * ★ 2026-10-07：四个几何记号。**几何全部来自 `worksheet-math-shapes.ts`** ——
       *   画板只负责"把算好的点画上去"，一个三角函数都不许在这里出现
       *   （教师预览是第二个渲染端，两边各推一套迟早分叉，而分叉的表现只是
       *    "教师看到的记号比学生画的小一点"，没人会为此报 bug）。
       * ⚠️ 三个记号 `points: []`（没有抓手）**并且 `fixed: true`**：它们太小，
       *   拖它比重新画一个还费劲。**`fixed: true` 不是装饰** —— jsxgraph 对
       *   "坐标数组建出来的线/曲线"默认 `isDraggable = true`，不锁住的话学生能拖走它，
       *   而 `snapshot()` 对这三个 kind 落到最后的 `return entry`（位移不进数据）⇒
       *   **拖了不记住**：屏幕上挪走了，下一次重画又弹回来，中间那张快照里却是挪过的位置。
       * ⚠️ 锁住**不影响选中**：`getAllObjectsUnderMouse` 只看可见性，`hasPoint` 不看 `fixed`
       *   ⇒ 学生照旧能点中它并「删除选中」。
       */
      if (entry.kind === 'equalMark') {
        const tick = equalMarkOf(entry.a, entry.b);
        if (!tick) return { entry, points: [], objects: [] };
        const shape = board.create('segment', [tick[0], tick[1]], { ...lineAttrs, strokeWidth: 3, fixed: true }) as JXG.GeometryElement;
        return { entry, points: [], objects: [shape] };
      }
      if (entry.kind === 'parallelMark') {
        const bar = parallelMarkOf(entry.a, entry.b);
        if (!bar) return { entry, points: [], objects: [] };
        const shape = board.create('segment', [bar[0], bar[1]], { ...lineAttrs, firstArrow: true, lastArrow: true, fixed: true }) as JXG.GeometryElement;
        return { entry, points: [], objects: [shape] };
      }
      if (entry.kind === 'rightAngle') {
        const square = rightAngleOf(entry.vertex, entry.a, entry.b);
        if (!square) return { entry, points: [], objects: [] };
        /*
         * 🔴 **不许用 `create('polyline', …)`** —— jsxgraph 里**没有**这个元素名
         *   （注册表里是 `polygon` / `polygonalchain` / `curve`，产物里搜 `polyline` 零命中）。
         *   `board.create` 找不全会 **throw**，而 `handleDown` 是挂在 `board.on('down')` 上的 ——
         *   `EventEmitter.trigger` 的 `suspended[evt] = false` **不在 finally 里**
         *   （`src/utils/event.js:71-81`，逐字核过）⇒ 抛一次之后 `suspended['down']`
         *   **永远停在 true** ⇒ 这块画板此后**不再派发 down** ⇒ 点/线段/圆/四个记号……
         *   **所有点类工具静默失效**，只剩拖动类（走我们自己的 DOM 监听）还能画。
         * ⇒ 用 `curve`（与自由线条、角弧同一支）：喂数组时它的 `curvetype` 是 `'plot'`，
         *   即**逐点连直线**，正是折线要的。
         */
        const shape = board.create('curve', [square.map(([x]) => x), square.map(([, y]) => y)],
          { ...lineAttrs, strokeWidth: 2, fixed: true }) as JXG.GeometryElement;
        return { entry, points: [], objects: [shape] };
      }
      if (entry.kind === 'angleArc') {
        // ⚠️ 三个点用 `mkHandle`（未选中时藏起来，与线段端点同一条规矩）。
        const a = mkHandle(entry.a);
        const vertex = mkHandle(entry.vertex);
        const b = mkHandle(entry.b);
        const objects: JXG.GeometryElement[] = [a, vertex, b];
        const arc = arcPathOf(entry.vertex, entry.a, entry.b);
        if (arc) {
          /*
           * ⚠️ 用 `curve`（与自由线条那一支同种画法）而**不是**库自带的 `angle` 元素：
           *   库那个自己决定画哪一段弧，而教师预览要照着同一个函数画 —— 两边必须同源。
           *   （历史形状 `kind: 'angle'` 仍然用库自带的那个，那是为了与老作答长得一样。）
           */
          objects.push(board.create('curve', [arc.map(([x]) => x), arc.map(([, y]) => y)], { ...lineAttrs, strokeWidth: 2 }) as JXG.GeometryElement);
        }
        const at = entry.text ? arcLabelAt(entry.vertex, entry.a, entry.b) : null;
        if (entry.text && at) {
          objects.push(board.create('text', [at[0], at[1], entry.text], { fontSize: 14, strokeColor: '#263b53', fixed: disabled }) as JXG.GeometryElement);
        }
        return { entry, points: [a, vertex, b], objects };
      }
      // 六种老形状在上面都 return 了；这一行只为让类型收敛（真走到这里说明有形状漏了实现）。
      return { entry, points: [], objects: [] };
    };

    const clearAll = () => {
      /*
       * JSXGraph 明确要求批量删除按创建逆序进行。多边形还带自动 border 与动态直角标记，
       * 正序先删顶点会递归删掉依赖对象，后面再删同一批对象时容易留下未刷新的 Canvas 帧。
       */
      for (let itemIndex = runtime.current.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const objects = runtime.current[itemIndex].objects;
        for (let objectIndex = objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
          board.removeObject(objects[objectIndex]);
        }
      }
      runtime.current = [];
    };
    const renderAll = (entries: MathEntry[]) => {
      // 切工具/取消选中会走这里；无论图形多少，都只在全部重建完成后刷新一次画面。
      board.suspendUpdate();
      try {
        clearAll();
        runtime.current = entries.map(renderEntry);
      } finally {
        board.unsuspendUpdate(); // 内部会 fullUpdate，不能等下一次画布点击才补绘
      }
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
      if (entry.kind === 'angleArc') {
        // ⚠️ 角弧的三个点是**可拖的** ⇒ 必须按拖动后的位置存回去。
        //   少这一支的表现是"拖了一下，松手又弹回去"，而屏幕上只是"没拖动"。
        //   ⚠️ `points` 的顺序与 `angle` 那一支一致：[a, vertex, b]。
        return {
          kind: 'angleArc',
          a: [round3(item.points[0].X()), round3(item.points[0].Y())],
          vertex: [round3(item.points[1].X()), round3(item.points[1].Y())],
          b: [round3(item.points[2].X()), round3(item.points[2].Y())],
          // ⚠️ 文字**没有就不带那个键**（与 `readInk` 对 `texts` 的口径一致：
          //    老值原样，不是凭空多一个空串）。
          ...(entry.text ? { text: entry.text } : {}),
        };
      }
      if (entry.kind === 'label') {
        const el = item.objects[0] as unknown as { X: () => number; Y: () => number };
        return { kind: 'label', at: [round3(el.X()), round3(el.Y())], text: entry.text };
      }
      if (entry.kind === 'coordinateSystem' || entry.kind === 'numberLine') {
        return {
          kind: entry.kind,
          a: [round3(item.points[0].X()), round3(item.points[0].Y())],
          b: [round3(item.points[1].X()), round3(item.points[1].Y())],
        };
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
      /*
       * ⚠️ 顺序要紧：先整体重画（上一条选中的端点会随重画消失），再给这一条露端点。
       *
       * 🔴 重画的输入是 **`snapshot()` 而不是 `item.entry`** —— `entry` 是**创建时**那份，
       *   学生拖过端点之后它还是旧坐标，而拖动改的是 `item.points`。
       *   用 `item.entry` 重画 ⇒ **拖过的图形弹回原位**，而且此后任何一次 `publish()`
       *   会把弹回后的坐标写回作答 ⇒ 拖动永久丢失（屏幕上只是"弹了一下"）。
       *   这一版把「拖端点」变成了唯一的微调手势，所以这条老代码第一次变成主路径。
       *   `snapshot()` 的定义就是"画板上现在真正是什么"，重画当然该按它来。
       */
      renderAll(snapshot());
      if (index === null) return;
      const item = runtime.current[index];
      (item?.hitObjects ?? item?.objects ?? []).forEach((object) => {
        const shape = object as unknown as { setAttribute?: (attrs: Record<string, unknown>) => void };
        shape.setAttribute?.({ strokeColor: '#b45309', strokeWidth: 3, highlight: false });
      });
      /*
       * 只露出小控制点；好不好抓由上面的透明命中区 / precision 保证，不再靠把圆画大。
       */
      item?.points.forEach((point) => point.setAttribute({
        visible: true,
        size: 3,
        strokeOpacity: 1,
        fillOpacity: 1,
        highlightStrokeOpacity: 1,
        highlightFillOpacity: 1,
      }));
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
    commitLabelRef.current = (raw: string) => {
      const editor = labelEditorRef.current;
      // 先关编辑器，避免 Enter 引发的 blur 再提交一次。
      labelEditorRef.current = null;
      setLabelEditor(null);
      setLabelDraft('');
      const text = raw.trim().slice(0, 12);
      if (!editor || !text) return;
      pushHistory();
      addEntry({ kind: 'label', at: editor.at, text });
      publish();
    };

    /** 画板按下：选择图形；文字和拖动画图由下面的 DOM 捕获监听接管。 */
    const handleDown = (event: PointerEvent) => {
      if (disabled) return;
      /**
       * 「选择」档：点图形选中它，点空白取消。⚠️ 必须排在下面那句「点到图形就 return」**之前**——
       * 那句是给绘图工具用的（点既有图形时只让内核拖动它），选择档恰恰要处理「点到了图形」。
       */
      if (toolRef.current === 'select') {
        const hit = studentHitAt(event);
        const index = hit?.index ?? -1;
        /*
         * 已经选中的图形不能再次 applySelection：它会 renderAll、把指针刚按住的控制点
         * 换成一个新对象，JSXGraph 随即失去本次拖动目标。保留原对象后，直线定义点和
         * 三角形顶点都能从这次 pointerdown 直接开始拖。
         */
        if (index >= 0 && index === selectedRef.current) return;
        selectRef.current?.(index >= 0 ? index : null);
        return;
      }
      // 其它现有工具都由拖动完成；按在既有控制点上时只让 JSXGraph 负责调整。
      if (studentHitsUnderMouse(event).length > 0) return;
    };

    /** 一次拖动结束后生成正式图形。 */
    const buildEntry = (currentTool: MathTool, start: Pt, end: Pt): MathEntry | null => {
      const needsArea = currentTool === 'triangle' || currentTool === 'rectangle'
        || currentTool === 'parallelogram' || currentTool === 'trapezoid'
        || currentTool === 'coordinateSystem';
      if (needsArea && (Math.abs(end[0] - start[0]) < 0.3 || Math.abs(end[1] - start[1]) < 0.3)) return null;
      if (currentTool === 'numberLine' && Math.abs(end[0] - start[0]) < 0.3) return null;
      switch (currentTool) {
        case 'segment': case 'arrow':
          return { kind: currentTool, a: start, b: end };
        case 'coordinateSystem':
          return { kind: 'coordinateSystem', a: start, b: end };
        case 'numberLine':
          return { kind: 'numberLine', a: start, b: [end[0], start[1]] };
        case 'circle':
          return { kind: 'circle', center: start, edge: end };
        case 'triangle':
          return { kind: 'polyline', closed: true, points: triangleOf(start, end) };
        case 'rectangle':
          return { kind: 'polyline', closed: true, points: rectangleOf(start, end) };
        case 'parallelogram':
          return { kind: 'polyline', closed: true, points: parallelogramOf(start, end) };
        case 'trapezoid':
          return { kind: 'polyline', closed: true, points: trapezoidOf(start, end) };
        default:
          return null;
      }
    };

    /**
     * ★ 2026-10-06（教师两条批注合成一条路）：
     *   ① 「能不能在画图时使用拖拽的方式，不要用不同位置点鼠标的方式」；
     *   ② 「铅笔拖拽过程中线条要可见」。
     *
     * ⇒ 统一成**拖动绘制**：按下 → 过程画在覆盖层上（必然可见）→ 松手一次性成正式图形。
     *   · `free` 是铅笔轨迹；工具表里 `drag: true` 的图形都由起点与终点确定包围框；
     *   · 三角形、平行四边形、梯形也统一拖动生成，生成后仍可拖各顶点微调；
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
    let polygonMove: { index: number; start: Pt; origins: Pt[]; moved: boolean } | null = null;
    let polygonRotation: {
      index: number;
      center: Pt;
      startPointer: Pt;
      origins: Pt[];
      moved: boolean;
    } | null = null;

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
      } else if (currentTool === 'coordinateSystem') {
        const centerX = (screenStart[0] + screenNow[0]) / 2;
        const centerY = (screenStart[1] + screenNow[1]) / 2;
        overlayCtx.moveTo(screenStart[0], centerY);
        overlayCtx.lineTo(screenNow[0], centerY);
        overlayCtx.moveTo(centerX, screenStart[1]);
        overlayCtx.lineTo(centerX, screenNow[1]);
      } else if (currentTool === 'triangle' || currentTool === 'parallelogram' || currentTool === 'trapezoid') {
        // 几何函数按“用户坐标 y 向上”计算；预览层 y 向下，所以进出各翻转一次。
        const a: Pt = [screenStart[0], -screenStart[1]];
        const b: Pt = [screenNow[0], -screenNow[1]];
        const points = (currentTool === 'triangle' ? triangleOf(a, b)
          : currentTool === 'parallelogram' ? parallelogramOf(a, b) : trapezoidOf(a, b))
          .map(([x, y]) => [x, -y] as Pt);
        points.forEach(([x, y], index) => { if (index === 0) overlayCtx.moveTo(x, y); else overlayCtx.lineTo(x, y); });
        overlayCtx.closePath();
      } else if (currentTool === 'numberLine') {
        overlayCtx.moveTo(screenStart[0], screenStart[1]);
        overlayCtx.lineTo(screenNow[0], screenStart[1]);
      } else {
        overlayCtx.moveTo(screenStart[0], screenStart[1]);
        overlayCtx.lineTo(screenNow[0], screenNow[1]);
      }
      overlayCtx.stroke();
    };

    const onDragDown = (event: PointerEvent) => {
      if (disabled || event.button !== 0) return;
      const currentTool = toolRef.current;
      if (currentTool === 'label') {
        /*
         * 文字落点必须在捕获阶段完整接管。之前它走 `board.on('down')`，同一次按下已经先让
         * JSXGraph 启动了“拖图形/平移画布”；React 随后把输入框自动聚焦，打断那次手势，
         * 就会留下图形被拖出视区、看起来像“点击后消失”的状态。
         */
        event.stopImmediatePropagation();
        event.preventDefault();
        const coords = board.getUsrCoordsOfMouse(event);
        const at: Pt = [round3(coords[0]), round3(coords[1])];
        const rect = hostEl.getBoundingClientRect();
        setLabelDraft('');
        setLabelEditor({ at, x: event.clientX - rect.left, y: event.clientY - rect.top });
        return;
      }
      const isDragTool = currentTool === 'free'
        || (MATH_TOOLS.find((item) => item.value === currentTool)?.drag ?? false);
      if (!isDragTool) return;
      if (studentHitsUnderMouse(event).length > 0) return;   // 让内核去拖那个控制点
      event.stopPropagation();
      event.preventDefault();
      syncOverlaySize();
      const coords = board.getUsrCoordsOfMouse(event);
      const at: Pt = [round3(coords[0]), round3(coords[1])];
      const local = toLocal(event);
      drag = { tool: currentTool, start: at, user: [at], screen: [local] };
      drawPreview(currentTool, local, local);
    };
    /**
     * 选择档拖闭合图形的内部/边线 ⇒ 整体平移；拖顶点仍交给 JSXGraph，只改那一个顶点。
     * 首次按住尚未选中的多边形也能直接开始拖，不必先点一下、再拖第二次。
     */
    const onPolygonMoveDown = (event: PointerEvent) => {
      if (disabled || event.button !== 0 || toolRef.current !== 'select') return;
      const hit = studentHitAt(event);
      if (!hit) return;
      const item = runtime.current[hit.index];
      if (item.entry.kind !== 'polyline' || !item.entry.closed
        || item.points.some((point) => point.id === hit.target.id)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      hostEl.focus({ preventScroll: true });
      if (selectedRef.current !== hit.index) selectRef.current?.(hit.index);
      const movingItem = runtime.current[hit.index];
      const coords = board.getUsrCoordsOfMouse(event);
      polygonMove = {
        index: hit.index,
        start: [coords[0], coords[1]],
        origins: movingItem.points.map((point) => [point.X(), point.Y()] as Pt),
        moved: false,
      };
      hostEl.dataset.panCursor = 'grabbing';
    };
    const onPolygonMove = (event: PointerEvent) => {
      if (!polygonMove) return;
      event.preventDefault();
      const coords = board.getUsrCoordsOfMouse(event);
      const dx = coords[0] - polygonMove.start[0];
      const dy = coords[1] - polygonMove.start[1];
      if (!polygonMove.moved && Math.hypot(dx, dy) > 0.01) {
        pushHistory();
        polygonMove.moved = true;
      }
      if (!polygonMove.moved) return;
      const movingItem = runtime.current[polygonMove.index];
      movingItem.points.forEach((point, index) => {
        const origin = polygonMove?.origins[index];
        if (origin) point.setPositionDirectly(JXG.COORDS_BY_USER, [origin[0] + dx, origin[1] + dy]);
      });
      board.update();
    };
    const onPolygonMoveUp = () => {
      if (!polygonMove) return;
      const moved = polygonMove.moved;
      polygonMove = null;
      if (moved) publish();
    };
    /**
     * 选中的闭合多边形，每个顶点外侧有一圈 12–28px 的旋转命中区。
     * 命中区不画出来：控制点保持小巧，但指针靠近外圈时会明确变成旋转状态。
     */
    const rotationHit = (event: PointerEvent): { index: number; center: Pt; origins: Pt[] } | null => {
      const index = selectedRef.current;
      if (index === null) return null;
      const item = runtime.current[index];
      if (item?.entry.kind !== 'polyline' || !item.entry.closed || item.points.length < 3) return null;
      const local = toLocal(event);
      const origins = item.points.map((point) => [point.X(), point.Y()] as Pt);
      const closeToOuterRing = origins.some(([x, y]) => {
        const coords = new JXG.Coords(JXG.COORDS_BY_USER, [x, y], board);
        const distance = Math.hypot(local[0] - coords.scrCoords[1], local[1] - coords.scrCoords[2]);
        return distance >= 12 && distance <= 28;
      });
      if (!closeToOuterRing) return null;
      const center = origins.reduce(([sumX, sumY], [x, y]) => [
        sumX + x / origins.length,
        sumY + y / origins.length,
      ] as Pt, [0, 0] as Pt);
      return { index, center, origins };
    };
    const onRotationDown = (event: PointerEvent) => {
      if (disabled || event.button !== 0 || toolRef.current !== 'select') return;
      const hit = rotationHit(event);
      if (!hit) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      hostEl.focus({ preventScroll: true });
      const coords = board.getUsrCoordsOfMouse(event);
      polygonRotation = {
        ...hit,
        startPointer: [coords[0], coords[1]],
        moved: false,
      };
      hostEl.dataset.panCursor = 'rotating';
    };
    const onRotationMove = (event: PointerEvent) => {
      if (!polygonRotation) return;
      event.preventDefault();
      const coords = board.getUsrCoordsOfMouse(event);
      const currentPointer: Pt = [coords[0], coords[1]];
      const rotated = rotatePolygonPoints(
        polygonRotation.origins,
        polygonRotation.center,
        polygonRotation.startPointer,
        currentPointer,
      );
      const travel = Math.hypot(
        currentPointer[0] - polygonRotation.startPointer[0],
        currentPointer[1] - polygonRotation.startPointer[1],
      );
      if (!polygonRotation.moved && travel > 0.01) {
        pushHistory();
        polygonRotation.moved = true;
      }
      if (!polygonRotation.moved) return;
      const movingItem = runtime.current[polygonRotation.index];
      movingItem.points.forEach((point, pointIndex) => {
        const position = rotated[pointIndex];
        if (position) point.setPositionDirectly(JXG.COORDS_BY_USER, position);
      });
      board.update();
    };
    const onRotationUp = () => {
      if (!polygonRotation) return;
      const moved = polygonRotation.moved;
      polygonRotation = null;
      hostEl.dataset.panCursor = 'grab';
      if (moved) publish();
    };
    const syncPanCursor = (event: PointerEvent, pressed = event.buttons !== 0) => {
      if (disabled || toolRef.current !== 'select') {
        delete hostEl.dataset.panCursor;
        return;
      }
      if (rotationHit(event)) {
        hostEl.dataset.panCursor = polygonRotation ? 'rotating' : 'rotate';
        return;
      }
      const hit = studentHitAt(event);
      if (hit) {
        const item = runtime.current[hit.index];
        hostEl.dataset.panCursor = item?.points.some((point) => point.id === hit.target.id) ? 'vertex' : 'move';
        return;
      }
      hostEl.dataset.panCursor = pressed ? 'grabbing' : 'grab';
    };
    const onCursorDown = (event: PointerEvent) => {
      hostEl.focus({ preventScroll: true });
      syncPanCursor(event, true);
    };
    const onCursorMove = (event: PointerEvent) => {
      if (!drag) syncPanCursor(event);
    };
    const onCursorUp = () => {
      if (toolRef.current === 'select' && !disabled) hostEl.dataset.panCursor = 'grab';
      else delete hostEl.dataset.panCursor;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (labelEditorRef.current || selectedRef.current === null) return;
      event.preventDefault();
      deleteSelectedRef.current?.();
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
      // 拖得太短 ⇒ 不成形（避免两个定义点重合或半径为 0）。
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.3) return;
      const formed = buildEntry(currentTool, start, end);
      if (!formed) return;
      pushHistory();
      addEntry(formed);
      publish();
    };
    hostEl.addEventListener('pointerdown', onDragDown, { capture: true });
    hostEl.addEventListener('pointermove', onDragMove, { capture: true });
    hostEl.addEventListener('pointerdown', onRotationDown, { capture: true });
    hostEl.addEventListener('pointerdown', onPolygonMoveDown, { capture: true });
    hostEl.addEventListener('pointerdown', onCursorDown, { capture: true });
    hostEl.addEventListener('pointermove', onCursorMove, { capture: true });
    hostEl.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);
    window.addEventListener('pointermove', onPolygonMove);
    window.addEventListener('pointerup', onPolygonMoveUp);
    window.addEventListener('pointercancel', onPolygonMoveUp);
    window.addEventListener('pointermove', onRotationMove);
    window.addEventListener('pointerup', onRotationUp);
    window.addEventListener('pointercancel', onRotationUp);
    window.addEventListener('pointerup', onCursorUp);
    window.addEventListener('pointercancel', onCursorUp);

    /*
     * ★ 2026-10-07（教师）：教师上传的几何题原图当**底图**。
     *
     * 🔴 为什么必须是**画板对象**、而不是继续挂在 CSS `background-image` 上（三条缺一不可）：
     *   ① **进快照**：抓图抓的是 jsxgraph 那块 canvas，CSS 背景一个字都不在里面 ⇒
     *      教师看板那一格与发给 AI 的联系表里是「一堆悬空的线，几何图不见了」；
     *   ② **跟着缩放平移**：它的矩形是用户坐标，画板动它就动 —— 在图上描辅助线，
     *      对齐是**全部意义**，而 CSS 背景钉死不动；
     *   ③ **不变形**：摆位由 `backgroundPlacement` 给的锚点与尺寸决定，不再被
     *      `background-size: 100% 100%` 硬拉成 5:4。
     *
     * 🔴 取图必须走 **fetch → blob → objectURL**（同源），不能把 URL 直接喂进去：
     *   dev 下页面在 `:4000`、图片在 `:4001`（`worksheetAssetUrl` 就是这么拼的）⇒ 跨域图
     *   画进 canvas ⇒ canvas **被污染** ⇒ `toDataURL()` 抛 SecurityError ⇒ 被 `safeCapture`
     *   吞掉 ⇒ **快照静默全废**，而屏幕上什么都不说。生产是同源、本来没这问题，
     *   但**教师是在 dev 里验的**。
     *
     * ⚠️ 取图失败（离线 / 404 / 教师把图换了）⇒ 就当这一题没有底图，学生照旧能在空白
     *   画板上作答。**不弹提示**：那是学生无能为力的事，打断他更坏。
     * ⚠️ 底图**不进 `runtime.current`** ⇒ 「清空」与撤销栈碰不到它（学生清不掉老师给的图）。
     * ⚠️ 顺序**不靠创建先后**（取图是异步的）：见下面 `layer: -1` 那一段。
     *   所以下面那句 `renderAll` 仍然**同步**执行 —— 不许为了等底图把它挪到 `await` 后面，
     *   那会让"重新打开一道题"先看到一块空白画板。
     */
    let cancelled = false;
    let loadedBackgroundUrl: string | null = null;
    let backgroundObject: JXG.GeometryElement | null = null;

    /**
     * 底图**不是学生能碰的东西**：`Image.hasPoint` 是矩形命中，而它铺满整块画布 ⇒
     * 它会被**每一次点击**命中。三处命中判断共用这一个过滤器（少滤一处就是
     * "所有绘图工具失效"或"永远选不中自己画的线"，两种都不报错）。
     * ⚠️ 按**对象身份**滤，不依赖"库今天会不会返回它" —— 将来库改了 `Image.hasPoint`，
     *   这条过滤照样成立（与「思维导图那条工具条用库自己的 id 并对拍库产物」同一个纪律）。
     */
    const studentHitsUnderMouse = (event: PointerEvent) => board.getAllObjectsUnderMouse(event)
      .filter((object) => object !== backgroundObject && !starterObjects.has(object as JXG.GeometryElement));
    const studentHitAt = (event: PointerEvent): { index: number; target: JXG.GeometryElement } | null => {
      for (const object of studentHitsUnderMouse(event)) {
        const target = object as JXG.GeometryElement;
        const index = runtime.current.findIndex((item) => (item.hitObjects ?? item.objects).includes(target));
        if (index >= 0) return { index, target };
      }
      return null;
    };

    // 默认点阵由画布容器重复铺设，始终覆盖可见区域；只有教师上传的图片才创建有限画板对象。
    if (backgroundUrlProp && !usesInfiniteDotGrid) {
      void (async () => {
        try {
          const response = await fetch(backgroundUrlProp);
          const objectUrl = URL.createObjectURL(await response.blob());
          const aspect = await imageAspectOf(objectUrl);
          if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
          loadedBackgroundUrl = objectUrl;
          /*
           * 🔴 jsxgraph 要的是 **[锚点, 尺寸]**，不是两个角（我第一版按两个角写，图缩成一半、
           *   挤在左下角）。换算在 `backgroundPlacement` 里，有用例钉住"居中"这条性质。
           */
          const { anchor, size } = backgroundPlacement(aspect ?? Number.NaN);
          backgroundObject = board.create('image', [objectUrl, anchor, size], {
            // 🔴 压在最下面：canvas 渲染器绘制前按 layer 排序（已核 board.js 的 _compareDepth），
            //    而 `layer` 是公开属性。这样**不用**靠"底图必须先建"来保证顺序。
            layer: -1,
            fixed: true,          // 老师给的图不是可拖的东西
            highlight: false,     // 触摸屏没有 hover，留着只是让桌面端与学生的感受分叉
            withLabel: false,
          }) as JXG.GeometryElement;
        } catch {
          // 取不到就当没有底图（见上）。
        }
      })();
    }

    /*
     * 数学底图与学生作答是两层：教师画出的结构图只负责显示，永远不进 runtime、快照、
     * 选中命中或撤销栈。教师端制作底图时没有 starter prop，仍以普通 data 方式完整可编辑。
     */
    readEntries(starterData).map(renderEntry).forEach((item) => {
      [...new Set([...(item.hitObjects ?? []), ...item.objects])].forEach((object) => {
        starterObjects.add(object);
        const shape = object as unknown as { setAttribute?: (attrs: Record<string, unknown>) => void };
        shape.setAttribute?.({ fixed: true, highlight: false });
      });
      item.points.forEach((point) => point.setAttribute({
        fixed: true,
        strokeOpacity: 0,
        fillOpacity: 0,
        highlightStrokeOpacity: 0,
        highlightFillOpacity: 0,
      }));
    });
    // `{elements: []}` 是学生明确清空后的有效作答；数学底图始终留在独立锁定层。
    renderAll(hasSavedMathData ? readEntries(data) : []);
    board.on('down', handleDown);
    board.on('up', () => { if (!drag && !polygonMove && !polygonRotation) publish(); });

    // 撤销/清空要给外面的按钮用（工具条在 effect 之外）。
    viewRef.current = (action) => {
      if (action === 'in') board.zoomIn();
      else if (action === 'out') board.zoomOut();
      else {
        const entries = [...readEntries(starterData), ...snapshot()];
        const points: Pt[] = [];
        entries.forEach((entry) => {
          if (entry.kind === 'point') points.push(entry.p);
          else if (entry.kind === 'circle') {
            const radius = Math.hypot(entry.edge[0] - entry.center[0], entry.edge[1] - entry.center[1]);
            points.push(
              [entry.center[0] - radius, entry.center[1] - radius],
              [entry.center[0] + radius, entry.center[1] + radius],
            );
          } else if (entry.kind === 'polyline') points.push(...entry.points);
          else if (entry.kind === 'angle' || entry.kind === 'angleArc') points.push(entry.a, entry.vertex, entry.b);
          else if (entry.kind === 'label') points.push(entry.at);
          else points.push(entry.a, entry.b);
        });
        const rect = hostEl.getBoundingClientRect();
        board.setBoundingBox(fitMathBoundingBox(points, rect.width, rect.height), true);
      }
    };
    deleteSelectedRef.current = () => {
      const index = selectedRef.current;
      if (index === null) return;
      // ⚠️ 与 `applySelection` 同一个道理：按 `snapshot()`（画板上现在的坐标）重画，
      //    不许用 `item.entry`（创建时那份）—— 否则拖过端点的图形会弹回。
      const remaining = snapshot().filter((_, itemIndex) => itemIndex !== index);
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
      hostEl.removeEventListener('pointerdown', onRotationDown, { capture: true });
      hostEl.removeEventListener('pointerdown', onPolygonMoveDown, { capture: true });
      hostEl.removeEventListener('pointerdown', onCursorDown, { capture: true });
      hostEl.removeEventListener('pointermove', onCursorMove, { capture: true });
      hostEl.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerup', onDragUp);
      window.removeEventListener('pointercancel', onDragUp);
      window.removeEventListener('pointermove', onPolygonMove);
      window.removeEventListener('pointerup', onPolygonMoveUp);
      window.removeEventListener('pointercancel', onPolygonMoveUp);
      window.removeEventListener('pointermove', onRotationMove);
      window.removeEventListener('pointerup', onRotationUp);
      window.removeEventListener('pointercancel', onRotationUp);
      window.removeEventListener('pointerup', onCursorUp);
      window.removeEventListener('pointercancel', onCursorUp);
      /*
       * ★ 2026-10-07：底图那条 blob URL 必须回收 —— 不回收就是"每开一次题漏一张图"，
       *   而它漏的是**内存**（学生在同一节课里翻几十道题就会显出来）。
       * ⚠️ `cancelled` 先置：取图还在路上时组件就被卸载的话，
       *   那条 async 分支醒来会发现 `cancelled` 并**自己**回收（见上面）。
       */
      cancelled = true;
      if (loadedBackgroundUrl) URL.revokeObjectURL(loadedBackgroundUrl);
      undoRef.current = null;
      clearRef.current = null;
      deleteSelectedRef.current = null;
      commitLabelRef.current = null;
      selectRef.current = null;
      viewRef.current = null;
      JXG.JSXGraph.freeBoard(board);
      runtime.current = [];
      history.current = [];
    };
  // 第三方画板只挂载一次，工具通过 ref 读取，避免切工具时销毁学生已画内容。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseTool = (next: MathTool) => {
    labelEditorRef.current = null;
    setLabelEditor(null);
    setLabelDraft('');
    // 手型只属于选择档的空白区域；切到绘图工具后不能残留上一帧的 grab 指针。
    if (next !== 'select') host.current?.removeAttribute('data-pan-cursor');
    if (host.current) host.current.dataset.toolCursor = next;
    // 换工具时取消选中（否则「删除选中」会对着一个已经看不见高亮的图形动手）。
    // 没有选中对象时不做无意义的全量重建；图形越多，这一点越重要。
    if (selectedRef.current !== null) selectRef.current?.(null);
    setTool(next);
  };

  return (
    <div className={styles.thirdPartySurface}>
      <div className={styles.drawingSurfaceToolbar} role="toolbar" aria-label="数学作图工具">
        {/*
          ★ 2026-10-06（教师）：「其它工具要在文字前加图标，整个工具栏 UI 重新设计一下，归类要科学。」
          ⇒ 按 `MATH_TOOL_GROUPS` 分成 基础 / 多边形 / 角与线 / 其他 四组，组间一条细分割线，
            每个按钮只显示图标（名称通过延迟悬停提示与 aria-label 提供）。
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
                <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} key={item.value} type="button" aria-label={item.label} data-tooltip={item.label} aria-pressed={tool === item.value} disabled={disabled} onClick={() => chooseTool(item.value)}>
                  <MathToolbarIcon tool={item.value} className={styles.drawingToolbarIcon} />
                </button>
              ))}
            </span>
          );
        })}
        <span className={styles.drawingToolbarSpacer} />
        <span className={styles.drawingToolbarGroup}>
          <span className={styles.drawingToolbarGroupLabel}>视图</span>
          {([['in', '放大'], ['out', '缩小'], ['fit', '适应画布']] as const).map(([action, label]) => (
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} key={action} type="button" aria-label={label} data-tooltip={label} disabled={disabled} onClick={() => viewRef.current?.(action)}>
              <DrawingToolbarIcon name={action === 'in' ? 'zoomIn' : action === 'out' ? 'zoomOut' : 'fit'} className={styles.drawingToolbarIcon} />
            </button>
          ))}
        </span>
        <span className={`${styles.drawingToolbarGroup} ${styles.drawingToolbarActions}`}>
          <span className={styles.drawingToolbarGroupLabel}>编辑记录</span>
          {tool === 'select' && (
            <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton} ${styles.drawingToolbarDanger}`} type="button" aria-label="删除选中" data-tooltip="删除选中" disabled={disabled || selected === null} onClick={() => deleteSelectedRef.current?.()}><DrawingToolbarIcon name="delete" className={styles.drawingToolbarIcon} /></button>
          )}
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton}`} type="button" aria-label="撤销" data-tooltip="撤销" disabled={disabled || !canUndo} onClick={() => undoRef.current?.()}><DrawingToolbarIcon name="undo" className={styles.drawingToolbarIcon} /></button>
          <button className={`${styles.drawingToolbarButton} ${styles.drawingToolbarIconButton} ${styles.drawingToolbarDanger}`} type="button" aria-label="清空" data-tooltip="清空" disabled={disabled} onClick={() => clearRef.current?.()}><DrawingToolbarIcon name="clear" className={styles.drawingToolbarIcon} /></button>
        </span>
        <span className={styles.drawingToolbarHint}>
          <strong className={styles.drawingToolbarHintLabel}>操作提示</strong>
          {toolHintOf(tool)}
        </span>
      </div>
      <div className={styles.mathStage}>
        {/*
          ★ 教师上传的题图仍是画板里的 image 对象（能进快照并跟随缩放平移）；默认点阵是例外，
            它由 `.mathCanvas[data-infinite-dot-grid]` 无限重复铺设，不能再退回有限 image 对象。
          ⚠️ `.thirdPartyCanvas` 的 CSS（含 `background-size: 100% 100%`）**一个字都不许动** ——
            流程图与思维导图两档**还在用**它。
        */}
        <div
          ref={host}
          className={`${styles.thirdPartyCanvas} ${styles.mathCanvas}`}
          tabIndex={disabled ? -1 : 0}
          aria-label="数学作图画布"
        />
        {/* 拖动预览层：`pointer-events: none`（在 CSS 里），绝不抢指针事件。 */}
        <canvas ref={overlay} className={styles.mathOverlay} aria-hidden="true" />
        {tool === 'label' && labelEditor && (
          <input
            className={styles.mathLabelEditor}
            type="text"
            maxLength={12}
            autoFocus
            aria-label="画布文字"
            placeholder="输入文字"
            value={labelDraft}
            style={{ left: labelEditor.x, top: labelEditor.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setLabelDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') commitLabelRef.current?.(event.currentTarget.value);
              if (event.key === 'Escape') {
                labelEditorRef.current = null;
                setLabelEditor(null);
                setLabelDraft('');
              }
            }}
            onBlur={(event) => commitLabelRef.current?.(event.currentTarget.value)}
          />
        )}
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
            title="删除选中的图形"
            onClick={() => deleteSelectedRef.current?.()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/** 坐标统一留三位小数：与 `worksheet-math-shapes.ts` 里那几个构造器同一口径。 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 取一张图的原始宽高比；**加载不出来就回 `null`**（调用方据此回落成画板框自己的比例）。
 * ⚠️ 用 `onerror` 兜底、且**不抛**：图挂了不该把整个画板带下去。
 */
function imageAspectOf(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(probe.naturalWidth > 0 && probe.naturalHeight > 0
      ? probe.naturalWidth / probe.naturalHeight : null);
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}
