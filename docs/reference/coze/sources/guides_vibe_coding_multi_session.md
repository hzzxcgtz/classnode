> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子 AI 编程项目支持创建多个会话，让你可以在同一个项目中并发处理多项独立的开发任务。

## 什么时候使用多会话 {#hKHefTc4g}

当你需要在同一个项目中同时处理多个独立任务，或者需要一个空白的上下文时，可以使用多会话功能。例如：

* 当前会话积累了大量报错历史，导致 AI 响应缓慢。
* 希望从某个历史节点重新开始，避免此前的会话信息干扰 AI 的判断。
* 在一个会话中开发新功能，在另一个会话中修复 Bug。
   需要注意的是，新建会话会连接相同的主分支，代码并不隔离。建议创建独立工作区，并行开发。具体操作，请参考[AI编程多分支并行开发](/vibe-coding-multi-branch)。   


## 核心特性 {#hOBDLTHgm}

多会话的核心特性是“文件共享，上下文隔离”：

* **文件共享**：所有会话都作用于同一个项目。因此，在任何一个会话中修改项目文件，都会实时反映在其他会话中。
   如果多个会话任务同时修改同一个代码文件，可能会产生冲突。为确保代码稳定，扣子 AI 在开发过程中会实时同步文件变更，并在检测到代码存在逻辑问题或运行异常时，自动进行修复。
* **上下文隔离**：每个会话都拥有独立的对话上下文。扣子 AI 在某个会话中的交互，不会受到其他会话内容的影响。

此外，当你新建会话时，扣子 AI 会自动加载项目中最新的代码，并在此基础上继续开发。

## 使用限制 {#hkF9VLAvX}

* 一个 AI 编程项目中，最多可创建 100 个分支和会话。
* 每位用户最多可同时打开 5 个开发页面。

## 新建会话 {#hFjY1X5eb}

你可以通过如下三种方式新建会话。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

### 全新会话 {#hovkGLXvL}

创建一个完全独立的会话，新会话不会继承任何历史对话上下文。

1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面中，单击目标 AI 编程项目。
2. 在左侧导航栏中，单击**新建会话**。
   ![Image=597x319](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/564da2dbd3b34d0dbd1701a37d9f6e9f)   


### 复制会话 {#hEqq7Fv5G}

复制一个现有的会话，新会话会继承原会话的全部上下文。

1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面中，单击目标 AI 编程项目。
2. 在会话列表中，单击目标会话对应的**···** > 复制，复制一个新的会话。
   ![Image=364x182](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/d4b83d6208d242e69f7ee6c0469704f5)   


### 复制对话到新会话 {#hIcoqBMtY}

基于某一条对话进行新建，新会话会继承该条对话之前的所有上下文。

1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面中，单击目标 AI 编程项目。
2. 在目标会话中，单击某条对话中的**复制上下文到新会话**。
   系统会新建一个会话，并将整条对话之前的内容复制到新会话中。
   ![Image=243x132](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/f470973af44c4b4f8980d362d6cd07bd)   


## 使用会话 {#hZxYKkZgg}

当会话中积累了过多的对话或报错历史，导致大模型响应变慢时，你可以新建一个会话。新会话将提供一个**空白上下文**，更专注于新任务的开发。

下文将通过一个具体示例来演示：在当前会话中反复调试 Bug，当上下文过载时，新建一个会话，在空白上下文中继续开发。

1. **在默认会话**中，修复 Bug。
   例如，输入指令：
   ```Plain Text
   单击生成卡片没有反应
   ```
   ![Image=391x441](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/52334badad3f4449b9c53981da630f69)
2. 在**会话2**中调整 UI 风格。
   例如，输入指令：
   ```Plain Text
   将 UI 配色改成浅色系
   ```
   ![Image=405x461](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/6433368b3a01417aa34a8b23cbc17b09)
3. 预览开发结果。
   所有会话共用一份项目代码和同一个预览环境。你可以在任意一个会话中，预览开发结果。
   ![Image=535x256](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/6d51b33da22a4a7986f99a84eeb7722d)   


## 相关操作 {#hKYvhiAHr}

创建会话后，你还可以重命名、关闭、置顶会话等操作。

![Image=462x236](https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/698c7075f7d449c18f988f4733f4a7ce)

<!-- @cols-width: 222,603 -->
| | | \
|**操作** |**说明** |
|---|---|
|重命名会话 |在会话列表中，双击目标会话名称，或者单击目标会话对应的··· > **重命名**，重新设置会话名称。 |
|关闭会话 |在会话列表中，单击目标会话对应的··· > **关闭**，关闭会话。 |\
| | |\
| |:::tip 说明 |\
| |* 如果会话中有任务正在进行，则暂时无法关闭该会话。如需关闭，请先手动停止正在进行的任务。 |\
| |* 关闭会话后，该会话中的记录将被清除，未合并的代码改动将丢失。该操作不可撤销，请谨慎操作。 |\
| |::: |\
| | |\
| | |
|置顶会话 |在会话列表中，单击目标会话对应的··· > **置顶**，将该会话固定在会话列表顶部。 |

## 常见问题 {#hh3M388wj}

* [在不同会话中，任务是并发进行的吗？](/guides_vibe_coding_faq#0e0321da)
* [在不同会话中，同时发送需求会冲突吗？](/guides_vibe_coding_faq#hqMLquanf)
* [多会话模式下，新会话是基于一个全新的空项目吗？](/guides_vibe_coding_faq#hbOKQJpWS)
* [我可以在不同会话中预览不同的开发效果吗？](/guides_vibe_coding_faq#hcKAaK5fp)
