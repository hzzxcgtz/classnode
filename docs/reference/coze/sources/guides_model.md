> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程基于大模型能力帮助你开发 AI 编程项目。在使用扣子编程时，你可以选择扣子官方已接入的模型，也可以接入并使用自己的模型服务。

:::tip 说明
* 本文介绍**开发 AI 编程项目时可选择的模型**。内置集成服务中使用的大模型能力不属于本文范围，如需了解相关内容请参考[集成大模型能力](/guides_integrate_llm)。
* 在团队版和企业版中，企业超级管理员可以通过**功能访问控制**​和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 费用说明 {#hOe4O0sHb}

使用模型服务的费用说明如下：

<!-- @cols-width: 139,530 -->
| | | \
|**模型类型** |**费用说明** |
|---|---|
|内置模型 |由扣子统一提供的模型服务，按照扣子编程任务费用规则计费。更多信息，请参考[编程任务费用](https://docs.coze.cn/coze_pro/task_fee)。 |
|自定义接入模型 |不会产生扣子编程任务费用，这类模型会消耗你自己的模型 Token 费用。 |

## 内置模型 {#hqyWvEGQq}

内置模型是扣子面向用户统一提供的模型服务。你无需自行配置 API Key，即可在开发 AI 编程项目时选择使用。目前，扣子官方提供了 Doubao、GLM、Kimi 等大模型。

:::tip 说明
* 模型调用速度取决于模型本身的性能，不受扣子订阅套餐类型的影响。
* 不同订阅套餐可使用的模型范围可能不同，具体以实际界面展示为准。
:::

你可以在开发 AI 编程项目时，选择对应的模型。

![Image=326x216](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e138f871f264486a1779ec1bcd60fc4~tplv-goo7wpa0wc-topic.webp)

## 接入自定义模型 {#huwr3RLy2}

:::tip 说明
* **套餐限制**：仅个人进阶版及以上版本支持添加自定义模型。
* **企业用户权限**：企业成员均可添加自定义模型，添加后默认仅本人可用。**企业组织的超级管理员和管理员**可以在**模型管理**页面开启**成员可用**，将模型分享给企业组织内的其他成员。
:::

扣子提供了 Doubao、GLM、Kimi 等大模型供你选择。除此之外，你也可以添加自定义模型、接入自己的模型 API，例如你自行部署的模型、第三方在线模型等。成功接入后，你在开发 AI 编程项目时就可以使用自己的模型服务，并消耗你自己的模型 Token 费用。

<!-- @cols-width: 175,500 -->
| | | \
|**接入方式** |**适用场景** |
|---|---|
|服务商接入 |使用扣子已适配的第三方模型服务商。 |\
| | |\
| |当前支持以下服务商： |\
| | |\
| |* 火山引擎方舟 |\
| |* Kimi |\
| |* DeepSeek |\
| |* 智谱 GLM |\
| |* MiniMax |\
| |* 智谱GLM (Coding Plan) |
|自定义接入 |使用用户自己的模型服务，或兼容 OpenAI 协议的第三方模型服务。 |\
| | |\
| |支持的协议类型： |\
| | |\
| |* Chat API |\
| |* Responses API |\
| |* Anthropic Messages |

具体的操作步骤如下：

::::tabs
@tab 服务商接入
1. 在扣子编程首页，单击**模型列表** > **添加自定义模型**。
   ![Image=253x213](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6d1d9f3d39404d3d80d0afffa4edab92~tplv-goo7wpa0wc-topic.webp)
2. 在**服务商接入**页签中填写以下配置：
   * **服务商**：选择需要接入的模型服务商。
   * **API Key**：调用服务商模型接口所需的鉴权凭证。以火山方舟为例，API Key 获取方式可参考[火山方舟官方文档](https://www.volcengine.com/docs/82379/1399008?lang=zh#da0e9d90)。
   * **选择模型**：选择需要添加到扣子中的模型。每次只能添加一款模型。
   * **图片理解**：开启后，该模型可用于图片理解场景，需模型本身支持该能力。关闭后，图片理解场景将自动调用扣子提供的识图工具。
      ![Image=371x221](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9b13bb44b0a54b369b6b8d5eace3d38e~tplv-goo7wpa0wc-topic.webp)
3. 单击**添加**。
   成功添加自定义模型后，就可以选择该自定义模型开发 AI 编程项目。
   ![Image=301x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/778f4cd3f35a401b803a301aa879fb58~tplv-goo7wpa0wc-topic.webp)

@tab 自定义接入
1. 在扣子编程首页，单击**模型列表** > **添加自定义模型**。
   ![Image=269x226](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b60ac5feb04f45c29402f3ce6d4d1bdb~tplv-goo7wpa0wc-topic.webp)
2. 在**自定义接入**页签中填写以下配置：
   * **模型展示名称**：模型在扣子内展示的名称，便于用户识别和选择。
   * **模型 ID**：模型唯一标识，例如 `doubao-seed-2-0-lite-260428`，调用接口时会作为模型标识传入。
   * **模型协议**：选择模型服务兼容的 OpenAI 协议类型，支持 Chat API、Responses API 和 Anthropic Messages。
   * **API URL**：填写模型服务的 Base URL。选择不同协议后，系统会自动拼接对应接口路径。
   * **API Key**：调用模型服务所需的鉴权凭证。
   * **图片理解**：开启后，该模型可用于图片输入场景，需模型本身支持图片理解。
   * **最大输入长度**：模型单次支持的最大输入 token 数，可手动填写，也可选择 32K、64K、128K、256K。
   * **最大回复长度**：模型单次回复支持的最大输出 token 数，可手动填写，也可选择 16K、32K、64K、128K。
      ![Image=262x432](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e0d54d2260334870841db5ade97bba21~tplv-goo7wpa0wc-topic.webp)
3. 单击**添加**。
   成功添加自定义模型后，就可以选择该自定义模型开发 AI 编程项目。
   ![Image=301x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/778f4cd3f35a401b803a301aa879fb58~tplv-goo7wpa0wc-topic.webp)
::::

## 后续操作 {#hmmezp0rH}

选择模型后，你就可以开发 AI 编程项目了。

* [开发网页应用](/guides_vibe_coding_web_app)
* [开发移动应用](/guides_vibe_coding_app)
* [开发小程序](/guides_vibe_coding_miniapp)
* [开发智能体](/guides_vibe_coding_agent)
* [开发工作流](/guides_ai_powered_workflow_development)
* [开发技能](/guides_vibe_coding_skill)

## 常见问题 {#hxHdJOXck}


* [使用自定义模型后，还会产生扣子编程任务费用吗？](/guides_vibe_coding_faq#hzjhRlHAI)
* [使用扣子官方模型开发 AI 编程项目时，如何计算模型费用？](/guides_vibe_coding_faq#hTM01tILg)
* [为什么我使用了自定义接入模型，仍产生了费用？](/guides_vibe_coding_faq#hq00QQTYu)
* [如何修改自定义接入模型信息？](/guides_vibe_coding_faq#hIpBDMxmh)
* [如何删除自定义接入的模型？](/guides_vibe_coding_faq#heIX73Gzl)
