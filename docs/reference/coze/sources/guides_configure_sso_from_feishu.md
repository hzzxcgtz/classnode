> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

通过单点登录功能（即 Single Sign On，SSO）可实现飞书和扣子编程之间登录身份互通互认。企业用户只需登录飞书，就可以直接访问扣子编程中的企业工作空间，免去每次访问都需要输入扣子账号和密码的步骤。本文档以飞书为例，演示飞书作为 IdP 时，企业管理员开启 SSO 登录的详细操作步骤，帮助你理解企业 IdP 与扣子编程进行 SSO 的端到端配置流程。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。
:::

## 场景说明 {#ivL9AX564O}

某企业使用飞书作为移动办公平台，在飞书中维护自己的员工身份信息。企业使用员工邮箱前缀作为员工的唯一标识，例如用户 Alice 的员工邮箱为 Alice_123@enterprise.com，该员工在扣子编程中作为企业成员的用户名为 Alice_123。

企业管理员购买了扣子企业旗舰版之后可以开启 SSO 登录，能够让 Alice 通过链接基于飞书已经登陆的身份直接跳转扣子编程，以企业成员的身份访问扣子企业旗舰版工作空间。

![Image=500x173](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2aaa427078694e7d80f57aef14fe6887~tplv-goo7wpa0wc-topic.webp)

## 准备工作 {#LeWaqofrKr}

* 已在扣子编程中创建企业组织、创建企业成员 Alice_123，并将其加入企业。
* 已获取飞书集成平台管理员权限、扣子编程企业超级管理员权限。

## 步骤一：在扣子编程中获取配置信息 {#OD0DvJKZ54}

在扣子编程中获取以下配置信息：

