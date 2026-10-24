> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

用量管理功能可帮助你保障已部署项目的服务稳定性、安全性并控制成本。通过设置请求速率上限、项目预算和开启 DDoS 防护，你可以有效拦截恶意流量、避免预期外的积分消耗，确保服务在安全、可控的范围内高效运行。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 配置建议 {#064d8681}

* **推荐开启**：所有对外提供服务的项目，建议先开启**请求速率上限** + **DDoS 防护**，设置合理的 QPS/QPM 阈值。
* **高消耗项目优先配置预算**：生图、生视频等消耗 Token 较高的项目，建议开启**项目积分预算上限**，并设置超出后暂停服务，避免意外超支。
* **AI 接口限速**：如果项目集成了高成本的大模型，建议开启 **AI 模型接口速率上限**，设置与业务规模匹配的 QPM。

## 配置入口 {#ecec3d29}

执行以下操作：

1. 在[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)左侧导航栏选择**项目管理**，筛选带有 **New** 标签的项目，单击目标项目。
   ![Image=500x212](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf3f91f97b1e4d9094d25b7627b5ce50~tplv-goo7wpa0wc-topic.webp)
2. 在 AI 编程开发界面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
   ![Image=420x290](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d1704b1c963e4bad9f4b26775415c6da~tplv-goo7wpa0wc-topic.webp)
3. 在**用量管理**页签中，设置限流和用量策略，并单击保存配置。
   ![Image=422x353](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a029e7bd320f4bb193ae3061f3583870~tplv-goo7wpa0wc-topic.webp)   


## 配置说明 {#27ea0ccc}

:::tip 说明
* 所有配置修改完成后，点击右下角的 **保存配置**按钮，修改会**立即生效，无需重新部署服务**。
* 若配置错误，可点击**重置**按钮，恢复到修改前的配置状态。
:::

### 用量限制 {#ffb33315}

设置项目的 QPM、QPS 等速率限制，防止爬虫或恶意刷量。默认未开启用量管理，如需开启，打开模块右侧的开关，填写数值后保存即可生效。

<!-- @cols-width: 171,397,295 -->
| | | | \
|**限制项** |**说明** |**配置方式** |
|---|---|---|
|请求速率上限 |控制项目线上访问的 QPM（每分钟请求数）和 QPS（每秒请求数），防止恶意流量攻击导致服务中断或资损。 |\
| | |\
| |超限后，会触发限流策略，返回 429 状态码。 |* 配置 QPM 和 QPS，分别表示每分钟和每秒的请求数上限。 |\
| | |* 速率上限必须大于 0，最大不可超过当前套餐版本的 QPM 上限。具体限额可参考[订阅套餐](/coze_pro/premium_package)。 |
|AI 模型接口速率上限 |AI 模型接口按积分计费，建议设置速率限制，避免积分被快速消耗。建议模型 Token 消耗较多的项目按需开启，例如提供生图、生视频的项目。 |\
| | |\
| |超限后，会触发限流策略，访问 AI 模型接口报错。 |设置模型接口的 QPS，对当前项目的每个模型均生效，不支持针对某个模型单独设置 QPS。 |
|项目积分预算上限 |限制本项目每月消耗的积分上限，防止超出预算。达到阈值时通过站内信和短信通知，分别在 50%、75%、100% 时触发。 |\
| | |\
| |项目积分消耗通常包括以下部分： |\
| | |\
| |* 和编程 AI 对话 |\
| |* 使用大模型等集成服务 |\
| |* 服务托管费用（限时免费） |1. 设置预算上限。当前页面会展示此项目本月积分消耗情况，以便你设置一个合理的数值。 |\
| | |2. 设置超出后的表现。支持设置为： |\
| | |   * 仅通知，服务继续运行。 |\
| | |   * 暂停服务，返回状态码 402。 |

### 访问防护 {#3fafff9d}

自动识别并拦截异常高频请求、慢速攻击，防止恶意流量攻击导致服务中断或资损，目前支持设置 DDos 防护策略。

#### DDos 防护 {#d6e2f8d3}

自动识别并拦截异常高频请求与慢速攻击，防止服务不可用或积分被恶意消耗。由平台自动处理，无需配置规则。你可以实时查看当前的防护状态、今日已拦截的请求数。

此外，你也可以设置 DDos 防护的 IP 白名单。白名单内的 IP 不受 DDos 拦截限制，适用于内部系统、可信服务调用场景，例如办公网络、CI/CD服务器、合作伙伴IP等。支持单个 IP 和 CIDR 网段。

![Image=2330x1715](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6dd8823e1e64457c9d4e268d1a580df9~tplv-goo7wpa0wc-topic.webp)
