> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

单点登录（SSO）适用于已对接 SAML 2.0 协议或 OAuth 2.0 协议的 IdP（Identity Provider，身份提供商）的企业，可让企业成员使用内部已有用户账号登录扣子编程，这种方式简化了用户在多个应用间访问的步骤，降低了一人多账号的安全风险。

:::tip 说明
* **订阅套餐**：企业旗舰版。
* **角色限制**：企业超级管理员。
* **访问控制**：在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。
:::

## 什么是 SSO {#61209c85}

单点登录（SSO）是一种跨系统的身份验证解决方案，用户仅通过一次身份验证，即可无缝访问多个应用程序和网站。

在基于 SAML 2.0 协议的 SSO 架构中，主要涉及以下角色：

<!-- @cols-width: 260,578 -->
| | | \
|**角色** |**说明** |
|---|---|
|服务提供者 |\
| |\
|（Service Provider，简称 SP） |为用户提供具体服务的应用。SP 通过 IdP 的身份管理功能来验证用户身份。 |\
| | |\
| |例如扣子编程即为服务提供者。 |
|身份提供者 |\
| |\
|（Identity Provider，简称 IdP） |通常是企业自有身份系统，可以提供身份管理服务，负责对用户进行身份验证，并向 SP |\
| | |\
| |发送身份断言。身份断言是可以标识用户身份的 Token，由 SP 负责签发。 |\
| | |\
| |常见的 IdP 包括 Shibboleth 等企业本地 IdP，或者飞书、飞连、Azure AD、Okta 等 Cloud IdP。 |
|主体（Principal） |即用户，需要访问 SP 提供的资源的人，也就是企业中的员工。 |

## 扣子的 SSO 实现 {#ce516b83}

扣子编程为用户提供了基于 SAML 2.0 协议和 OAuth 2.0 协议的 SSO 特性，支持企业旗舰版。在与企业进行用户 SSO 集成时，扣子编程作为服务提供者（SP），企业自有的身份管理系统则作为身份提供者（IdP）。通过 IdP 颁发的 SAML 断言，扣子编程能够确定企业用户与扣子用户的对应关系。

通过 SSO，企业可以将内部身份管理系统与扣子编程集成。开启 SSO 之后，企业成员可以通过 SSO 快速登录扣子编程，使用企业工作空间下的资源。如果用户在 IdP 中已是登录态，也可以直接免密访问扣子编程。例如企业使用飞书作为内部协同工具，企业用户只需登录飞书，就可以直接访问扣子编程中的企业工作空间，免去每次访问都需要输入扣子账号和密码的步骤。

## 注意事项 {#83329b76}

* 仅企业旗舰版用户可使用 SSO 功能，该功能默认关闭，须由企业超级管理员开启并配置。
* 扣子支持基于 SAML 2.0 协议和 OAuth 2.0 协议的单点登录。
* 企业应已对接支持 SAML 2.0 或 OAuth 2.0 单点登录协议的企业身份系统，例如飞书、飞连、Azure AD、Okta、其他采购或自建的企业身份系统。

## 配置 SAML 2.0 的 SSO 登录 {#e949bd4c}

为了建立扣子与企业 IdP 之间的互信关系，需要在企业 IdP 创建 SAML 配置、在扣子编程添加 SP 的 SAML 配置。配置完成并开启 SSO 登录功能后，企业成员可以使用 SSO 登录到扣子编程。

:::tip 说明
你也可以参考教程[通过飞书进行 SAML SSO 登录](/guides/configure_sso_from_feishu)，快速配置飞书为企业 IdP 的 SSO 登录场景。
:::

### SAML SSO 登录流程 {#cbcc78d2}

企业管理员在扣子编程中开启 SSO 登录，并完成相关配置后，企业员工可通过 SSO 方式登录扣子编程。登录过程如下：

![Image=438x232](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/79df64118d1f473a8d10ef6996d6ae17~tplv-goo7wpa0wc-topic.webp)

