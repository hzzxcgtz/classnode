import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, EXTERNAL_AGENT_BASE, DYNAMIC_CLASS_POLICY, DYNAMIC_INDIVIDUAL_POLICY, SUBJECTS, STUDENT_FEEDBACK_STYLE, COLLECTION_REPORT_GUIDE, CLASS_REPORT_WRITING_GUIDE } from './lib/analysis-prompt-content.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
function write(file, text) {
  const target = path.join(root, file);
  if (check) { if (fs.readFileSync(target, 'utf8') !== text) throw new Error(`提示词未同步：${file}`); }
  else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); }
}
const base = '# 角色：通用教育评价与学习分析助手\n\n' + EXTERNAL_AGENT_BASE;
const universal = `<!-- ClassNode Worksheet Analysis Prompts v${VERSION}；自动生成 -->\n${base}\n`;
write('myportal/prompt-templates/analysis/universal.md', universal);
write('src/lib/analysis-agent-prompt-template.ts', `// 由 scripts/generate-analysis-prompts.mjs 生成，请修改 scripts/lib/analysis-prompt-content.mjs。\nexport const ANALYSIS_PROMPT_VERSION = ${JSON.stringify(VERSION)};\nexport const ANALYSIS_AGENT_PROMPT_TEMPLATE = ${JSON.stringify(base)};\n`);
// 保留旧地址，供尚未升级的模板页读取；内容统一，不再维护学段学科分支。
for (const stage of ['primary', 'middle']) for (const subject of Object.keys(SUBJECTS)) {
  write(`myportal/prompt-templates/analysis/${stage}-${subject}.md`, universal);
}
write('server/src/services/analysis-teaching-policy.ts', `// 由 scripts/generate-analysis-prompts.mjs 生成。\nexport const EXTERNAL_ANALYSIS_TEMPLATE = ${JSON.stringify(universal)};\nexport const DYNAMIC_CLASS_POLICY = ${JSON.stringify(DYNAMIC_CLASS_POLICY)};\nexport const DYNAMIC_INDIVIDUAL_POLICY = ${JSON.stringify(DYNAMIC_INDIVIDUAL_POLICY)};\nexport const ANALYSIS_PROMPT_VERSION = ${JSON.stringify(VERSION)};\nexport const STUDENT_FEEDBACK_STYLE = ${JSON.stringify(STUDENT_FEEDBACK_STYLE)};\nexport const COLLECTION_REPORT_GUIDE = ${JSON.stringify(COLLECTION_REPORT_GUIDE)};\nexport const CLASS_REPORT_WRITING_GUIDE = ${JSON.stringify(CLASS_REPORT_WRITING_GUIDE)};\n`);
write('docs/Coze学习单小题分析智能体提示词.md', `# ClassNode 外部分析智能体模板\n\n> ClassNode Worksheet Analysis Prompts v${VERSION}\n\n本模板适用于已实现动态评价协议和个人评价文字汇总的新版本 ClassNode。请先升级应用，再替换外部模板；旧安装包不应直接改用本精简模板。模板版本号不等同于应用版本号。\n\n## 分工\n\nClassNode 动态请求负责题目与评价标准、学生与附件对应、评分范围、学生反馈、详细依据及班级汇总协议；程序校验身份、分值和版本。外部模板提供通用评价原则和证据边界，不再按学段学科区分。动态请求目前随调用内容发送，不意味着它在平台上拥有高于系统提示词的角色优先级。\n\n## 升级方式\n\n先备份外部平台原提示词与自定义内容，再移除其中冲突的固定评分条件、固定返回格式、强制逐生重评和报告栏目，使用下方基础模板。长期风格可保留，但不得增设本题评分项。已有智能体不会由 ClassNode 自动修改。日常在学习单中填写评价要求，无需复制动态 JSON 协议。升级不会清空历史评价或自动批量重评；历史记录缺依据时按有限证据汇总。\n\n## 推荐基础模板\n\n\`\`\`text\n${base}\n\`\`\`\n\n## 可以使用自己的智能体\n\n本模板是可选参考，不是使用 ClassNode 的前提。教师完全可以使用自己设计的智能体，或已试用过、适合本学科的专业辅助教学智能体；其学科知识、教学方法或知识库可能更贴合实际教学，效果以真实任务试用为准。保留有效的学科特色，同时确保它能接收本次材料并按 ClassNode 的动态协议返回结果。建议先用少量真实作答测试学生对应、反馈、评分和班级汇总，再用于全班。\n\n## 通用模板文件\n\n[下载通用模板](../myportal/prompt-templates/analysis/universal.md)。应用模板页使用内置同版内容，无需连接官网；旧学段学科文件地址保留兼容，正文均为通用模板。\n\n## 验收\n\n用文字、图片、录音、混合填空及仅反馈任务测试。个人评价应保留学生反馈并保存分析依据；班级汇总不能重新评分或要求重复上传原始作品。若平台仍存在冲突系统指令、工作流节点或不支持附件的模型，需在外部配置中处理，不能仅靠动态请求覆盖。\n`);
write('src/lib/analysis-prompt-templates.ts', `// 通用模板目录；正文随应用内置，旧模板地址仅保留兼容。\nexport const ANALYSIS_PROMPT_TEMPLATES = [{ id: 'universal', title: '通用教育评价与学习分析', file: '/prompt-templates/analysis/universal.md' }] as const;\n`);
