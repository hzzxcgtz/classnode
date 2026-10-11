/** 纯文本协议分离；服务端解析与教师端旧报告清理共用，禁止依赖数据库或 Node API。 */
export type AnalysisProtocolKind = 'scores' | 'feedback';
export interface AnalysisProtocolBlock { kind: AnalysisProtocolKind; body: string }

function jsonEnd(text: string, start: number): number {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && --depth === 0) return i + 1;
  }
  return text.length;
}

export function analysisProtocolJson(body: string): unknown {
  // AI 可能把机器块包进代码围栏或逐行引用；只在机器数据内部解除包装。
  const text = body.replace(/^\s*>[ \t]?/gm, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch { return null; }
}

/** 完整、转义、缺结束标签及裸 JSON 都从正文隔离；无效数据不尝试猜补分数或身份。 */
export function extractAnalysisProtocol(source: string, kinds: readonly AnalysisProtocolKind[] = ['scores', 'feedback']) {
  const allowed = new Set(kinds);
  const blocks: AnalysisProtocolBlock[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  const tags = [...source.matchAll(/(?:\\?<|&lt;)\s*(\\?\/)?classnode-(scores|feedback)\s*(?:\\?>|&gt;)/gi)];
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index], kind = tag[2].toLowerCase() as AnalysisProtocolKind;
    if (!allowed.has(kind)) continue;
    if (tag[1]) { ranges.push({ start: tag.index!, end: tag.index! + tag[0].length }); continue; }
    const next = tags[index + 1];
    const closed = next && next[1] && next[2].toLowerCase() === kind;
    const start = tag.index!, bodyStart = start + tag[0].length;
    let bodyEnd = next?.index ?? source.length;
    if (!closed) {
      const body = source.slice(bodyStart, bodyEnd);
      const json = body.search(/\{\s*"(?:scores|groups|students)"\s*:/);
      if (json >= 0) {
        const end = jsonEnd(body, json);
        // 缺结束标签但 JSON 完整时，保留之后的讲评文字；不补写数据。
        if (analysisProtocolJson(body.slice(0, end))) bodyEnd = bodyStart + end;
      }
    }
    blocks.push({ kind, body: source.slice(bodyStart, bodyEnd) });
    ranges.push({ start, end: closed ? bodyEnd + next[0].length : bodyEnd });
    if (closed) index++;
  }
  let narrative = source;
  for (const range of ranges.sort((a, b) => b.start - a.start)) narrative = narrative.slice(0, range.start) + narrative.slice(range.end);

  // 只接受根对象以协议字段开头的裸 JSON，普通教学文字、示例代码和计算式保持原样。
  const bare = /\{\s*"(scores|groups|students)"\s*:/g;
  const bareRanges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = bare.exec(narrative))) {
    const kind: AnalysisProtocolKind = match[1] === 'scores' ? 'scores' : 'feedback';
    const end = jsonEnd(narrative, match.index);
    if (allowed.has(kind)) {
      blocks.push({ kind, body: narrative.slice(match.index, end) });
      bareRanges.push({ start: match.index, end });
    }
    bare.lastIndex = end;
  }
  for (const range of bareRanges.reverse()) narrative = narrative.slice(0, range.start) + narrative.slice(range.end);
  if (blocks.length) {
    // 数据专属标题及数据被抽走后的空围栏不能留在报告里。
    narrative = narrative.replace(/^\s*(?:>\s*)?(?:#{1,6}\s*|\*\*)?(?:[一二三四五六七八九十\d]+[、.．]\s*)?(?:典型表现对应名单|个人反馈|逐生评分|逐生评分结果|AI 评分数据|评分数据)(?:\*\*)?[：:]?\s*$/gm, '')
      .replace(/^[ \t>]*```(?:json)?[ \t]*\n[\s>]*?```[ \t]*$/gm, '');
  }
  return { narrative: narrative.trim(), blocks };
}
