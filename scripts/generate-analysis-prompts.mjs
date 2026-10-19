import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBJECT_GUIDES } from './lib/analysis-subject-guides.mjs';
import { VERSION, COMMON, SUBJECTS, STUDENT_FEEDBACK_STYLE, TASK_LENSES, COLLECTION_REPORT_GUIDE } from './lib/analysis-prompt-content.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
function write(file, text) {
  const target = path.join(root, file);
  if (check) { if (fs.readFileSync(target, 'utf8') !== text) throw new Error(`提示词未同步：${file}`); }
  else fs.writeFileSync(target, text);
}
function intro(title, skills) {
  return `# 角色：${title}学习分析助手\n你是一位耐心的教师助手，依据真实作答帮助教师决定下一步怎么教，帮助学生采取可行的下一步。\n\n## 目标：\n识别有教学价值的表现与差异，提供有证据、可操作的分析；是否评分以系统本次设置为准。\n\n## 技能：\n${skills}\n\n`;
}
const base = intro('学情', '依据任务要求识别学习任务，选择相关观察维度，区分事实与推测，尊重合理差异。') + `## 学习任务观察指引\n${TASK_LENSES}\n\n` + COMMON;
write('src/lib/analysis-agent-prompt-template.ts', `// 由 scripts/generate-analysis-prompts.mjs 生成，请修改 scripts/lib/analysis-prompt-content.mjs。\nexport const ANALYSIS_PROMPT_VERSION = ${JSON.stringify(VERSION)};\nexport const ANALYSIS_AGENT_PROMPT_TEMPLATE = ${JSON.stringify(base)};\n`);
const names = { chinese: '语文', math: '数学', english: '英语', science: '科学', 'information-technology': '信息科技', general: '其他学科通用' };
const links = [];
for (const [stage, stageName] of [['primary', '小学'], ['middle', '初中']]) for (const [subject, skills] of Object.entries(SUBJECTS)) {
  const title = stageName + names[subject];
  const file = `${stage}-${subject}.md`;
  const guide = SUBJECT_GUIDES[`${stage}-${subject}`];
  if (!guide) throw new Error(`缺少学科评价方法：${stage}-${subject}`);
  const prompt = intro(title, `${skills}\n${stage === 'primary' ? '按儿童发展水平给出具体、简短的观察与操作建议。' : '在材料允许时关注关系、论证与方法适用条件。'}未提供具体年级时不猜测年级。\n\n${guide}\n\n只选当前任务适用的评价方法；本模板支持所有适用作答形式，不要求每次覆盖全部学习任务。`);
  write(`public/prompt-templates/analysis/${file}`, `<!-- ClassNode Worksheet Analysis Prompts v${VERSION}；自动生成 -->\n# 可优化区：教师可按需要修改\n\n本模板不修改也能直接使用。日常在学习单填写评价依据和当前任务分析重点，无需逐项修改模板。\n\n${prompt}---\n\n# 固定区：教师不应修改\n\n以下规则用于保持分析行为一致；名单和机器协议由系统在每次请求中提供。\n\n${COMMON}`);
  links.push(`- [${title}](../public/prompt-templates/analysis/${file})`);
}
write('server/src/services/analysis-teaching-policy.ts', `// 由 scripts/generate-analysis-prompts.mjs 生成。\nexport const ANALYSIS_PROMPT_VERSION = ${JSON.stringify(VERSION)};\nexport const STUDENT_FEEDBACK_STYLE = ${JSON.stringify(STUDENT_FEEDBACK_STYLE)};\nexport const COLLECTION_REPORT_GUIDE = ${JSON.stringify(COLLECTION_REPORT_GUIDE)};\n`);
write('docs/Coze学习单小题分析智能体提示词.md', `# Coze 学习单任务分析智能体提示词\n\n> 模板版本：ClassNode Worksheet Analysis Prompts v${VERSION}\n\n基础模板可直接使用，无需指定年级。配置一次后，日常通过学习单中的参考作答、评价标准和当前任务分析重点表达教学要求。\n\n## 升级说明\n\n已有外部平台智能体不会自动更新。先保存原提示词及自定义内容，再复制适合学科、学段的新版完整模板到分析智能体的系统提示词，保留需要的长期教学风格设置，并用代表性作答验证。学习单统一采用“主题—任务”层级：主题组织相关任务，分析以当前任务及所属主题为依据。此次更新明确区分信息收集与作答分析：信息收集报告以回答分布、共性诉求、差异和后续行动为主，分类人数与完整关联名单必须一致；不沿用教学讲评结构。系统每次请求也会明确发送用途及所需结构。已有报告需重新生成才采用新结构。此次更新不清除已有评分和报告，也不会自动重评。\n\n表达题与开放题合并；参考作答和评价标准可留空，AI 评分默认关闭。客观题选择“无标准答案，收集信息”后不判对错。分析重点用于选择关注方向，不修改给分标准。\n\n平台模板负责教学规则，系统动态提供班级分析、补评、个人评价三种调用模式和机器协议。无需在平台复制动态 JSON 示例。\n\n## 学科模板\n\n优先按学科、学段选择一份完整模板，配置一次即可。每份模板独立描述本学科的证据、判断、反馈与讲评方法；公共工作流和系统协议统一维护。通用模板用于跨学科或暂未细化的任务，不替代学科模板。\n\n${links.join('\n')}\n\n## 通用模板\n\n\`\`\`markdown\n${base}\`\`\`\n\n## 维护与核验\n\n公共规则修改 scripts/lib/analysis-prompt-content.mjs，学科评价方法分别修改 scripts/lib/analysis-subject-guides.mjs；随后运行 node scripts/generate-analysis-prompts.mjs；使用 --check 检查通用模板、12 份学科模板及运行期教学指引是否同步。\n`);
