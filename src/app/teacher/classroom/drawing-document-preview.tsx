'use client';

import { worksheetAssetUrl } from '@/lib/worksheet-presentation';
import { flowchartPreviewImage } from '@/lib/worksheet-drawing-starter.ts';
import type { DrawingDocument } from '@/lib/worksheet-drawing-document';

type Pair = [number, number];
type PreviewProps = {
  document: DrawingDocument;
  width: number;
  height: number;
  backgroundUrl: string | null;
  /** ★ 2026-10-07：题目自带的**初始化图**（底稿）—— 只有流程图那一档有；渲染时要合进来。 */
  starter?: unknown;
};

/*
 * ★ 2026-10-07（教师）：「学生在画流程图的时候，能够**一眼看到完整的图**……不要使用滚动条了」。
 * `maxHeight: '100%'` + SVG 自己的 `viewBox`（有内在宽高比）⇒ 框不够高时**等比缩小**，不溢出。
 * ⚠️ 百分比要解析得上，容器必须有**确定高度**（看板那一格由 `tile-answer.tsx` 的 `fill` 给）；
 *    没有确定高度时（抽屉那一支）`max-height` 等价于 `none` ⇒ 与原来一模一样。
 */
const SVG_STYLE = { display: 'block', width: '100%', maxHeight: '100%', background: '#fff' } as const;

function pair(raw: unknown): Pair | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  if (typeof raw[0] !== 'number' || typeof raw[1] !== 'number') return null;
  if (!Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) return null;
  return [raw[0], raw[1]];
}

function row(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function pathFromPoints(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.map((point, index) => {
    const item = row(point);
    if (!item || typeof item.x !== 'number' || typeof item.y !== 'number') return '';
    return `${index === 0 ? 'M' : 'L'} ${item.x} ${item.y}`;
  }).filter(Boolean).join(' ');
}

function Background({ url, width, height }: { url: string | null; width: number; height: number }) {
  return url ? <image href={url} x="0" y="0" width={width} height={height} preserveAspectRatio="none" /> : null;
}

function BasicPreview({ data, width, height, backgroundUrl }: PreviewProps & { data: Record<string, unknown> }) {
  const paths = Array.isArray(data.paths) ? data.paths : [];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={SVG_STYLE} role="img" aria-label="学生的基础绘图作答">
      <Background url={backgroundUrl} width={width} height={height} />
      {paths.map((rawPath, index) => {
        const item = row(rawPath);
        if (!item) return null;
        const d = pathFromPoints(item.paths);
        if (!d) return null;
        return <path key={index} d={d} fill="none" stroke={item.drawMode === false ? '#fff' : String(item.strokeColor ?? '#1f2937')} strokeWidth={typeof item.strokeWidth === 'number' ? item.strokeWidth : 2} strokeLinecap="round" strokeLinejoin="round" />;
      })}
    </svg>
  );
}

