> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子企业旗舰版支持使用火山引擎 KMS 密钥对会话数据进行存储加密，从而满足企业对数据安全的高要求。本文介绍如何使用火山引擎 KMS 实现数据加密管理。

## 功能简介 {#3577eb03}

扣子企业旗舰版支持两种密钥类型：扣子编程自带的加解密密钥和火山引擎 KMS 密钥。默认情况下，扣子使用自带密钥加密存储的会话数据。在金融、政府等对数据安全有更高要求的场景中，企业可选择使用火山引擎 KMS 密钥进行加解密，以满足其数据安全保障需求。企业可以在火山引擎上创建 KMS 密钥，将扣子侧的密钥类型修改为 KMS，并填写火山引擎 KMS 上创建的密钥，从而实现更高级别的数据加密。

使用火山引擎 KMS 密钥的优势包括：

* **自主管理密钥**：企业可以自主创建、管理和控制加密密钥，提升对数据的掌控力。
* **可靠的安全保障**：为会话数据提供更可靠的安全保障，确保企业在享受扣子编程服务时，数据安全无忧。

## 费用说明 {#93a44d5f}

使用火山引擎 KMS 密钥，火山引擎 KMS 产品会收取**密钥托管费**，这些费用自动从你的火山引擎余额中扣款，具体收费标准可参考[密钥管理计费说明](https://www.volcengine.com/docs/6476/71331)。

## 注意事项 {#a27b0735}

<!-- @cols-width: 127,730 -->
| | | \
|**类别** |**说明** |
|---|---|
|扣子套餐限制 |仅**企业旗舰版**提供**数据加密管理**功能。 |
|火山账号 |* 需要使用企业的超级管理员或管理员对应的火山引擎账号创建 KMS 密钥。 |\
| |* 火山引擎账号欠费后，密钥无法使用，会话数据无法加解密，需及时充值以保证功能正常。 |
|密钥规格 |扣子侧支持的 KMS 密钥类型仅支持 **SYMMETRIC_256**，密钥用途仅支持 **ENCRYPT_DECRYPT。** |
|加密生效范围 |* 设置火山引擎 KMS 加密后，仅对之后创建的会话数据进行加密，不影响历史会话数据。 |\
| |* 数据加密管理仅针对企业内的会话数据进行加密。 |
|密钥更换 |更换密钥后，请勿删除原密钥，否则会导致无法解析历史会话或获取上下文信息。 |

## 步骤一：创建火山引擎 KMS 密钥 {#93f10b47}

你需要创建火山引擎 KMS 密钥，用于加解密数据。

1. 登录火山引擎 [KMS控制台](https://console.volcengine.com/kms/region:kms+cn-beijing/primary)开通 KMS 服务，新建密钥环，详细步骤请参见[密钥管理快速入门](https://www.volcengine.com/docs/6476/71333)。
   ![Image=700x507](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a7b6d9f90d254b4eb85b77f23cd402e0~tplv-goo7wpa0wc-topic.webp)
2. 单击密钥环，在密钥环详情页面，单击**新建密钥**，关键参数说明如下：
   ![Image=400x378](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4f7ce92b682a4dd1bd19e8b6cae204a1~tplv-goo7wpa0wc-topic.webp)
   <!-- @cols-width: 142,635 -->
   | | | \
   |**参数** |**说明** |
   |---|---|
   |密钥类型 |本场景中需要选择 **SYMMETRIC_256**。 |
   |密钥用途 |本场景中需要选择 **ENCRYPT_DECRYPT**。 |
   |保护等级 |根据需要选择 **SOFTWARE**（软件保护） 或 **HSM**（硬件安全模块），详细说明请参见[密钥保护等级](https://www.volcengine.com/docs/6476/71338#%E5%AF%86%E9%92%A5%E4%BF%9D%E6%8A%A4%E7%AD%89%E7%BA%A7)。 |
   |别名 |自定义一个易于识别的别名，便于后续管理和识别。 |
3. 拷贝密钥 TRN，后续在扣子编程中需要使用该密钥 TRN 配置数据加密。
   ![Image=700x268](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7336be3fc50a46f69b2226726121ca05~tplv-goo7wpa0wc-topic.webp)   


## 步骤二：配置数据加密类型 {#0db92e33}

扣子默认的密钥类型为扣子的加解密密钥，企业的超级管理员和管理员可以修改密钥类型为 KMS，并填写火山引擎 KMS 上创建的密钥进行加解密。

:::tip 说明
**角色限制**：组织超级管理员或管理员。

**访问控制**：在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。
:::

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左下角单击个人头像，选择企业，然后单击对应组织的**设置**图标。
   ![Image=278x218](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/287c83b0c6844891b833ccc376ee3de4~tplv-goo7wpa0wc-topic.webp)
2. 在**企业组织管理**页面的顶部选择**数据加密管理**页签，修改密钥类型为 **火山 cloud_kms 主密钥**，并填写步骤一中拷贝的密钥 TRN，单击**确认**。
   ![Image=500x159](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/00f6dd4f83a04210bb5f7030e6926b0d~tplv-goo7wpa0wc-topic.webp)   


## 常见问题 {#c8c5889e}

### 为什么数据加密管理的状态为已失效？ {#56feef00}

当密钥类型为 **火山 cloud_kms 主密钥** 类型时，如果状态为已失效，你可以按以下思路进行排查：

* 确保火山引擎侧 KMS 密钥的状态为**启用中**，如果状态为已停用、已计划删除、已归档，则扣子侧数据加密管理将变成已失效。此时，扣子将无法对会话消息进行解密，导致回复消息报错。
   ![Image=700x350](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d5896a13975d438dabd07ae02e96cca3~tplv-goo7wpa0wc-topic.webp)
* 确保火山引擎账号未欠费，如果账号欠费，密钥无法使用，则扣子侧数据加密管理将变成已失效，你需要尽快续费，以免影响会话功能。

### 更换密钥对历史会话有影响吗？ {#a3e2432f}

更换密钥后，新会话数据将使用更换后的密钥进行加解密，历史会话数据会使用原密钥进行解密。因此，**更换密钥后，请不要删除原密钥。**

* 如果删除原密钥，将导致历史会话数据无法解密，进而无法解析历史会话或获取上下文信息。
* 原密钥存在时，更换密钥不会影响历史会话数据的正常使用。
