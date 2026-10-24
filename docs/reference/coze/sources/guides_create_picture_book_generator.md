> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

从一个简单的任务入手，在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)开发你的第一个 AI 编程项目。本教程以开发儿童绘本生成网站为例，演示如何使用扣子编程开发并部署一个**网页应用**。

在本教程中，你将使用自然语言提示生成一个 Next.js 应用，用户输入主题之后，应用会自动制作对应主题的儿童绘本。此应用生成的绘本图片保存在对象存储中，同时数据库自动保存用户的绘本生成记录。

生成应用之后，你可以在线调试和体验，最终将其公开发布为在线网页应用，以供其他用户浏览使用。

## 步骤一：开发应用 {#bc694afa}

和扣子编程一起，利用大模型生成应用。关于开发网页应用的详细操作步骤，可参考[开发网页应用](/guides/vibe_coding_web_app)。

1. 登录扣子编程。
2. 在扣子编程首页文本框中输入以下提示，创建一个儿童绘本制作工具。
   ```Plain Text
   请帮我开发一个儿童绘本生成器，网页形式。用户输入一个主题，模型自动生成绘本的脚本，然后根据绘本脚本的内容，生成4张画面连续的绘本画面。要求必须使用 seedream 4.5 的 sequential image generation 模式，以保证画风一致、主体形象一致。
   ```
   你需要尽可能清晰且详细地描述应用的功能、界面设计、业务流程等方面的要求，详尽的提示词能让 AI 精准理解你的需求，避免生成的代码偏离你的目标。
   输入提示词时，你也可以同时上传一张图片，帮助模型理解你想要的样式和效果。例如上传一张你想参考的界面设计图片，让扣子编程参考图片上的功能布局和交互来开发你的应用。
   ![Image=454x285](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3f9f99bb0dfe4be58f78b9f47f02a614~tplv-goo7wpa0wc-topic.webp)
2. 扣子编程收到你的需求，开始编写应用代码。
   1. 扣子编程会根据你输入的提示词来开始设计应用、创建项目，并自动为项目设置应用名称。
   2. 创建项目后，将立即启动需求分析，并规划开发流程和步骤，逐步生成应用的前后端代码。
   3. 扣子 AI 会自动生成测试用例并完成一轮单元测试，测试通过后再向你交付成果。
      需要注意的是，如果你的提示词不明确、缺失关键信息，扣子编程则主动追问，请求补充缺失的关键信息。澄清需求时，你同样可以上传附件，为扣子编程提供更丰富的信息。      


## 步骤二：预览与测试 {#41891716}

扣子 AI 编写代码完毕后，会自动构建并启动服务，以提供一个可视化的界面供你预览。你可以在右侧预览页面查看应用的实际运行效果。

对于上文中我们搭建的儿童绘本生成器，其预览效果如下：

![Image=737x317](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4c6444ae58f24b6e8c046c2b3982fd96~tplv-goo7wpa0wc-topic.webp)

你可以在预览区全面测试你的应用，查看其功能是否可用、交互是否完善、AI 能力是否正常。如果发现应用存在问题或有新的需求，你可以随时反馈给扣子 AI，它会根据你的反馈对代码进行调整和优化，并重新构建、部署，以供你审查修复结果。

![Image=746x320](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5298a67aa98e4f71a09bce3ec6b8c786~tplv-goo7wpa0wc-topic.webp)

预览和测试完成之后，即可开始部署应用。

## 步骤三：（可选）调优 {#006bda45}

修复问题和故障之后，这个应用的雏形就基本搭建完成了，你可以选择直接将其部署为网页站点。但是通常情况下，这些应用在功能或交互上仍有可改进之处，此时你可以通过自然语言或编写代码的方式，和扣子 AI 一起迭代你的应用。

### 优化应用 {#6a8071bf}

对于借助 AI 进行的开发流程，最有效的方式是通过迭代来完成开发，你可以持续和扣子 AI 对话，通过多轮交互来不断完善和优化你的应用，使其功能更加丰富、界面更加友好、业务流程更加顺畅。

例如，对于较为复杂的故事场景，4 张图片数量明显不足，我们可以要求扣子 AI 增加图片生成的数量，以满足复杂故事场景对于丰富画面展示的需求。

