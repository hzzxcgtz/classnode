> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

除了从零开发以外，你还可以导入现有的代码文件，在扣子编程继续你的开发工作，或者通过扣子编程将其部署为线上服务。

## 功能介绍 {#91c388f6}

通过导入项目功能，你可以将已有的代码工程快速迁移到扣子编程环境中，进行后续开发、调试和部署。扣子编程支持两种导入方式：

* **从 GitHub 导入**：支持导入你的公开或私有 GitHub 仓库。项目导入后会自动与原仓库绑定，方便你进行代码的双向同步和版本控制。
* **从本地导入**：支持通过上传 `.zip` 等格式的压缩包来导入项目。此方式不仅适用于迁移本地项目，也常用于项目在不同工作空间或企业间的备份与迁移。

这项功能主要适用于以下场景：

* **迁移现有项目**：将你在其他平台或本地开发的项目迁移至扣子编程，以利用其 AI 编程和云端开发环境。
* **快速部署服务**：将已有的成熟项目导入，并直接使用扣子编程的部署能力，将其快速发布为在线应用或服务。
* **团队协同开发**：团队成员可将同一个 GitHub 仓库导入进行协作开发，同时保持与标准 Git 工作流的一致性。
* **项目备份与迁移**：通过“导出再导入”的方式，可以实现项目在不同工作空间、甚至不同企业组织之间的安全迁移。

## 准备工作 {#b0ee3aa7}

## 从 GitHub 导入 {#2e5a7601}

从 GitHub 导入项目时，自动导入仓库中所有文件，包括源码、静态资源和文档等。

:::tip 说明
暂不支持导入超过 500MB 的 GitHub 代码仓库。
:::

### 步骤一：GitHub 账号授权 {#8310203c}

导入项目之前，需要先为工作空间配置 GitHub 账号授权。

:::tip 说明
* **权限要求**：空间所有者或管理员。
* **授权范围**：指定工作空间。授权后，此**工作空间**下所有的 AI 编程项目都可以绑定这个账号下的代码仓库。
* **访问控制**：在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

操作方式如下：

1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 找到要授权的工作空间。
   个人免费版只有一个默认的个人空间，无需切换，可以直接跳过此步骤。
   ::::tabs
   @tab 个人版
   在页面左下角头像处切换工作空间。
   
   ![Image=148x208](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1fa28a2a79a246f2a10ac74e1802b0ef~tplv-goo7wpa0wc-topic.webp)
   
   @tab 企业版&团队版
   在页面左下角头像处切换组织之后，在左上角切换工作空间。
   
   ![Image=125x183](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0ddd74d2329c4faba85fad4e60d28b39~tplv-goo7wpa0wc-topic.webp)
   ::::
3. 在左侧导航栏中，单击**集成管理**。
4. 在 Git 服务页签中找到 **GitHub**，并单击**配置**。
   ![Image=467x187](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/129f9cc785764053b37da4d2ceb3796f~tplv-goo7wpa0wc-topic.webp)
5. 根据页面提示登录 GitHub 账号，并完成授权。
   ![Image=127x175](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/11a22195201048a486695c6347574c94~tplv-goo7wpa0wc-topic.webp)
   GitHub 服务一栏中，如果提示**已配置**，表示已完成账号授权和绑定。
   ![Image=503x132](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/44214ce47d3f45c3a3444304dcb1f82c~tplv-goo7wpa0wc-topic.webp)   


### 步骤二：从 GitHub 导入 {#ac5fc184}


1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左侧导航栏中，单击**导入** > **GitHub 导入**。
3. 选择需要导入的项目。
   ![Image=259x324](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1f83e655af2940f6b85a093333b4f977~tplv-goo7wpa0wc-topic.webp)
4. 扣子编程自动执行初始化配置。
   编程 AI 会自动从 GitHub 仓库中拉取项目代码，克隆到扣子编程项目中。这期间，还会自动查看并理解源码，补齐 `AGENTS.md` 等必要的内容。
   ![Image=428x206](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/64de4027ad924fbc9012cd1f4ff771a5~tplv-goo7wpa0wc-topic.webp)
5. 完成导入。
   扣子编程完成项目初始化配置之后，会自动构建项目，你可以在页面右侧查看并调试。
   ![Image=452x252](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/13bf9dec802842da9074d10c8443da34~tplv-goo7wpa0wc-topic.webp)   


## 从本地导入 {#ee973188}

除了从 GitHub 仓库导入，扣子编程也支持你上传本地项目压缩包来创建新项目。

### 导入要求 {#533198f3}

* **文件格式**：必须是压缩文件，格式为 `.zip`、`.tar` 或 `.tar.gz`。
* **文件结构**：解压后必须是单个文件夹。
* **体积限制**：文件夹内每个文件不超过 500 MB。

### 操作步骤 {#8edaacc5}


1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左侧导航栏中，单击**导入** > **本地上传**。
   ![Image=468x234](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ef4cdb715edd43c8859041d58238b6ee~tplv-goo7wpa0wc-topic.webp)
3. 选择要上传的 Zip 文件，并单击**确定**。
   ![Image=372x278](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e005687e714340719cb5a722c08c6b84~tplv-goo7wpa0wc-topic.webp)
4. 扣子编程自动执行初始化配置。
   编程 AI 会自动解压你上传的文件，并将其作为项目源码。这期间，它还会自动查看并理解源码，补齐 `AGENTS.md` 等必要的项目内容。
   ![Image=416x245](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/95c01387a15f49ef888c0beb35a3fc33~tplv-goo7wpa0wc-topic.webp)
5. 完成导入。
   扣子编程完成项目初始化配置之后，会自动构建项目，你可以在页面右侧打开新标签页，并单击**预览**来在线调试。
   ![Image=430x240](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/13bf9dec802842da9074d10c8443da34~tplv-goo7wpa0wc-topic.webp)   


## 继续开发 {#761a9321}

导入项目之后，如果你的项目还需要修改和优化、调试和修复，可以参考以下文档，与编程 AI 一起继续开发与调试。

* [开发网页应用](/guides/vibe_coding_web_app)
* [开发移动应用](/guides/vibe_coding_app)
* [开发小程序](/guides/vibe_coding_miniapp)
* [开发智能体](/guides/vibe_coding_agent)
* [开发工作流](/guides/ai_powered_workflow_development)

## 后续操作 {#719b91ab}


1. 部署应用。
   完成应用的开发与测试之后，你可以在页面右上角单击**部署**，将扣子编程搭建的应用部署成为一个公开可访问的在线项目，将你的创意和原型，转化为服务于真实用户的产品。详细操作步骤可参考[部署网页应用](/guides/deploy_vibe_web)。
   ![Image=465x199](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/55e412d16972431299c0c280bf3aa431~tplv-goo7wpa0wc-topic.webp)
2. 分享项目。
   在项目搭建页面右上角单击**分享**按钮，可以将部署成功的项目分享给他人。   


![Image=1420x359](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b2c5dac1a8384499b2acc845a6607180~tplv-goo7wpa0wc-topic.webp)

### 查看线上日志 {#e79b6625}

查看已发布的应用、智能体和工作流的前后端运行日志，以便在出现问题时进行故障排查和分析。详细说明可参考[查看日志和 Trace](/guides/view_running_log)。

![Image=462x309](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f888d181901f44b2b5f3e71466bca410~tplv-goo7wpa0wc-topic.webp)
