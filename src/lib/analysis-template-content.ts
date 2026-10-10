/** 教师编辑说明只用于模板页，复制给智能体时仅保留角色与实际规则。 */
export function analysisTemplateParts(text: string) {
  const role = text.indexOf('# 角色：');
  const fixed = text.indexOf('# 固定区：教师不应修改');
  const workflow = text.indexOf('## 工作流：', fixed);
  if (role < 0 || fixed <= role || workflow <= fixed) return { editable: '', fixed: '', prompt: text };
  const editable = text.slice(role, fixed).trim().replace(/\n---\s*$/, '').trim();
  const rules = text.slice(workflow).trim();
  return { editable, fixed: rules, prompt: `${editable}\n\n${rules}` };
}
