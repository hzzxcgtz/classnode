> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

## 2026 年 08 月 {#hNJcCYFzz}

### 功能访问控制 {#hMhhzkr4c}

功能访问控制用于控制企业成员对不同功能的可见性。企业超级管理员可以按角色、组织、成员或空间维度设置功能不可见性。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。

### 空间资源访问控制 {#hKq2Rz8pV}

空间资源访问控制用于控制工作空间资源的可见范围。企业超级管理员可以按工作空间、角色维度设置项目管理、资源库、任务中心的资源可见范围。更多信息，请参考[空间资源访问控制](/guides_team_config#hCId5unoV)。

## 2026 年 07 月 {#hiQ5M1Dlz}

### 模型下架（0730） {#hsk3ToWvP}

扣子编程将于 **2026 年 7 月 30 日** 同步下线并停止提供下述官方模型服务。

内置集成服务：DeepSeek-V3.2 模型

### 模型下架（0729） {#hDDX0C4Vb}

扣子编程将于 **2026 年 7 月 29 日** 同步下线并停止提供下述官方模型服务。

* 扣子：Kimi K2.5
* 扣子编程（开发项目） ：Kimi K2.5、Kimi K2.6、GLM-5、GLM-5V-Turbo

### 创建企业 {#hLoDg1llM}

购买团队版后，系统支持自动创建企业。更多信息，请参考[创建企业](/guides_create_team_and_enterprise)。

## 2026 年 06 月 {#hHsUQYQdF}

### AI 编程多会话 {#6fb6b6a8}

扣子 AI 编程项目支持创建多个会话，让你可以在同一个编程项目中并发处理多项独立的开发任务。更多信息，请参考[AI 编程多会话与多分支开发](/guides/vibe_coding_multi_session)。

### 多人协作 AI 编程 {#364d8b47}

通过**多人协作模式**，团队成员可以像在群聊一样，与扣子 AI 实时对话，共同开发项目、查看项目进展、修改代码并调试项目。更多信息，请参考[多人协作 AI 编程](/guides/vibe_coding_collaboration)。

### 身份验证集成服务 {#81466be0}

通过身份验证功能，开发者只需用简单提示词说清楚需求，扣子 AI 就能给你的 Web 应用、移动应用构建一套完整的用户注册、登录和管理系统。更多信息，请参考[集成身份验证](/guides/integrate_authentication)。

## 2026 年 04 月 {#7025198d}

### 工作流画布优化 {#9a9ca722}

通过 AI 编程方式生成工作流后，支持在画布上手动增加、修改或删除节点。手动编排工作流并不会直接更新代码。更多信息，请参考[编辑工作流](/guides/ai_powered_workflow_development#09b79de9)。

## 2026 年 03 月 {#9870b567}

### 批量切换模型 {#840afa62}

当某个模型即将停运时，工作空间的所有者或管理员可以快速定位当前工作空间下所有使用该模型的 AI 编程项目，并批量为这些项目的线上版本切换模型。更多信息，请参考[批量切换模型](/guides/integrate_llm#4c400c43)。

### AI 编程功能优化 {#2474a784}

* **编程 AI 新增技能**：通过 AI 编程方式生成网页应用时，编程 AI 可使用 **WebSocket 实时通信**等技能，可以生成高质量的双向实时通信的 Web 项目。
* **增加** [AGENTS.md](http://agents.md/) **规范**：在项目根目录创建 [AGENTS.md](http://agents.md/)，写入技术栈、代码风格、目录结构等规范。Agent 每次开发都会自动加载并遵守，适用全部场景。

::::cols
@col 50
新技能：

![Image=3706x1870](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7139f470082b4718850533c3477cad87~tplv-goo7wpa0wc-topic.webp)

@col 50
[AGENTS.md](http://agents.md/)：

![Image=3954x1864](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ae3a2fb2e39b459780467ef2b1ae334a~tplv-goo7wpa0wc-topic.webp)
::::

### 订阅套餐权益 {#232923b5}

为保障平台的稳定运行和资源的合理分配，扣子编程对 AI 编程项目的可创建数量、可回滚的历史部署版本数、部署运维日志查询量、部署次数等权益，增加套餐配额，更多信息，请参考[套餐权益](/guides/edition#b8784ae2)。

![Image=787x204](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4b779ddeb36e4d9d97bde93bde0020da~tplv-goo7wpa0wc-topic.webp)

### 自助开票 {#08b87724}

扣子编程现已支持线上自助开票。具体操作，请参考[开具发票](https://docs.coze.cn/coze_pro/Issue_invoice)。

### OpenClaw 部署体验优化 {#b4c50078}

扣子编程中部署 OpenClaw 现已支持以下能力：

* 极速一键部署
* 可视化配置和切换模型
* 极简配置飞书渠道
* 提供满血版和省流版以供选择，后者 Token 消耗更低

详细说明可参考[一键部署 OpenClaw 并集成飞书](/tutorial/openclaw)。

## 2026 年 02 月 {#4e58e602}

### 技能环境变量支持 OAuth 等类型 {#9a7068b5}

技能环境变量分为常规变量和凭证变量两类，后者又包括 APIKey 和 OAuth 两种，适用于需要 API Key 鉴权、OAuth 授权的技能。详细说明可参考[技能环境变量](/guides/skill_credential_variable)。

### AI 编程支持开发小程序、手机应用 {#b807fb61}

* [开发移动应用](/guides/vibe_coding_app)
* [开发小程序](/guides/vibe_coding_miniapp)

### OpenClaw 个人助理 {#f40c2f4f}

扣子编程现已支持云端环境快速部署 OpenClaw 个人助理，只需简单的配置，即可拥有一个 7*24 小时不间断运行的个人助理。和传统的 AI 助理不同，OpenClaw 不是普通的聊天机器人，被授予操作权限之后，它能控制你的终端执行操作，可以“动手工作”，而不是“只出主意”。

更多信息，请参考[一键部署 OpenClaw 并集成飞书](/tutorial/openclaw)。

## 2026 年 01 月 {#211722fc}

### 图像生成节点 {#a7906674}

图像生成节点新增 Seedream 4.5 模型。相较于 Seedream 4.0，Seedream 4.5 模型有了整体提升，显著改善了人像效果和画面美感，并增强了推理能力，详情请参考[图像生成节点](/guides/image_generation_node)。

### 数据向量化 {#cc7d649c}

扣子编程支持调用向量模型，将非结构化内容转换为向量并存储于数据库中，提升系统对非结构数据的召回能力。更多信息，请参考[数据向量化写入与检索](/guides/vector_based_data_writing_and_search)。

### 内置集成 {#1a36e2b9}

扣子编程集成了向量模型，将文本、图像、视频等数据转换为数值向量。更多信息，请参考[内置集成](/guides/internal_integrations)。

### 内置集成 {#d55d3dd9}

内置集成服务新增视频生成与内容处理能力。更多信息，请参考[内置集成](/guides/internal_integrations)。

* 视频生成：AI 编程项目支持接入 Doubao-Seedance-1.5-pro 大模型，生成视频。
* 内容处理：AI 编程项目支持接入内容处理工具，剪辑视频。

## 2025 年 12 月 {#8d15606b}

即日起，「扣子开发平台」现已正式升级为「[扣子编程](code.coze.cn)」！本次升级也标志着**扣子编程**将从低代码 AI Agent 开发平台转变为基于 AI 编程的全代码应用开发平台，提供更低的操作门槛、更高的开发上限，将你的精力聚焦到创意本身。

关于扣子编程的产品介绍，可参考[什么是扣子编程](/guides/welcome)。

### AI 编程能力 {#cf187a28}

AI 编程是**扣子编程**的核心能力，你只需要清晰表达意图，就能一站式完成从**构建到落地**的完整生产级闭环，覆盖**智能体**、**工作流**、**网页应用**等多个开发场景。

在浏览器中打开[扣子编程](code.coze.cn)，只要清晰描述你的需求并敲击回车，即可开始开发你的第一个 AI 编程项目，让你的开发过程更聚焦于创意和价值创造。

![Image=504x318](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d13b41505c114f9ab64dfd9501924519~tplv-goo7wpa0wc-topic.webp)

关于 AI 编程能力的详细说明，可参考[扣子 AI 编程概述](/guides/vibe_coding_overview)。

### 集成服务与生态 {#9f344977}

扣子编程将复杂的能力配置包装为独立的集成服务模块。在 AI 编程时，只需清楚描述你的需求，扣子编程会自动判断并接入所需的集成服务：

* **内置集成**：内置如数据库、存储、身份认证等集成服务，开发者无需手动配置。
* **外部集成**：由扣子编程官方提供的第三方集成服务，包括飞书、微信、火山方舟等服务。

关于集成服务的详细说明，可参考[集成服务概述](/guides/integrations_overview)。

### 一键发布能力 {#f424d641}

扣子编程为你的 AI 编程项目提供一键发布功能：

* 将你的智能体和工作流一键发布为 API 服务，以便集成到现有系统中。
* 将你开发的 AI 应用发布为独立的网页站点，支持自定义域名。

只需要点击“部署”，扣子编程会自动完成云端打包、构建与服务部署。

关于部署能力的详细介绍，可参考[部署运维概述](/guides/deployment_ops_overview)。

### AI 生成式应用功能升级 {#0abd81c1}

AI 生成式应用的功能现已全面升级，支持开发具备完整前后端逻辑的应用，并将其部署上线。

* 原入口已屏蔽，已创建的 AI 生成式应用也无法继续编辑或使用。
* 建议你前往新版[扣子编程](code.coze.cn)页面体验**全新的 AI 生成式应用**，详细操作步骤请参考[开发网页应用](/guides/vibe_coding_web_app)。
