> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

超级管理员可以修改企业的设置，包括修改名称和头像，查看套餐信息并续费。

## 修改企业的名称与头像 {#ca45bbbf}

1. 企业超级管理员或管理员登录[扣子](https://space.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)或[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号**> **企业管理**。
   ![Image=298x237](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee36314fd37b4bc182ecfe411f436a91~tplv-goo7wpa0wc-topic.webp)
3. 在左侧导航栏选择**企业设置**页签，编辑头像和名称。
   ![Image=505x238](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6268a4349f0c45278e42e94fc6aa17ae~tplv-goo7wpa0wc-topic.webp)   


## 将扣子 Logo 替换为企业 Logo {#2e4c350c}

扣子左侧导航栏中的 Logo 默认为扣子的 Logo，扣子**企业旗舰版**用户支持将平台默认的扣子 Logo 替换为企业 Logo，即企业自定义的头像，以增强品牌识别度和企业形象展示。

1. 企业超级管理员或管理员登录[扣子](https://space.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)或[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号**> **企业管理**。
   ![Image=298x237](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee36314fd37b4bc182ecfe411f436a91~tplv-goo7wpa0wc-topic.webp)
3. 在**企业设置**页签中，设置企业的自定义头像后，打开**将扣子 Logo 替换为企业 Logo** 右侧的开关。扣子会自动将左上角的扣子 Logo 替换为企业自定义头像。
   ![Image=599x292](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8f7955e289674dc7869bd28806b9dcc7~tplv-goo7wpa0wc-topic.webp)   


## 设置功能访问控制 {#hnd1HfjfQ}

:::tip 说明
* 功能访问控制仅用于控制功能入口和页面访问，不会删除已有的数据。
* 每个功能同一时间只能按一种限制维度生效，例如不能同时配置组织维度和角色维度的限制。
:::

功能访问控制用于控制企业成员对不同功能的可见性。企业超级管理员可以按角色、组织、成员或空间维度设置功能不可见性。配置保存后立即生效，后续也可以随时修改或恢复默认配置。

### 适用场景 {#hXrYtfIfr}

部分功能可能涉及数据安全、资源消耗或企业管理风险，且不同团队、角色适用的功能范围不同，因此企业可以通过功能访问控制按需设置可见范围。例如：

* 只允许管理员查看工作空间下的所有项目。
* 暂不向某个组织开放技能商店功能。
* 对指定的成员隐藏 Agent 对话记录分享、设备等功能入口。
* 在指定空间内隐藏编程项目、任务中心等功能。

### 开启访问控制 {#he1gaVnor}

企业超级管理员可以参考如下步骤设置功能访问控制。

1. 企业超级管理员或管理员登录[扣子](https://space.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)或[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号**> **企业管理**。
   ![Image=298x237](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee36314fd37b4bc182ecfe411f436a91~tplv-goo7wpa0wc-topic.webp)
3. 在**功能访问控制**页面，配置企业内不同功能对成员的可见性。
   1. 选择需要屏蔽的功能，单击**添加访问限制**。
      扣子支持配置新建项目、新建 Agent、文件、技能商店、新建编程项目、积分消耗页等功能的访问控制。具体可配置功能会随产品能力调整，实际展示为准。
   2. 选择限制维度和不可见对象，然后单击**保存配置**。
      不同功能支持的限制维度不同，以实际界面为准。保存后，被限制对象刷新页面或重新进入对应页面后，将看不到该功能入口。
      <!-- @cols-width: 147,615 -->
      | **限制维度**  | **配置后效果**  |
      | --- | --- |
      | 系统角色  | 按系统角色批量限制。 | \
      | | | \
      | | 选择管理员、成员、访客、超级管理员等角色后，这些角色的账号将看不到该功能。  |
      | 组织  | 按组织批量限制。 | \
      | | | \
      | | 选择指定的组织后，该组织下的成员将看不到该功能。 | \
      | | | \
      | | :::tip 说明 | \
      | | 目前，编程项目部署仅支持按组织维度生效；即使界面中选择了成员等其他维度，也暂不会生效。 | \
      | | :::  |
      | 成员  | 按成员精准限制。 | \
      | | | \
      | | 选择指定的成员后，对应的成员将看不到该功能。  |
      | 工作空间  | 按工作空间批量限制。 | \
      | | | \
      | | 选择指定的工作空间后，成员在该工作空间下将看不到该功能。  |
      ![Image=583x319](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ef1b5e6b9a4f4822acc04d9ad37cc703~tplv-goo7wpa0wc-topic.webp)      


### 移除访问限制 {#hYwnLA3jN}

如果不再需要限制某个功能的可见范围，企业超级管理员可以一键移除该功能的访问限制。移除后，原受限对象可重新看到该功能入口。

1. 在**功能访问控制**页面，找到需要恢复可见的功能，单击**添加访问限制**。
2. 在页面右下角，单击**清空配置**。
   ![Image=371x230](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d44bd9c313a74aa4897997232a5f53a1~tplv-goo7wpa0wc-topic.webp)   


## 设置空间资源的访问控制 {#hCId5unoV}

:::tip 说明
空间资源访问控制仅用于控制工作空间资源的可见范围，不会删除已有的数据。
:::

工作空间资源可见性用于控制不同角色的成员在工作空间内能看到哪些资源。企业超级管理员可以按工作空间、角色维度分别设置项目管理、资源库、任务中心的资源可见范围。配置保存后立即生效，后续也可以随时修改或恢复默认。

### 适用场景 {#hEnvBQdjL}

同一空间内，不同角色的成员对资源的管理需求不同。通过空间资源可见性，可以按需控制各角色能看到的内容范围。例如：

* 访客只能看到自己创建的项目，看不到其他成员的项目。
* 普通成员只能看到自己创建或参与协作的资源。
* 管理员可以看到全部资源，便于统一管理。

### 开启访问控制 {#hyyA8o2pt}

企业超级管理员可以参考如下步骤设置资源访问控制。

1. 企业超级管理员或管理员登录[扣子](https://space.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)或[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=298x234](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7af50f48a2ba4d71ab07e7c5ec455605~tplv-goo7wpa0wc-topic.webp)
3. 在**组织管理**页面，单击**配置空间资源可见性**。
   ![Image=372x140](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/63383eed6c72461898b0db20cff5e120~tplv-goo7wpa0wc-topic.webp)
4. 在**配置空间资源可见性**页面，按需设置各个工作空间内的资源可见范围。
   ![Image=475x306](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/89d11a807c91406bac0a29ba65a37c4c~tplv-goo7wpa0wc-topic.webp)
   1. 选择要配置的模块。
      不同模块支持的可见范围可能不同，请以实际页面展示为准。
      * **项目管理**：控制指定工作空间下编程项目和低代码项目的可见范围。
      * **资源库**：控制指定工作空间下资源库资源的可见范围，例如插件、知识库等。
      * **任务中心**：控制指定工作空间下工作流任务的可见范围。
   2. 分别为**访客**、**成员**、**管理员**设置资源可见范围。
      你可以为每个工作空间单独配置，也可以勾选多个工作空间进行批量配置。
      <!-- @cols-width: 157,479 -->
      | **可见范围**  | **说明**  |
      | --- | --- |
      | 自己创建的资源  | 选择该范围后，指定的角色只能看到自己创建的资源。  |
      | 自己协作的资源  | 选择该范围后，指定角色只能看到自己参与协作的资源。  |
      | 管理员创建的资源  | 选择该范围后，指定角色只能看到管理员创建的资源。  |
      | 空间所有者创建的资源  | 选择该范围后，指定角色只能看到空间所有者创建的资源。  |
   3. 单击**保存配置**。

### 移除访问限制 {#hAYqkwCMC}

如果不再需要限制某个空间内指定角色的资源可见范围，可以清空该角色的资源可见性配置。恢复默认后，该角色成员在空间内可以看到全部资源。

1. 在**配置空间资源可见性**页面，找到需要恢复默认配置的空间。
2. 清空该空间下**访客**、**成员**、**管理员**已选择的可见范围，保持不选择任何限制项。
   ![Image=386x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4bfbf3c20d3a414cac5b9d83fe5d5594~tplv-goo7wpa0wc-topic.webp)
3. 单击**保存配置**。

## 查看或修改企业的登录信息（企业版） {#9b42f900}

企业的超级管理员或管理员可以在火山引擎扣子控制台中查看或修改扣子登录信息，包括别名、默认域名等信息。

其中，企业超级管理员可以在扣子编程的**添加新成员**对话框中，单击**创建员工用户账号**，跳转到火山引擎扣子控制台进行操作，无需通过火山引擎账号进行登录。具体操作，请参考[步骤一：创建成员](/guides/create_member#895f1618)。

![Image=2367x397](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5ff70fb964904f64a236515464f554f5~tplv-goo7wpa0wc-topic.webp)

:::tip 说明
团队版不涉及此功能，无别名和域名设置。
:::

## 查看套餐信息并续费 {#84e3aaa7}

超级管理员可以在**企业设置**下查看基本信息，包括当前套餐、创建时间和到期时间，并进行续费。

##  {#3103554e}