function MathPreview({ data, width, height, backgroundUrl }: PreviewProps & { data: Record<string, unknown> }) {
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const project = ([x, y]: Pair): Pair => [((x + 10) / 20) * width, ((8 - y) / 16) * height];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={SVG_STYLE} role="img" aria-label="学生的数学作图作答">
      <defs><marker id="math-preview-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#365b82" /></marker></defs>
      <Background url={backgroundUrl} width={width} height={height} />
      {!backgroundUrl && Array.from({ length: 17 }, (_, index) => <line key={`h${index}`} x1="0" y1={(index / 16) * height} x2={width} y2={(index / 16) * height} stroke="#edf2f7" />)}
      {!backgroundUrl && Array.from({ length: 21 }, (_, index) => <line key={`v${index}`} x1={(index / 20) * width} y1="0" x2={(index / 20) * width} y2={height} stroke="#edf2f7" />)}
      {elements.map((rawElement, index) => {
        const item = row(rawElement);
        if (!item || typeof item.kind !== 'string') return null;
        if (item.kind === 'point') {
          const value = pair(item.p); if (!value) return null;
          const [x, y] = project(value);
          return <circle key={index} cx={x} cy={y} r="4" fill="#fff" stroke="#365b82" strokeWidth="2" />;
        }
        /*
          ★ 2026-10-06：新增的三种形状（教师端预览必须跟上 —— 少了它们，学生画的多边形/
          角/文字在**教师这里完全看不见**，而学生那边的画板上明明有）。
          坐标口径与画板完全一致：`data.elements` 里就是六种普通坐标数组。
        */
        if (item.kind === 'polyline') {
          const list = Array.isArray(item.points) ? item.points.map((point) => pair(point)) : [];
          const pts = list.filter((point): point is Pair => !!point).map((point) => project(point));
          if (pts.length < 2) return null;
          const d = pts.map(([x, y]) => `${x},${y}`).join(' ');
          return item.closed
            ? <polygon key={index} points={d} fill="none" stroke="#365b82" strokeWidth="2" />
            : <polyline key={index} points={d} fill="none" stroke="#365b82" strokeWidth="2" />;
        }
        if (item.kind === 'angle') {
          const vertex = pair(item.vertex); const armA = pair(item.a); const armB = pair(item.b);
          if (!vertex || !armA || !armB) return null;
          const [vx, vy] = project(vertex);
          const [ax, ay] = project(armA);
          const [bx, by] = project(armB);
          // 小弧：两条边各取 36px 处连线再绕顶点画（够用且不必算角度）。
          const shorten = (x: number, y: number): Pair => {
            const len = Math.hypot(x - vx, y - vy) || 1;
            return [vx + ((x - vx) / len) * 36, vy + ((y - vy) / len) * 36];
          };
          const [sa, sb] = [shorten(ax, ay), shorten(bx, by)];
          return (
            <g key={index}>
              <line x1={vx} y1={vy} x2={ax} y2={ay} stroke="#365b82" strokeWidth="2" />
              <line x1={vx} y1={vy} x2={bx} y2={by} stroke="#365b82" strokeWidth="2" />
              <polyline points={`${sa[0]},${sa[1]} ${sb[0]},${sb[1]}`} fill="none" stroke="#7895b3" strokeWidth="2" />
            </g>
          );
        }
        if (item.kind === 'label') {
          const at = pair(item.at); const text = typeof item.text === 'string' ? item.text : '';
          if (!at || !text) return null;
          const [x, y] = project(at);
          return <text key={index} x={x} y={y} fontSize="14" fontWeight="600" fill="#263b53" textAnchor="middle">{text}</text>;
        }
        const first = pair(item.kind === 'circle' ? item.center : item.a);
        const second = pair(item.kind === 'circle' ? item.edge : item.b);
        if (!first || !second) return null;
        const [x1, y1] = project(first); const [x2, y2] = project(second);
        if (item.kind === 'circle') return <circle key={index} cx={x1} cy={y1} r={Math.hypot(x2 - x1, y2 - y1)} fill="none" stroke="#365b82" strokeWidth="2" />;
        return <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#365b82" strokeWidth="2" markerEnd={item.kind === 'arrow' ? 'url(#math-preview-arrow)' : undefined} />;
      })}
    </svg>
  );
}

function MindBranch({ node }: { node: Record<string, unknown> }) {
  const children = Array.isArray(node.children) ? node.children.map(row).filter((item): item is Record<string, unknown> => !!item) : [];
  return <li><span>{String(node.topic ?? '主题')}</span>{children.length > 0 && <ul>{children.map((child, index) => <MindBranch key={String(child.id ?? index)} node={child} />)}</ul>}</li>;
}

