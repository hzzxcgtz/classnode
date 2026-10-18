/** 学习单教学对象；服务端有无依赖镜像，由对拍测试保证一致。 */
export const WORKSHEET_GRADES = [
  { value: 1, label: '小学一年级', stage: '小学' },
  { value: 2, label: '小学二年级', stage: '小学' },
  { value: 3, label: '小学三年级', stage: '小学' },
  { value: 4, label: '小学四年级', stage: '小学' },
  { value: 5, label: '小学五年级', stage: '小学' },
  { value: 6, label: '小学六年级', stage: '小学' },
  { value: 7, label: '初中七年级', stage: '初中' },
  { value: 8, label: '初中八年级', stage: '初中' },
  { value: 9, label: '初中九年级', stage: '初中' },
] as const;
export const WORKSHEET_SUBJECTS = ['语文', '数学', '英语', '科学', '信息科技', '道德与法治', '历史', '地理', '物理', '化学', '生物学', '音乐', '美术', '体育与健康', '劳动', '综合实践', '其他学科'] as const;

function sourceOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

export function normalizeWorksheetCurriculum(raw: unknown): { gradeLevel?: number | null; subject?: string | null } {
  const source = sourceOf(raw);
  return {
    ...(source.gradeLevel !== undefined ? { gradeLevel: WORKSHEET_GRADES.some(grade => grade.value === source.gradeLevel) ? source.gradeLevel as number : null } : {}),
    ...(source.subject !== undefined ? { subject: typeof source.subject === 'string' && WORKSHEET_SUBJECTS.some(subject => subject === source.subject) ? source.subject : null } : {}),
  };
}

/** 编辑器必填；API 允许完全未提供新字段的旧客户端，显式填写时必须完整有效。 */
export function worksheetCurriculumError(raw: unknown, required = true): string | null {
  const source = sourceOf(raw);
  if (!required && source.gradeLevel === undefined && source.subject === undefined) return null;
  const curriculum = normalizeWorksheetCurriculum(source);
  if (!curriculum.gradeLevel && !curriculum.subject) return '请在学习单设置中选择适用年级和学科';
  if (!curriculum.gradeLevel) return '请在学习单设置中选择适用年级';
  if (!curriculum.subject) return '请在学习单设置中选择学科';
  return null;
}

export function worksheetCurriculumContext(raw: unknown): string {
  const curriculum = normalizeWorksheetCurriculum(raw);
  const grade = WORKSHEET_GRADES.find(item => item.value === curriculum.gradeLevel);
  return `适用年级：${grade?.label ?? '未填写，不根据标题或班名推测'}\n适用学段：${grade?.stage ?? '未填写'}\n学科：${curriculum.subject ?? '未填写，不根据标题推测'}`;
}

export function worksheetTemplateRecommendation(raw: unknown): string | null {
  const curriculum = normalizeWorksheetCurriculum(raw);
  const grade = WORKSHEET_GRADES.find(item => item.value === curriculum.gradeLevel);
  if (!grade || !curriculum.subject) return null;
  const subject = ['语文', '数学', '英语', '科学', '信息科技'].includes(curriculum.subject)
    ? curriculum.subject : ['物理', '化学', '生物学'].includes(curriculum.subject) ? '科学' : '其他学科通用';
  return `${grade.stage}${subject}`;
}
