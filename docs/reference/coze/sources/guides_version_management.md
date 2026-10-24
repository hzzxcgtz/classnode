> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

通过扣子编程开发应用、智能体和工作流的过程中，扣子编程为代码和产物变更提供类似 Git 的版本控制能力，适用于开发过程中需要追溯代码变更、回滚错误版本等场景。你可以清晰地追溯每一次代码变更，对比不同版本间的差异，并在需要时恢复到任意历史版本。本文介绍扣子编程中版本控制的相关操作。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 版本控制概述 {#f8b3ce73}
你在扣子编程开发应用、智能体或工作流过程中，扣子编程会自动生成一个版本，并自动将这些版本的代码存档并生成版本记录，从而实现精细化的版本控制与回退。
**主要功能**
扣子编程的版本控制功能主要包括：

* **自动存档**：在日常开发过程中，代码变更时会生成新的版本，扣子编程会自动将当前的代码存档，形成一个新的版本记录。
* **查看版本历史**：清晰地列出每一次提交的版本历史，包括详细的 Commit 信息，方便你追溯每一次变更。
* **搜索版本**：支持通过版本标题或 Commit 信息中的关键词进行搜索，帮助你快速定位到特定的版本。
* **变更对比（Diff）**：你可以查看任意一次提交所涉及的所有文件变更，并进行文件级的差异对比（Diff），直观地了解代码的新增、修改和删除。
* **回滚版本**：当需要恢复到某个历史版本时，可以一键执行回滚操作。

## 版本类型 {#045966d7}
版本列表中的版本分为以下几种类型：
![Image=500x325](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/19bbfa54edeb4d48844d1bc015de5a5b~tplv-goo7wpa0wc-image.image)
<!-- @cols-width: 188,100,571 -->
| | | | \
|**版本类型** |**图中序号** |**说明** |
|---|---|---|
| | | | \
|Initial commit 版本 |① |项目初始化时自动生成的初始版本。版本列表中关键词为 `Initial commit`的版本。 |
| | | | \
|feat 版本 |② |代码变更时，扣子编程自动将当前代码存档并生成的版本。版本列表中关键词为 `feat` 的版本。 |
| | | | \
|Restored 版本 |③ |执行版本回滚操作后自动创建的新版本。版本列表中关键词为 `Restored` 的版本。 |
| | | | \
|Auto commit 版本 |④ |若你手动修改文件后未提交，直接执行回滚或部署操作时，扣子编程会自动创建一个 **Auto commit** 版本，以确保手动修改的文件变更不会丢失。版本列表中关键词为 `auto commit`的版本。 |

## **使用限制** {#26ae02cc}

* **权限限制**：仅项目**所有者**有权限执行版本控制操作。
* **回滚版本限制**：不支持回滚以下类型的版本：
   * 最新版本。
   * Auto commit 版本。
   * Restored 版本。

## 使用方式 {#68e947e3}
### **自动存档** {#cf6e3839}
在日常开发过程中，编程 AI 修改代码后会生成新的版本，扣子编程会自动将当前的代码存档，形成一个新的版本记录。

1. 进入 AI 编程开发页面，在左侧对话框中描述需要修改的功能，触发代码变更，例如：`列表页的默认条数修改为每页显示 20 条，并在底部增加‘加载更多’按钮`。
2. 扣子编程修改代码后，会自动提交一个版本，并根据变更内容自动生成摘要（Commit Message）。
3. 你可以在对话框上方的版本卡片中单击**查看修改记录**，在**版本控制**页面查看该版本变更的详细信息。
   ![Image=500x304](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9b85fc105f7f4cb9847f3e63d85bc294~tplv-goo7wpa0wc-image.image)

### 手动提交 {#7623c024}
如果你手动修改了代码文件，则必须手动提交版本，并填写摘要。操作步骤如下：

1. 在文件区域单击图标，打开源代码管理页面。
2. 单击文件名称，查看文件的详细变更对比。
3. 确认无误后，填写版本摘要，并单击**提交**。
   ![Image=503x272](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5b3c9362e3af42ec9d4bf232dba5704e~tplv-goo7wpa0wc-image.image)

手动编辑场景下，除了基础的手动提交功能以外，你还可以：

* 放弃更改：放弃本次变更，将文件内容回退到上一个版本。
* 暂存变更：暂存当前的变更，以便在后续提交时合并到其他版本中。
* 添加到 `.gitignore`：将文件添加到 .gitignore 文件中，以便在后续提交时忽略该文件。

在想要操作的文件上单击右键，即可执行以上操作。
![Image=451x266](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ac66f0fa6baa48eb85b0b83878153c16~tplv-goo7wpa0wc-image.image)
### 查看版本差异 {#920744b3}
你可以随时查看任一历史版本的具体代码变更。
1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-image.image)


