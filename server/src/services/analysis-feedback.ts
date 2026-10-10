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

export function feedbackInstruction(entries: readonly Entry[]): string {
  return [
    '【班级问题名单与个人建议】所有题型均需返回，与 AI 评分开关无关。',
    `反馈名单（完整标签必须逐字复制）：${entries.map(entry => entry.anonLabel).join('、')}`,
    '报告采用所配置学科与学段的五段结构：核心结论、典型表现与作答依据、关键认识或方法、课堂讲评或活动方案、讲评后检查；标题随学科和题型调整，简单题可以合并。典型问题与优秀回答都用名单链接关联学生：问题旁可写 [相关同学](#classnode-group-g1)，优秀实例旁可写 [优秀作答同学](#classnode-group-g2)，在 groups 中填写各自作者或相关学生的完整标签，每组 id 唯一。单人优秀实例只关联该作者，不与问题名单混用；引用真实作答并说明亮点，不把润色冒充原话，无法确认作者时不猜。不要在班级正文直接写姓名、学号或可识别的个人错误；人数由系统根据有效名单显示，悬停查看姓名，不自行计数。没有需记录的名单时 groups 返回空数组，不强行分组。',
    '每位反馈名单学生必须在 students 中返回一条个性化 advice，不漏人、不重复；建议依据该学生实际作答。评分仅按另行提供的评分协议返回，不在这个数据块中填写分数。',
    '评价 reason 和小建议 advice 都直接说给学生听，统一用“你”称呼，保持温柔、耐心、尊重、以鼓励为主的口吻。先肯定真实表现，再给一个容易做到的下一步和检查方法；不责备、不比较、不贴标签、不用训斥或命令语气，不空泛夸奖或编造优点。建议要承接评价，评分仍严格依据标准，不能为鼓励而虚增分数。',
    '每位学生只写一份个人建议；同一学生同时出现在反馈块和评分块时，两个 advice 必须逐字一致，先形成个人建议，再复制到评分块，不分别生成。',
    '在 Markdown 报告之后追加以下数据块（格式示意，示例标签必须换成本次真实标签）：',
    FEEDBACK_START,
    '{"groups":[{"id":"g1","students":["张伟#7"]}],"students":[{"student":"张伟#7","advice":"针对该学生实际作答的一条具体小建议"}]}',
    FEEDBACK_END,
    '数据块仅放合法 JSON，不加代码围栏。若另需评分数据块，两种数据块都返回。',
  ].join('\n');
}

export function parseAnalysisFeedback(raw: string, entries: readonly Entry[]): { narrative: string; feedback: AnalysisFeedback } {
  const blocks = [...raw.matchAll(/<classnode-feedback>([\s\S]*?)<\/classnode-feedback>/g)];
  const narrative = raw.replace(/<classnode-feedback>[\s\S]*?<\/classnode-feedback>/g, '').replace(/<classnode-feedback>[\s\S]*$/, '').trim();
  let data: Record<string, unknown> = {};
  if (blocks.length === 1) { try { data = object(JSON.parse(blocks[0][1])); } catch { /* 不猜名单；报告与有效评分仍可保留。 */ } }
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