/**
 * 思维导图**没有快照时**的近似渲染：把树退化成层级文字。
 *
 * ★ 2026-10-07（教师裁定 ②(a)）：**保持大纲，但要明写「近似预览」。**
 *
 * 🔴 为什么必须明写：这条回退与快照**不是同一张图** —— 没有布局、没有配色、没有分支形状
 *   （真正的图是 mind-elixir 渲出来再抓的那张位图，AI 联系表与 Word 报告用的也是它）。
 *   2026-10-06 教师报的「导图被画成了三行大纲文字」就是这个形状；那次只修到
 *   「有快照就先画快照」，而这一支**快照缺席时**仍然长得和信息完整的预览一模一样。
 * ⚠️ 而思维导图**比流程图更容易走到这一支**：它只在学生**动手**时才抓图
 *   （流程图挂载后无条件先抓一张），学生改完就离开题目 ⇒ 那张图永远不来。
 * ⚠️ 另一种走到这里的情形：值超过实时通道的预算时 `drawingPart` 会把矢量数据整个丢掉
 *   （只留位图）⇒ `nodeData` 不在 ⇒ 大纲是**空的**（这里会照实说一句，而不是留一个白框）。
 */
function MindPreview({ data, backgroundUrl }: PreviewProps & { data: Record<string, unknown> }) {
  const root = row(data.nodeData);
  return (
    <div style={{ minHeight: 180, padding: 16, overflow: 'auto', background: backgroundUrl ? `#fff url(${backgroundUrl}) center/100% 100% no-repeat` : '#fff', color: '#334b66', fontSize: 13 }} role="img" aria-label="学生的思维导图作答（近似预览）">
      {/* 🔴 这行字是这一支存在的理由的一半 —— 别为了「干净」删掉它：
          没有它，教师会把一张只有层级、没有布局与配色的图当成学生画的那张。 */}
      <div style={{ display: 'inline-block', marginBottom: 8, padding: '2px 7px', borderRadius: 5, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11 }}>
        近似预览（快照还没到）—— 布局与配色请以快照为准
      </div>
      {root
        ? <ul style={{ margin: 0, paddingLeft: 22 }}><MindBranch node={root} /></ul>
        : <div style={{ color: '#94a3b8' }}>这份作答的结构也还没拿到，稍后会自己更新。</div>}
    </div>
  );
}

export function DrawingDocumentPreview(props: PreviewProps) {
  const data = row(props.document.data) ?? {};
  /**
   * ★ 2026-10-06（教师截图批注）：「教师看板显示有点问题」—— 那张卡里，学生的导图被
   * 画成了**三行大纲文字**（中心主题 / 新主题 / 已经可以了），而不是一张导图。
   *
   * 下面那四个分支都是**近似**渲染（导图那条尤其粗糙：它是把树退化成 `<ul>`）——
   * 而客户端在改动停下来之后会抓一张**位图快照**（`drawing.image`，见
   * `worksheet-drawing-raster.ts`），服务端的 AI 分析与 Word 报告用的也正是那一张。
   * ⇒ **有快照就先画快照**：教师看到的、模型看到的、报告里印的，从此是同一张图。
   * ⚠️ 快照缺席（老作答、抓图失败）时才回到近似渲染 —— 那时至少有东西可看，
   *    而不是一片空白。
   */
  if (props.document.image) {
    return (
      <img
        src={worksheetAssetUrl(props.document.image)}
        alt="学生的作图作答（快照）"
        /* ★ 同上：宽度铺满、但**高度不许超过框**（超出时按比例收窄 ⇒ 整张图都看得见）。 */
        style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '100%', objectFit: 'contain', background: '#fff' }}
      />
    );
  }
  if (props.document.tool === 'math') return <MathPreview {...props} data={data} />;
  if (props.document.tool === 'mind-map') return <MindPreview {...props} data={data} />;
  /*
   * ★ 2026-10-07（教师）：「初始图没有一次性出来」「菱形被显示成矩形」——
   *   原来这里有**自己一套**近似渲染（只会画圆角矩形、也不含底稿）。
   * ✅ 现在与**快照共用同一个渲染器**（`flowchartPreviewImage` ⇒ `flowchartSvg`），
   *   输入是「底稿 + 学生画的」⇒ 与最终那张图长得一模一样，而且**只剩一套画法**。
   */
  if (props.document.tool === 'flowchart') {
    const src = flowchartPreviewImage(props.starter, data);
    return src
      ? <img src={src} alt="学生的流程图作答" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: '#fff' }} />
      : null;
  }
  return <BasicPreview {...props} data={data} />;
}
