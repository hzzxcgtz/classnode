import { STUDENT_FEEDBACK_STYLE } from './analysis-teaching-policy.js';
import { extractAnalysisProtocol, analysisProtocolJson } from './analysis-protocol.js';
/** 独立于成绩的班级问题名单与逐生建议。只接受本次名单中的完整标签。 */
export const FEEDBACK_START = '<classnode-feedback>';
export const FEEDBACK_END = '</classnode-feedback>';
export interface AnalysisFeedback {
  version: 1;
  groups: Array<{ id: string; studentIds: string[] }>;
  students: Array<{ studentId: string; advice: string }>;
  missing: string[];
  wordCloud?: Array<{ phrase: string; studentIds: string[] }>;
}
type Entry = { studentId: string; anonLabel: string };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const MAX_CLOUD_OPINIONS = 500; // Defensive protocol bound, independent of the ten-item display limit.

export function wordCloudRequirementsOf(node: { type: string; data: Record<string, unknown> }): string {
  const value = node.data.wordCloudRequirements;
  return (node.type === 'short-answer' || node.type === 'open-ended' || node.type === 'rating') && typeof value === 'string'
    ? value.trim().slice(0, 1200)
    : '';
}

export function wordCloudInstruction(requirements = ''): string {
  return [
    '在 classnode-feedback JSON 中追加 wordCloud 数组。每项包含 phrase（自然通顺、能独立读懂的观点短句）和 students（支持该观点的全部学生完整标签）。同一观点内按学生去重，仅一人提出的观点也须保留，系统按名单计算人数。按提及人数从多到少排序，不判断观点好坏。',
    '措辞优先清楚、自然、忠实原意，通常用 8–18 字，必要时可到 30 字。保留必要的动词、介词和连接词，不为凑字数删成生硬的词语堆叠，不拼接多条独立观点。即使教师要求更短，也优先保证语句通顺和原意完整。',
    '区分观察与建议：原文肯定的做法写清实际表现，建议保留“建议”“可”等语气，不把改进建议改写成已经发生的事实。表达润色不得新增原文没有的效果、原因或评价，也不得改变对应学生名单。',
    '表述示例（只示范语法，不能当作作答证据）：“反馈明确修改方向”可写为“反馈能指出修改方向”；“补充异情境检测任务”可写为“建议补充不同情境的检测任务”。输出前逐条检查搭配是否自然、意思是否明确、立场是否忠实。',
    '依据可辨认的学生作答或已确认的作答记录提炼。合并意思相近的表达，分别保留不同立场。不从题干、评分标准、分数或教师建议推断学生观点。',
    requirements
      ? `教师本题的观点提炼要求（仅用于 wordCloud）：${JSON.stringify(requirements)}。按其关注方向提炼，语句须符合上述自然表达规则。若其中限制条数或排除单人观点，以本协议的完整保留规则为准。`
      : '尽可能完整提炼有作答依据的不同观点，包括单人观点。不要为了凑数拆分近义观点。',
    `最多 ${MAX_CLOUD_OPINIONS} 条（协议安全上限）；按证据返回实际条数，没有可辨认观点时返回空数组。不要按云的展示容量截断结果：界面按人数仅展示前10条，全部观点保留在列表。提炼要求不影响正文。`,
  ].join('\n');
}

function readWordCloud(raw: unknown, resolveId: (value: string) => string | undefined): NonNullable<AnalysisFeedback['wordCloud']> {
  const result: NonNullable<AnalysisFeedback['wordCloud']> = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const row = object(value);
    const phrase = typeof row.phrase === 'string' ? row.phrase.trim().replace(/\s+/g, ' ') : '';
    const key = phrase.toLowerCase();
    if (phrase.length < 2 || phrase.length > 30 || !Array.isArray(row.students)) continue;
    const ids = row.students.map(label => typeof label === 'string' ? resolveId(label) : undefined);
    if (!ids.length || ids.some(id => !id)) continue;
    const previous = seen.has(key) ? result.find(item => item.phrase.toLowerCase() === key) : undefined;
    if (previous) previous.studentIds = [...new Set([...previous.studentIds, ...ids as string[]])];
    else result.push({ phrase, studentIds: [...new Set(ids as string[])] });
    seen.add(key);
  }
  return result.sort((a, b) => b.studentIds.length - a.studentIds.length).slice(0, MAX_CLOUD_OPINIONS);
}

