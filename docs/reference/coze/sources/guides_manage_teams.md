> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

工作空间中的资源可以在空间成员中共享，如需和其他用户一起协同开发 AI 应用，需要先创建空间，并邀请其他用户加入空间。

:::tip 说明
* **套餐限制**：团队高阶版、团队旗舰版、团队尊享版、企业标准版、企业旗舰版
* **角色权限**：组织超级管理员和管理员。
* **数量限制**：各个套餐版本可创建的工作空间数量如下：
   * 团队高阶版：20 个
   * 团队旗舰版：40 个
   * 团队尊享版、企业标准版、企业旗舰版：不限
* **访问控制**：在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。
:::

## 创建空间 {#6a9b9c69}

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=289x227](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9e2630a20faa413a8171775ed0858515~tplv-goo7wpa0wc-topic.webp)
2. 在**组织管理**页面的顶部选择**空间管理**页签，在右上角单击➕**创建空间**。
   ![Image=661x137](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/fbe6ab5d535d4689a5ff47d51c4af85d~tplv-goo7wpa0wc-topic.webp)
3. 在**创建新工作空间**对话框，配置工作空间名称、描述和空间头像，并单击**确认**。

## 转让空间 {#9767f08d}

如果你是**空间所有者**，可以在**空间设置**页面，将空间转移给其他成员。转移后指定的成员会成为该空间新的所有者，你将变为空间的管理员。

:::notice 注意
* 转让所有权之后，空间所有者为此空间申请的个人访问密钥（PAT）会失效，无法通过这些密钥调用扣子 OpenAPI，请谨慎操作。
* 空间的所有权只能转移给空间内的其他内部用户，不支持转移给外部用户。关于内部用户和外部用户的定义，可以参考[内部用户和外部用户](/guides/teams#2ce768d6)。
:::

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=317x249](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6f497ad6bfc745668d8a7f5fc8eb7d35~tplv-goo7wpa0wc-topic.webp)
3. 在**组织管理**页面的顶部选择**空间管理**，然后单击目标工作空间对应的**设置**。
   ![Image=386x197](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5f86215a64a043d58c92b8d8b9d4bcbc~tplv-goo7wpa0wc-topic.webp)
4. 在顶部单击**空间设置**页签，单击**转让空间**。
   ![Image=500x256](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/feff9419889447539698cea10f370d06~tplv-goo7wpa0wc-topic.webp)   


## 离开空间 {#26e14f49}

空间成员和管理员可以随时退出空间，并将自己在空间中的所有资源转移给其他成员。空间所有者退出空间之前需要将空间所有权转移给其他成员。

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=319x251](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8221f2d176da4d88afd67f131e57b17e~tplv-goo7wpa0wc-topic.webp)
3. 在**组织管理**页面的顶部选择**空间管理**，然后单击目标工作空间对应的**设置**。
   ![Image=386x197](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5f86215a64a043d58c92b8d8b9d4bcbc~tplv-goo7wpa0wc-topic.webp)
4. 在顶部单击**空间设置**页签，单击**离开空间**。
   ![Image=500x260](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4577b0f1318e4b1a89999b0aedcee640~tplv-goo7wpa0wc-topic.webp)   


## 删除空间 {#332ab3fc}

如果你是**空间所有者**，可以删除空间。

:::notice 注意
删除空间后，空间内的所有数据也会同步删除且不可恢复，请谨慎操作。
:::

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择企业账号，然后单击对应组织的**设置**图标。
   ![Image=327x257](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/38b581c1672f452482ffdbad69b7c2f4~tplv-goo7wpa0wc-topic.webp)
3. 在**组织管理**页面的顶部选择**空间管理**，然后单击目标工作空间对应的**设置**。
   ![Image=386x197](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5f86215a64a043d58c92b8d8b9d4bcbc~tplv-goo7wpa0wc-topic.webp)
4. 在顶部单击**空间设置**页签，单击**删除空间**。
   ![Image=500x256](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/29d621295d0640098781fc69dd8fd4e3~tplv-goo7wpa0wc-topic.webp)
