> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

外部集成是扣子编程提供的第三方服务对接功能，支持连接飞书、企业微信等平台，实现 AI 编程项目与外部服务的交互。本文介绍扣子编程外部集成的相关操作步骤。

不同套餐对应的操作流程如下：

* **团队版（高阶版、旗舰版、尊享版）、企业旗舰版**：组织管理员为工作空间启用外部集成 > 空间管理员配置外部集成 > 为项目接入外部集成。
* **个人版（免费版、进阶版、高阶版、旗舰版、尊享版）、企业标准版**：空间管理员配置外部集成 > 为项目接入外部集成。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 团队版、企业旗舰版 {#c7c455a8}

企业旗舰版可参考如下步骤配置外部集成。

### 步骤一：为工作空间启用外部集成 {#0c1a71ed}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控组织内外部集成的可用性，即组织管理员可以为工作空间启用空间内可用的外部集成。默认情况下，外部集成在企业组织的工作空间内处于禁用状态。

企业组织管理员为工作空间启用外部集成后，空间管理员才能在工作空间内配置外部集成。

:::tip 说明
* **团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
* 组织管理员禁用指定工作空间内的某个外部集成后，该工作空间的管理员无法配置该外部集成。
   需要注意的是禁用前已完成配置的外部集成，不受禁用操作影响，仍可正常接入项目。如需禁用该外部集成的可用状态，可在工作空间内删除该外部集成。
:::

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在页面顶部选择目标工作空间，然后在左侧导航栏中单击**集成管理**，然后在页面右上角单击**组织集成管理**。
   ![Image=406x275](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6fcce07a4d734e8cbaa81618fb920cde~tplv-goo7wpa0wc-topic.webp)
3. 在**组织集成管理**页面，单击目标外部集成对应的**配置**。
   ![Image=414x414](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7889e399e973490e8e67b6f015166727~tplv-goo7wpa0wc-topic.webp)
4. 选择目标工作空间，单击**开启**。

### 步骤二：在工作空间中配置集成的连接 {#c0debc4b}

空间管理员在空间中配置外部集成，用于建立扣子编程与外部集成的连接。配置完成后，外部集成状态将变为**已配置**。开发者在该工作空间下开发 AI 编程项目时，扣子 AI 会自动判断并接入该外部集成，无需额外配置。

:::tip 说明
外部集成配置在工作空间内生效，所有项目共享。
:::

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在页面顶部选择目标工作空间，然后在左侧导航栏中单击**集成管理**。
3. 在**外部集成**区域，单击**添加集成**。
   ![Image=455x310](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9cd7ff4f0de04e8592f6a280e46633f3~tplv-goo7wpa0wc-topic.webp)
4. 单击目标外部集成对应的**配置**。
   ![Image=442x131](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2672eb843525415d907e9a40553815a5~tplv-goo7wpa0wc-topic.webp)
5. 配置外部集成。
   不同外部集成对应的连接配置不同，具体配置说明，请参考配置文档。
   * [发送飞书机器人消息](/guides/feishu_message_integration)
   * [管理飞书多维表格](/guides/feishu_base_integration)
   * [收发邮件](/guides/email_integration)
   * [发布微信公众号文档](/guides/wechat_official_account_integration)
   * [发送企业微信机器人消息](/guides/wecom_robot_integration)
   * [调用火山方舟模型](/guides/volcengine_ark_integration)

目前，扣子编程的集成服务均有配套的官方技能。外部集成配置完成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中，供扣子 AI 加载。

:::tip 说明
请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

![Image=463x369](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9673e109e8df45929f737c9c8d5d951b~tplv-goo7wpa0wc-topic.webp)

### 步骤三：为项目接入外部集成 {#c1aab503}

完成上述配置后，你在与扣子 AI 协作开发 AI 编程项目时，只需用自然语言清晰描述所需功能，扣子 AI 会自动识别关键词，加载对应的技能来接入外部集成。试运行或正式运行 AI 编程项目时，将自动触发外部集成，使用对应的功能。例如，你可以跟扣子 AI 对话：

```Plain Text
让智能体完成任务后，自动向指定飞书群推送结果通知
```

![Image=536x341](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3a9af5472ecd44fab5ceef66652a35e1~tplv-goo7wpa0wc-topic.webp)

## 个人版、企业标准版 {#6c3b3639}

个人版（免费版、进阶版、高阶版、旗舰版、尊享版）和企业标准版的工作空间默认可使用外部集成功能，需由空间管理员先在空间内配置外部集成。具体操作步骤如下：

### 步骤一：在工作空间中配置集成的连接 {#413e4cd1}

空间管理员在空间中配置外部集成，用于建立扣子编程与外部集成的连接。配置完成后，外部集成状态将变为**已配置**。开发者在该工作空间下开发 AI 编程项目时，扣子 AI 会自动判断并接入该外部集成，无需额外配置。

:::tip 说明
配置在工作空间内生效，所有项目共享。
:::

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在页面顶部选择目标工作空间，然后在左侧导航栏中单击**集成管理**。
3. 单击目标外部集成对应的**配置**。
   ![Image=516x284](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d8999309ff964859a22a9673b0f4aaff~tplv-goo7wpa0wc-topic.webp)
4. 配置外部集成。
   不同外部集成对应的连接配置不同，具体配置说明，请参考配置文档。
   * [发送飞书机器人消息](/guides/feishu_message_integration)
   * [管理飞书多维表格](/guides/feishu_base_integration)
   * [收发邮件](/guides/email_integration)
   * [发布微信公众号文档](/guides/wechat_official_account_integration)
   * [发送企业微信机器人消息](/guides/wecom_robot_integration)
   * [调用火山方舟模型](/guides/volcengine_ark_integration)

目前，扣子编程的集成服务均有配套的官方技能。外部集成配置完成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中，供扣子 AI 加载。

:::tip 说明
请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

![Image=463x369](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9673e109e8df45929f737c9c8d5d951b~tplv-goo7wpa0wc-topic.webp)

### 步骤二：为项目接入外部集成 {#ca2cb9bc}

完成上述配置后，你在与扣子 AI 协作开发 AI 编程项目时，只需用自然语言清晰描述所需功能，扣子 AI 会自动识别关键词，加载对应的技能来接入外部集成。试运行或正式运行 AI 编程项目时，将自动触发外部集成，使用对应的功能。示例如下：

```Plain Text
让智能体完成任务后，自动向指定飞书群推送结果通知
```

![Image=536x341](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3a9af5472ecd44fab5ceef66652a35e1~tplv-goo7wpa0wc-topic.webp)

## 相关操作 {#d33ef95a}

下述表格罗列了外部集成的相关操作。

<!-- @cols-width: 253,333,240 -->
| | | | \
|**操作** |**说明** |**图示** |
|---|---|---|
|禁用外部集成 |\
| |\
|（团队高阶版、团队旗舰版、团队尊享版、企业旗舰版） |企业组织管理员可以在**集成管理**页面，禁用工作空间内的外部集成。 |\
| | |\
| |1. 在**集成管理**页面的右上角，单击**组织集成管理**。 |\
| |2. 单击目标外部集成对应的**配置**。 |\
| |3. 选中目标工作空间，单击**关闭**。 |\
| | |\
| |禁用后，此前未配置过该外部集成的工作空间，其下所有项目均无法接入该外部集成。 |![Image=1214x1220](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4e16c30a47564f71a370ef2840cf99ab~tplv-goo7wpa0wc-topic.webp) |
|删除外部集成配置 |\
| |\
|（团队高阶版、团队旗舰版、团队尊享版、企业旗舰版） |由于禁用前已完成配置的外部集成，不受禁用操作影响，可正常接入项目。如需禁用该外部集成的可用状态，需在工作空间内删除该外部集成。即在**集成管理**页面，单击目标集成对应的**删除**。 |\
| | |\
| |如果已在项目中接入该外部集成，需先在项目中通过自然语言对话移除，再在工作空间中删除。 |![Image=1237x794](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/fa8f5d56914d43f89d396f8c8d601da5~tplv-goo7wpa0wc-topic.webp) |
|取消外部集成配置 |\
| |\
|（个人免费版、个人进阶版、个人高阶版、个人旗舰版、个人尊享版和企业标准版） |空间管理员可以在工作空间内取消外部集成配置。取消后，该空间下所有的项目均不能接入该集成服务。 |\
| | |\
| |1. 在**集成管理**页面，单击目标集成对应的**管理**。 |\
| |2. 在**管理外部集成**面板中，单击**取消配置**。 |\
| |   如果已在项目中接入该外部集成，需先在项目中通过自然语言对话移除，再在工作空间中取消。 |![Image=1245x776](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a4d7407aaa9c44729adce22f00edaabb~tplv-goo7wpa0wc-topic.webp) |
|查看工作空间内的外部集成 |在**集成管理**页面，查看该工作空间内可使用的外部集成列表。 |![Image=1238x1065](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7e2ce65bec9f4f8facf4641266b742c1~tplv-goo7wpa0wc-topic.webp) |
|更新外部集成配置 |1. 在**集成管理**页面，单击目标集成对应的**管理**。 |\
| |2. 在**管理外部集成**面板中，修改配置，单击**更新**。 |![Image=1242x780](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/544f28ced286429fa60fd1f8b902b3a0~tplv-goo7wpa0wc-topic.webp) |
|查看外部集成的关联项目 |1. 在**集成管理**页面，单击目标集成对应的**管理**。 |\
| |2. 在**管理外部集成**面板中，查看已接入当前外部集成的项目。 |![Image=1554x905](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8f673a0bf8e542b988215abaec0dbc46~tplv-goo7wpa0wc-topic.webp) |

## 常见问题 {#70605015}

* [为什么我的空间无法配置外部集成？](/guides/vibe_coding_faq#17542d3b)
* [组织管理员禁用了某个外部集成后，空间里原已配置的集成是否能继续使用？](/guides/vibe_coding_faq#16c552a9)
* [接入飞书消息集成后，为什么空间内的项目都使用同一个飞书机器人发送消息？](/guides/vibe_coding_faq#cbfc0525)
* [支持接入第三方的 API 吗？](/guides/vibe_coding_faq#33faf53c)
