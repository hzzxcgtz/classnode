> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

创建 AI 编程项目之后，你可以将你的项目分享给他人，以便共享项目进展、吸引更多用户。目前支持将你的项目开发页面分享给其他扣子用户，或者将你已部署的成品分享给最终用户或集成方，满足团队协作与对外发布的不同场景需求。
:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 分享完整项目 {#de16b89b}
该场景主要面向其他扣子开发者，用于共享 AI 编程项目的开发编辑页面，方便你和其他开发者共享项目进展、搭建方式、代码成果。分享完整项目时，你可以设置分享时长，超期后自动关闭分享。
被分享者打开 AI 编程项目的分享链接后，将进入项目的只读页面，可进行以下操作：

* 查看项目详情与最新状态、对话过程、历史版本
* 查看或下载项目代码
* 试运行项目
* 复制项目（取决于项目所有者的分享配置）

被分享者无法对项目执行任何编辑类操作，例如：

* 与扣子 AI 对话
* 修改项目基础设置
* 部署项目

:::tip 说明
开启分享后，任意获得项目链接的用户，将可能获取到项目开发过程、源码、环境变量等敏感信息。建议谨慎开启项目分享。
:::
分享方式如下：

1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面，找到你要分享的 AI 编程项目。
2. 打开项目，在页面右上角单击分享图标。
3. 在**分享完整项目**页签中，单击**设为公开可见**。
   ![Image=301x223](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c476cf1e7a5a4d8199c66173c5527ff9~tplv-goo7wpa0wc-image.image)
4. 设置**分享有效期**，支持设置为**永久**。
5. 设置是否**允许复制**，默认不允许。
   :::tip 说明
   开启**允许复制**后，**未包含外部集成的项目**可被他人复制。
   :::
6. 复制项目链接，并发送给其他扣子用户查看。
   ![Image=286x253](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/51d9a8a56466430c830c35701649a829~tplv-goo7wpa0wc-image.image)

被分享者看到的项目详情页面大致如下：
![Image=656x318](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b56c1cf404f84789b707674c92812969~tplv-goo7wpa0wc-image.image)
## 分享产物 {#7b5e38b7}
该场景主要面向 AI 编程项目的最终用户或集成方，用于项目**成功部署**之后，分享调用方式（例如 API 地址）或页面访问链接。
分享方式如下：
<!-- @cols-width: 161,373,298 -->
| | | | \
|**项目类型** |**分享方式** |**示例** |
|---|---|---|
| | | | \
|网页应用 |1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面，找到你要分享的网页应用。 |\
| |2. 打开项目，在页面右上角单击分享图标。 |\
| |3. 在**分享产物**页签中，复制生产版本 URL。 |\
| | |\
| |:::tip 说明 |\
| |默认分享最新的生产版本，若需要分享历史版本，可参考[如何查看网页应用的历史部署版本？](/guides/vibe_coding_faq#53e677a7) |\
| |::: |![Image=175x161](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b8d5791b0869459f944fce79881c81bd~tplv-goo7wpa0wc-image.image) |
| | | | \
|智能体 |1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面，找到你要分享的智能体项目。 |\
| |2. 打开项目，在页面右上角单击分享图标。 |\
| |3. 在**分享产物**页签中，复制智能体 API 的 curl 调用示例。 |\
| | |\
| |:::tip 说明 |\
| |curl 调用示例中 API Token 使用占位符 <YOUR_TOKEN> 表示，如果被分享者需要调用 API，应由你提供真实的 API Token。 |\
| |::: |![Image=460x516](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0e8e41b5492f4220abf0ffa2b7309feb~tplv-goo7wpa0wc-image.image) |
| | | | \
|工作流 |1. 在[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)的**项目管理**页面，找到你要分享的工作流项目。 |\
| |2. 打开项目，在页面右上角单击分享图标。 |\
| |3. 在**分享产物**页签中，复制工作流 API 的 curl 调用示例。 |\
| | |\
| |:::tip 说明 |\
| |curl 调用示例中 API Token 使用占位符 <YOUR_TOKEN> 表示，如果被分享者需要调用 API，应由你提供真实的 API Token。 |\
| |::: |![Image=872x703](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e049930fbd3544fab177549075406aba~tplv-goo7wpa0wc-image.image) |\
| | | |

##  {#15728816}
