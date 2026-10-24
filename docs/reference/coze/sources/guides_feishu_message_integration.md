> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成飞书消息能力，以实现通过飞书自定义机器人 Webhook 发送文本、富文本或卡片消息。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 支持的能力 {#5d7cbb00}

* 发送文本、富文本或卡片消息。
* @指定的群成员，@所有群成员。

## 配置方式 {#1f16c916}

### 步骤一：获取飞书机器人 URL {#95244e6f}

在集成飞书消息能力前，需要先在飞书侧创建一个自定义机器人，并获取其对应的 Webhook URL。具体操作，请参考[在群组中添加自定义机器人](https://open.larkoffice.com/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN#399d949c)。

![Image=394x263](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/39668200e43c45e9be660d3471e3a137~tplv-goo7wpa0wc-topic.webp)

### 步骤二：为工作空间启用外部集成（企业管控操作） {#e663a285}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

### 步骤三：配置飞书消息集成 {#820e158e}

在**集成管理**页面，单击飞书消息对应的**配置**，然后输入你已获取的飞书机器人 Webhook URL。配置后，当前空间下所有集成了飞书消息能力的项目，均通过该飞书机器人发送消息。

:::tip 说明
配置外部集成后，系统会**自动**将开发项目所需的官方技能添加到技能列表中，不同项目对应的技能有所不同。请勿随意移除，以免开发时报错。
:::

![Image=591x326](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/32eef9abe3da480fb67d8282e5238a63~tplv-goo7wpa0wc-topic.webp)

### 步骤四：为项目接入飞书消息集成 {#490df1e5}

配置飞书消息集成后，你可以在开发 AI 编程项目时，输入添加飞书消息集成的相关需求，让扣子 AI 自动识别并加载飞书消息技能来接入飞书消息外部集成。运行工作流，可以通过飞书自定义机器人 Webhook 发送文本、富文本或卡片消息，并支持@功能。

![Image=518x288](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/40bd8ead9a2348e78912f8d512d80e25~tplv-goo7wpa0wc-topic.webp)

## 演示效果 {#65b48d20}

::::cols
@col 50
![Image=1636x839](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6bdadc24f90c4db1b2049e3e78617264~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=816x650](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1a0a1a5343da41b680a2cb9ef883fa99~tplv-goo7wpa0wc-topic.webp)
::::
