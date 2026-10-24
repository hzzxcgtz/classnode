> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

在扣子编程创建了自己的技能之后，你可以将技能发布到扣子对话中，供你个人使用。对于企业版套餐，员工可以在企业范围内共享技能。对于技能的开发者，你也可以将自己开发的优秀技能发布到扣子技能商店，以供其他扣子用户付费使用，将你的技能变现。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 发布技能 {#79d89163}

在扣子编程中创建的自定义技能，必须部署之后才能在扣子对话中使用。默认情况下，自定义技能只能被所有者本人使用。

参考以下步骤发布技能：

1. 登录[扣子编程](https://code.coze.cn/?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)，并在主页左上角选择工作空间。
2. 在左侧导航栏中单击**项目管理**，找到自己已经调试好的技能。
3. 打开技能，在页面右上角单击**打包**。
4. （可选）配置生产环境变量。
   在生产环境中为项目配置特定的环境变量，例如 API Key、数据库连接字符串、飞书文档地址等敏感信息，以免将这些信息硬编码在代码中导致安全风险。
   你可以新建环境变量、查看本次部署新增和变更的环境变量。关于环境变量的具体说明请参考[技能环境变量](/guides/skill_credential_variable)。
   :::tip 说明
   打包时新建的变量，仅在生产环境生效，不会被添加至开发环境。
   :::
5. （可选）开启加密部署。
   加密部署后，模型在运行技能时，无法读取脚本文件内容，会直接执行脚本文件。这种方式可以有效保障脚本文件的隐私性和安全性，但是也会牺牲一定灵活度，因为模型无法按需优化脚本、在执行失败时自动排障和修复。
   :::tip 说明
   如果你计划将技能发布为技能商店的非开源技能，则**建议开启加密部署**，以免脚本内容泄露。同时，开发者也需要保证脚本文件的代码质量，以免脚本执行失败影响用户体验。
   :::
6. 单击**打包技能**。
   扣子编程将自动进行打包操作。你可以在部署页面查看部署的进展和部署日志。部署过程可能需要几秒钟到几分钟，请耐心等待。部署过程中，你可以随时取消部署。
   ![Image=490x190](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/75f31bd8f5ee46598f9611c963176c34~tplv-goo7wpa0wc-topic.webp)   


扣子编程会自动执行技能的打包、构建和部署，部署成功后，你可以根据页面提示单击**立即体验**，在扣子对话中触发技能，体验技能的效果。

::::cols
@col 50
查看我的技能：

在[扣子技能商店](https://space.coze.cn/skills?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=) -> **我的技能** -> **我创建的**技能中，查看你已经创建并发布的自定义技能。

![Image=575x334](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/061559f8cffa498b98a9d550b977dfd4~tplv-goo7wpa0wc-topic.webp)

@col 50
使用技能：

![Image=1522x708](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f7fa1481acfd43769f7514bb85011d0b~tplv-goo7wpa0wc-topic.webp)
::::

## 相关操作 {#599c90c7}

### 将技能上架到扣子商店 {#a68799ee}

扣子官方制作了一批常用技能，已发布至扣子商店供所有用户使用。作为技能开发者，你也可以将自己开发的优秀技能设置为付费模式、设置合理的价格，并上架到技能商店，将你的技能变现。

详细操作步骤可参考[将技能上架到技能商店](/cozespace_create_skill#hq5zUwVG8)。如果上架付费技能，你需要先开通支付渠道，详细步骤可参考[开通收款账户](/guides/template_revenue_settlement#5269f774)。

### 将技能上架到企业 {#38907b46}

企业市场是扣子专为企业组织打造的内部技能分发中心。对于涉及核心业务逻辑或仅限内部使用的技能，上架到企业市场既能保护知识产权，又能提升内部协作效率。

详细操作步骤可参考[将技能上架到企业市场](/cozespace_create_skill#hDrBusFPb)。

:::tip 说明
仅团队尊享版、企业旗舰版支持在企业范围内分享技能。其他版本用户请使用扣子商店中的公开技能。
:::


