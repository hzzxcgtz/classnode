> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

本文将帮助你快速上手扣子编程内置的对象存储服务，包括集成对象存储服务的基础介绍，以及在 AI 编程项目中接入对象存储服务、使用对象存储服务等指引。

## 功能概述 {#e74bc88b}

扣子编程内置的对象存储服务是专为 AI 编程项目设计的非结构化数据托管方案，支持图像、文档、音频、视频等各类文件的安全存储与高效管理。

在开发 AI 编程项目过程中，你可以通过自然语言与扣子 AI 对话，让其为你开发的 AI 编程项目添加存储功能，也可以在可视化界面中手动配置，轻松实现文件上传与托管。

功能特征如下：

* **持久化存储**：采用高可靠性存储架构，确保文件长期稳定留存，供用户或 AI 编程项目访问。
* **多层环境隔离**：
   * 环境隔离：开发环境和生产环境物理独立，确保开发阶段的文件操作不影响线上环境。
   * 项目隔离：不同 AI 编程项目的对象存储相互独立，文件访问权限隔离，保障数据安全。
* **无缝服务集成**：将对象存储功能封装为标准化集成服务，可被扣子 AI 直接调用添加。

## 开发与生产环境 {#3ef7fcbe}

为项目接入对象存储能力后，你的 AI 编程项目将具备两个数据完全隔离的存储环境，即**开发环境**和**生产环境。**

<!-- @cols-width: 100,393,431 -->
| | | | \
|**环境类型** |开发环境 |生产环境 |
|---|---|---|
|**适用阶段** |AI 编程项目开发/调试阶段 |AI 编程项目部署上线后 |
|**说明** |开发阶段仅创建开发环境存储桶。 |\
| | |\
| |在向量化写入数据到数据库时，系统将在对象存储中自动生成 `coze_knowledge_origin`、`coze_knowledge_base` 文件夹。更多信息，请参考[数据向量化写入与检索](/guides/vector_based_data_writing_and_search)。 |生产环境存储桶在首次部署项目时自动创建，部署前不支持手动开通生产环境存储桶。 |\
| | | |\
| | |首次部署时，系统会自动创建生产环境的存储桶。每次部署均会同步 `coze_knowledge_base` 文件夹及其文件到生产环境，不会同步其他文件。当你需要将开发环境中的文件同步到生产环境时，可以上传文件到 `coze_knowledge_base` 文件夹中。 |

## 权限说明 {#1a696bf2}

* 只有 AI 编程项目的所有者，拥有其对应对象存储服务的操作权限。
* 在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。

## 使用限制 {#d93fcfbb}


* 每个项目均只提供一个开发环境存储桶和一个生产环境存储桶。
* 最大支持上传 200MB 大小的文件。
* 文件 URL 有效期为 0～30天。
* 不支持上传 PHP 文件。

## 费用说明 {#fc0b4d06}


* 在项目开发过程中，你与扣子 AI 的每轮对话均会产生扣子编程任务费用，更多信息，请参考[扣子编程任务费用](/coze_pro/task_fee)。
* 目前**免收存储、数据库、向量模型**的内置集成费用，后续正式计费的时间计划与产品定价请关注平台公告。

## 使用对象存储 {#f199b9fe}

### 为项目接入对象存储能力 {#78a78672}

你在开发 AI 编程项目时，可以与扣子 AI 对话为项目接入对象存储能力。

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在页面顶部选择目标工作空间，然后在左侧导航栏中单击**新建项目**。
3. 输入你的开发需求，然后进入 AI 编程环境。
4. 等待项目初步开发完成后，通过自然语言与扣子 AI 对话，为项目接入对象存储服务。
   例如输入：
   ```Plain Text
   为我的工作流添加文件存储功能
   ```
   ![Image=555x287](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e936704173154014a9a5116dcaf2fac1~tplv-goo7wpa0wc-topic.webp)   


### 上传文件 {#0ff305be}

接入对象存储能力后，即可将各类文件上传至专属存储桶中。例如开发作品集应用时，可将作品上传至存储桶中，从而在应用内快速实现作品的展示与访问。

1. 在 AI 编程环境的右上角，单击➕，然后在**集成服务**区域，单击**对象存储**。
2. 在**对象存储**的**文件管理**页签中，单击**上传文件**。
   ![Image=472x127](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/540fd3f65e5848c89a49cb593df67010~tplv-goo7wpa0wc-topic.webp)
3. 选择目标本地文件，完成上传。

### 下载文件 {#f9dacc61}

你可以在 AI 编程环境的**对象存储**页签中，将存储桶中的文件下载到本地。

1. 在 AI 编程环境的右上角，单击➕，然后在**集成服务**区域，单击**对象存储**。
2. 在**对象存储**的**文件管理**页签中，单击目标文件对应的**···** > **下载**。
   ![Image=450x143](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/df506e6e0463449a95b05caada18c5a6~tplv-goo7wpa0wc-topic.webp)   


### 查看文件 {#b94a4ac1}

你可以在 AI 编程环境的**对象存储**页签中，查看文件列表以及目标文件的大小、类型、创建时间及修改时间等信息。