2. 在 AI 编程开发页面，你可以通过如下两种方式进入版本控制页面，看目标版本变更的文件，包括新增、修改、删除的文件列表。
   
   :::: tabs
   @tab 对话区版本历史图标
   单击对话区顶部的版本历史图标，在目标版本右侧单击**查看修改记录**图标。
   ![Image=500x267](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f3037d1b05b04c3091b77cc49cb7cd7c~tplv-goo7wpa0wc-image.image)
   
   @tab 右侧的新标签页
   1. 在项目开发页面右侧单击➕打开新的标签页，在弹出的标签页中选择**开发工具** > **版本控制**。
      ![Image=500x326](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0bfa34ca404040d8b4a30917a98add31~tplv-goo7wpa0wc-image.image)
   2. 在**版本控制**页面，单击目标版本。
   
   ::::

3. 单击对应的文件，即可查看该文件的详细变更差异。
   ![Image=600x537](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0ce8e53049d643959b2f9c2812594f1f~tplv-goo7wpa0wc-image.image)

### 回滚开发版本 {#499da712}
当你需要将项目恢复到某个特定的历史版本时，可以使用版本回滚功能，回滚后会撤销该版本之后的所有更改。此操作通常用于撤销错误的修改或恢复到某个稳定的功能节点。
版本回滚后，在版本记录中会新增一条版本记录。回滚并不会删除历史记录，而是会创建一个新的版本，其内容与你选择回滚到的目标版本完全一致。
1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-image.image)


2. 在 AI 编程开发页面，你可以通过如下方式进行版本回滚。
   
   :::: tabs
   @tab 对话区版本历史图标
   单击对话区顶部的**版本历史**图标，在目标版本右侧单击**回滚**图标。
   ![Image=500x234](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b388855674be4c4b82d4cc2050412013~tplv-goo7wpa0wc-image.image)
   
   @tab 右侧的新标签页
   1. 在右侧单击➕打开新的标签页，在弹出的标签页中选择**开发工具** > **版本控制**。
      ![Image=500x309](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/dbe5a8dcf3924258b5463346fe38eb27~tplv-goo7wpa0wc-image.image)
   2. 在**版本控制**页面，单击目标历史版本，在版本详情页面单击**回滚**。
      ![Image=500x244](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/94530e663b834f11bdf27cad794e6232~tplv-goo7wpa0wc-image.image)
   
   ::::

3. 在回滚确认对话框中，如果项目集成了数据库，根据需要选择是否回滚数据库。如果勾选**同时回滚数据库**，系统将把开发环境数据库还原至对应版本状态，该版本之后添加的数据将丢失，包括 Schema 以及数据。
   ![Image=500x247](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/12ba51ea7912454c8db37044f0eaf675~tplv-goo7wpa0wc-image.image)
4. 单击**回滚**。

## 相关文档 {#cd3a8800}
如果要回滚已部署的历史版本，请参考[回滚部署版本](/guides/deployment_history#016fe789)。

