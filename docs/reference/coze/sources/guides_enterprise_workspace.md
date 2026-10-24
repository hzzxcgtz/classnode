> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

**组织超管或管理员**可以将本人拥有的工作空间迁移到企业的组织中，以便继续开发企业级应用。

## 功能简介 {#fdef76af}

创建企业之后，组织超级管理员或管理员可以将扣子个人版工作空间中的资源、智能体和应用迁移到企业的工作空间中。迁移空间功能可以高效地完成资源迁移，确保升级过程平滑顺畅。迁移后空间 ID、智能体 ID 保持不变，不影响已发布的智能体或应用正常运行，也无需重新发布。

![Image=452x581](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/43fddfe9aaa54007939f0cecf4a81488~tplv-goo7wpa0wc-topic.webp)

## 迁移规则 {#143bcfff}

<!-- @cols-width: 132,716 -->
| | | \
|**分类** |**说明** |
|---|---|
|**迁移影响** |* **此操作为一次性、不可逆的迁移操作，迁移完成后，该空间及其中的所有资源均为企业的专属资源，无法复制或迁移到企业外的空间中。建议谨慎操作**。 |\
| |* 由于智能体等资源属于空间，API 方式创建的会话属于扣子用户，迁移空间之后，智能体无权限访问原个人账号下的会话，建议开发者创建新会话。创建方式可参考[创建会话](/developer_guides/create_conversation)。 |\
| |* 如需迁移自定义渠道，建议联系扣子技术支持获取支持和帮助。 |\
| |* 迁移后，智能体和应用的 ID 均不变。 |
|迁移范围 |* 工作空间中已创建的智能体、应用、工作流、插件、知识库、数据库、卡片和提示词会同步迁移到企业中。如果某个资源的所有者未同步迁移，该资源的草稿版本不会被迁移；多人协作场景下，协作者未提交的个人草稿版本也不会被迁移。 |\
| |* 空间中指定的内部成员（子用户）和外部用户（访客）会同步迁移到企业中。 |
|权限要求 |* 从扣子个人版迁移到企业版、团队版，请确保你是空间的**所有者**。 |\
| |* 在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。 |

创建企业之后，你可以将之前已创建的工作空间迁移到新的企业中，这些工作空间中可享受企业版、团队版套餐的全部高级权益，工作空间中的成员也可以继续编排原有的智能体、使用已有的知识库等资源。

## 操作步骤 {#ba37bd89}

### 1 选择工作空间 {#b63ed370}

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=291x229](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e384093a4801493ea827989cd1eaa70d~tplv-goo7wpa0wc-topic.webp)
2. 在**企业组织管理**的顶部选择**空间管理**页签，单击右上角的**迁移空间**。
   ![Image=549x106](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ae9a879df69d451bace6e8022748c1d1~tplv-goo7wpa0wc-topic.webp)
3. 在**选择工作空间**页面，选择待迁移的工作空间，单击**下一步**。
   仅支持迁移你作为空间**所有者**的工作空间。
   ![Image=480x304](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/20a94ca6989145488129039854ee5c40~tplv-goo7wpa0wc-topic.webp)
4. （可选）如果选择了个人空间，你需要在弹出的对话框中设置该个人空间迁移后的工作空间的名称，单击**确认**。

### 2 确认非 API 资源 {#a1c7eb1f}

确认待迁移的非 API 资源，单击**下一步**。

非 API 资源的迁移范围包括空间中所有智能体、应用、插件、工作流、知识库、卡片、音色、提示词。

![Image=490x279](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e6dfd97153d848aca2a0a73fb7f84d40~tplv-goo7wpa0wc-topic.webp)

### 3 迁移 API 资源 {#437828e3}

确认空间中待迁移的 API 资源，选择迁移方式。

* 如果页面提示没有待迁移的 API 资源，可以直接单击**下一步**。
* 如果待迁移的工作空间中已创建了个人访问令牌、OAuth 应用等 OpenAPI 资源，你需要根据名下的 API 授权选择迁移方式，再根据页面提示完成迁移。

