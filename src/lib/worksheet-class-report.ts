import { extractAnalysisProtocol, analysisProtocolJson } from '../../server/src/services/analysis-protocol.ts';

/** 兼容历史报告里的显式姓名：正文隐藏，只有能唯一对应名单时提供悬停名单。 */
export function classReportContent(text: string, entries: readonly { studentId: string; anonLabel: string }[], names: Record<string, string>) {
  const replacements = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const label of [entry.anonLabel, names[entry.studentId]].filter(Boolean)) {
      const ids = replacements.get(label) ?? new Set<string>(); ids.add(entry.studentId); replacements.set(label, ids);
    }
  }
  const groups: Array<{ id: string; studentIds: string[] }> = [];
  const slots: string[] = [];
  // 必须先隔离机器数据，再做姓名链接替换，避免把 JSON 内的 student 字段改成 Markdown。
  const separated = extractAnalysisProtocol(text);
  let content = separated.narrative;
  const feedbackBlocks = separated.blocks.filter(block => block.kind === 'feedback');
  if (feedbackBlocks.length === 1) {
    const parsed = analysisProtocolJson(feedbackBlocks[0].body) as { groups?: unknown } | null;
    const rows = Array.isArray(parsed?.groups) ? parsed.groups.slice(0, 20) : [];
    const labels = new Map(entries.map(entry => [entry.anonLabel, entries.filter(item => item.anonLabel === entry.anonLabel).map(item => item.studentId)]));
    const counts = new Map<string, number>();
    for (const row of rows) if (typeof row?.id === 'string') counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    for (const row of rows) {
      if (typeof row?.id !== 'string' || !/^g[1-9]\d{0,2}$/.test(row.id) || counts.get(row.id) !== 1 || !Array.isArray(row.students) || !row.students.length) continue;
      const ids = row.students.map((label: unknown) => typeof label === 'string' ? labels.get(label) : undefined);
      if (ids.some((ids: string[] | undefined) => ids?.length !== 1)) continue;
      groups.push({ id: row.id, studentIds: [...new Set(ids.map((ids: string[]) => ids[0]))] as string[] });
    }
  }
  // 已有名单链接必须整体隔离；替换链接标题里的姓名会生成嵌套链接，露出内部地址。
  content = content.replace(/\[[^\]\n]*\]\(#classnode-group-[\w-]+\)/g, link => {
    const marker = `\uE000${slots.length}\uE001`;
    slots.push(link);
    return marker;
  });
  // 只移除名单链接后纯粹重复列姓名的括号，保留带作答依据等实质内容的括号。
  content = content.replace(/(\uE000\d+\uE001)[ \t]*[（(]([^()（）\n]*)[）)]/g, (whole, marker: string, list: string) => {
    let remainder = list.replace(/\uE000\d+\uE001/g, '');
    for (const label of [...replacements.keys()].sort((a, b) => b.length - a.length)) {
      remainder = remainder.split(label).join('');
    }
    return remainder.replace(/[\s、，,；;和与及等]/g, '') === '' ? marker : whole;
  });
  // 先替换完整标签，避免姓名把“姓名#学号”切开。占位符避免新链接又被姓名替换。
  for (const [label, ids] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    if (!content.includes(label)) continue;
    const marker = `\uE000${slots.length}\uE001`;
    if (ids.size === 1) {
      const id = `legacy${groups.length + 1}`;
      groups.push({ id, studentIds: [...ids] });
      slots.push(`[相关同学](#classnode-group-${id})`);
    } else slots.push('某位同学（身份待核实）');
    content = content.split(label).join(marker);
  }
  content = content.replace(/\uE000(\d+)\uE001/g, (_, index: string) => slots[Number(index)] ?? '相关同学');
  return { text: content, groups };
}

/** 中文姓名保留常见复姓；外文、混合名称用完整名称，避免臆造姓氏。 */
export function reportStudentLabel(names: readonly string[]): string {
  const name = names[0]?.trim() ?? '';
  if (!name) return '相关同学';
  const compound = ['欧阳', '司马', '上官', '诸葛', '夏侯', '东方', '皇甫', '尉迟', '公孙', '慕容', '令狐', '宇文', '长孙', '司徒', '司空', '南宫', '端木', '独孤', '钟离', '澹台', '申屠', '公羊', '闻人', '赫连', '百里', '东郭', '呼延', '万俟', '仲孙', '宗政', '濮阳', '太史', '公冶', '公良', '段干', '闾丘', '第五'];
  const surname = /^[\p{Script=Han}]+$/u.test(name)
    ? compound.find(prefix => name.startsWith(prefix)) ?? Array.from(name)[0]
    : name;
  return `${surname}同学${names.length > 1 ? '等' : ''}`;
}
