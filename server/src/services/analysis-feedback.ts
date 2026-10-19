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
}
type Entry = { studentId: string; anonLabel: string };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function feedbackInstruction(entries: readonly Entry[], includeStyle = true): string {
  return [
    '【班级问题名单与个人建议】所有题型均需返回，与 AI 评分开关无关。',
    `反馈名单（完整标签必须逐字复制）：${entries.map(entry => entry.anonLabel).join('、')}`,
    '典型表现用名单链接关联学生：[相关同学](#classnode-group-g1) 或 [优秀作答同学](#classnode-group-g2)。groups 中按对应 id 返回准确的完整标签，单人实例只关联作者，不与问题名单混用；开放表达与信息收集也可用相关同学关联观点。同一发现或类别只用一个整组 Markdown 链接：12名学生放进同一个 group，不要逐人并排输出12个链接。单人实例才用单人链接，不嵌套、不在括号重复名单。班级正文不直接写姓名或学号，系统计算称呼和人数；对于选项或内容分类的汇总，每类正文明确标注N人，并关联该类完整名单，N必须与去重后的名单长度一致；身份不清时不猜，没必要时 groups 返回空数组。',
    '每一种具体表现分别使用独立的 group id，名单只包含确实符合该表现的学生；不同选项、不同错误、单人实例不得共用全班名单。多选题中“选 D”与“只选 D”必须分别核对，“只选 D”要求该学生的完整选择集合仅含 D；人数和比例以实际作答统计为准，不凭印象写多数或少数。举例名单仅列对应实例，不能用全体反馈名单代替。',
    '每位反馈名单学生必须在 students 中返回一条个性化 advice，不漏人、不重复；建议依据该学生实际作答。评分仅按另行提供的评分协议返回，不在这个数据块中填写分数。',
    ...(includeStyle ? [STUDENT_FEEDBACK_STYLE] : []),
    '每位学生只写一份个人建议；同一学生同时出现在反馈块和评分块时，两个 advice 必须逐字一致，先形成个人建议，再复制到评分块，不分别生成。',
    '在 Markdown 报告之后追加以下数据块（格式示意，示例标签必须换成本次真实标签）：',
    FEEDBACK_START,
    '{"groups":[{"id":"g1","students":["张伟#7"]}],"students":[{"student":"张伟#7","advice":"针对该学生实际作答的一条具体小建议"}]}',
    FEEDBACK_END,
    '报告各段标题必须使用 ### Markdown 标题。典型表现对应名单与个人反馈是数据协议说明，不是正文小节，不输出这两个标题。所有 groups 和 students 只放在 classnode-feedback 起止标签内，禁止裸 JSON 或把数据块放进引用段落。若另需评分数据块，两种数据块都返回。',
  ].join('\n');
}

export function parseAnalysisFeedback(raw: string, entries: readonly Entry[]): { narrative: string; feedback: AnalysisFeedback } {
  // 这一阶段仅提取反馈，评分留给同一条链路的评分解析器。
  const separated = extractAnalysisProtocol(raw, ['feedback']);
  const blocks = separated.blocks;
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
  const received = new Set(students.map(row => row.studentId));
  return { narrative, feedback: { version: 1, groups, students, missing: entries.filter(entry => !received.has(entry.studentId)).map(entry => entry.studentId) } };
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
  return { version: 1, groups, students, missing: studentIds.filter(id => !received.has(id)) };
}

export function mergeAnalysisFeedback(old: AnalysisFeedback | null, next: AnalysisFeedback, studentIds: readonly string[], scoped: boolean): AnalysisFeedback {
  const students = scoped ? new Map((old?.students ?? []).map(row => [row.studentId, row])) : new Map<string, AnalysisFeedback['students'][number]>();
  for (const row of next.students) students.set(row.studentId, row);
  const rows = studentIds.flatMap(id => students.has(id) ? [students.get(id)!] : []);
  return { version: 1, groups: scoped ? old?.groups ?? [] : next.groups, students: rows, missing: studentIds.filter(id => !students.has(id)) };
}
