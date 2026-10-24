# 扣子编程开发参考

阅读日期：2026-10-23（Asia/Shanghai）。已完成官方目录“扣子编程”栏目 88 篇公开正文及 5 篇相关 SDK/计费专题的阅读。本文件保留核心速查；完整记录见[文档知识库](../reference/coze/README.md)与[逐页阅读记录](../reference/coze/READING-LOG.md)。同域其他产品栏目、视频图片和登录态项目不在此完成范围内。

## 阅读范围与证据

- 工作台：<https://code.coze.cn/playground>。用户已登录，但浏览器连接工具连续超时，尚未核实用户账号中的项目、权限、套餐、当前 UI 或部署参数。
- 官方文档站：<https://docs.coze.cn/guides_welcome>。公开正文可读取，无需使用用户凭据。
- 下表保留核心入口。官方“扣子编程”栏目目录已建立，88/88 篇正文已读；补充专题 5/5 篇已读。原文、哈希与逐页结论保存在文档知识库。
- 动态额度、价格、界面、API 字段在实施前重新核对官方页面及目标项目的部署示例。

## 文档索引

| 主题 | 官方来源 | 状态 |
| --- | --- | --- |
| 产品概述 | [什么是扣子编程](https://docs.coze.cn/guides_welcome) | 要点已核实 |
| 网页应用 | [开发网页应用](https://docs.coze.cn/guides_vibe_coding_web_app) | 要点已核实 |
| 智能体 | [开发智能体](https://docs.coze.cn/guides_vibe_coding_agent) | 要点已核实 |
| 工作流 | [开发工作流](https://docs.coze.cn/guides_ai_powered_workflow_development) | 要点已核实 |
| 技能 | [开发技能](https://docs.coze.cn/guides_vibe_coding_skill) | 要点已核实 |
| 导入 | [导入项目](https://docs.coze.cn/guides_import_from_github) | 要点已核实 |
| 开发环境 | [AI 编程环境](https://docs.coze.cn/guides_vibe_coding_environment) | 要点已核实 |
| Git | [使用 Git 服务](https://docs.coze.cn/guides_using_git_services) | 要点已核实 |
| 开发版本 | [版本控制](https://docs.coze.cn/guides_version_management) | 要点已核实 |
| 网页部署 | [部署网页应用](https://docs.coze.cn/guides_deploy_vibe_web) | 要点已核实 |
| 智能体部署 | [部署智能体](https://docs.coze.cn/guides_deploy_agent_as_api_service) | 要点已核实 |
| 工作流部署 | [部署工作流](https://docs.coze.cn/guides_deploy_vibe_workflow) | 正文已读 |
| 智能体 API | [通过 API 调用智能体](https://docs.coze.cn/dev_how_to_guides_qeesmmos) | 要点已核实 |
| 数据库 | [集成数据库能力](https://docs.coze.cn/guides_integrate_database) | 要点已核实 |
| 对象存储 | [集成对象存储能力](https://docs.coze.cn/guides_integrate_storage) | 要点已核实 |
| 配置 | [管理环境变量](https://docs.coze.cn/guides_environment_variables) | 要点已核实 |
| 线上回滚 | [回滚部署版本](https://docs.coze.cn/guides_deployment_history) | 要点已核实 |
| 可观测性 | [查看日志和 Trace](https://docs.coze.cn/guides_view_running_log) | 要点已核实 |
| 限制 | [配额与限制](https://docs.coze.cn/guides_vibe_coding_limit) | 要点已核实 |

## 开发流程

以下分别依据上表的产品概述、网页应用、智能体、工作流、技能和开发环境文档。

- 平台同时包含 AI 编程与低代码项目；产品名称相近不代表接口兼容。
- 网页应用可以生成前后端，并使用数据库、存储、认证和 AI 集成。需求应包含功能、页面、业务逻辑及验收条件。
- 开发环境包含对话区、文件树、编辑器、预览和 Web 终端；可把文件、代码片段、终端错误、界面元素加入对话。手动编辑后需构建或重启以验证效果。
- 智能体以对话输入执行任务；需求未确定时，可先在问答模式讨论，再切换 Agent 模式实现。预览验收应覆盖输出格式、业务约束和模型行为。
- 工作流可查看节点输入、输出及执行耗时。试运行需验证参数传递、分支、异常和完整返回结果；可引用节点提出修改。
- 技能需要验证触发条件、执行流程及输出。修改 `SKILL.md` 后需重新打包。扣子编程制作的技能若要用于编程环境，文档要求先下载 `.skill` 再上传到编程技能列表。

## 智能体 API 接入

来源：[通过 API 调用智能体](https://docs.coze.cn/dev_how_to_guides_qeesmmos)。以下为接入速记，具体参数仍以目标项目部署示例为准。

| 用途 | 方法与路径 |
| --- | --- |
| SSE 流式执行 | `POST /stream_run` |
| 创建异步任务 | `POST /async_run` |
| 查询任务 | `GET /task/{task_id}` |

- 请求头使用 `Authorization: Bearer <API_TOKEN>`。项目 Token 仅创建时展示一次，每项目最多 10 个；不要写入前端或本笔记。
- 文本位于 `content.query.prompt` 数组，元素为 `type: text`，正文位于 `content.text`；请求另含 `type: query`、`session_id`、`project_id`。
- 文件使用 `upload_file` 元素传入 URL 与文件名；AI 编程不兼容低代码上传文件 API。
- SSE 外层事件一般为 `message`；依据 JSON 中的 `type` 区分事件。按 `sequence_id` 拼接 `content.answer`，检查 `message_end` 状态及 `error`，不要仅凭 HTTP 成功判定任务成功。
- 异步状态包括 `pending/running/completed/failed/timeout`，截止时间以 `deadline` 为准，最长默认 24 小时。重新部署可能终止运行中的任务。

## 导入与代码同步

来源：[导入项目](https://docs.coze.cn/guides_import_from_github)、[使用 Git 服务](https://docs.coze.cn/guides_using_git_services)。

- 支持 GitHub 仓库及本地压缩包导入。GitHub 仓库超过 500 MB 暂不支持；本地包支持 `.zip/.tar/.tar.gz`，解压后须为单文件夹，每文件不超过 500 MB。
- 导入会执行初始化，可能补充 `AGENTS.md`，并尝试构建；需比较初始化前后改动。
- Git 授权在工作空间级配置，要求所有者或管理员。Git 服务文档写明只支持 GitHub、同步 `main`，且限制仓库 owner。
- [多分支并行开发](https://docs.coze.cn/vibe-coding-multi-branch)已读：智能体和网页应用可建立独立 Worktree；Git 同步专题的 main 限制与该能力应分别理解。多会话则共享代码和预览。
- 同步前检查远程版本、未提交变更及冲突，避免不加审查地选择全部覆盖。

## 部署、配置与数据

来源：[网页部署](https://docs.coze.cn/guides_deploy_vibe_web)、[智能体部署](https://docs.coze.cn/guides_deploy_agent_as_api_service)、[数据库](https://docs.coze.cn/guides_integrate_database)、[存储](https://docs.coze.cn/guides_integrate_storage)、[环境变量](https://docs.coze.cn/guides_environment_variables)。

- 网页应用当前支持公开部署；默认分配 `coze.site` 域名。修改域名前缀会使旧地址失效，应同步更新调用方。
- 智能体支持 API 与 Web SDK 渠道；Web SDK 可在部署后开启。部署权限、可用规格与套餐有关，尚未核实本账号。
- 平台数据库基于 PostgreSQL，开发与生产隔离。首次部署可选复制开发数据；后续部署只同步表结构变更，不复制业务数据。
- 对象存储也区分开发与生产；文档说明每次部署只同步 `coze_knowledge_base` 目录，其他文件不会自动迁移。文件 URL 有有效期，不能默认永久有效。
- 自定义环境变量不能用系统保留的 `COZE_` 前缀。生产变量修改后需重新部署，开发变量修改后可重启；改变量名不会自动修改业务代码。

## 回滚与限制：实施前必查

来源：[版本控制](https://docs.coze.cn/guides_version_management)、[部署回滚](https://docs.coze.cn/guides_deployment_history)、[配额](https://docs.coze.cn/guides_vibe_coding_limit)、[日志](https://docs.coze.cn/guides_view_running_log)。

- 开发版本回滚可以选择恢复开发数据库，包括 Schema 和数据；目标版本之后的数据可能丢失。
- 线上部署回滚恢复历史代码及相应环境变量，但配额文档明确写明不回滚生产数据库。数据库变更必须兼容被回滚的代码。
- 对话附件：单个 20 MB，每项目最多 20 个。部署项目上传请求：16 MB。对象存储自身支持最大 200 MB；三者属于不同入口，不可混用限制。
- 配额页写 HTTP 空闲上限90秒，FAQ写300秒，工作流API同步建议300秒；存在入口或文档口径差异，长任务按实际协议实测心跳或采用异步查询。
- 沙箱磁盘：智能体/工作流/技能等为 1 GB，网页/移动/小程序/导入项目为 3 GB；开发沙箱空闲约 1 小时回收。
- 文档把单 API 限制写为 200 次/秒，另列套餐 QPM；不能把两者视为同一指标或账号实测容量。
- 配额页写日志保留 7 天、Trace 3 天；日志专题另按套餐列出 Trace 3/7/90/180 天。以目标套餐和实际控制台核实，保留该差异。

## 与 ClassNode 的关联（本地观察与待验证判断）

- 2026-10-23 已对低代码“图语小伴”完成一次音频-only消息真实调用，上传 WAV 取得 file_id 后正确理解并回复；无需公网存储。详见[音频输入验证](COZE-AUDIO-INPUT-VERIFICATION.md)。此结果不能套用于扣子编程接口。
- 本地 `server/src/services/ai-proxy.ts` 已分别处理 `coze` 与 `coze-agent`，后者使用 `stream_run`。后续接口修改应先确定对应产品，不能交叉套用低代码协议。
- 该文件已有大整数项目 ID 精度处理相关注释；官方把 `project_id` 标为 int。具体传参与路由行为尚未实测，后续修改时核对部署示例和现有序列化逻辑。
- ClassNode 当前使用 Prisma + SQLite，并有 Socket.IO、本地文件和 Tauri 分发。平台的 PostgreSQL 与云端部署不能视为现有架构可直接迁移的证据；需要另行验证兼容性。
- 后续接入重点：流式结束错误、取消/断线、异步任务恢复、文件 URL 可访问性及有效期、学生会话隔离。以上为项目工程建议，尚未完成接口测试。

## 完整阅读记录与实施边界

之前待补的工作流 API、移动应用、小程序、模型、外部集成、身份验证、存储 SDK、向量检索、技能、协作、权限、域名和 Web SDK 已完成正文阅读。88篇栏目正文和5篇补充专题的状态见[逐页记录](../reference/coze/READING-LOG.md)。

实施前先读[文档差异与实施约束](../reference/coze/IMPLEMENTATION-NOTES.md)，尤其是工作流流式路径/事件、SDK鉴权、回滚数据、模型与托管计费。文档阅读不等于接口实测，登录后项目的调用示例、实际套餐和权限仍需核实。

本次“栏目读完”不表示 docs.coze.cn 同域的低代码、扣子、罗盘、全部教程、全部计费与协议等其他栏目已全部读完，亦不包含每个页面的所有外链内容。

后续每次核实追加日期、来源、结论和项目适用范围；发现旧结论变化时直接更新并说明差异。涉及扣子的开发先读本文件，再打开对应官方来源核对。
