> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程会自动保存你的每一次部署记录，方便你随时查看历史版本或在必要时回滚到某个稳定版本。当你执行回滚操作时，扣子编程会基于所选的历史版本创建一个新的部署记录。
:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## **功能简介** {#b01a94c1}
扣子编程支持查看所有部署历史，并支持一键回滚历史版本，其典型应用场景包括：

* **快速恢复服务**：当线上版本出现故障时，可以迅速回滚到某一个已验证的稳定版本，最大限度地缩短服务中断时间。
* **问题追溯与审计**：通过完整的部署历史，可以清晰地追溯每一次变更的负责人、时间和具体内容，为故障排查提供可靠依据。

## **使用限制** {#155ec777}
支持回滚的项目状态、项目可回滚的历史部署版本数量等均存在限制，详情请参见[配额与限制](/guides/vibe_coding_limit)。
## 查看部署历史 {#1491b369}
1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-image.image)


2. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
   ![Image=500x345](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d1704b1c963e4bad9f4b26775415c6da~tplv-goo7wpa0wc-image.image)
3. 在**部署**页面的**总览**页签中，你可以查看曾经部署过的版本，和正在部署的版本。

## 回滚部署版本 {#016fe789}
当你需要将 AI 编程项目恢复到某个历史状态时，你可以执行回滚操作。回滚后，扣子编程会自动生成一个新的部署版本，原始的历史记录不会被修改或删除。
:::tip 说明
回滚时，环境变量也会回退到目标历史版本对应的环境变量设置，以确保项目在回滚后的运行环境与该历史版本一致。你可以在回滚确认对话框中查看变更的环境变量。
:::
1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-image.image)


2. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
   ![Image=500x345](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d1704b1c963e4bad9f4b26775415c6da~tplv-goo7wpa0wc-image.image)
3. 在**部署**页面的**总览**页签中，找到你希望恢复的历史部署记录。
4. 单击目标部署记录右侧的更多按钮，选择**回滚**。
   ![Image=500x219](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c156500ef6a8401f8569c61f9ebfad96~tplv-goo7wpa0wc-image.image)
5. 在回滚确认对话框中核对环境变量差异。单击**回滚**，可以重新部署该版本。
   ![Image=500x270](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/689bbd702c3341df8e2990335e92948b~tplv-goo7wpa0wc-image.image)