```Plain Text
将 4 张图片改为 10 张图片。
```

![Image=761x351](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cefb3a265fbd4d77ba723beafc915605~tplv-goo7wpa0wc-topic.webp)

扣子编程提供了一个基于 Web 的 AI 编程开发环境，你可以在代码编辑器中修改代码文件、在终端中执行命令调试代码，或者将代码文件和内容引用到对话区，通过对话和扣子 AI 一起开始优化代码和应用。关于 AI 编程开发环境的使用技巧，可参考[AI 编程环境](/guides/vibe_coding_environment)。

![Image=755x327](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bd2e95d184974b54b53fc8997bdbcbc8~tplv-goo7wpa0wc-topic.webp)

### 为应用添加功能 {#6f95e7ec}

扣子编程封装了一批常见的集成能力接口，方便你快速为应用添加各种功能，例如数据库、存储、AI 能力等，使应用更好地满足多样化的业务需求。

* **添加 AI 能力**：扣子编程托管了业界先进的各种模型服务，无需任何配置，扣子 AI 会自动为你的应用添加 AI 能力，帮助你开发更为智能的应用程序。例如，当前的儿童绘本制作工具已经集成了文本大模型和生图大模型，用于生成脚本和绘本图片。
* **存储与数据库**：扣子编程提供了结构化数据托管方案，对于需要集成数据库和存储能力的应用，扣子 AI  会根据任务要求自动集成并设置数据库能力和存储能力。你也可以在对话区发送自然语言指令，为应用集成存储或数据库能力。
   输入以下提示词，将此应用生成的绘本图片保存在对象存储中，同时数据库自动保存用户的绘本生成记录。
   ```Plain Text
   1. 所有绘本图片默认保存在对象存储中
   2. 数据库自动记录每个用户的绘本生成记录，包括生成时间、绘本主题、图片地址等关键信息。 
   ```   


目前网页应用仅支持接入内置集成服务，关于内置集成服务的详细说明，可参考[内置集成](/guides/internal_integrations)。

## 步骤四：部署应用 {#ba3a7dec}

完成应用的开发与测试之后，你可以在页面右上角单击**部署**，将扣子编程搭建的应用部署成为一个公开可访问的在线项目，将你的创意和原型，转化为服务于真实用户的产品。

1. 在页面右上角单击**部署**。
2. （可选）添加部署配置。配置方式可参考[部署网页应用](/guides/deploy_vibe_web)。
   * 网页应用默认部署在扣子提供的统一域名中，格式为 `xxx.coze.site` 。你也可以选择部署到一个已备案的自定义域名下。
   * 当前仅支持**公开部署**，即发布后所有用户都可以访问该网页。
3. 单击**开始部署**。
   扣子编程将自动进行部署相关操作。你可以在部署页面查看部署的进展和部署日志。部署过程可能需要几分钟，请耐心等待。部署过程中，你可以随时取消部署。
   ![Image=659x280](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d9fef5f6ea764a0d98724fbc7325645d~tplv-goo7wpa0wc-topic.webp)   


部署成功之后，你的应用已正式上线！你可以通过访问部署域名来访问这个儿童绘本制作工具，将网页地址分享给你的好友，或者发布到社交平台，让更多用户来体验使用吧！

::::cols
@col 50
![Image=1078x717](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a09805876dfa407a9239fcb6c0821cc3~tplv-goo7wpa0wc-topic.webp)

@col 50

::::

## 继续探索扣子编程 {#a8dbdbfc}

在开发过程中，扣子编程提供一系列功能特性提升你的开发体验、提高开发效率，你可以按需灵活使用这些特性，探索更丰富的开发场景，创造出更具创意和实用性的应用。

* [AI 编程环境](/guides/vibe_coding_environment)
* [内置集成](/guides/internal_integrations)
* [回滚开发版本](/guides/version_management#499da712)、[回滚部署版本](/guides/deployment_history)
* [管理环境变量](/guides/environment_variables)
* [配置自定义域名](/guides/configure_custom_domain)
* [查看日志和 Trace](/guides/view_running_log)
