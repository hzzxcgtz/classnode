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

const MAX_CLOUD_OPINIONS = 10;

export const WORD_CLOUD_INSTRUCTION = [
  '在同一个 classnode-feedback JSON 对象中追加 wordCloud 数组。每项包含 phrase（共同观点的简短表述）和 students（支持该观点的全部学生完整标签）。观点云名单按全班原答核对，与报告正文的举例名单分开整理。',
  '先通读本题全部文字原答，找出每份作答想解决的问题或表达的主张。围绕题目把解决同一问题、方向一致的作答归到一起。比如“器材不够就轮流”“借用前先登记”“用完放回借用盒”可归为“让课间器材有序共享”。具体做法留在正文。相反立场或会改变主张的条件分别保留，避免笼统归成“活动安排”等主题名称。',
  '整理后逐条重查全班原答，补齐所有确实表达该观点的学生，同一观点内按学生去重。一份作答明确表达多个不同观点时，可归入多条。每条至少两人支持，这是入选门槛；名单没有固定长度，不能只列两名例子、给各条配相同人数，或为凑人数加入无关作答。系统按名单计数，人数相同也按实际名单返回。',
  '核对名单后，优先保留与题目最相关、能代表共同诉求的 4–6 条，通常不超过 8 条，最多 10 条。依据不足时可以更少，只有一条就只返回一条，没有就返回空数组。用便于投屏的短句概括，避免重复、空话、姓名和学号。',
].join('\n');

function readWordCloud(raw: unknown, resolveId: (value: string) => string | undefined): NonNullable<AnalysisFeedback['wordCloud']> {
  const result: NonNullable<AnalysisFeedback['wordCloud']> = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const row = object(value);
    const phrase = typeof row.phrase === 'string' ? row.phrase.trim().replace(/\s+/g, ' ') : '';
    const key = phrase.toLowerCase();
    if (phrase.length < 2 || phrase.length > 30 || seen.has(key) || !Array.isArray(row.students)) continue;
    const ids = row.students.map(label => typeof label === 'string' ? resolveId(label) : undefined);
    if (!ids.length || ids.some(id => !id)) continue;
    result.push({ phrase, studentIds: [...new Set(ids as string[])] });
    seen.add(key);
  }
  return result.sort((a, b) => b.studentIds.length - a.studentIds.length).slice(0, MAX_CLOUD_OPINIONS);
}

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

export function parseAnalysisFeedback(raw: string, entries: readonly Entry[], includeWordCloud = false): { narrative: string; feedback: AnalysisFeedback } {
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
  const resolveLabel = (label: string) => labels.get(label);
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
