> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程会为网页应用自动分配平台域名。如果希望使用自己的品牌域名访问网站，可以为项目添加自定义域名。本文介绍如何完成域名准备、火山引擎备案、DNS 解析和 SSL 证书配置。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 域名概述 {#e166f077}

扣子编程会为每个部署项目自动分配以 `.coze.site` 为后缀的默认域名。你也可以将项目绑定至自定义域名，以便打造专属品牌访问地址，使网站地址更容易被用户记住，还能提升品牌知名度。

你可以从火山引擎购买域名，或使用从第三方服务商处购买的域名。使用自定义域名时，你需要在火山引擎为自定义域名进行备案，并配置 SSL 证书。

默认域名和自定义域名配置方式的区别，可参考[管理网站域名](/manage-website-domains)。

## 费用说明 {#8d25dd22}

* 购买火山引擎域名时，火山引擎域名服务产品会收取域名服务费用，这些费用自动从你的火山引擎余额中扣款，不支持用扣子积分抵扣。具体收费标准可参考[域名服务计费文档](https://www.volcengine.com/docs/6568/103928?lang=zh)。
* 购买火山引擎的证书时，火山引擎证书中心会收取 SSL 证书费用，这些费用自动从你的火山引擎余额中扣款，不支持用扣子积分抵扣。具体收费标准可参考[SSL证书计费说明](https://www.volcengine.com/docs/6638/117994?lang=zh)。

## 使用限制 {#a749c041}

配置自定义域名时，存在项目类型、免费证书额度等限制。详情请参见[配额与限制](/guides/vibe_coding_limit)。

## **操作步骤** {#2da6e901}

### 步骤一：购买域名 {#5a4eb39b}

在配置自定义域名之前，你需要先购买一个域名。本文以购买火山引擎域名为例，如果你已经从其他服务商处购买了域名，可以跳过本步骤。

**使用限制**

仅火山主账号或具备 **DomainFullAccess** 权限的 IAM 用户，才支持购买火山引擎域名。

**操作步骤**

1. 打开[扣子编程建站域名特惠](https://www.volcengine.com/activity/domain-coze)页面。注册域名的详细说明请参见[注册域名](https://www.volcengine.com/docs/6568/81255?lang=zh)。
2. 单击相应的域名类型卡片，在域名搜索框中，输入你想注册的域名，单击搜索按钮。
   ![Image=500x366](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b90756a5ba784db280cfbab2f66b89d4~tplv-goo7wpa0wc-topic.webp)
3. 在对应域名右侧单击**立即购买**。根据界面提示完成支付，域名就注册成功了。
   注册域名后，域名会自动进入实名认证流程。打开[域名列表](https://console.volcengine.com/domain-service/domain)页面，你可以查看实名认证的状态。   


### **步骤二：完成**火山引擎备案 {#cae6c34f}

根据国家相关法规，所有在中国内地提供服务的网站都必须进行 ICP 备案。由于你的网页应用由扣子编程统一部署在火山引擎的服务器上，因此需要在火山引擎备案系统对域名进行备案。

:::tip 说明
* 已在其他服务商备案过的域名，仍需在火山引擎重新备案。
* 备案审核通常需要 **1 到 20 个工作日**。建议你提前规划，尽早提交备案申请，以免影响应用上线计划。
:::

1. 登录[火山引擎备案控制台](https://console.volcengine.com/beian)，单击**开始备案**。
2. 根据页面提示，填写主办者信息和备案信息，等待审核通过。不同场景的备案流程稍有差异，具体如下表所示。
   <!-- @cols-width: 486,166 -->
   | **场景**  | **备案流程**  |
   | --- | --- |
   | 首次购买域名，且没有任何备案历史。  | [首次备案流程](https://www.volcengine.com/docs/6428/68739?lang=zh)  |
   | 域名已在其他服务商备案，现需指向火山引擎服务器。  | [接入备案流程](https://www.volcengine.com/docs/6428/68740)  |
   | 你已有其他域名在火山引擎备案，需为新域名备案。  | [新增服务流程](https://www.volcengine.com/docs/6428/68741)  |   


### **步骤三：添加自定义域名** {#hmjnxsE5Z}

完成域名准备和备案后，就可以在你的 AI 编程开发的项目中绑定自定义域名。

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-topic.webp)
2. 在 AI 编程开发界面的右上角单击**部署**。
   ![Image=500x376](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1ad90d994a184a75a3edba9ab24b056b~tplv-goo7wpa0wc-topic.webp)
3. 在**部署**页面的**部署域名**右侧单击**添加域名**。
4. 在**域名**页面单击**添加域名**，在**添加域名**对话框中，输入该项目使用的具体域名。
   域名后缀为步骤一中准备好的域名。例如，备案的域名为二级域名`example.com`，此处可以填写三级域名`web.example.com`。
   ![Image=500x157](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/891d702907ed42159eb9a8faea1d74ce~tplv-goo7wpa0wc-topic.webp)
5. 单击**保存域名，下一步**。
   扣子编程会为你生成一条解析记录。下述步骤会指引你如何在 DNS 中添加对应的解析记录。
   ![Image=400x330](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/30278e0afc734cf68a5ad4cafe2b48f9~tplv-goo7wpa0wc-topic.webp)   


### 步骤四：**在 DNS 侧为域名配置解析记录** {#f20f92ef}

在你的域名服务商的 DNS 控制台，将扣子编程提供的解析记录添加到对应域名的解析记录中，从而让域名指向扣子编程为你分配的应用服务器地址。

以下是某域名服务商 DNS 控制台的配置示例，在**公网权威解析**页面，添加对应的域名，并为对应的域名添加两条解析记录。其中，解析记录中的**记录值**为扣子编程**配置域名**页面中复制的解析记录的值。火山引擎 DNS 的配置方法请参考[添加解析记录](https://www.volcengine.com/docs/6758/109959?lang=zh)。

::::cols
@col 50
扣子编程侧

![Image=400x330](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/30278e0afc734cf68a5ad4cafe2b48f9~tplv-goo7wpa0wc-topic.webp)

@col 50
DNS 侧

![Image=500x263](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/858df1e6cb9d421db71436b0d8c4c105~tplv-goo7wpa0wc-topic.webp)
::::

:::tip 说明
扣子编程侧解析记录的状态变为**已验证**，说明 DNS 侧已正确配置解析记录。
:::

### 步骤五：购买或上传 SSL 证书 {#hfF4zGnOJ}

为确保数据传输的安全，你需要为你的域名配置 SSL证书。扣子编程提供两种证书配置方式。

<!-- @cols-width: 100,500,241 -->
| **证书类型**  | **说明**  | **配置方式**  |
| --- | --- | --- |
| **免费证书**  | 适用于需要为自定义域名快速、免费启用 HTTPS 的场景，例如个人项目或开发测试环境。 | 单击**生成免费证书**。扣子编程将自动生成免费证书并完成证书安装，整体过程预计需要 3~5 分钟。同时，建议你勾选**自动轮转。** | \
| | | | \
| | * **有效期与额度**：[免费证书](https://www.volcengine.com/docs/6638/139126?lang=zh)遵循火山引擎的统一策略，有效期为 **3 个月**，每个主账号在一个自然年内拥有 **20 次**免费证书的生成额度。 | ![Image=1085x1179](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9152541779144f43a2f10ef3c0caabb0~tplv-goo7wpa0wc-topic.webp)  | \
| | * **额度可用**：为避免证书过期导致服务中断，强烈建议勾选**自动轮转**。只要年度额度有剩余，系统将在证书到期前自动为你生成并替换新证书。 | | \
| | * **额度用尽**：当年度免费证书额度用尽时，自动轮转功能将失效。 | | \
| | * **过期通知**：扣子会在证书到期前 3 个工作日向你发送过期提醒。收到通知后，你需要及时切换为付费的火山引擎证书，或等待下一自然年额度重置后，重新生成免费证书。  | |
| **火山引擎证书**  | 适用于对稳定性要求较高的生产环境，或当免费证书额度用尽后，需要为自定义域名提供长期、可靠的 HTTPS 服务。 | 单击**选择并添加**，在下拉列表中选择你已购买的火山引擎证书，扣子编程将自动完成证书安装。 | \
| | | | \
| | * **有效期**：通常为 **1 年**。 | ![Image=1079x1177](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/35c4c9ad24084ae7ad8cfca99833d9ec~tplv-goo7wpa0wc-topic.webp)  | \
| | * **购买**：根据页面提示先购买火山引擎证书，详细操作说明请参见 [SSL 证书快速入门](https://www.volcengine.com/docs/6638/118049?lang=zh)。 | | \
| | * **续费：​**在证书到期前 30天 内执行续费，否则证书将自动失效，详细操作说明请参见[续费 SSL 证书](https://www.volcengine.com/docs/6638/125688)。  | |

完成备案、DNS 和证书配置后，你可以点击**保存域名**。自定义域名会展示在域名列表中，状态为可访问。此时可以通过该域名直接访问已部署的网站，也可以在域名右侧的更多菜单中将其设为主域名。

## 相关操作 {#b51ce830}

### 部署项目 {#0a8992b0}

你可以在完成自定义域名配置之前或之后部署项目，具体步骤可参考[部署网页应用](/guides/deploy_vibe_web)。

### 查看域名配置 {#94f15fd8}

你可以查看自定义域名的配置，包括完整的域名、域名解析记录、证书的有效期等信息，你也可以重新添加证书。

:::tip 说明
仅自定义域名支持查看域名配置，扣子编程默认域名不支持查看域名配置。
:::

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-topic.webp)
2. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
   ![Image=500x345](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d1704b1c963e4bad9f4b26775415c6da~tplv-goo7wpa0wc-topic.webp)
3. 在**部署**页面的**域名**页签中，在目标域名右侧单击**查看配置**。你可以执行以下操作：
   * **查看完整域名**：你可以复制此地址，用于分享给你的用户，以便访问网页。
   * **查看 DNS 解析记录**：你可以复制此处的解析记录，将其添加到 DNS 的解析记录中。
   * **查看证书类型和有效期**：你可以查看当前配置证书的类型和有效期。如果证书即将过期，你可以添加新的证书。
   * **删除域名**：当需要更换项目的域名时，你可以从你的项目中解除该域名的绑定。
      :::tip 说明
      删除域名后，用户将无法通过此域名访问该服务。此操作不可逆，请在执行前仔细确认。
      :::      


## **常见问题** {#8727e49d}


* [域名已在其他服务商那边备案，还需要重新备案吗？](/guides/vibe_coding_faq#426c793c)
* [备案审核需要多长时间？](/guides/vibe_coding_faq#e9eb4b6b)
* [备案未完成会影响部署吗？](/guides/vibe_coding_faq#d51388b9)
* [扣子生成的免费证书和火山证书有什么区别？](/guides/vibe_coding_faq#f0e4f1d8)
* [可以使用其他厂商的 SSL 证书吗？](/guides/vibe_coding_faq#f5d6e8a1)
* [免费证书到期后能生成新的免费证书吗？](/guides/vibe_coding_faq#96633474)
