> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

为了便于多人协作开发和远程备份，你可以将项目绑定到 GitHub 仓库，使用 Git 服务进行代码同步。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 功能介绍 {#446817ca}

扣子编程的 Git 服务允许你将 AI 编程项目与 GitHub 仓库进行绑定和同步。

* **绑定仓库**：将项目绑定到 GitHub 仓库，便于团队协作开发。
* **Push 和 Pull**：拉取和推送代码到 GitHub 仓库，实现代码的同步和备份。
* **解决冲突**：可视化展示冲突的代码文件，帮助你解决冲突。
* **终端操作**：对于习惯使用命令行的开发者，也可以在 AI 编程环境的终端中直接使用 Git 命令进行操作。

## 注意事项 {#e010ddaf}


* **服务范围**：Git 服务目前仅支持 GitHub。
* **同步范围**：目前仅同步 main 分支，暂不支持创建或切换分支。

## 准备工作 {#0e373c6f}

在你的 AI 编程项目中使用 Git 服务之前，需要先为工作空间配置 GitHub 账号授权。

:::tip 说明
* **权限要求**：空间所有者或管理员。
* **授权范围**：指定工作空间。授权后，此**工作空间**下所有的 AI 编程项目都可以绑定这个账号下的代码仓库。
   仅支持绑定 **owner 为当前授权账号** 的仓库，暂不支持 **组织账号仓库** 或 **非当前授权账号 owner** 的仓库。
:::

操作方式如下：

1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 找到要授权的工作空间。
   免费版只有一个默认的个人空间，无需切换，可以直接跳过此步骤。
   ::::tabs
   @tab 个人版
   在页面左下角头像处切换工作空间。
   
   ![Image=148x208](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1fa28a2a79a246f2a10ac74e1802b0ef~tplv-goo7wpa0wc-topic.webp)
   
   @tab 企业版
   在页面左下角头像处切换组织之后，在左上角切换工作空间。
   
   ![Image=125x183](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0ddd74d2329c4faba85fad4e60d28b39~tplv-goo7wpa0wc-topic.webp)
   ::::
3. 在左侧导航栏中，单击**集成管理**。
4. 在 Git 服务页签中找到 **GitHub**，并单击**配置**。
   ![Image=659x264](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/129f9cc785764053b37da4d2ceb3796f~tplv-goo7wpa0wc-topic.webp)
5. 根据页面提示登录 GitHub 账号，并完成授权。
   ![Image=194x267](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/11a22195201048a486695c6347574c94~tplv-goo7wpa0wc-topic.webp)
   GitHub 服务一栏中，如果提示**已配置**，表示已完成账号授权和绑定。
   ![Image=668x175](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/44214ce47d3f45c3a3444304dcb1f82c~tplv-goo7wpa0wc-topic.webp)   


## 使用方法 {#b264cdcb}

在你已创建的 AI 编程项目中，通过以下方式使用 Git 服务。

### 绑定仓库 {#6bf11146}

通过 Git 服务为 AI 编程项目设置并连接 GitHub 仓库，以便通过 GitHub 进行备份和多人协作。支持绑定新仓库或已有仓库。绑定步骤如下：

1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左侧导航栏中，单击**项目管理**。
3. 找到你的 AI 编程项目，并打开项目。
4. 在右侧新建标签页，并选择**版本控制**。
   ![Image=521x238](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/073314db456b42a084d1bbab8631aa3a~tplv-goo7wpa0wc-topic.webp)
5. 单击**绑定仓库**。
   ![Image=522x255](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c2d4d800f1549549abed1c80f256d1f~tplv-goo7wpa0wc-topic.webp)
6. 新建仓库或选择一个已有仓库。
   你可以在这里看到此账号下的所有仓库，如果仓库数量比较多，你还可以通过检索框来查找仓库。注意需要输入正确的仓库名称。
   ![Image=201x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d6b1eaf5a45f4e9e9cb92215b549a069~tplv-goo7wpa0wc-topic.webp)   


成功绑定仓库后，你就可以看到 Push 和 Pull 操作的按钮、版本检查的提醒。

![Image=563x248](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9567a0552ae24825810d44278292d791~tplv-goo7wpa0wc-topic.webp)

### Push 操作 {#f63bf437}

Push 操作可将 AI 编程项目的代码推送到远程仓库。

* 首次绑定仓库后，页面会提示你“有未推送的更改”，说明 GitHub 仓库版本落后于扣子编程项目，你可以选择 Push 操作，将扣子编程项目代码推送到 GitHub 仓库。
* AI 编程项目的每次改动，也都可以通过 Push 操作同步到 GitHub。

操作步骤如下：

1. 在 AI 编程项目的版本控制页面中，单击 **Push**。
   ![Image=589x337](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6ba400258652401c837bf9a82ac13f3a~tplv-goo7wpa0wc-topic.webp)
2. 确认要同步的 Commit 列表，并单击 **Push**。
   如果暂时不想同步这些 Commit，可以单击**忽略**，表示取消这次操作。
   ![Image=426x385](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/fae09e85760646fda90867a9ae492a5c~tplv-goo7wpa0wc-topic.webp)
3. Push 完成后，页面会提示**已同步**，表示推送成功。
   项目的版本列表中也会添加一个新版本，并注明这个版本来自 agent，即扣子编程 AI。
   ![Image=531x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8a688f35ee274e458b98d00400ecc143~tplv-goo7wpa0wc-topic.webp)   


### Pull 操作 {#12606ba8}

Pull 操作可以从远程拉取更新，例如协作者提交到 GitHub 上的更新。当远程有新的提交时，扣子编程会提示你“远程有更新”， 你可以选择 Pull 操作，把远程更新同步到你的 AI 编程项目中。

操作步骤如下：

1. 在 AI 编程项目的版本控制页面中，单击 Pull。
   ![Image=626x276](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ad6a2abb13064cc885737247a507650b~tplv-goo7wpa0wc-topic.webp)
2. Pull 完成后，页面会提示**已同步**，表示拉取成功。
   项目的版本列表中也会添加一个新版本，并注明这个版本来自 GitHub。
   ![Image=630x218](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c68c6b6f4daf4af58539b95e13c5d5e3~tplv-goo7wpa0wc-topic.webp)   


### 冲突处理 {#f9085531}

Push 或 Pull 时，不同来源的代码可能会发生冲突，扣子编程会识别冲突的文件内容，并可视化展示冲突代码的两个版本，供你选择保留哪一个版本，解决之后再帮你合并冲突。

例如拉取 GitHub 上的更新时，扣子编程提示冲突，你需要选择处理机制：

* **全部保留我的版本**：放弃远程的所有修改，仅保留扣子编程项目的内容。
* **全部使用远程版本**：用远程仓库的文件覆盖你扣子编程项目的所有冲突文件。

![Image=407x331](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/37a6bd0002a846ffa209b8461045b323~tplv-goo7wpa0wc-topic.webp)

### 使用 Git 命令 {#5f2b7b61}

如果你习惯使用终端来执行 Git 操作，也可以在 AI 编程环境的终端区域直接输入 Git 命令行。目前支持 Pull 和 Push 相关的常见 Git 命令，例如：

* 拉取远程变更：`git pull`
* 推送变更到远程：`git push`
* 查看文件修改状态：`git status`
* 查看提交历史：`git log`
* 提交变更：`git commit -m"feat: 新增xxx"`

## 常见问题 {#b08fb53d}

### 如何更换授权的 GitHub 账号？ {#98d9a944}

你可以取消授权，再登录其他 GitHub 账号来完成授权。取消授权后，此工作空间下所有已绑定的 GitHub 仓库会自动解绑，若有需要，你可以自行绑定其他仓库。

1. 在**集成管理** > **Git 服务**页面中，单击**取消配置**，并根据页面提示取消授权。
   ![Image=483x239](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8d1dc2098687446baeb26881fc9067b0~tplv-goo7wpa0wc-topic.webp)
2. 使用其他账号登录 [GitHub](https://github.com/)。
   换绑之前必须登录你想授权的另一个 GitHub 账号，否则扣子编程会使用你当前登录账号直接完成授权。
3. 在**集成管理** > **Git 服务**页面中，单击**配置**，完成授权。
   ![Image=659x264](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/129f9cc785764053b37da4d2ceb3796f~tplv-goo7wpa0wc-topic.webp)   


### 如何更换绑定的 GitHub 仓库？ {#0739d07b}

为 AI 编程项目解除仓库绑定，并重新绑定一个仓库即可。

1. 在 AI 编程项目的**版本控制**页面，单击解绑图标。
2. 单击**解绑仓库**。
   ![Image=653x340](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d5cc7b6bed1b470e99b4fff510dfcc78~tplv-goo7wpa0wc-topic.webp)
3. 单击**绑定仓库**，根据页面提示重新绑定仓库即可。
   ![Image=637x341](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/dc6ce176790040d6a0c336e775324b25~tplv-goo7wpa0wc-topic.webp)   


### 使用 Git 服务时可以指定分支吗？ {#de6780aa}

暂不支持，目前固定使用 main 分支。

### 编程项目可以绑定已有的 Git 仓库吗？ {#d28114bc}

可以但不推荐。如果你的 Git 仓库中已有代码文件，Pull 或 Push 时可能会和 AI 编程项目中的代码文件产生冲突，不便于项目管理协作。建议你绑定时根据页面提示创建一个新的仓库。
