'use client';

import type { DrawingDocument } from '@/lib/worksheet-drawing-document';

type Pair = [number, number];
type PreviewProps = {
  document: DrawingDocument;
  width: number;
  height: number;
  backgroundUrl: string | null;
};

const SVG_STYLE = { display: 'block', width: '100%', background: '#fff' } as const;

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

function FlowPreview({ data, width, height, backgroundUrl }: PreviewProps & { data: Record<string, unknown> }) {
  const nodes = (Array.isArray(data.nodes) ? data.nodes : []).map(row).filter((item): item is Record<string, unknown> => !!item);
  const edges = (Array.isArray(data.edges) ? data.edges : []).map(row).filter((item): item is Record<string, unknown> => !!item);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const positions = nodes.map((node) => row(node.position)).filter((item): item is Record<string, unknown> => !!item);
  const maxX = Math.max(500, ...positions.map((position) => typeof position.x === 'number' ? position.x + 190 : 0));
  const maxY = Math.max(360, ...positions.map((position) => typeof position.y === 'number' ? position.y + 130 : 0));
  return (
    <svg viewBox={`0 0 ${maxX} ${maxY}`} style={{ ...SVG_STYLE, aspectRatio: `${width}/${height}` }} role="img" aria-label="学生的流程图作答">
      <Background url={backgroundUrl} width={maxX} height={maxY} />
      {edges.map((edge, index) => {
        const source = byId.get(String(edge.source)); const target = byId.get(String(edge.target));
        const a = row(source?.position); const b = row(target?.position);
        if (!a || !b || typeof a.x !== 'number' || typeof a.y !== 'number' || typeof b.x !== 'number' || typeof b.y !== 'number') return null;
        return <line key={index} x1={a.x + 75} y1={a.y + 32} x2={b.x + 75} y2={b.y + 32} stroke="#607d9e" strokeWidth="2" />;
      })}
      {nodes.map((node, index) => {
        const position = row(node.position); const nodeData = row(node.data);
        if (!position || !nodeData || typeof position.x !== 'number' || typeof position.y !== 'number') return null;
        const kind = String(nodeData.kind ?? 'process'); const x = position.x; const y = position.y;
        return <g key={String(node.id ?? index)} transform={`translate(${x} ${y})`}><rect width="150" height="64" rx={kind === 'terminator' ? 32 : 9} fill="#fff" stroke="#7895b3" strokeWidth="2" /><text x="75" y="34" dominantBaseline="middle" textAnchor="middle" fill="#263b53" fontSize="14" fontWeight="600">{String(nodeData.label ?? '')}</text></g>;
      })}
    </svg>
  );
}

function MindBranch({ node }: { node: Record<string, unknown> }) {
  const children = Array.isArray(node.children) ? node.children.map(row).filter((item): item is Record<string, unknown> => !!item) : [];
  return <li><span>{String(node.topic ?? '主题')}</span>{children.length > 0 && <ul>{children.map((child, index) => <MindBranch key={String(child.id ?? index)} node={child} />)}</ul>}</li>;
}

function MindPreview({ data, backgroundUrl }: PreviewProps & { data: Record<string, unknown> }) {
  const root = row(data.nodeData);
  return <div style={{ minHeight: 180, padding: 16, overflow: 'auto', background: backgroundUrl ? `#fff url(${backgroundUrl}) center/100% 100% no-repeat` : '#fff', color: '#334b66', fontSize: 13 }} role="img" aria-label="学生的思维导图作答"><ul style={{ margin: 0, paddingLeft: 22 }}>{root && <MindBranch node={root} />}</ul></div>;
}

export function DrawingDocumentPreview(props: PreviewProps) {
  const data = row(props.document.data) ?? {};
  if (props.document.tool === 'math') return <MathPreview {...props} data={data} />;
  if (props.document.tool === 'mind-map') return <MindPreview {...props} data={data} />;
  if (props.document.tool === 'flowchart') return <FlowPreview {...props} data={data} />;
  return <BasicPreview {...props} data={data} />;
}
