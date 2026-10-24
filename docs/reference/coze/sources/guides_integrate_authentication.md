> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

通过身份验证功能，开发者只需用简单提示词说清楚需求，扣子 AI 就能给你的 Web 应用、移动应用构建一套完整的用户注册、登录和管理系统。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 什么是身份验证 {#6c7402a8}

扣子编程提供身份验证能力，可以为你的应用添加一套账号权限系统。你仅需通过简单的提示词，即可为 Web 应用、移动应用加上登录、注册、用户管理等功能。

核心功能如下：

* **极简集成**：通过自然语言或简单的手动操作，即可为你的应用添加注册、登录和用户管理等功能。
* **登录方式**：支持手机号、邮箱等登录方式。
* **用户管理**：提供直观的用户管理界面，方便你查看、管理应用里的所有注册用户。
* **数据存储**：将用户信息自动存储在你的专属数据库中。
* **自定义登录页面**：可以修改应用名称、图标等，打造符合你品牌风格的登录页面。

## 使用限制 {#0017cd59}


* 仅 **Web 应用**、**移动应用**支持集成身份验证，其他 AI 编程项目不支持。
* 部分老项目不支持身份验证配置，你可在控制台查看是否显示配置卡片，显示则代表支持。
* 复制项目时，仅复制登录配置、代码和开发环境的用户数据。

## **费用说明** {#1978a72d}

以下操作将消耗你的扣子积分。

* **身份验证**：限时免费，后续正式计费的时间计划与产品定价请关注平台公告。
* [编程任务](https://docs.coze.cn/coze_pro/task_fee)：与扣子 AI 的每轮对话。

## 效果展示 {#851399fb}

集成身份验证后，用户访问你的应用时，必须先注册账号并完成登录。

![Image=611x289](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/08ef0ce2cb87412cb319544da9f5ee15~tplv-goo7wpa0wc-topic.webp)

## 操作步骤 {#d7105e20}

### 为应用接入身份验证能力 {#a77bdfeb}

开发应用时，扣子 AI 会通过你的需求描述，接入身份验证功能；你也可以手动为应用添加身份验证功能。

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，单击某个应用。
2. 通过如下方式集成身份验证功能。

::::cols
@col 50
扣子 AI 自动集成

输入自然语言，包含**用户管理**、**用户登录、用户管理系统**等关键词，例如：

```Plain Text
帮我集成用户登录能力
```

@col 50
手动添加

1. 在开发应用的**工作区**，单击**➕新标签页**，在**集成服务**区域单击**集成服务** > **身份验证**。
2. 单击**帮我集成用户登录能力**。
   ![Image=2237x604](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ed235590c6b845e3be7bdbe47c93d91f~tplv-goo7wpa0wc-topic.webp)
::::

扣子 AI 是调用 Supabase 技能来接入身份验证能力，接入完成后，你可以继续与扣子 AI 对话，修改登录配置。例如：

::::cols
@col 50
```Plain Text
用户可以先访问主页，不需要强制登录
```

@col 50
```Plain Text
支持手机号登录
```
::::

### 用户管理 {#e4265f7a}

扣子编程提供了一个内置的用户管理界面，便于你查看和管理该应用的所有用户。

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，然后单击某个应用。
2. 在开发应用的**工作区**，单击**➕新标签页**，在**集成服务**区域单击**集成服务** > **身份验证**。
3. 在**用户**页签中，你可以查看和管理应用的所有注册用户。
   ![Image=633x150](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/60b4bb1370ad4c92909e355f321cec8a~tplv-goo7wpa0wc-topic.webp)
   * 切换环境，查看不同用户数据。
      * **线下数据**：在开发和调试过程中注册的用户数据。
      * **线上数据**：应用部署到线上后，真实的用户注册数据。
   * 查看所有注册用户：在列表中，查看已注册该应用的所有用户。
   * 查看用户详情：单击**查看详情**，查看用户的登录数据详情，包括用户 ID、邮箱、手机号、最近一次登录方式和登录时间等。
   * 删除用户：单击**删除**图标，删除无效或违规用户。
      :::notice 注意
      删除用户后，该用户将无法登录应用，该操作不可逆，请谨慎操作。
      :::      


### 配置登录页面 {#5e745b0c}

集成身份验证能力时，扣子会生成默认的登录页面，你还可以根据品牌和业务需求，自定义登录页面的图标和名称。

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，然后单击某个应用。
2. 在开发应用的**工作区**，单击**➕新标签页**，在**集成服务**区域单击**集成服务** > **身份验证**。
3. 在**配置**页签中，你可以自定义登录页面。
   目前支持自定义如下元素：
   * 应用名称：设置应用的名称。
   * 应用图标：上传符合需求的图标。
   * 登录方式：勾选支持的登录方式，包括邮箱登录、手机号登录。
      默认情况下，仅开启邮箱登录，关闭手机号登录。手机号登录功能目前仅支持中国大陆（+86）的号码。
      ![Image=515x262](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/91b7174ad8c74a909035fd44f72ae3e1~tplv-goo7wpa0wc-topic.webp)
4. 单击**保存配置**。
   保存配置成功后，会触发登录页的调试及重新生成，生成后请确认登录模块符合预期。   


### 存储用户数据 {#a149c16a}

扣子编程会为每个应用创建一个数据库，用于存储用户数据，你可以在数据库的 **auth schemas** 中，找到 **users** 数据表，进行查看。数据库的详细说明请参考[集成数据库能力](/guides/integrate_database)。

<!-- @cols-width: 142,696 -->
| | | \
|**安全特性** |**说明** |
|---|---|
|**环境数据隔离** |扣子编程数据库支持为你的应用创建并维护两份独立的用户数据表。 |\
| | |\
| |* **开发环境**：用于在开发和调试过程中产生的用户数据。 |\
| |* **线上环境**：用于已发布应用产生的真实用户数据。 |
|**行级安全策略** |系统默认会为所有表开启行级安全策略（RLS），默认仅允许用户读写自己的数据。为避免数据泄露风险，请勿关闭 RLS 以及请勿设置公开读写的 Policy。更多信息，请参考@[行级安全](https://supabase.com/docs/guides/database/postgres/row-level-security#update-policies)。 |

查看 **users 数据表**的操作步骤如下：

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，然后单击某个应用。
2. 在开发应用的**工作区**，单击**➕新标签页**，在**集成服务**区域单击**集成服务** > **数据库**。
3. 在 **auth schemas** 中，单击 **users** 数据表，查看用户数据。

![Image=674x211](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d87adca9ee0c42c9b225c67cf113feaa~tplv-goo7wpa0wc-topic.webp)

users 数据表的字段说明如下表所示：

<!-- @cols-width: 269,421 -->
| | | \
|**字段** |**说明** |
|---|---|
|id |用户身份的唯一标识。 |
|is_sso_user |是否为 SSO 单点登录用户。 |
|is_anonymous |是否匿名用户。 |
|instance_id |实例 ID。 |
|aud |受众声明，JWT 令牌的目标受众。 |
|role |数据库角色，用于 RLS 权限控制。 |
|email |用户邮箱地址。 |
|encrypted_password |加密密码哈希。 |
|email_confirmed_at |邮箱确认时间戳。用户邮箱完成验证的时间。 |
|invited_at |用户被邀请的时间。 |
|confirmation_token |邮箱验证令牌。 |
|confirmation_sent_at |验证邮件发送时间。 |
|recovery_token |密码重置令牌。 |
|recovery_sent_at |密码重置邮件发送时间。 |
|email_change_token_new |新邮箱的验证令牌。 |
|email_change |待确认的新邮箱。 |
|email_change_sent_at |换绑邮件发送时间。 |
|last_sign_in_at |最近登录时间戳。用户上次登录系统的时间。 |
|raw_app_meta_data |系统元数据（提供商、角色等）。 |
|raw_user_meta_data |用户自定义元数据。 |
|is_super_admin |是否为超级管理员。 |
|created_at |创建时间戳。用户账户创建的时间。 |
|updated_at |更新时间戳。用户信息最后一次修改的时间。 |
|phone |用户手机号。 |
|phone_confirmed_at |手机确认时间戳。 |
|phone_change |待确认的新手机号。 |
|phone_change_token |手机换绑验证令牌。 |
|phone_change_sent_at |手机换绑验证码发送时间。 |
|confirmed_at |最终确认时间戳。用户邮箱或手机号任一完成验证的时间。 |
|email_change_token_current |当前邮箱的验证令牌。 |
|email_change_confirm_status |邮箱换绑确认状态。 |\
| | |\
| |* 0：未确认 |\
| |* 1： 已确认 |
|banned_until |账号封禁截止时间。 |
|reauthentication_token |二次验证令牌（修改密码、换绑前校验）。 |
|reauthentication_sent_at |二次验证邮件、短信发送时间。 |
|deleted_at |软删除时间，不为空表示已删除。 |

## 常见问题 {#7c972419}

### **用户数据存储在哪里，是否安全？** {#974dbf27}

用户数据存储在你扣子编程项目关联的专属数据库中，并由火山引擎提供企业级的安全防护。开发环境与线上环境数据物理隔离，确保了数据的独立性与安全性。扣子编程不会使用你的用户数据。

### **误删了应用中的用户怎么办？** {#06c19740}

如果在应用的**用户管理**页面删除了用户，该操作不可逆。一旦用户被删除，其相关的认证信息将从数据库中被移除，该用户将无法登录应用，请谨慎执行删除操作。
