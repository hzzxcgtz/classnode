> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成火山方舟大模型服务，用于调用方舟丰富的模型资源，以扩展 AI 编程项目的能力边界。你可以在方舟平台中添加模型推理接入点，然后为 AI 编程项目集成火山方舟模型服务，扩大其可选择的模型范围。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 费用说明 {#672629a3}

通过火山方舟集成服务接入的方舟模型，其产生的 token 费用，由火山方舟平台收取。

## 步骤一：获取火山方舟 API Key {#9fc96312}

在集成火山方舟大模型能力前，需要先在火山方舟平台获取方舟模型的 API Key，该密钥将作为模型调用时的鉴权凭证。具体操作，请参考[API Key 管理](https://www.volcengine.com/docs/82379/1361424)。

![Image=509x112](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/65c9e560211e4ddd85644eabcece15b2~tplv-goo7wpa0wc-topic.webp)

## 步骤二：在方舟平台开通模型 {#43107a3d}

1. 登录[火山方舟控制台](https://console.volcengine.com/ark)。
2. 在左侧导航栏中选择**模型推理** > **在线推理**。
3. 在**自定义推理接入点**页签中，单击**创建推理接入点**。
   ![Image=617x287](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/03ca38a364ed45ec932409c76106932b~tplv-goo7wpa0wc-topic.webp)
4. 根据页面提示，设置接入点名称，并选择模型。
   在方舟平台中开通模型的详细说明可参考[方舟平台官方文档](https://www.volcengine.com/docs/82379/1099522#%E6%A8%A1%E5%9E%8B%E6%8E%A8%E7%90%86%E4%BD%BF%E7%94%A8%E5%85%A5%E5%8F%A3)。
   <!-- @cols-width: 152,667 -->
   | | | \
   |**参数名称** |**参数说明** |
   |---|---|
   |接入点名称 |接入点名称。 |
   |接入点描述 |描述接入模型的业务需求，如接入场景、用途（如测试、线上业务）等。 |
   |模型选择 |单击**添加模型**，在**选择模型**页面，你可以通过**模型广场**或**模型仓库**页签筛选对应的模型。 |\
   | | |\
   | |* 选择**模型广场**中的模型后，需进一步选择模型版本。 |\
   | |* 选择**模型仓库**中的模型后，需进一步选择模型版本和 Checkpoint。当前仅支持基于豆包系列模型进行精调的模型。模型仓库的详细说明，可参考[模型仓库](https://www.volcengine.com/docs/82379/1217587)。 |
   |购买方式 |支持**按Token付费**、**按模型单元付费**。 |
   |接入点限流 |设置限流后，使用此模型的智能体回复频率均受限于此设置。 |\
   | | |\
   | |建议不设置**接入点限流**。 |   


## 步骤三：为工作空间启用外部集成（企业管控操作） {#cacb95cb}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

## 步骤四：配置火山方舟集成 {#b9082598}

在**集成管理**页面，单击火山方舟对应的**配置**，然后输入你已获取的 API Key。

:::tip 说明
配置外部集成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中。请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

::::cols
@col 50
![Image=532x291](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1923f41766264b71878517720bb61526~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1051x827](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b31f36c0a6cd469b954d86f467e37558~tplv-goo7wpa0wc-topic.webp)
::::

## 步骤五：为项目接入火山方舟集成 {#ed597c63}

配置火山方舟集成后，你可以在开发 AI 编程项目时，输入添加火山方舟集成的相关需求，让扣子 AI 自动识别并加火山方舟技能来接入火山方舟集成。

你可以在项目开发过程中，指定要接入你已创建的火山方舟大模型的接入点。例如`调用火山方舟 ep-2025**** 模型提供新闻总结服务`。

![Image=615x395](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/135d2119dd42416e9f5ff70e029c83e0~tplv-goo7wpa0wc-topic.webp)
