> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

为避免技能（Skill）在运行过程中泄露 API Key、鉴权秘钥、OAuth Token 等敏感信息，你可以使用环境变量来安全地存储和管理这些凭证。

根据加载方式，我们将环境变量分为以下类型：

* **常规变量**：Agent 加载技能时，会直接将这类变量加载到运行环境中。由于使用者在查看智能体的思考和规划过程时可能会看到变量的值，因此常规变量适合存储非敏感信息，例如 API 的 Base URL。
* **凭证变量**：为了保障凭证安全，当 Agent 加载技能时，系统使用占位符来代替凭证变量。只有在技能实际发起 API 调用时，系统才会通过服务端代理加载真实凭证。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 凭证变量 {#d2e0b5f1}

### 认证方式 {#cb42dfcc}

凭证变量支持以下两种认证方式：

* **API Key**：适用于通过 API 密钥进行鉴权的场景，例如调用火山方舟模型 API。
* **OAuth**：适用于需要 OAuth 协议授权的场景。授权方式包括：
   * **平台授权**：扣子官方已集成的常用第三方平台（如飞书、Notion 等），开发者无需自行配置 OAuth 参数。
   * **自建授权**：对于扣子未支持的平台，或者开发者希望使用自己的授权参数，可以手动配置 OAuth 授权所需的所有参数。

### 赋值方式 {#2ae47676}

根据由谁提供凭证，凭证变量分为以下两种：

* **开发者变量**：由技能开发者填写变量值，Agent 调用技能时，使用开发者的密钥等敏感信息发送请求。开发者变量通常是**全局固定参数**，不因用户的变化而改变，例如第三方服务的密钥。
* **消费者变量**：技能安装时将提醒用户填写变量值，使用**消费者的秘钥**，例如用户自己的公众号 AppID、secret 等。不同用户的变量值相互隔离，互不干扰。

## 使用场景 {#94537f52}

技能环境变量目前支持以下典型场景：

* **存储常规配置**：用于存放非敏感、但不希望硬编码在代码中的信息，例如 API 的 Base URL。
* **API Key 鉴权**：在调用需 API Key 作为凭证的接口时使用，例如火山方舟模型 API。
* **微信公众号消息鉴权**：配置微信公众号凭证后，所有请求将通过**固定出口 IP (`115.190.189.7`) **发送。你可以将此 IP 添加到微信公众号的 IP 白名单中。
* **OAuth 授权**：支持平台授权和自建授权两种方式，用于需要 OAuth 认证的服务集成。

## 注意事项 {#ff791995}


* **创建方式**：在扣子编程中通过 AI 编程来创建技能时，支持使用凭证变量；在扣子对话中制作的技能不支持此功能。
* **安全提醒**：关于如何安全开发与使用技能的更多信息，可参考[技能安全指南](/tutorial/skill_security_guide)。
* **域名配置**：每个凭证变量都会关联一个域名列表。为防止凭证泄漏，当 Agent 使用该凭证调用外部 API 时，扣子平台会强制校验请求的域名是否在该列表中，以防止攻击者将凭证恶意发送到未授权的服务器。
   * 对于官方托管的凭证（例如火山方舟、微信公众号、OAuth 平台授权），其关联域名由扣子平台维护，不支持修改。
   * 对于扣子编程提示你自行设置的请求域名，请谨慎配置。

## 设置常规变量 {#28c8331c}

技能常规变量的创建方式和普通环境变量一致，你可以参考[管理环境变量](/guides/environment_variables)文档查看详细说明。

::::cols
@col 50
1. 创建环境变量：

![Image=1388x492](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4ae4b0a7dc7244f39034eab93871f9ec~tplv-goo7wpa0wc-topic.webp)

@col 50
2. 请扣子 AI 设置环境变量：

```Plain Text
将 baseurl 设置为环境变量
```

![Image=191x210](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/62c3e7352b2941beba5d09f899c09653~tplv-goo7wpa0wc-topic.webp)
::::

## 设置凭证变量 {#3b4430b9}

### 步骤一：创建凭证变量 {#5fa10f39}

在 AI 编程中，你可以通过以下方式创建凭证变量：

* **自动识别**：对于需要使用秘钥等敏感信息的 AI 编程任务，扣子 AI 会自动识别并提示你将敏感字段封装为变量。例如要求调用火山方舟模型，扣子 AI 将提示你将 API Key 配置为凭证变量。
* **主动指令**：对于已开发完成的技能，你可以直接向 AI 发送指令，例如：“`请帮我识别代码中的敏感凭证信息，并进行加密。`”

![Image=437x257](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2fa86236a924416f8bbe44257cf5e73b~tplv-goo7wpa0wc-topic.webp)

### 步骤二：设置凭证变量 {#512b7b71}

扣子 AI 识别到敏感凭证后，会根据凭证变量的类型（API Key 或 OAuth），弹出对应的设置卡片。

#### API Key 类型 {#a6e6285f}

对于 API Key 类型的变量，你需要选择配置方式。例如某个技能需要调用火山方舟模型 API，则需要设置：

* **开发者变量**：直接填写变量值，并单击**继续**。技能运行时将使用你填写的值发起请求。
   ![Image=312x282](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3c7b4d4dd2064e6fab4d664fd7f437a2~tplv-goo7wpa0wc-topic.webp)
* **消费者变量**：单击**设为消费侧变量**，无需填写具体值，技能安装和运行时将由最终消费者自行填写凭证内容。
   ![Image=444x227](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a1aab1029ac14c579fa500a08e3be8b3~tplv-goo7wpa0wc-topic.webp)   


#### OAuth 类型 {#6c2a2755}

对于 OAuth 类型的变量，你需要选择授权方式，再设置配置方式。以下操作以创建一个“查询飞书云文档”的技能为例，扣子 AI 识别出需要编写脚本调用飞书 API，而飞书平台支持 OAuth 授权，因此提示用户选择授权方式。

1. 选择授权方式。
   * **平台授权**：扣子官方已集成的常用第三方平台（如飞书、Notion 等），开发者无需自行配置 OAuth 参数。
   * **自建授权**：如果平台未被官方集成，选择此项并手动配置所有 OAuth 参数。
      ![Image=365x294](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6d9aa46713904e8fb050b9202d92ce2f~tplv-goo7wpa0wc-topic.webp)
2. 选择赋值方式，即使用开发者还是消费者的秘钥。
   ![Image=314x252](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/72832317145549bba5868de79ec2d2e5~tplv-goo7wpa0wc-topic.webp)
   ::::tabs
   @tab 平台授权
   如果选择**平台授权**，扣子 AI 会进一步提示选择凭证变量的赋值方式。
   
   * **消费者授权**：无需填写具体值，技能安装和运行时将由最终消费者自行完成 OAuth 授权。
   * **开发者授权**：根据页面提示，登录你的飞书账号，完成 OAuth 授权。技能运行时将使用你的账号权限发起 API 请求，查阅飞书文档。
      ![Image=195x203](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e0e43065756643a38d72050cfc67472d~tplv-goo7wpa0wc-topic.webp)
   
   @tab 自建授权
   选择 **自建授权** 后，你需要提供 OAuth 授权所需的 `CLIENT_ID` 和 `CLIENT_SECRET`。对于飞书等特定平台，你还需配置 Redirect URL。
   
   1. 根据授权信息的提供者，选择以下一种方式进行配置：
      * **开发者授权**：
         1. 输入飞书自建应用的 `CLIENT_ID` 和 `CLIENT_SECRET`。
         2. 点击**开发者授权**。
         3. 根据页面提示，在跳转的页面中完成您自己飞书账号的授权。
      * **消费者授权**：
         1. 输入飞书自建应用的 `CLIENT_ID` 和 `CLIENT_SECRET`。
         2. 点击**消费者授权**。
         3. 配置完成后，当最终用户安装或使用该技能时，系统将引导他们完成各自飞书账号的授权。
            ![Image=211x235](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/50d8a68f1ec349d8a21b0601cc0292fd~tplv-goo7wpa0wc-topic.webp)
            需要注意的是，OAuth 授权通常还需要 token_url、authorization_url、相关域名等信息，扣子 AI 会默认识别这些信息并自动配置，如果识别不够准确，你可以在 AI 编程开发环境中打开**环境变量**页面，自行编辑变量。
            ![Image=294x204](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/292d47d41895400a9c37dd1ff1920fd0~tplv-goo7wpa0wc-topic.webp)
   2. 对于飞书等特定平台，在其开发者后台中添加扣子的 Redirect URL，作为免登授权码跳转地址。
      以[飞书开放平台](open.feishu.cn/app)为例，找到自建应用，并在安全设置 > 重定向 URL 中填写扣子指定的 URL。
      ```Plain Text
      https://www.coze.cn/api/permission_api/project_secret/callback
      ```
      ![Image=511x308](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6cf15adb4e38445d94a6b0e75de901b5~tplv-goo7wpa0wc-topic.webp)
   ::::
   完成设置之后，扣子 AI 将自动编写代码，完成技能的开发。   


### 步骤三：调试技能 {#9a5991ed}

技能开发完成后，扣子 AI 会提醒你调试技能，你可以输入简单的问题，查看凭证变量的设置是否符合预期。

* **开发者变量**：技能运行时将自动使用开发者设置的变量值来发起请求，消费者对此无感知。
* **消费者变量**：调试技能时，系统会弹出凭证填写窗口，填写完成后将独立保存用户的凭证信息，技能运行时将使用该用户配置的变量值来发起请求。

::::cols
@col 50
![Image=491x409](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c92db4bd34d9437c9a4f5a21544d867f~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=890x426](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3c9c0072e6794212bcc331daf4359576~tplv-goo7wpa0wc-topic.webp)
::::

## 相关操作 {#b568c203}

### 查看环境变量 {#fd0eb8a7}

添加环境变量后，你可以新建标签页，打开**环境变量**标签查看所有已配置的环境变量。

::::cols
@col 50
1. 打开环境变量页面。

![Image=1121x750](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/45c6ee0cb87f49aa8c32e6b6f899a113~tplv-goo7wpa0wc-topic.webp)

@col 50
2. 查看环境变量。

![Image=1127x524](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a99a753971f7488bb14c9ae74cdac5b2~tplv-goo7wpa0wc-topic.webp)
::::

### 修改环境变量 {#da8ea775}

* **修改变量类型**：直接和扣子 AI 对话，要求修改变量类型。例如：
   ```Plain Text
   帮我把 API_KEY 改成消费者变量
   ```
* **修改变量名称或值（开发者变量）**：
   1. 打开 **环境变量** 标签页。
   2. 找到您想修改的变量，在其右侧的折叠菜单中单击 **编辑**。
      ![Image=617x341](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/573189be0aeb417bb70a2d8b85092738~tplv-goo7wpa0wc-topic.webp)
* **修改已配置的凭证（消费者变量）：**
   技能的消费者可以按以下步骤修改他们自己配置的凭证：
   1. 前往 [扣子技能商店](https://www.coze.cn/skills?tab=my&surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
   2. 在 **我安装的** 或 **我创建的** 列表中找到对应的技能。
   3. 点击**授权/配置**按钮，即可重新配置变量值。
      ![Image=480x224](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a5951b366b454aebbdffc73427925cf7~tplv-goo7wpa0wc-topic.webp)      


### 部署时设置凭证变量 {#fb3e77b5}

在开发环境完成凭证变量配置后，所有凭证变量将跟随技能一同部署到生产环境。 你也可以直接在部署页面修改凭证变量的值。

![Image=476x283](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf74c291b79047f29d62539cfd0258b9~tplv-goo7wpa0wc-topic.webp)

如果在开发环境修改了环境变量，部署时你将能看到修改前后的差异，以便最终确认。

::::cols
@col 50
部署提醒：

![Image=2500x1165](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e3f12eff69d148cd985185a69590c832~tplv-goo7wpa0wc-topic.webp)

@col 50
查看差异：

![Image=2596x1375](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0354c965a015403b888458228f2854d0~tplv-goo7wpa0wc-topic.webp)
::::

## 常见问题 {#fbd7feab}

* [调用技能时，报错环境变量问题](/guides/skill_faq#62555c95)
* [配置开发者变量，但使用技能时智能体要求提供凭证](/guides/skill_faq#680675d8)
* [如何将开发者环境变量转换为消费者环境变量](/guides/skill_faq#0110b612)
* [模型重新配置环境变量后，部署页面出现重复的变量](/guides/skill_faq#3043570c)
* [上架商店时提示「skill内的敏感信息校验未通过，请求域名为空」](/guides/skill_faq#d43c511d)
* [使用技能时提示授权失败，如何解决？](/guides/skill_faq#cbfda041)
