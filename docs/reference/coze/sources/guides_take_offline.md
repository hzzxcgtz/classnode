> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

当你的扣子编程项目部署上线后，你可以随时通过**暂停**或**停止**操作来管理其运行状态。

* **暂停部署**：暂时停用在线服务，但保留所有部署配置和资源。这适用于临时维护、功能调试或希望在不删除服务的前提下节省部分资源成本的场景。服务可以在之后被快速恢复。
* **停止部署**：彻底终止并删除当前部署实例及其所有相关资源。此操作**不可逆**，适用于下线某个版本或希望完全停止线上资源计费的场景。服务停止后，如需再次上线，必须重新部署。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 暂停和停止部署的区别 {#95ded103}

<!-- @cols-width: 200,257,296 -->
| | | | \
|**对比项** |**暂停部署** |**停止部署** |
|---|---|---|
|**服务状态** |暂时不可用，访问时报错 503 |\
| | |\
| |![Image=2130x1310](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c1dd22931fb460692eb1484cd1f224f~tplv-goo7wpa0wc-topic.webp) |下线，访问时报错 404 |\
| | | |\
| | |![Image=204x143](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/89be69a209bb4993bf698142f60913b1~tplv-goo7wpa0wc-topic.webp) |
|**资源保留** |保留计算实例和部署配置 |彻底删除和释放 |
|**恢复方式** |点击**恢复**按钮即可 |必须重新部署 |
|**适用场景** |临时维护、调试、短期成本优化 |服务下线、长期停止服务 |

:::tip 说明
暂停和停止部署期间，无用户可访问服务，且不产生下行流量，因此不会产生任何服务托管费用。
:::

## 操作步骤 {#QjrpzE2fKK}

### 暂停部署 {#cc73b5de}

如果你希望暂时下线服务，但保留未来快速恢复的能力，可以执行以下操作：

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-topic.webp)
2. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
   ![Image=500x345](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d1704b1c963e4bad9f4b26775415c6da~tplv-goo7wpa0wc-topic.webp)
3. 在**部署**页面的**总览**页签中，找到最新一条部署成功的记录，单击暂停图标。
   ![Image=492x267](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bf4e28497bac4b20a44a15fa419d3043~tplv-goo7wpa0wc-topic.webp)
4. 在弹出对话框中单击**暂停**。
   操作完成后，该部署版本的状态将变为“**已暂停**”，用户访问此服务时将报错 503。   


### 恢复部署 {#hths25ECtl}

对于已暂停的服务，你可以随时将其恢复：

1. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
2. 在**部署历史**页面中，找到状态为“**已暂停**”的目标部署版本。
3. 单击恢复图标。
   ![Image=501x266](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a992dba85fa74aeea2b39dc3c6081319~tplv-goo7wpa0wc-topic.webp)
4. 在弹出对话框中单击**恢复**。
5. 系统会立即开始恢复服务，部署状态将重新变为“**运行中**”，服务将恢复正常访问。

### 停止部署 {#naPqxp0CRS}

如果你决定彻底下线某个部署版本并释放其所有资源，可以执行以下操作。

1. 在**部署**页面的**总览**页签中，找到最新一条部署成功的记录，单击停止图标。
2. 在弹出对话框中单击**停止**。
   ![Image=2356x1082](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f76df5d086a64abd809b66b09d1aa5af~tplv-goo7wpa0wc-topic.webp)
   操作完成后，该项目将无法被外部用户访问。
