> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

扣子编程支持集成飞书多维表格能力，可在获得授权的飞书账号内，对目标飞书多维表格及其表记录、表字段，进行创建、查询、修改、删除等操作。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 支持的能力 {#a10476b6}

* 创建多维表格
* 搜索多维表格
* 获取多维表格元数据
* 创建多维表格数据表
* 删除多维表格数据表
* 查询多维表格下的全部数据表
* 在数据表中新增字段
* 在数据表中更新字段
* 在数据表中删除字段
* 查询单个数据表的全部字段
* 在多维表格数据表中新增多条记录，单次调用最多新增 500 条记录
* 批量更新多维表格数据表中的记录，单次调用最多更新 500 条记录
* 查询多维表格数据表中的现有记录，单次最多查询 500 行记录
* 批量删除多维表格数据表中的记录

## 配置方式 {#aee20539}

### 步骤一：为工作空间启用外部集成（企业管控操作） {#10052703}

团队高阶版、团队旗舰版、团队尊享版、企业旗舰版由组织管理员统一管控工作空间内外部集成的可用性。即组织管理员可以为工作空间设置空间内可用的外部集成。默认情况下，企业旗舰版所有工作空间内均不可使用外部集成。具体操作，请参考[步骤一：为工作空间启用外部集成](/guides/manage_external_integrations#0c1a71ed)。

:::tip 说明
**团队高阶版**、**团队旗舰版**、**团队尊享版**、**企业旗舰版**支持管控工作空间内外部集成的可用性，其他版本请跳过此步骤。
:::

### 步骤二：配置飞书多维表格集成 {#4fda6507}

在**集成管理**页面，单击飞书多维表格对应的**配置**，然后在弹出的授权框中，完成授权。

在授权时，默认选择当前登录飞书的账号，你可以切换为其他飞书账号。配置完成后，当前工作空间中，所有集成了飞书多维表格服务的项目，均只能操作本次授权的飞书账号下的飞书多维表格。不能访问其他飞书账号。

:::tip 说明
配置外部集成后，系统会根据项目类型**自动添加**对应的官方技能到技能列表中。请勿随意移除官方技能，以免扣子 AI 在开发过程中因无法加载所需技能而报错。
:::

::::cols
@col 33
![Image=404x223](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/29ad7944ce13491881fb616a2fb36f76~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=325x340](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/695e927d03764ff3af5821ccd9e3a6a1~tplv-goo7wpa0wc-topic.webp)

@col 33
![Image=1047x833](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/21f6640b4b2146d39046873036efd553~tplv-goo7wpa0wc-topic.webp)
::::

### 步骤三：为项目接入飞书多维表格集成 {#f93ee526}

配置飞书多维表格集成后，你可以在开发 AI 编程项目时，输入添加飞书多维表格集成服务的相关需求，让扣子 AI 自动识别并加载飞多维表格技能来接入飞书多维表格集成。

![Image=491x318](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/acb6b47d27774069917cf03689031af7~tplv-goo7wpa0wc-topic.webp)

## 配置示例 {#9005f0a0}

例如搭建一个识别发票的工作流，将识别结果写入到飞书多维表格进行存储和管理。

1. 搭建工作流，让扣子 AI 自动识别并加载飞多维表格技能来接入飞书多维表格集成。
   ![Image=326x338](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/59a4d55d03454b23b0b50a1beb2a202c~tplv-goo7wpa0wc-topic.webp)
2. 在飞书侧创建一个多维表格，并根据工作流输出字段设置数据表的表头和数据类型。
   ![Image=750x81](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/0b7c1d38af294326a5433d4dc5dec34f~tplv-goo7wpa0wc-topic.webp)
3. 获取多维表格 ID 和数据表 ID。
   你可以在多维表格的 URL 中获取多维表格ID 和数据表 ID，在运行工作流时，需要输入该 ID，用于指定向目标数据表写入数据。
   ![Image=1128x124](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/157b7626546f43c8b8f54be6e5e32bb6~tplv-goo7wpa0wc-topic.webp)
4. 试运行工作流。
   试运行工作流，上传发票 PDF 以及输入多维表格 ID 和数据表 ID，试运行成功后，提取到的发票信息将发送到多维表格中。   


::::cols
@col 50
![Image=1413x948](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5dcca6f7f8f340cca52e54a705bb3b34~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=752x116](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/099a0a89924a4121a9bba2ab4ecd0351~tplv-goo7wpa0wc-topic.webp)
::::

## 常见问题 {#dd7042bb}

[向飞书多维表格推送数据时，提示 [1254045]: FieldNameNotFound错误，如何处理？](/guides/vibe_coding_faq#2e580c4a)