export function feedbackInstruction(entries: readonly Entry[], includeStyle = true, classReportOnly = false): string {
  return [
    classReportOnly ? '【班级分析】只分析本次提交的作答，保留已有个人评价和评分。students 返回空数组，不返回评分块。' : '【班级问题名单与个人建议】与 AI 评分开关无关。',
    `反馈名单（完整标签必须逐字复制）：${entries.map(entry => entry.anonLabel).join('、')}`,
    '用 [相关同学](#classnode-group-g1) 关联典型表现。每类使用独立 group id，groups 仅包含符合该类的完整标签。按实际去重人数统计，多选区分选择与仅选。正文不列姓名和学号，单人实例只关联作者，无可靠名单时 groups 返回空数组。',
    ...(!classReportOnly ? [
      '每位反馈名单学生在 students 中只返回一条有作答依据的 advice。评分按另行提供的协议返回。',
      ...(includeStyle ? [STUDENT_FEEDBACK_STYLE] : []),
    ] : []),
    '在 Markdown 报告之后追加以下数据块（格式示意，示例标签必须换成本次真实标签）：',
    FEEDBACK_START,
    classReportOnly ? '{"groups":[{"id":"g1","students":["张伟#7"]}],"students":[]}'
      : '{"groups":[{"id":"g1","students":["张伟#7"]}],"students":[{"student":"张伟#7","advice":"针对该学生实际作答的一条具体小建议"}]}',
    FEEDBACK_END,
    '正文默认使用 ### Markdown 小节标题，教师明确指定正文形式时按本题要求。典型表现对应名单与个人反馈是数据协议说明，不是正文小节。所有 groups 和 students 只放在 classnode-feedback 起止标签内，禁止裸 JSON 或把数据块放进引用段落。若另需评分数据块，两种数据块都返回。',
  ].join('\n');
}

export function parseAnalysisFeedback(raw: string, entries: readonly Entry[], includeWordCloud = false, wordCloudEvidence?: ReadonlySet<string>): { narrative: string; feedback: AnalysisFeedback } {
  // 这一阶段仅提取反馈，评分留给同一条链路的评分解析器。
  const separated = extractAnalysisProtocol(raw, ['feedback', 'word-cloud']);
  const blocks = separated.blocks.filter(block => block.kind === 'feedback');
  const cloudBlocks = separated.blocks.filter(block => block.kind === 'word-cloud');
  const narrative = separated.narrative;
  const data = blocks.length === 1 ? object(analysisProtocolJson(blocks[0].body)) : {};
  const labelCount = new Map<string, number>();
  for (const entry of entries) labelCount.set(entry.anonLabel, (labelCount.get(entry.anonLabel) ?? 0) + 1);
  const labels = new Map(entries.filter(entry => labelCount.get(entry.anonLabel) === 1).map(entry => [entry.anonLabel, entry.studentId]));
  const groupRows = Array.isArray(data.groups) ? data.groups.slice(0, 20) : [];
  const idCount = new Map<string, number>();
  for (const value of groupRows) { const id = object(value).id; if (typeof id === 'string') idCount.set(id, (idCount.get(id) ?? 0) + 1); }
  const groups: AnalysisFeedback['groups'] = [];
  for (const value of groupRows) {
    const row = object(value);
    if (typeof row.id !== 'string' || !/^g[1-9]\d{0,2}$/.test(row.id) || idCount.get(row.id) !== 1 || !Array.isArray(row.students) || row.students.length === 0) continue;
    const ids = row.students.map(label => typeof label === 'string' ? labels.get(label) : undefined);
    // 任一身份无法核对就拒绝该组，不把“部分核对成功”误当完整名单。
    if (ids.some(id => id === undefined)) continue;
    groups.push({ id: row.id, studentIds: [...new Set(ids as string[])] });
  }
  const rows = Array.isArray(data.students) ? data.students : [];
  const counts = new Map<string, number>();
  for (const value of rows) { const label = object(value).student; if (typeof label === 'string') counts.set(label, (counts.get(label) ?? 0) + 1); }
  const students: AnalysisFeedback['students'] = [];
  for (const value of rows) {
    const row = object(value), id = typeof row.student === 'string' ? labels.get(row.student) : undefined;
    if (!id || counts.get(row.student as string) !== 1 || typeof row.advice !== 'string' || !row.advice.trim()) continue;
    students.push({ studentId: id, advice: row.advice.trim().slice(0, 1200) });
  }
  const resolveLabel = (label: string) => {
    const id = labels.get(label);
    return id && (!wordCloudEvidence || wordCloudEvidence.has(id)) ? id : undefined;
  };
  const wordCloud = includeWordCloud ? readWordCloud(data.wordCloud, resolveLabel) : undefined;
  if (wordCloud && !wordCloud.length && cloudBlocks.length === 1) {
    wordCloud.push(...readWordCloud(object(analysisProtocolJson(cloudBlocks[0].body)).wordCloud, resolveLabel));
  }
  const received = new Set(students.map(row => row.studentId));
  return { narrative, feedback: { version: 1, groups, students, ...(wordCloud ? { wordCloud } : {}), missing: entries.filter(entry => !received.has(entry.studentId)).map(entry => entry.studentId) } };
}

