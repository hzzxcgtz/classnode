const studentNumberCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

/** 学号自然排序；有学号的在前，缺失学号时用姓名保持稳定顺序。 */
export function compareStudentNumbers(
  leftNo: string | null | undefined,
  rightNo: string | null | undefined,
  leftName = '',
  rightName = '',
): number {
  const left = leftNo?.trim() || '';
  const right = rightNo?.trim() || '';
  if (left && right) {
    const byNumber = studentNumberCollator.compare(left, right);
    if (byNumber !== 0) return byNumber;
  } else if (left) {
    return -1;
  } else if (right) {
    return 1;
  }
  return leftName.localeCompare(rightName, 'zh-CN');
}
