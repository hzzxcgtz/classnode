> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成微信公众号能力，以实现公众号文章内容的生成与文章数据查询。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 支持的能力 {#38f2d17d}

* 发布草稿到微信公众号
* 发布微信公众号文章
* 查询文章数据

## 配置方式 {#c7ca4f73}

### 步骤一：获取微信公众号配置信息 {#68ed5f6d}

在使用微信公众号集成服务前，你需要先在微信开发者平台的公众号管理页面，获取对应的开发者 ID（AppID）和密钥（AppSecret），具体操作，请参考[获取 AppID 和 AppSecret](https://developers.weixin.qq.com/doc/subscription/guide/dev/api/#%E8%8E%B7%E5%8F%96-AppID-%E5%92%8C-AppSecret)。

![Image=583x295](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7f10c780171a4d2eb0168ec7ecdcdbed~tplv-goo7wpa0wc-topic.webp)

### 步骤二：配置 IP 白名单 {#2e1fb105}

为确保接口调用安全，微信公众号仅允许白名单内的 IP 地址调用公众号的服务端接口。即你需要在微信开发者平台的公众号管理页面，配置 API IP 白名单为 `115.190.189.7`。具体操作，请参考[公众号与服务号 IP 白名单](https://developers.weixin.qq.com/doc/oplatform/developers/basic_func/ip_whitelist.html#_2%E3%80%81%E5%85%AC%E4%BC%97%E5%8F%B7%E4%B8%8E%E6%9C%8D%E5%8A%A1%E5%8F%B7-IP-%E7%99%BD%E5%90%8D%E5%8D%95)。

![Image=584x374](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/949d7a9c18cc4e998787f8747c170340~tplv-goo7wpa0wc-topic.webp)

### 步骤三：为工作空间启用外部集成（企业管控操作） {#2e131ba0}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

### 步骤四：配置微信公众号集成 {#566a9d2a}

在**集成管理**页面，单击微信公众号对应的**配置**，然后输入你已获取的开发者 ID（AppID）和密钥（AppSecret）。

:::tip 说明
配置外部集成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中。请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

::::cols
@col 50
![Image=536x355](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/077ef3964947400fa1d1426188a01d02~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1053x821](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6a5f2a83ce684442b7038fa51f5036fb~tplv-goo7wpa0wc-topic.webp)
::::

### 步骤五：为项目接入微信公众号集成 {#a726f348}

完成微信公众号集成配置后，你可以在开发 AI 编程项目时，输入添加微信公众号集成服务的相关需求，让扣子 AI 自动识别并加载微信公众号技能来添加集成服务。

![Image=476x305](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/95281c2e45cd4538a5b7b9eb28a9cad9~tplv-goo7wpa0wc-topic.webp)

###  {#9d4756e4}