#### 选择迁移方式 {#d80cc739}

扣子支持以下两种迁移方式，其对比说明如下：

<!-- @cols-width: 112,316,400 -->
| | | | \
|**迁移对比** |**一键授权** |**手动迁移** |
|---|---|---|
|是否有损 |* 无需任何额外操作，线上服务无损迁移。 |\
| |* 原个人账号下已创建的会话仍会保留。 |* 原本的 Access Token 失效，需要重新授权 API，以避免影响线上服务。 |\
| | |* 智能体无权限访问原个人账号下已创建的会话，建议开发者创建新会话。创建方式可参考[创建会话](/developer_guides/create_conversation)。 |
|迁移限制 |* 不会移动 API，只是变更了 API 的授权范围，增加企业的访问权限。你仍需在**个人账号** > **API** **管理**中查看API 授权。 |\
| |* 仅支持 PAT 和 AuthAPP，不支持 OBO。 |将所有授权类型的 API（OBO、PAT、AuthApp）全部剪切迁移，后续可在**企业账号** > **API** **管理**处查看和修改。 |
|适用场景 |适用于无需迁移 OBO 授权的场景，且开发者希望快速完成迁移、仍可访问原个人账号下已创建的会话。 |需要手动修改代码中的授权逻辑，适用于具备一定开发背景的专业开发者。但该方式会将 API 授权迁移至企业账号下，便于后续的资源管理和维护。 |

#### 一键授权 {#3c28541a}

根据页面提示授权，允许企业访问个人版账号 API。Open API 不会迁移，仅增加企业的访问权限。

* **注意事项**：一键授权迁移方式不会迁移 OBO 授权，如果存在 OBO 类型的 API，请先参考[OBO 授权场景](/developer_guides/update_authorization#62a96ffe) 手动迁移 OBO 授权。
* **操作步骤**：
   1. 根据页面提示选择**一键授权**即可。
      ![Image=400x270](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5e6d17aabb4e422186d244e0cf2b6a0d~tplv-goo7wpa0wc-topic.webp)
   2. 后续确认待迁移的用户之后，系统会自动完成授权。

#### 手动迁移 {#bec09c28}

将空间中的所有 API 授权手动迁移到企业，选择该方式需逐一确认您已知悉风险。可通过提前授权方式降低对线上服务的影响。

* **注意事项**：
   :::notice 注意
   * 若未执行更新 API 授权步骤、直接选择**手动迁移**，会导致原有的 API 授权失效，线上用户调用 API 时会因鉴权失败而无法正常访问。
   * 如果智能体、应用或工作流已发布到生产环境且线上用户量较大，为保障平滑迁移，建议选择服务流量较少的时段（如深夜或凌晨）执行手动迁移。
   :::
* **操作步骤**：
   1. 更新 API 授权，将空间中的所有 API 授权手动迁移到企业。
      详细操作步骤可参考文档[升级企业版后更新 API 授权](/developer_guides/update_authorization)。
   2. 返回迁移空间页面，根据页面提示选择**手动迁移**。
      ![Image=323x217](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/54f4999b9bc94289b9ece717c298b85e~tplv-goo7wpa0wc-topic.webp)
   3. 选择待迁移的 API 授权，确认已知悉相关风险。
      ![Image=500x228](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0aea1d2bf2354396a347fb22ef847624~tplv-goo7wpa0wc-topic.webp)      


### 4 迁移用户 {#14a7c322}

在**选择用户**页面，从工作空间中已有的成员中选择要同步迁移的用户，并单击**确认**。

迁移成功后，被选中的成员将自动加入组织中对应的工作空间，并同步成为组织成员。支持将内部用户（子用户）和外部用户（访客）加入组织。

![Image=500x371](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1b30e453c5b54a398bceb9d0e6ab32e0~tplv-goo7wpa0wc-topic.webp)

:::tip 说明
如果企业超级管理员和管理员设置了禁止访客加入企业，迁移空间时无法选择外部用户（访客）。迁移空间成功后，外部用户会自动退出此工作空间，其拥有的资源也会自动转让给空间所有者。
:::