1. 在 AI 编程环境的右上角，单击➕，然后在**集成服务**区域，单击**对象存储**。
2. 在**对象存储**的**文件管理**页签中，查看文件列表及相关信息。
   单击目标文件，可以预览该文件。目前，图片、视频支持在线预览。
   ![Image=470x223](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/23b21b7273bb4c0db9cba498b39d5435~tplv-goo7wpa0wc-topic.webp)   


### 设置 URL 有效期 {#ff4e800f}

存储文件 URL 有效期为 0～30 天。在开发项目过程中，扣子 AI 会设置一个默认有效期，你也可以与扣子 AI 对话来调整。

URL 是临时的访问凭证，每个文件还具备一个唯一且固定的标识符（URI）。如果你需要某文件长期有效访问，可以让扣子 AI 将文件 URI  存储到数据库中，再基于 URI 重新获取一个 URL。例如输入对话：

```Plain Text
将存储在对象存储桶里的图片的URI存入数据库中，每次获取URL时，根据URI重新换取URL。
```

## 管理**对象**存储 {#a34fe400}

在 AI 编程环境的**对象存储**页签中，你还可以进行如下相关操作。

<!-- @cols-width: 138,136,500,100 -->
| | | | | \
|**分类** |**操作** |**说明** |**图示** |
|---|---|---|---|
|管理文件夹 |创建文件夹 |单击**新建文件夹**，创建文件夹，用于归类与管理文件。 |![Image=1909x322](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/822458a648534797829138ec8aaf690f~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |重命名文件夹 |在文件夹及文件列表中，单击目标文件夹对应的**···** > **重命名**，修改文件夹名称。 |![Image=1265x262](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e0fb5f3e90614e2ea2b46ad97e7b7cb0~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |删除文件夹 |在文件夹及文件列表中，单击目标文件夹对应的**···** > **删除**，删除文件夹。 |\
| | | |\
| | |:::tip 说明 |\
| | |* 删除文件夹时，文件夹内的文件会被同步删除。在执行删除时添加的文件，也会被同步删除。 |\
| | |* 删除操作无法恢复，请谨慎操作。 |\
| | |::: |\
| | | |\
| | | |![Image=1261x262](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/87ca95f7ee1340a0a9cbb7ad8c348d58~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |复制文件夹路径 |在文件夹及文件列表中，单击目标文件夹对应的**···** > **复制文件夹路径**，复制文件夹的路径。在移动文件到文件夹时，你需要输入完整的文件夹路径。 |![Image=1261x245](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bea451093355404cab06659c42d264e8~tplv-goo7wpa0wc-topic.webp) |
|管理文件 |移动文件到文件夹 |在文件夹及文件列表中，选择一个或多个文件，单击对应的**···** > **移动**，将文件移动到目标文件夹中，进行管理。 |![Image=1867x703](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a7a8f2736a794d67bebb95b1ce26d0b3~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |分享文件 |在文件夹及文件列表中，单击目标文件，然后单击**获取URL**，并选择有效期。 |\
| | | |\
| | |获取链接的用户，可以查看该文件。当文件链接超过有效期后，文件将不可访问。 |![Image=1910x992](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3de22171d58a4ff984227f6a712a8d4c~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |重命名文件 |在文件夹及文件列表中，单击目标文件对应的**···** > **重命名**，修改文件名称。 |![Image=1864x653](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5b37404f1b74420d851641dfaaf23046~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |删除文件 |在文件夹及文件列表中，单击目标文件对应的**···** > **删除**，删除文件。 |\
| | | |\
| | |:::tip 说明 |\
| | |删除操作无法恢复，请谨慎操作。 |\
| | |::: |\
| | | |\
| | | |![Image=1867x678](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e6eab0a99a5d44388b36d08b7bbb3d41~tplv-goo7wpa0wc-topic.webp) |
|管理对象存储服务 |查看存储容量 |在**对象存储**的**总览**页面，查看开发环境、生产环境中已使用的存储容量。 |![Image=1908x346](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b4cc06d05ca54e3b84e20fae544c9e1b~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |删除对象存储服务 |在**对象存储**的**设置**页签下，单击**删除桶**，删除当前项目的对象存储服务。 |\
| | | |\
| | |在此处删除对象存储服务，不会触发代码更新，也不会影响项目的其他功能。你也可以通过与扣子 AI 对话，修改代码，删除代码中关于对象存储服务调用的相关逻辑。 |![Image=1911x421](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/28d8080f3a05458f8e6490940ec739cb~tplv-goo7wpa0wc-topic.webp) |
| || | | \
|通过 SDK 方式访问对象存储 | |扣子编程官方提供的 Coze Storage Client Python SDK，采用同步实现方式，用于管理 Client 与 Coze S3 兼容存储的交互。通过该 SDK，你可以以编程方式上传、下载、删除文件，检查对象是否存在，以及通过 Coze S3 Proxy 生成签名下载 URL。更多信息，请参考[存储 Python SDK](/guides/integrate_storage_sdk)。 |无 |

## 常见问题 {#027097a9}

* [各个项目之间的存储桶是共享的吗？](/guides/vibe_coding_faq#87f5d23a)
* [如何为项目接入对象存储能力？](/guides/vibe_coding_faq#e8a8db7a)
