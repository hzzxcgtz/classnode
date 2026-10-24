> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

本文将帮助你快速上手扣子编程的环境变量功能，了解其在 AI 编程项目开发中的作用，及相关操作步骤。

## 什么是环境变量 {#ad842b17}

扣子编程提供环境变量管理工具，用于将 AI 编程项目运行所需的信息以环境变量形式进行存储与管理，例如 API 密钥、数据库密码、鉴权 Token 等。通过将数据与代码分离，可有效避免硬编码风险，大幅提升 AI 编程项目的安全性、灵活性与合规性。支持以下两种类型的环境变量：

* **系统环境变量**： 由平台内置并管理，以`COZE_`作为命名前缀。例如为 AI 编程项目接入数据库能力时，扣子 AI 会自动在代码中使用数据库相关的环境变量存储数据库的访问地址等信息。
* **自定义环境变量**：由你根据项目需求自行创建。创建后，你需要与扣子 AI 对话，将环境变量写入项目代码中。

核心特性如下：

* **应用级密钥管理**：AI 编程项目维度独立管理环境变量。
* **生产与开发环境隔离**：开发与生产环境完全隔离，避免开发调试阶段的配置变动影响线上运行。

## 开发与生产环境 {#e8327183}

扣子编程的环境变量区分**开发环境**和**生产环境**，数据完全隔离，避免开发阶段的配置变动影响线上业务运行。

<!-- @cols-width: 109,260,500 -->
| | | | \
|**环境类型** |**适用阶段** |**说明** |
|---|---|---|
|开发环境 |AI 编程项目开发/调试阶段 |开发阶段仅创建开发环境的环境变量。 |
|生产环境 |AI 编程项目部署上线后 |生产环境的环境变量在首次部署项目时进行配置，未部署前无法添加。 |\
| | | |\
| | |* 首次部署项目时，系统会自动同步开发环境的环境变量到**部署**页面，你可以调整环境变量，并发布到生产环境。 |\
| | |* 生产环境的环境变量只支持在**发布管理**页面进行配置，重新部署项目才能生效。 |

## 权限说明 {#0dff3be8}

* 仅 AI 编程项目的所有者具备对应环境变量的操作权限。
* 在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。

## 使用环境变量 {#999cc518}

你可以参考如下步骤创建并使用自定义环境变量。

1. 创建自定义环境变量。
   1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)首页，按需输入你的开发需求，然后进入 AI 编程环境。
   2. 在 AI 编程环境的右上角，单击➕，然后在**集成服务**区域，单击**环境变量**。
   3. 在**开发环境**页签中，单击**新建变量**。
   4. 设置环境变量名称和值，单击**确认**。
      :::tip 说明
      环境变量 Key 不允许以 `COZE_` 开头，`COZE_` 为系统环境变量专用前缀。
      :::      


![Image=573x160](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5e8cc66b967242c281b13fc4396378a4~tplv-goo7wpa0wc-topic.webp)

2. 通过自然语言与扣子 AI 对话，将已创建的环境变量集成到项目代码中。
   :::tip 说明
   创建自定义环境变量后，你需要通过对话，让扣子 AI 将其集成到业务代码中。
   :::   


![Image=560x174](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b45b270db07a42c286ea29d5e635ac93~tplv-goo7wpa0wc-topic.webp)

## 示例 {#912b5e2c}

在开发识别发票并将识别结果发送到飞书多维表格的工作流时，工作流中会提供输入参数来配置飞书多维表格的 `app_token` 和 `table_id`。在该场景中，你可以：

1. 创建环境变量 `FEISHU_APP_TOKEN` 和 `FEISHU_TABLE_ID`，并根据实际的`app_token` 和 `table_id`，配置环境变量值。
2. 与扣子 AI 对话，更新代码，将这两个环境变量集成到业务代码中。

运行工作流时，系统会自动读取环境变量中的配置值，你无需手动填写 `app_token` 和 `table_id`，即可将发票提取结果写入指定的飞书多维表格。如果你需要切换目标飞书多维表格，只需更新环境变量值。

::::cols
@col 50
![Image=1587x889](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b58e937ef8b9490386c49569bc01a548~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1379x502](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2ba8a0da39a94deead638fa9429b16b0~tplv-goo7wpa0wc-topic.webp)
::::

## 相关操作 {#778e58a4}

在 AI 编程环境的环境变量页签中，你还可以进行如下相关操作。

<!-- @cols-width: 166,557,100 -->
| | | | \
|**操作** |**说明** |**图示** |
|---|---|---|
|修改环境变量 |* 开发环境：在**环境变量**的**开发环境**页签中，找到目标环境变量，进行修改。 |\
| |* 生产环境：在**发布管理**页面修改环境变量，并在修改后重新部署才能生效。 |\
| | |\
| |:::tip 说明 |\
| |* 修改环境变量 Key，系统不会自动更新代码，你需要让扣子 AI 调整相关配置或者自行调整相关代码，避免项目运行异常。 |\
| |* 修改环境变量 Value 后，你可以重启 AI 编程项目，使变更生效。 |\
| |::: |\
| | |\
| | |![Image=1906x390](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5290dc1e46724f49bd2de4471b09744c~tplv-goo7wpa0wc-topic.webp) |\
| | | |\
| | |![Image=1356x869](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bf04cb957968450f8c1a84e4e0aadbb5~tplv-goo7wpa0wc-topic.webp) |
|删除环境变量 |* 开发环境：在**环境变量**的**开发环境**页签中，找到目标环境变量，选择**更多** > **删除**。 |\
| |* 生产环境：在**发布管理**页面删除环境变量，并在删除后重新部署才能生效。 |\
| | |\
| |:::tip 说明 |\
| |删除环境变量并不会自动更新相关代码，你需要通过对话方式让扣子 AI 调整代码。 |\
| |::: |\
| | |\
| | |![Image=1361x453](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/75c55a9cd431449289675326ba20ebe9~tplv-goo7wpa0wc-topic.webp) |
|同步环境变量 |在**部署**页面，如果你修改了环境变量名称或值，可以单击**同步开发环境变量**，一键同步开发环境变量。 |![Image=1349x864](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/576cae6759364c7fab92faaf825de5b4~tplv-goo7wpa0wc-topic.webp) |
|查看环境变量 |在**环境变量**页签中，查看开发环境或生产环境的环境变量。 |![Image=1347x483](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/89f5bfc18fb942dfa91ed27e28b9128b~tplv-goo7wpa0wc-topic.webp) |

## 常见问题 {#28911268}

* [各个项目之间的环境变量是共享的吗？](/guides/vibe_coding_faq#77ce1375)