/** 旧结果没有此字段则返回 null；读取时也按当前题目参与者范围核对。 */
export function readAnalysisFeedback(raw: unknown, studentIds: readonly string[]): AnalysisFeedback | null {
  const data = object(object(raw).analysisFeedback);
  if (data.version !== 1) return null;
  const allowed = new Set(studentIds);
  const groups: AnalysisFeedback['groups'] = [];
  for (const value of Array.isArray(data.groups) ? data.groups : []) {
    const row = object(value);
    if (typeof row.id !== 'string' || !/^g[1-9]\d{0,2}$/.test(row.id) || !Array.isArray(row.studentIds) || row.studentIds.length === 0 || !row.studentIds.every(id => typeof id === 'string' && allowed.has(id))) continue;
    if (groups.some(group => group.id === row.id)) continue;
    groups.push({ id: row.id, studentIds: [...new Set(row.studentIds as string[])] });
  }
  const students: AnalysisFeedback['students'] = [];
  for (const value of Array.isArray(data.students) ? data.students : []) {
    const row = object(value);
    if (typeof row.studentId !== 'string' || !allowed.has(row.studentId) || students.some(student => student.studentId === row.studentId) || typeof row.advice !== 'string' || !row.advice.trim()) continue;
    students.push({ studentId: row.studentId, advice: row.advice.slice(0, 1200) });
  }
  const received = new Set(students.map(row => row.studentId));
  const wordCloud = Array.isArray(data.wordCloud)
    ? readWordCloud(data.wordCloud.map(value => ({ phrase: object(value).phrase, students: object(value).studentIds })), id => allowed.has(id) ? id : undefined)
    : undefined;
  return { version: 1, groups, students, ...(wordCloud ? { wordCloud } : {}), missing: studentIds.filter(id => !received.has(id)) };
}

export function mergeAnalysisFeedback(old: AnalysisFeedback | null, next: AnalysisFeedback, studentIds: readonly string[], scoped: boolean): AnalysisFeedback {
  const students = scoped ? new Map((old?.students ?? []).map(row => [row.studentId, row])) : new Map<string, AnalysisFeedback['students'][number]>();
  for (const row of next.students) students.set(row.studentId, row);
  const rows = studentIds.flatMap(id => students.has(id) ? [students.get(id)!] : []);
  const wordCloud = scoped ? old?.wordCloud : next.wordCloud;
  return { version: 1, groups: scoped ? old?.groups ?? [] : next.groups, students: rows, ...(wordCloud ? { wordCloud } : {}), missing: studentIds.filter(id => !students.has(id)) };
}
