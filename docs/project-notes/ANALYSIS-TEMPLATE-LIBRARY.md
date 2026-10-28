# 官网远程 MD 模板服务

2026-10-28。模板版本 4.3.0，应用版本仍为 2.1.5。

## 使用方式

官网只托管 12 个 Markdown 文件，不提供模板展示页。教师仍在 ClassNode 的“AI 智能体 → 分析提示词模板”中按学段、学科选择、预览、复制和下载。

固定地址示例：`https://www.aicls.xyz/prompt-templates/analysis/primary-math.md`。文件来源为仓库 `myportal/prompt-templates/analysis/`，包含小学、初中各 6 份模板。将该目录上传到官网相同路径即可；本次没有发布到线上服务器。

浏览器调用本地 `/api/agents/analysis-templates/:templateId`，后端从固定 HTTPS 官网页面取回 MD。服务器只允许 12 个固定模板 ID，不接受自定义 URL、不跟随重定向、不转发课堂数据、Cookie 或智能体密钥。读取有 10 秒超时、256 KiB 大小限制和内容完整性检查；失败后在应用内提示并提供重试。

不需要配置浏览器跨域 CORS。每次进入模板页、切换模板或重试都会重新读取；页面只显示远端文件标注的版本，不拿软件内置版本冒充官网最新版本。下载与复制使用当前成功加载的同一份正文，加载期间禁用操作，避免使用上一份模板。

## 更新方式

1. 修改 `scripts/lib/analysis-prompt-content.mjs` 公共规则、`scripts/lib/analysis-subject-guides.mjs` 学科方法并更新独立模板版本。
2. 运行 `node scripts/generate-analysis-prompts.mjs` 和 `node scripts/generate-analysis-prompts.mjs --check`。
3. 上传 `myportal/prompt-templates/analysis/` 中的 12 个 MD 文件，保持路径和文件名不变。官网/CDN 对此目录设置 `Cache-Control: no-cache`，避免强制长缓存。
4. 在 ClassNode 重新进入模板页或重试，即可读取新内容。更新前自行备份网站文件以便回退。

模板不再随安装包的 public 目录分发；仓库保留维护源、开发文档与测试。运行期分析协议仍由 ClassNode 动态提供。本次 v4.3.0 补充图文评价依据、原始音频、逐空混合评价及只给建议/计分的边界，不增加音频转写调用。

官网下载更新的是模板资源；教师仍需复制到扣子等平台并保存发布，才会改变外部智能体的系统提示词。不会自动覆盖已有智能体配置，不清除评分或重评学生作答。新内容正式替换前应以代表性图文和录音验证模型效果。
