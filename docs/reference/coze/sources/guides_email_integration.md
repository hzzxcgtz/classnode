> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成电子邮件能力，可让你的 AI 编程项目便捷实现邮件的发送与接收功能，满足办公协同、通知推送等需求。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 支持的能力 {#19789cf5}

* 接收邮件
* 向指定的邮箱发送邮件
* 管理邮件等主流的邮箱服务

## 配置方式 {#debb35cc}

### 步骤一：获取邮箱配置信息 {#448f38d5}

根据你所使用的邮箱，获取对应的授权码、SMTP 端口、SMTP 服务器地址、IMAP 服务器地址、IMAP 端口等关键配置信息。不同邮箱服务商的配置信息不同，请以对应邮箱官方文档或设置页面提供的标准配置为准。

### 步骤二：为工作空间启用外部集成（企业管控操作） {#8a30ae45}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

### 步骤三：配置 Email 集成 {#67fd6920}

在**集成管理**页面，单击 Email 集成对应的**配置**，然后完成如下参数配置。配置完成后，当前空间下所有集成了 Email 能力的项目，均通过该邮箱账号发送邮件，或读取该邮箱账号内的邮件。

:::tip 说明
配置外部集成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中。请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

<!-- @cols-width: 135,472 -->
| | | \
|**参数** |**说明** |
|---|---|
|Account |邮箱登录账号。 |
|Auth Code |邮箱服务商提供的授权码，用于第三方客户端登录验证。不是邮箱密码。 |\
| | |\
| |请在对应邮箱的设置页面手动获取。 |
|SMTP Server |SMTP 邮件服务器的地址。SMTP 协议用于发送邮件。 |
|SMTP Port |SMTP 邮件服务器的端口号。 |
|IMAP Server |IMAP 邮件服务器的地址。IMAP 协议用于接收和管理邮件。 |
|IMAP Port |IMAP 邮件服务器的端口号。 |

::::cols
@col 50
![Image=548x343](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/06c4bf59e59945279af168e4b676071e~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1044x814](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d588f8e00dc240bebe15fbd37f399ab7~tplv-goo7wpa0wc-topic.webp)
::::

### 步骤四：为项目接入 Email 集成 {#b98f3b3d}

配置 Email 集成后，你可以在开发 AI 编程项目时，输入添加 Email 集成的相关需求，让扣子 AI 自动识别并加载邮件技能来接入入 Email 集成。

发送邮件时，系统是将 Email 集成中已配置的邮箱账号作为发件方，向指定的目标账号投递邮件，而非向该配置邮箱账号本身发送邮件。

![Image=586x375](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/dc053d51cb614e08a55d77121b6b0347~tplv-goo7wpa0wc-topic.webp)

## 效果演示 {#55986932}

例如创建一个邮件助手，集成数据库与 Email 能力后，该助手可自动撰写邮件，并调取数据库中存储的目标邮箱地址，完成邮件的自动发送。

::::cols
@col 50
与智能体对话

![Image=1616x1119](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ea9f7e6af9ee4b9c9103b4f6f3c9f814~tplv-goo7wpa0wc-topic.webp)

@col 50
收到邮件

![Image=1784x1265](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c3d65a694ff84f46905fef9303fd7696~tplv-goo7wpa0wc-topic.webp)
::::
