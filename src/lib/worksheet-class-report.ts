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
  let content = text;
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
