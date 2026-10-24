> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程现已支持自然语言开发微信、抖音小程序。在扣子编程首页输入你的创意，从零开始开发你的微信小程序，并一键部署上线。

## 功能概述 {#cb578d75}

扣子编程提供了一个基于 Web 的 AI 编程开发环境，你可以直接在网页中与扣子 AI 对话，描述你想要开发的小程序的功能、界面、逻辑等需求，扣子 AI 会自动完成小程序的开发、测试、迭代和发布。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 费用说明 {#a59f20cd}

开发、测试、部署、线上使用小程序时，以下操作将消耗你的扣子积分。

* [编程任务](https://docs.coze.cn/coze_pro/task_fee)：与扣子 AI 的每轮对话。
* [内置集成](https://docs.coze.cn/coze_pro/internal_integrations_fee)：调用大语言模型、联网搜索、图像生成等内置集成服务。
* [服务托管费用](/coze_pro_service_hosting_fee)：部署为线上服务，将产生服务托管费。

## 配额与限制 {#c515d4c2}

开发小程序时，存在可创建的项目数量、可回滚版本数、可部署的次数等配额限制，详细说明，请参考[配额与限制](/guides/vibe_coding_limit)。

## 开发小程序 {#f52fc4db}

参考以下流程，通过 AI 编程开发小程序。

### 准备工作 {#b09ff805}

在开始开发之前，你需要在微信公众平台或抖音开放平台完成小程序的注册和基础配置。

<!-- @cols-width: 117,724 -->
| **平台**  | **说明**  |
| --- | --- |
| 微信小程序  | * **注册小程序**：前往 [微信公众平台](https://mp.weixin.qq.com/)，按照官方[小程序注册指引](https://developers.weixin.qq.com/miniprogram/introduction/#%E5%B0%8F%E7%A8%8B%E5%BA%8F%E6%B3%A8%E5%86%8C)完成小程序账号的注册。 | \
| | * **获取 AppID**：在[微信公众平台](https://mp.weixin.qq.com/)左侧导航栏单击**管理** > **开发管理**，在**开发设置**页签的**开发者 ID** 区域找到并复制 AppID。这是小程序的唯一标识，后续步骤将会用到。 | \
| |    ![Image=293x166](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c4a4e16ab07e419e840e0e01d96ce65b~tplv-goo7wpa0wc-topic.webp)  |
| 抖音小程序  | * **注册小程序**：前往[抖音开放平台](https://developer.open-douyin.com)，按照官方[小程序注册指引](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/introduction/develop-process/prepare)完成小程序账号的注册。 | \
| | * **获取 AppID**：在[抖音开放平台](https://developer.open-douyin.com)的小程序页签下，单击目标小程序，获取 AppID。这是小程序的唯一标识，后续步骤将会用到。 | \
| |    ![Image=307x129](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/77730a0cc4b4471b9a89c27509926f68~tplv-goo7wpa0wc-topic.webp)  |

### 步骤一：需求澄清 {#53e47469}

1. 创建小程序并输入你的需求。
   1. 在扣子编程首页，单击**小程序**选项卡。
   2. 在文本框输入你的提示词。
      你需要尽可能清晰且详细地描述小程序的功能、界面设计、业务逻辑等方面的要求。例如，你可以输入以下提示：
      ```Plain Text
      帮我制作一个小程序，用于学习普通话情景对话
      1. 模型随机生成并展示 3 个不同主题，例如买菜、问路、面试等，用户进入页面时，选择一个主题，模型根据主题生成一段对话数据，并展示给用户
      2. 类似聊天气泡的布局展示对话，每个汉字上方标注拼音，点击气泡可以朗读语句，整体有个录音按钮，用户可以跟读并录音，跟读完听回放
      ```
      ![Image=544x198](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/97b37da73d654d8497dbf103ee74df3b~tplv-goo7wpa0wc-topic.webp)
   3. （可选）进阶配置：通过上传附件、选择协作模式、添加技能、选择编程模型，让扣子 AI 生成的结果更精准、更符合你的预期。
      ![Image=403x166](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4b0e13657c5d4b9786d4750a5ce4a89b~tplv-goo7wpa0wc-topic.webp)
   ::::tabs
   @tab ① 上传附件
   酌情上传一些图片或文件，作为附加信息提供给扣子 AI，以便扣子 AI 能更理解你的需求。例如上传一张你想参考的界面截图、想要的风格示例图片等，这些都能帮助扣子 AI 更精准地把握细节要求。
   
   @tab ② 选择协作模式
   默认情况下为 **Agent 模式**，如果你对需求不确定，可以先切换到**问答模式**讨论方案，在方案确认后，再切换到**Agent 模式**，由扣子 AI 根据此前的讨论结论执行开发任务。更多信息，请参考[如何选择协作模式？](/guides/vibe_coding_faq#3069a332)。
   
   @tab ③ 调用技能
   扣子 AI 现已支持添加编程技能（Skill），在执行编程任务时，扣子 AI 可以按需加载技能，从而具备相应的专业领域知识和能力。例如，前端设计技能可以有效指导模型如何排版、设计配色和动画效果、处理背景等等，能显著提升模型的 UI 生成能力，减少产物视觉效果的“AI 味”。
   
   AI 编程项目中，扣子 AI 可用的编程技能如下：
   
   * **官方技能**：扣子编程官方提供的集成服务，可一键集成各种常见能力，例如图片生成、视频生成等。
   * **我的技能**：开发者自行上传的编程技能。你可以上传扣子编程或扣子制作的技能包，也可以上传外部开源技能包。制作及上传技能的方式可参考[开发技能](/guides/vibe_coding_skill)、[使用技能](/guides/using_skill)。
   
   ![Image=354x274](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d46d93bbbc3a4407b6868ac1c76af067~tplv-goo7wpa0wc-topic.webp)
   
   @tab ④ 选择编程模型
   扣子编程已集成 Doubao、GLM、Kimi、DeepSeek 等主流的编程模型，用于开发应用。为了达到较好的开发效果，系统会自动为你选择适合当前场景的模型，你也可以根据模型的官方介绍自行选择。
   ::::
   4. 在键盘中敲击回车，开始开发你的项目。
      扣子 AI 会根据你输入的提示词来开始设计小程序、创建项目，并自动为项目设置小程序名称。
2. （可选）澄清你的需求。
   扣子 AI 收到你的提示词之后，如果判断提示词不明确、缺失关键信息，不足以支撑 AI 生成合适的 PRD 和产品原型，则会向你发送提示，请求补充缺失的关键信息。
   澄清需求时，你同样可以上传附件，为扣子 AI 提供更丰富的信息。   


### 步骤二：AI 编程开发小程序 {#e20eae98}

扣子 AI 收到你的需求之后，将立即启动需求分析，并规划开发流程和步骤，逐步生成小程序的前后端代码。代码生成完毕后，自动构建并启动服务，以提供一个可视化的界面供你预览。

如果扣子 AI 判断你的小程序需要数据库、存储、身份认证、AI 等能力，则会自动添加和配置对应的集成，为你的小程序设计数据库表、配置存储系统，实现相关功能。

![Image=341x430](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/15747589a6904892b0fd2a7c4b2f5ce4~tplv-goo7wpa0wc-topic.webp)

### 步骤三：预览与测试 {#53d3f6b2}

初步生成后端代码后，扣子 AI 会自动生成测试用例并完成一轮单元测试。测试通过后扣子 AI 会提供后端代码的预览，同时提醒你对后端开发部分进行验收，你可以在右侧预览页面查看后端功能的实际运行效果。

:::tip 说明
录音等部分功能仅在小程序真机调试时可用，建议配置 AppID 之后通过微信或抖音扫码预览真机效果。
:::

小程序预览界面如下：

![Image=663x385](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bdd4e40ef6a647cb86211c28c7e0afc5~tplv-goo7wpa0wc-topic.webp)

为了体验小程序在手机上的效果，建议参考以下流程真机调试小程序。

#### 1. 绑定小程序 {#24e36ea2}

::::tabs
@tab 微信
1. 在扣子编程打开小程序项目，在页面右下角单击 **AppID 设置**。
   ![Image=372x305](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ed14bccab6e14e91b861f86a90ac1aac~tplv-goo7wpa0wc-topic.webp)
2. 在弹出页面中填写 AppID，并单击**绑定**。
   **AppID** 是你在[准备工作](/guides/vibe_coding_miniapp#b09ff805)中获取的 AppID。
   ![Image=226x377](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3f29fb998fd446ee894de96fdf3a7686~tplv-goo7wpa0wc-topic.webp)
3. 完成公众平台账号授权。
   单击**绑定**后，系统默认打开授权页面，使用小程序的管理员微信号扫描授权二维码，并根据页面提示完成授权。
   ![Image=404x219](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d3960335ca0d42d488bb579c7a94bb15~tplv-goo7wpa0wc-topic.webp)

@tab 抖音
1. 在扣子编程打开小程序项目，在页面右下角单击 **AppID 设置**。
   ![Image=237x195](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ed14bccab6e14e91b861f86a90ac1aac~tplv-goo7wpa0wc-topic.webp)
2. 在弹出页面中填写 AppID，并单击**绑定**。
   **AppID** 是你在[准备工作](/guides/vibe_coding_miniapp#b09ff805)中获取的 AppID。
   ![Image=125x257](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/566d967b1a5e4e2da87fdc625115bc88~tplv-goo7wpa0wc-topic.webp)
::::

#### 2. 真机调试小程序 {#07532ed8}

成功绑定小程序之后，就可以使用管理员微信、抖音扫描页面右侧的二维码，在手机上调试小程序。

调试方式如下：

<!-- @cols-width: 197,423,239 -->
| **操作**  | **说明**  | **示例**  |
| --- | --- | --- |
| 预览小程序  | 使用管理员微信、抖音，在**预览**页面右下角扫描二维码，即可在手机上预览你的小程序。  | ![Image=1117x941](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/59f365d8cef94c6a9025aaf67621a5fc~tplv-goo7wpa0wc-topic.webp)  |
| 全面测试  | 全面测试你的小程序，通常建议关注以下问题： | ![Image=120x260](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/53274faedcfc45e8b09c8766eb9510cb~tplv-goo7wpa0wc-topic.webp)  | \
| | | | \
| | * **功能是否可用**：验证小程序的核心链路是否完整可操作、数据的增删改查是否能成功执行。 | | \
| | * **交互是否完善**：检查页面元素是否完整显示、布局是否合理、样式是否符合设计要求、各个按钮是否都能正确触发。 | | \
| | * **AI 能力是否正常**：如果你的小程序集成了 AI 能力，例如文本生成、图片生成等，验证 AI 模型的输出是否符合预期。  | |
| 修复故障  | 如果页面报错，扣子 AI 会自动识别并提示你修复故障，你可以根据页面提示，单击**一键修复**，允许扣子 AI 尝试修复这些问题。 | ![Image=1324x1048](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2d5d2eab83b54e4698653f5f2d7f582b~tplv-goo7wpa0wc-topic.webp)  | \
| | | | \
| | 如果你在体验小程序的过程中触发页面报错，或者页面交互、生成结果不符合你的预期，你也可以主动复制报错信息、描述预期的结果，并粘贴到左侧输入框中，要求扣子 AI 修复故障。  | |

## 迭代小程序 {#794facfc}

修复问题和故障之后，这个小程序的雏形就基本搭建完成了，你可以选择直接部署，以供其他微信或抖音用户使用。但是通常情况下，这些小程序在功能或交互上仍有可改进之处，此时你可以通过自然语言或编写代码的方式，和扣子 AI 一起迭代你的小程序。

### 调整需求 {#c8822147}

如果之前某次对话中你输入的描述有误或不准确，导致扣子 AI 生成的小程序无法满足你的需求，相对于回滚版本再重新对话生成小程序，直接修改你发送的历史消息会更加高效。你可以在对话记录中找到该历史消息，对其进行修改后敲击回车，扣子 AI 会根据新的描述对小程序进行调整和优化。同时扣子 AI 的版本记录里也会另起一个分支来记录本次及后续的变更。

![Image=478x471](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/809695dbaa384d99b6cdbdef56698208~tplv-goo7wpa0wc-topic.webp)

### 编辑小程序 {#b5f13c2d}

和扣子 AI 一起持续优化小程序，直到实现预期的效果。你可以在对话区中通过自然语言描述你的修改建议，和扣子 AI 一起优化你的小程序。例如输入以下提示词：

```Plain Text
增加一个返回首页的按钮
```

![Image=547x376](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9fff645c1ad1448896fffeb0e8b1460c~tplv-goo7wpa0wc-topic.webp)

### 回滚开发版本 {#6672685d}

扣子 AI 使用当前的先进模型来完成任务，但由于模型生成代码的随机性，有时可能无法完全满足你的需求，生成了不符合预期的代码，或者出现了反复修复失败的故障，此时你可以使用回滚版本功能，将小程序恢复到之前正常的版本状态。

在对话区顶部单击**版本历史**图标，找到要恢复的版本，在其右侧单击**回滚**图标。

![Image=541x398](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/da1e47c6319646c4a6a992064aa648b9~tplv-goo7wpa0wc-topic.webp)

## 集成能力 {#d912c5d4}

扣子编程通过**技能**方式封装了一批常见的集成能力接口，方便你快速为小程序添加各种功能，例如数据库、存储、AI 能力等，使小程序更好地满足多样化的业务需求。

在和扣子 AI 对话，添加集成能力之前，你需要先在扣子 AI 对话区域单击**技能**，确认扣子 AI 已添加了你想要的技能。

![Image=439x318](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6ea46d966e4b42e59d2540982aa06745~tplv-goo7wpa0wc-topic.webp)

### 存储与数据库 {#4bc8b6e8}

扣子编程提供了结构化数据托管方案，对于需要集成数据库和存储能力的小程序，扣子 AI  会根据任务要求自动集成并设置数据库能力和存储能力。例如开发一个电商小程序，扣子 AI 会自动集成数据库来管理商品信息、订单数据等，同时设置存储能力以存储商品图片、用户上传的评价图片等。

你也可以在对话区发送自然语言指令，为小程序集成存储或数据库能力。例如：

```Plain Text
使用数据库记录用户登录、浏览和购买行为数据
```

关于存储和数据库集成的详细说明，可参考[集成数据库能力](/guides/integrate_database)、[集成对象存储能力](/guides/integrate_storage)。

### AI 能力 {#c36bd8e9}

为小程序添加 AI 能力时，通常需要开通模型服务并获取 API 密钥、并自行完成模型调用的配置与开发。扣子编程托管了业界先进的各种模型服务，无需任何配置，扣子 AI 会自动为你的小程序添加 AI 能力，帮助你开发更为智能的小程序。例如，搭建一个多语言翻译的小程序，通过大模型翻译将用户的输入翻译为指定的语言，提供高效、低成本的翻译服务。

默认情况下，你的项目已开通了大模型集成的权限，扣子编程会在收到指令后，自动为小程序添加 AI 功能。你也可以在对话区发送自然语言指令，让扣子 AI 集成大模型能力。例如：

```Plain Text
使用豆包模型总结检索到的资讯，并整理为资讯日报
```

关于大模型集成详细说明，可参考[内置集成](/guides/internal_integrations)。

## 后续操作 {#e60981d9}

### 部署小程序 {#fc6dbfde}

完成小程序的开发与测试之后，你需要在微信公众平台或抖音开放平台完成**小程序的配置和备案**，然后在页面右上角单击**部署**，将扣子编程搭建的小程序部署成为一个公开可访问的小程序，将你的创意和原型，转化为服务于真实用户的产品。详细操作步骤可参考[部署小程序](/guides/deploy_vibe_miniapp)。

::::cols
@col 50
![Image=1639x597](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0ba4eed019d0401ab342c53ffcafd69e~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=506x362](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a571187ec85d4127a7a2fe7c943a1139~tplv-goo7wpa0wc-topic.webp)
::::

### 分享项目 {#000c78fe}

部署完成，微信平台或抖音平台审核通过之后，你的用户可在微信或抖音中根据小程序名称搜索并使用这个小程序。

::::cols
@col 50
![Image=1146x480](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3003de81cdd34f49a9310c86df54d919~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=168x236](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/18abca0f2a844f0fa535256dbbb81429~tplv-goo7wpa0wc-topic.webp)
::::

### 查看线上日志 {#0c9e77a9}

查看已发布的小程序、智能体和工作流的前后端运行日志，以便在出现问题时进行故障排查和分析。详细说明可参考[查看日志和 Trace](/guides/view_running_log)。

![Image=675x398](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4ecccafe0b774c50b77f5a85c3bb6b7c~tplv-goo7wpa0wc-topic.webp)

### 下架小程序 {#04edfa5a}

如果要下架小程序，需要在微信开放平台或抖音开放平台解除扣子编程的绑定关系，然后暂停小程序服务。操作步骤如下：

::::tabs
@tab 下架微信小程序
1. 管理员登录微信开放平台，解除绑定关系。
   1. 在页面左下角单击头像，单击账号设置

   ![Image=320x184](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bff13d73b2674bbc9b6625969314889d~tplv-goo7wpa0wc-topic.webp)
   2. 单击**第三方设置**页签。
   3. 找到扣子编程，并在操作列单击**解除授权**，根据页面提示完成后续操作。

   ![Image=326x205](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8a359691af5148c694b2513e12ce8f95~tplv-goo7wpa0wc-topic.webp)
2. 暂停小程序服务。
   1. 进入**设置** > **基本设置**页面。

   ![Image=329x225](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6e0c41a8eb014e3d983b0020f0d1b5e4~tplv-goo7wpa0wc-topic.webp)
   2. 在账号信息区域单击**暂停服务**按钮。
   3. 选择**暂停原因**和**预计恢复**时间，单击**确定关闭**。

   ![Image=387x245](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d8962277d8aa42fab8fed7b38b2ca506~tplv-goo7wpa0wc-topic.webp)

@tab 下架抖音小程序
1. 登录[开发者平台](https://developer.open-douyin.com/)，在右上角单击**控制台**。
2. 打开待下架的小程序，在其左侧导航栏，选择**设置**>**基础设置**。
3. 在**功能信息**区域，找到**小程序状态**，单击**下架**。
4. 在**下架小程序**对话框中获取并填写验证码，单击**提交**。
   如果是重点小程序，需要先填写下架申请，才能操作下架。
::::
