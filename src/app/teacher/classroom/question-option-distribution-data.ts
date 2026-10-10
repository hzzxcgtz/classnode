export function selectionRate(count: number, total: number): number {
  return total > 0 ? Math.round(count / total * 100) : 0;
}

/** 前三种之外必须计入其他，不能把截断后的计数重新当成全班比例。 */
export function combinationSlices(combos: ReadonlyArray<{ label: string; count: number }>, total: number, otherLabel = '其他组合', emptyLabel = '未选选项') {
  if (combos.length === 0) return [];
  const slices = combos.map(combo => ({ ...combo, label: combo.label || emptyLabel }));
  const remainder = total - slices.reduce((sum, combo) => sum + combo.count, 0);
  if (remainder > 0) slices.push({ label: otherLabel, count: remainder });
  return slices;
}
