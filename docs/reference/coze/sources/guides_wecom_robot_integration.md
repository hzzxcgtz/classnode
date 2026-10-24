> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成企业微信机器人能力，以实现通过企业微信机器人发送消息。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 配置方式 {#1b033a54}

### 步骤一：获取企业微信机器人配置信息 {#3863daf1}

在集成企业微信机器人能力前，需要先在企业微信侧创建一个群机器人，并获取其对应的 Webhook URL。具体操作，请参考[消息推送 Webhook 地址](https://open.work.weixin.qq.com/help2/pc/14931#%E4%BA%8C%E3%80%81%E3%80%8C%E6%B6%88%E6%81%AF%E6%8E%A8%E9%80%81%E3%80%8D%E6%B7%BB%E5%8A%A0%E5%85%A5%E5%8F%A3)。

![Image=424x290](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a6de0e306f7d451eb87ac04a6358ca75~tplv-goo7wpa0wc-topic.webp)

### 步骤二：为工作空间启用外部集成（企业管控操作） {#2420011d}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

### 步骤三：配置企业微信机器人集成 {#565ad7d2}

在**集成管理**页面，单击企业微信机器人对应的**配置**，然后输入你已获取的 Webhook Key。配置后，当前空间下所有集成了企业微信机器人能力的项目，均通过该企业微信机器人发送消息。

:::tip 说明
配置外部集成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中。请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

::::cols
@col 50
![Image=518x340](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3449750244ee4b0db085f32e4e574626~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1049x823](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/72edbfefb23949138fdc146843e9cd58~tplv-goo7wpa0wc-topic.webp)
::::

### 步骤四：为项目接入企业微信机器人集成 {#d63f8c7b}

配置企业微信机器人集成后，你可以在开发 AI 编程项目时，输入添加企业微信机器人集成的需求，让扣子 AI 自动识别并加载企业微信机器人技能来接入企业微信机器人集成。集成后，可以通过企业微信机器人 Webhook 发送文本、卡片等形式的消息，并支持@功能。

![Image=554x355](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/421c41026683452ab472046e3f73d965~tplv-goo7wpa0wc-topic.webp)

## 效果演示 {#5b62dd64}

例如搭建一个搜图工作流，并将搜索到的图片发送到企业微信群中。

::::cols
@col 50
![Image=1677x860](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8230e0f7d43c4ea79f96e4f96bd6127c~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=326x263](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e3107812aec4f86ba4c01d98cedeb1d~tplv-goo7wpa0wc-topic.webp)
::::

## 常见问题 {#eeeb92e4}

[发送图片到企业微信，出现 SignatureDoesNotMatch 错误，如何处理？](/guides/vibe_coding_faq#c8a52c5b)
