> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

在扣子编程中开发智能体、工作流、应用、技能等项目时，每轮对话均会产生扣子编程任务费用。本文主要介绍扣子编程任务费用的计费规则。
## 计费方式 {#c1ce5dee}
你与扣子 AI 的每轮对话均会产生费用。系统会根据该轮对话消耗的实际资源，从你的账户中扣减相应积分。

* **计费触发**：当你向扣子 AI 发起指令，任务开始执行即触发计费。
* **计费单位**：每轮对话扣减一次积分。
   一轮对话是指从你提交指令，到扣子 AI 完成任务并返回结果的完整过程。
* **非计费范围**：任务完成后，存储、查看及部署项目均不会产生扣子编程任务费用，即你无需删除任务以节省费用。

:::tip 说明
因为扣子平台技术问题而失败的任务，平台将进行周期性补偿。更多信息，请参考[失败任务补偿积分](/coze_pro/credits#ac31d302)。
:::
## 影响因素 {#01dca085}
每轮对话的积分消耗量取决于其调用的资源与复杂度。主要影响因素如下：

* **大语言模型**：用于解析需求、逻辑规划与决策以及生成最终产物。 
* **虚拟机**：支持文件处理、浏览器自动化以及代码执行时所需的云端计算环境。 
* **第三方 API**：调用联网搜索、生成图片等第三方 API 服务。

## 计费案例 {#76e12dd8}
下表展示了不同类型扣子编程任务的积分消耗案例，供你参考。
<!-- @cols-width: 102,325,262,104 -->
| | | | | \
|**任务类型** |**产物** |**完整项目** |**消耗的积分** |
|---|---|---|---|
| | | | | \
|网页 |通过 AI 编程开发一个网页版智能翻译工具，网页 URL 为 [智能翻译工具网页](https://3p227p87yq.coze.site)。 |\
| |![Image=1300x801](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e0d1ce1e9dd240c68ef7a0c8e7b7d6c0~tplv-goo7wpa0wc-image.image) |查看[完整项目](https://code.coze.cn/p/7598451242167386150/preview?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=) |386.00 |
| | | | | \
|智能体 |通过 AI 编程开发一款情绪陪伴智能体。 |\
| |![Image=1058x833](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/03d496ecc34f41acad29859f159e1c85~tplv-goo7wpa0wc-image.image) |查看[完整项目](https://code.coze.cn/p/7598520686268743690/preview?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=) |119.80 |
| | | | | \
|工作流 |通过 AI 编程开发一款提取发票信息的工作流。 |\
| |![Image=1295x833](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c84daa4e9c34593a62ae339ef0348bb~tplv-goo7wpa0wc-image.image) |查看[完整项目](https://code.coze.cn/p/7598510609772118067/preview?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=) |297.84 |
| | | | | \
|技能 |通过 AI 编程开发一个文档润色的技能。 |\
| |![Image=1902x899](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c7e1607ee83c4770a42f207001bed0e0~tplv-goo7wpa0wc-image.image) |不支持分享 |113.31 |

## 常见问题 {#3eeaabee}

* [如何查看每次编程任务消耗的积分？](/coze_pro/billing_faq#837f5e6f)
* [任务开发失败，如何抵扣积分？](/coze_pro/billing_faq#3fcf0107)