1. 企业用户使用浏览器访问登录页面，向扣子 SSO 服务发起登录请求，并接受浏览器扣子返回的 SAML 认证请求。
2. 企业用户浏览器向企业 IdP 转发 SAML 认证请求。
3. 企业 IdP 引导企业用户登录、认证用户身份，并生成 SAML 响应返回给浏览器。响应中包含企业用户对应的扣子企业成员身份信息。
4. 浏览器将 SAML 响应转发给扣子 SSO 服务。
5. 扣子 SSO 服务解析 SAML 响应，通过 SAML 互信配置验证 SAML 断言的真伪，并通过 SAML 断言匹配对应扣子企业成员的身份。
6. SSO 服务向浏览器返回扣子编程登录页面 URL。
7. 浏览器重定向到扣子编程登录页面，自动完成扣子编程的登录。

### 步骤一：管理员在企业 IdP 配置 SAML {#4e2ecc0d}

在企业 IdP 中，将扣子编程作为 SP，配置为企业 IdP 可信的服务提供商。

1. 从扣子编程获取 SAML 服务提供者（SP）元数据 URL。
   1. 企业超级管理员登录[扣子编程](https://code.coze.cn/home)。在左下角单击个人头像，选择企业账号 > **企业管理**。
      你也可以直接访问[扣子编程企业管理页面](admin.coze.cn)。
      ![Image=276x220](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a22a989b95934b66b4c7b0d04e6d0c5b~tplv-goo7wpa0wc-topic.webp)
   2. 在左侧导航栏选择 **SSO 设置**，并单击**去配置**。页面会自动跳转到火山引擎扣子控制台，引导你查看 SP 元数据。
      ![Image=400x215](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f8435a0c0f524114bb64bc290aeceb99~tplv-goo7wpa0wc-topic.webp)
   3. 在弹出页面中 **SSO 登录** > **服务提供商信息**一栏复制 **ACS URL** 和 **Entity ID**。
      你也可以根据页面提示，直接下载元数据文档。
      ![Image=250x244](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a790a24289e3435e80a1818df85d862f~tplv-goo7wpa0wc-topic.webp)
2. 在**企业 IdP** 中，基于上一步中已经获取的 SP 元数据，创建一个 SAML SP，并根据实际情况选择以下任意一种方式配置扣子编程为信赖方。

<!-- @cols-width: 193,639 -->
| | | \
|**配置方式** |**说明** |
|---|---|
|上传 SP 元数据文档 |在企业 IdP 中上传上一步中已经下载的 SP 元数据文件。 |
|手动配置参数 |基于元数据文件中的内容，手动在企业 IdP 中配置 SP 相关参数： |\
| | |\
| |* `Entity ID`：标识服务提供商的唯一标识，需要配置为元数据文件中 **EntityDescriptor** 元素中的 **entityID** 属性值，也就是上一步中复制的 `Entity ID`。 |\
| |* `ACS URL`：用于声明 SAML 断言发送地址，用于接收 IdP 发送的 SAML 断言。需要配置为元数据文件中 **AssertionConsumerService** 元素的 **Location** 属性值，也就是上一步中复制的 `ACS URL`。 |\
| | |\
| |:::tip 说明 |\
| |暂不支持通过 **RelayState** 指定 SSO 登录成功后跳转的目标页面 URL，此 URL 固定为扣子编程的登录页。 |\
| |::: |\
| | |\
| | |

3. 在企业 IdP 中配置 SAML 断言属性。
   在基于 SAML 2.0 的单点登录（SSO）流程中，当企业用户在身份提供者（IdP）完成登录后，IdP 会根据 SAML 2.0 HTTP-POST 绑定协议生成包含 SAML 断言的认证响应。随后，该认证响应将通过浏览器自动转发至扣子编程。
   为了确保 SSO 流程能够顺利进行，SAML 断言中必须包含扣子编程所要求的关键元素。这些元素用于确认用户的登录状态，并从中解析出登录主体的身份信息。如果断言中缺少这些必要元素，扣子编程将无法准确确认登录用户的身份，从而导致 SSO 流程失败。
   * [SAML 响应格式要求](/guides/configure_sso#365422e0)
   * [SAML 断言中的元素说明](/guides/configure_sso#b45427ac)
4. 下载 IdP 元数据文档，用于在扣子编程配置 SAML，建立扣子编程对 IdP 的信任。
   从 IdP 中下载元数据文档。IdP 元数据文档由企业 IdP 提供，一般为 XML 格式，包含 IdP 的登录服务地址以及 X.509 公钥证书，后者用于验证 IdP 所颁发的 SAML 断言的有效性。   


### 步骤二：管理员在扣子编程配置 SAML {#96d02994}

在扣子编程中上传企业身份管理系统（IdP）的元数据信息，建立扣子编程对 IdP 的信任，并开启 SSO 登录，实现企业 IdP 通过用户 SSO 登录扣子编程。

1. 企业超级管理员登录[扣子编程](https://code.coze.cn/home)。在左下角单击个人头像，选择企业账号 > **企业管理**。
   你也可以直接访问[扣子编程企业管理页面](admin.coze.cn)。
   ![Image=278x222](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ad366b4eb67a4124973150b329a40875~tplv-goo7wpa0wc-topic.webp)
2. 在左侧导航栏选择 **SSO 设置**，单击**去配置**。
3. 在弹出页面中 **SSO 登录** > **身份提供商信息**一栏，上传步骤一中下载的 IdP 元数据文档。
4. 在 **SSO 登录**区域，开启 SSO 登录。

::::cols
@col 33
![Image=400x215](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f8435a0c0f524114bb64bc290aeceb99~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=197x192](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0e15b3dfb21546dcbad29d8d0aee51b7~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=166x190](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9875dab1551b4ca0ac3743ee23c68a10~tplv-goo7wpa0wc-topic.webp)
::::

### 步骤三：管理员创建企业成员 {#641ae55d}

在扣子编程中创建**与企业 IdP 相匹配的**企业成员，并将其加入企业。详细操作步骤可参考[操作步骤](/guides/create_member#22807250)。

:::tip 说明
为了实现单点登录，扣子企业成员的名称必须与企业身份系统传递的用户信息中的某个字段进行精确匹配，例如用户ID、用户名或邮箱前缀等。你可以在身份提供方（IdP）中配置用户的唯一标识，用于 SAML 响应中的 NameID 元素，这个标识就是用于匹配的字段。
:::

![Image=604x259](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/06e9c6d60e4e49f9ac0dd348cee5f62c~tplv-goo7wpa0wc-topic.webp)

### 步骤四：企业成员使用 SSO 登录 {#11344c0a}

完成以上步骤之后，企业成员可以参考以下步骤使用 SSO 登录扣子编程。

::::tabs
@tab 通过 SP 登录
通过扣子登录页面登录：

1. 企业成员访问管理员提供的扣子编程登录地址。
   管理员可以在[火山扣子控制台](https://console.volcengine.com/coze-pro/overview) > **成员管理**页面查看这个登录地址。
   ![Image=465x123](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8556ed9345264636b251dd1ba4eba4d0~tplv-goo7wpa0wc-topic.webp)
2. 企业成员在登录页面中输入企业别名和火山用户名，并单击**下一步**。
   :::tip 说明
   用户名要填写火山子用户的用户名（user_name），而不是扣子用户名（coze_user_name）。
   :::
3. 单击**企业账号免密登录**。
   ![Image=286x177](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/95c1b726a66a4a94803546450c3ae08a~tplv-goo7wpa0wc-topic.webp)
4. 页面会自动跳转至身份提供商的登录页面，根据界面提示，输入账号、密码进行登录。
   登录账号可能是你的手机号、邮箱或工号，请以企业管理员的设置为准。
5. 登录成功后，页面将自动跳转至扣子编程，用户可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)

@tab 通过 IdP 登录
通过 IdP 提供的链接登录：

1. 企业管理员配置通过 IdP SSO 登录后跳转的扣子页面，具体配置方法请参见[配置 SSO 登录后跳转至扣子编程指定页面](/tutorial/set_sso_relaystate)。
2. 企业成员通过浏览器访问 IdP 提供的扣子编程访问链接。
3. 根据界面提示，输入账号、密码进行登录。
   登录账号可能是你的手机号、邮箱或工号，请以企业管理员的设置为准。
4. 登录成功后，页面将自动跳转至扣子编程，用户可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)
::::

### 配置示例 {#ea92ce8e}

[通过飞书进行 SAML SSO 登录](/guides/configure_sso_from_feishu)

## 配置 OAuth 2.0 SSO 登录 {#900992d9}

### OAuth SSO 登录流程 {#8cffc101}

![Image=400x614](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cb44c7af920a453093f3969541955f5c~tplv-goo7wpa0wc-topic.webp)

流程说明如下：

1. **发起授权请求**
   用户从云身份中心（SP）发起登录，SP 将浏览器重定向到企业 IdP 的授权端点。企业用户登录企业身份系统（IdP）后，**授权给云身份中心**。
2. **颁发授权码**
   企业身份系统（IdP）生成授权码并返回授权码。
3. **换取访问令牌**
   云身份中心接收到授权码后，使用其客户端 ID 和密钥，直接向企业身份系统的令牌端点发起请求，用授权码换取访问令牌（Access Token）。
4. **获取用户信息并完成登录**
   企业身份系统验证请求后，返回访问令牌。云身份中心通过访问令牌获取当前用户在企业身份系统的身份信息，根据用户映射规则映射到云身份中心中的用户，实现 SSO 登录。   


### 步骤一：管理员配置 OAuth 2.0 SSO 登录 {#cc3c17e4}


1. 登录[云身份中心控制台](https://console.volcengine.com/cloudidentity/saas/user/)。
   :::tip 说明
   主账号或具备火山引擎云身份中心管理员权限（CloudIdentityFullAccess）的 IAM 用户，才可开通和使用云身份中心。
   :::
2. 在 **SSO 登录设置**区域，单击 **OAuth 2.0** 页签，单击**编辑**。
   ![Image=600x307](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7c39edede29449a19d2217744afd655a~tplv-goo7wpa0wc-topic.webp)
3. 配置 SSO 登录设置相关参数，详细说明请参见[如何完成Oauth2.0协议配置](https://www.volcengine.com/docs/7165/1802891#zLdppn5X)。以飞书 OAuth SSO 为例，对应参数值的获取方法请参见[飞书 OAuth 2.0 SSO使用指南](https://anycross.feishu.cn/documentation/sso/protocol/OAuth)。
   ![Image=400x496](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/67c8213a5ab54659b75f294c5bb32131~tplv-goo7wpa0wc-topic.webp)
4. 将回调地址填写到企业 IdP 的 OAuth 应用中。
   将云身份中心控制台的**用户管理** > **用户登录设置** > **SSO登录设置**中获取的回调地址，填写到企业 IdP 的 OAuth 应用的**应用回调地址**中。下图为飞书 OAuth SSO 的配置界面示例，供参考，具体配置方法请参见[飞书 OAuth 2.0 SSO使用指南](https://anycross.feishu.cn/documentation/sso/protocol/OAuth)。
   ![Image=300x145](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d27f4ae1e4b5472d865a958ca2cc830d~tplv-goo7wpa0wc-topic.webp)
5. 开启企业 SSO 登录。
   在云身份中心控制台的**用户管理** > **用户登录设置** > **SSO登录设置**中开启 SSO 登录。
   开启后，管理员可在该页面复制用户登录地址，并提供给企业成员，企业成员可通过该地址登录扣子编程。
   ![Image=600x348](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/936ee735d6674e04a733974fc46d2b9e~tplv-goo7wpa0wc-topic.webp)   


### 步骤二：管理员创建企业成员 {#f932fa5b}

在扣子编程中，根据 SSO 登录设置中配置的用户映射规则，创建**与企业 IdP 信息相匹配的**企业成员，并将其加入企业。详细操作步骤可参考[操作步骤](/guides/create_member#22807250)。

:::tip 说明
为了实现单点登录，扣子企业成员的名称必须与企业身份系统传递的用户信息中的某个字段进行精确匹配，例如用户ID、用户名或邮箱前缀等。你可以在身份提供方（IdP）中配置用户的唯一标识，用于将企业身份提供商返回的用户信息与云身份中心的用户进行关联匹配。
:::

![Image=604x259](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/06e9c6d60e4e49f9ac0dd348cee5f62c~tplv-goo7wpa0wc-topic.webp)

### 步骤三：企业成员使用 SSO 登录 {#36b22c3e}

完成以上步骤之后，企业成员可以参考以下步骤使用 SSO 登录扣子编程。

::::tabs
@tab 通过扣子登录
通过扣子登录页面登录：

1. 企业成员访问管理员提供的扣子编程登录地址。
   管理员可以在[火山扣子控制台](https://console.volcengine.com/coze-pro/overview) > **成员管理**页面查看这个登录地址。
   ![Image=692x183](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8556ed9345264636b251dd1ba4eba4d0~tplv-goo7wpa0wc-topic.webp)
2. 企业成员在登录页面中输入企业别名和火山用户名，并单击**下一步**。
   :::tip 说明
   用户名要填写火山子用户的用户名（user_name），而不是扣子用户名（coze_user_name）。
   :::
3. 单击**企业账号免密登录**。
   ![Image=286x177](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/95c1b726a66a4a94803546450c3ae08a~tplv-goo7wpa0wc-topic.webp)
4. 页面会自动跳转至身份提供商的登录页面，根据界面提示，输入账号、密码进行登录。
   登录账号可能是你的手机号、邮箱或工号，请以企业管理员的设置为准。
5. 登录成功后，页面将自动跳转至扣子编程，用户可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)

@tab 通过云身份中心登录
通过云身份中心提供的链接登录：

1. 企业成员访问管理员提供的用户登录地址。
   管理员可在该页面复制用户登录地址，并提供给企业成员，企业成员可通过该地址登录扣子编程。
   ![Image=500x291](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/657d4fea4c77401b991422780da37db6~tplv-goo7wpa0wc-topic.webp)
2. 根据界面提示，输入账号、密码进行登录。
   登录账号可能是你的手机号、邮箱或工号，请以企业管理员的设置为准。
3. 登录成功后，页面将自动跳转至扣子编程，用户可以选择访问火山引擎扣子控制台或扣子编程。
   ![Image=418x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1e7eea3e8df84a6b87ab254fddaa2442~tplv-goo7wpa0wc-topic.webp)
::::

## 参考信息 {#2d34253e}

### SAML 响应格式要求 {#365422e0}

在用户登录 IdP 后、请求登录扣子编程时，IdP 会向扣子编程发送 SAML 响应。扣子编程通过验证 SAML 响应中的签名、解析 SAML 响应中传递的当前用户身份信息，为用户实现安全快捷的 SAML SSO 登录。

在配置完成后，调试登录流程时，SAML 响应需要满足下述格式，请确保您的 SAML 响应与下方示例格式相同、无元素缺失。

```XML
<samlp:Response>
    <saml:Issuer>${Issuer}</saml:Issuer>
    <ds:Signature>
        ...
    </ds:Signature>
    <samlp:Status>
        <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"></samlp:StatusCode>
    </samlp:Status>
    <saml:Assertion>
        <saml:Issuer>...</saml:Issuer>
        <ds:Signature>
            ...
        </ds:Signature>
        <saml:Subject>
            <saml:NameID>${NameID}</saml:NameID>
            <saml:SubjectConfirmation>
                ...
            </saml:SubjectConfirmation>
        </saml:Subject>
        <saml:Conditions>
            <saml:AudienceRestriction>
                <saml:Audience>${Audience}</saml:Audience>
            </saml:AudienceRestriction>
        </saml:Conditions>
        <saml:AuthnStatement>
            ...
        </saml:AuthnStatement>
    </saml:Assertion>
</samlp:Response>
```

### SAML 断言中的元素说明 {#b45427ac}

SAML 2.0 协议的通用元素如下：

<!-- @cols-width: 177,688 -->
| | | \
|**元素** |**说明** |
|---|---|
|Issuer |标识断言的颁发者，通常是 IdP 的实体 ID（EntityID）。其值必须与 SP 配置中指定的 IdP 的 EntityID 匹配。扣子编程需要验证该字段，以保证请求登录的身份提供商为已经完成信任配置的身份提供商。 |
|Signature |SAML 响应的签名，用于保护断言的完整性、验证颁发者的身份。签名包含签名值和签名算法等信息，应基于 IdP 元数据文件中的安全证书信息验签通过，确保断言在传输过程中未被篡改。 |\
| | |\
| |签名算法支持以下几种： |\
| | |\
| |* [RSA-SHA1](rsa-sha1) |\
| |* [RSA-SHA256](http://www.w3.org/2001/04/xmldsig-more#rsa-sha256) |\
| |* [RSA-SHA512](http://www.w3.org/2001/04/xmldsig-more#rsa-sha512) |
|Subject |表示断言的主体，通常包含用户的唯一标识。主要参数如下： |\
| | |\
| |* **NameID**：用户的唯一标识，格式可以是电子邮件、持久化标识符等。NameID 取值需要和火山引擎扣子控制台**用户管理**页面中企业成员的用户名完全一致。 |\
| |* **SubjectConfirmation**：确认主体身份的方法。以下字段需要包含唯一有效的取值： |\
| |   * **NotOnOrAfter**：用于指定断言有效期，UTC 时间。 |\
| |   * **Recipient**：扣子编程需要基于 Recipient 验证自身确实为当前响应的接收方，其取值必须为扣子编程提供的 SP ACS URL。格式为 `https://signin.volcengine.com/cloud-identity/${region}/${uuid}/userlogin/saml/sso`。 |\
| | |\
| |Subject 元素示例： |\
| | |\
| |```XML |\
| |<saml:Subject> |\
| |   <saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">user1</saml:NameID> |\
| |   <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"> |\
| |    <saml:SubjectConfirmationData NotOnOrAfter="2024-02-28T12:26:14Z" Recipient="https://signin.volcengine.com/cloud-identity/${region}/${uuid}/userlogin/saml/sso"></saml:SubjectConfirmationData> |\
| |   </saml:SubjectConfirmation> |\
| |  </saml:Subject> |\
| |``` |
|Conditions |定义断言的使用条件，必须包含 `AudienceRestriction`，其中包含唯一有效的 **Audience** 元素，指定断言的接收方（SP）。**Audience** 取值为火山引擎扣子控制台上复制的服务提供商 EntityID，格式为`https://signin.volcengine.com/cloud-identity/saml/sso/${CloudIdentity_Instance_Id}`。 |\
| | |\
| |Conditions 元素示例： |\
| | |\
| |```XML |\
| |<saml:Conditions NotBefore="2024-02-28T12:20:14Z" NotOnOrAfter="2024-02-28T12:26:14Z"> |\
| | <saml:AudienceRestriction> |\
| |  <saml:Audience>https://signin.volcengine.com/cloud-identity/userlogin/saml/sso/2***************</saml:Audience> |\
| | </saml:AudienceRestriction> |\
| |</saml:Conditions> |\
| |``` |

### OAuth2.0单点登录的接口标准 {#395c0b07}

OAuth2.0 单点登录的接口标准请参见[OAuth2.0单点登录的接口标准](https://www.volcengine.com/docs/7165/1802891#PbC0tCdX)。