<!-- @cols-width: 170,398,295 -->
| | | | \
|**信息** |**查看方式** |**示例** |
|---|---|---|
|SAML 服务提供者（SP）元数据 URL |1. 企业超级管理员登录[扣子编程企业管理页面](admin.coze.cn)。 |\
| |2. 在左侧导航栏选择 **SSO 设置**，并单击**去配置**。页面会自动跳转到火山引擎扣子控制台，引导你查看 SP 元数据。 |\
| |3. 在弹出页面中 **SSO 登录** > **服务提供商信息**一栏复制 **ACS URL** 和 **Entity ID**。 |\
| |   你也可以根据页面提示，直接下载元数据文档。 |![Image=250x244](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a790a24289e3435e80a1818df85d862f~tplv-goo7wpa0wc-topic.webp) |
|扣子企业超级管理员对应的火山引擎主账号 ID |扣子企业超级管理员登录到火山引擎扣子编程后，在[账号管理](https://console.volcengine.com/user/basics/)页面查看账号 ID。 |![Image=234x208](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/968e124cdcb14e5987f02819e528bfad~tplv-goo7wpa0wc-topic.webp) |
|确认用户的唯一标识 |`NameID` 是 SAML 断言中用于标识用户的一个元素。它是一个唯一标识符，用于在 IdP 和 SP 之间唯一地标识用户。 |\
| | |\
| |:::notice 注意 |\
| |本示例中，SAML 响应的 Name ID 为邮箱名（不包含@及后缀），开始配置前请确认： |\
| | |\
| |* 企业用户 Alice 在火山扣子控制台 > **用户管理**页面的用户名为 Alice_123。 |\
| |* 企业用户 Alice 在飞书中配置的邮箱前缀同样为 Alice_123。 |\
| |::: |\
| | |\
| | |![Image=1816x908](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ad86d0fdd6534679903a60e6dcb70c2d~tplv-goo7wpa0wc-topic.webp) |

## 步骤二：在飞书集成平台创建并配置应用 {#kKnmTiTaI2}

作为身份提供商（IdP），飞书集成平台需要以应用的形式感知服务提供商扣子编程，实现单点登录。因此，企业管理员需要飞书集成平台创建对应扣子编程的应用，应用类型为**自建应用**。

1. 使用飞书租户的管理员用户或具有同等权限的飞书用户登录[飞书集成平台](https://anycross.feishu.cn/console/identity/sso-app-manager)。
2. 在**身份集成 > 应用单点登录 > 应用管理**页面中，单击**新建应用**，创建一个新的自建应用。
   ![Image=580x282](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/40129e0dd20d46f98f22183ab3548a53~tplv-goo7wpa0wc-topic.webp)
3. 在**新建应用**页面，选择应用类型为**自建应用**。
   ![Image=315x190](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/84739295b1c14395ad82e07d298bb23d~tplv-goo7wpa0wc-topic.webp)
4. 在**基本配置**页面，配置应用程序的名称等基本信息，然后单击**下一步**。
   此示例中可以填写**应用名称**为**扣子编程**，该名称仅用作在 IdP 处展示。
   ![Image=363x294](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/948049f380ed4598a9075f97359bd866~tplv-goo7wpa0wc-topic.webp)
5. 在**应用配置**页面填写 SAML 配置。
   1. 在**更多配置**区域，展开配置，启用 SAML 2.0 协议。
      ![Image=338x301](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/608378aa4cc84f249912ba68c1d6578c~tplv-goo7wpa0wc-topic.webp)
   2. 填写以下设置，并单击**保存并启用**。
      <!-- @cols-width: 153,448,215 -->
      | | | | \
      |**配置** |**说明** |**示例** |
      |---|---|---|
      |授权配置 |在**快捷导入 SAML 元数据**区域，单击**上传文件**，上传步骤一中下载的 SP 元数据文件。 |\
      | | |\
      | |上传文件后，系统会默认填写**登录回调地址**。 |![Image=1518x948](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5cca8198eb7f4a9a9458977323e17ab3~tplv-goo7wpa0wc-topic.webp) |
      |支持 IdP 侧发起登录 |可选。配置 IdP 登录后，企业用户 Alice 可从飞书提供的登录地址访问扣子编程。 |\
      | | |\
      | |开启**支持 IdP 侧发起登录**，并手动填写以下配置： |\
      | | |\
      | |* ACS URL 和 Destination：设置为步骤一中获取的 ACS URL。 |\
      | |* Audience：设置为步骤一中获取的 Entity ID。 |\
      | | |\
      | |配置成功后，页面右侧展示的**认证请求端点**则是从 IdP 侧（也就是飞书侧）访问扣子编程的 URL。 |IdP 登录： |\
      | | | |\
      | | |![Image=2144x1284](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/64ddefddf8094619b82f1b3f83882cd1~tplv-goo7wpa0wc-topic.webp) |\
      | | | |\
      | | |认证请求端点： |\
      | | | |\
      | | |![Image=2832x1194](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9957a9cf959a4158961d9a96e02084b7~tplv-goo7wpa0wc-topic.webp) |
      |Name ID 配置 |选择进行 SSO 身份映射时使用的飞书用户字段。建议此处选择在飞书侧维护的全局唯一的、仅包含英文字母的字段。 |\
      | | |\
      | |本示例选择**邮箱名（不含"@"及后缀）**，表示通过飞书用户的邮箱前缀去匹配扣子编程中的企业成员用户名。 |![Image=1888x1160](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/520181c294944f47bd981721c79389ba~tplv-goo7wpa0wc-topic.webp) |
      |SAML 2.0 协议端点 |在页面右侧 **SAML 2.0 协议端点**区域中，单击**下载元数据文档**，下载身份提供商（IdP）元数据文件，并将其保存在本地目录。 |![Image=2696x1291](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/33e3c4d9cd924c07b91debe2dc588f15~tplv-goo7wpa0wc-topic.webp) |
      完整配置示例如下：
      ![Image=627x325](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8ff5dc6e69114ba8a36d9e3ef8a9978c~tplv-goo7wpa0wc-topic.webp)
6. 配置完成后，点击**保存并启用**。
7. 确认可访问范围。
   在刚创建的应用中的**访问授权**页面配置可以进行单点登录的飞书用户范围。默认**全部成员**均可通过飞书用户身份以 SSO 方式登录扣子编程，访问企业工作空间。
   ![Image=420x287](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c7a037115e34a23b5f84807bd694c62~tplv-goo7wpa0wc-topic.webp)   


## 步骤三：在扣子编程中上传 IdP SAML 配置 {#RQhPNe8yO1}

在扣子编程中上传企业身份管理系统（IdP）的元数据信息，建立扣子编程对 IdP 的信任，并开启 SSO 登录，实现企业 IdP 通过用户 SSO 登录扣子编程。

1. 企业超级管理员登录[扣子编程](https://code.coze.cn/home)。在左下角单击个人头像，选择企业账号 > **企业管理**。
   你也可以直接访问[扣子编程企业管理页面](admin.coze.cn)。
   ![Image=255x203](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/61b93d5fd94247dd855bc941a38fc3de~tplv-goo7wpa0wc-topic.webp)
2. 在左侧导航栏选择 **SSO 设置**，单击**去配置**。
3. 在弹出页面中 **SSO 登录** > **身份提供商信息**一栏，上传步骤二中下载的 IdP 元数据文档。
4. 在 **SSO 登录**区域，开启 SSO 登录。

::::cols
@col 33
![Image=200x107](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f8435a0c0f524114bb64bc290aeceb99~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=400x389](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0e15b3dfb21546dcbad29d8d0aee51b7~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=400x457](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9875dab1551b4ca0ac3743ee23c68a10~tplv-goo7wpa0wc-topic.webp)
::::

## 结果验证 {#E5n4VD4fGY}

完成 SSO 登录配置后，企业用户 Alice 可以从扣子编程或者飞书侧发起单点登录。

::::tabs
@tab 通过 SP 登录
通过扣子编程登录页面登录：

1. 企业成员访问管理员提供的扣子编程登录地址。
   管理员可以在[火山扣子控制台](https://console.volcengine.com/coze-pro/overview) > **成员管理**页面查看这个登录地址。
   ![Image=568x150](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3ec7f1f7b8c44a85aa7a3ecbb2b33dc1~tplv-goo7wpa0wc-topic.webp)
2. 企业成员 Alice 在登录页面中输入企业别名和用户名 Alice_123，并单击**下一步**。
   :::tip 说明
   用户名要填写火山子用户的用户名（user_name），而不是扣子用户名（coze_user_name）。
   :::
3. 单击**企业账号免密登录**。
   ![Image=286x177](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/95c1b726a66a4a94803546450c3ae08a~tplv-goo7wpa0wc-topic.webp)
4. 页面会自动跳转至飞书的登录页面，根据界面提示，输入账号密码或者扫描二维码登录。
5. 登录成功后，页面将自动跳转至扣子编程，企业成员 Alice 可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)

@tab 通过 IdP 登录
通过 IdP 提供的链接登录：

1. 获取飞书侧访问扣子编程的 URL 地址。
   可以在 IdP 应用配置页面右侧查看**认证请求端点**。
   ![Image=437x185](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5a50a1b5e99e4c85928ad62045c9272d~tplv-goo7wpa0wc-topic.webp)
2. 浏览器访问此链接。
3. 根据界面提示，扫描二维码登录 Alice 的飞书账号。
4. 登录成功后，页面将自动跳转至扣子编程，用户 Alice 可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)
::::
