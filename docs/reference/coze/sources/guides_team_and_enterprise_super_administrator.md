> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

购买团队版或企业版后，系统会自动将主账号设为超级管理员。你还可自行添加或取消超级管理员。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制**，控制功能的可见范围。如果你未看到预期的功能，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)。
:::

## 配置说明 {#a9164a38}

团队版和企业版的超级管理员配置方式不同，请根据你的套餐类型参考对应说明。

<!-- @cols-width: 127,325,381 -->
| | | | \
|**配置项** |**团队版超级管理员** |**企业版超级管理员** |
|---|---|---|
|系统默认超管 |购买套餐的扣子账号自动成为超级管理员 |购买套餐的火山引擎主账号（RootUser）自动成为超级管理员 |
|手动添加 |在扣子的成员列表中，修改成员身份为超级管理员。 |在[火山引擎扣子控制台](https://console.volcengine.com/coze-pro/overview)添加；火山引擎 IAM 用户也可在购买套餐时添加一位超管。详情请参考[购买订阅套餐](/coze_pro/premium_package#aad7a9fe)。 |
|数量限制 |20 位 |20 位 |
|注意事项 |不支持从企业中直接移除超级管理员，需先将其身份变更为管理员或成员。 |具备火山引擎扣子控制台操作权限（如 CozeFullAccess 权限）的 IAM 用户，可添加、变更企业版的超级管理员。 |

## 前提条件 {#3e3ea2f4}

已创建成员。具体操作，请参考[创建成员](/guides/create_member)。

## 添加超级管理员 {#357c6e94}

你可参考如下步骤，指定一个成员为企业的超级管理员。

::::tabs
@tab 团队版
1. **企业超级管理员**登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号** > **企业管理**。
   ![Image=242x193](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bd2c5aa9f08c4def8fb75e7589a81938~tplv-goo7wpa0wc-topic.webp)
3. 在左侧导航栏选择**企业成员管理**，在**成员列表**页面，设置目标成员为**超级管理员**。
   ![Image=641x143](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1c24a2d8b6464023892638431c3aa6a8~tplv-goo7wpa0wc-topic.webp)
4. 使用该用户账号登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)，确认其超级管理员身份设置生效。

@tab 企业版
1. 登录[火山引擎扣子控制台](https://console.volcengine.com/coze-pro/overview)。
2. 在**成员管理**页面，单击**设置超管**。
   ![Image=556x145](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/d73b19a1517d406fa19f51456e533ba4~tplv-goo7wpa0wc-topic.webp)
3. 在**设置超级管理员**对话框中，单击**添加超管**，选择目标成员，单击**确定**。
4. 使用该用户账号登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)，确认其超级管理员身份设置生效。
::::

## 取消超级管理员 {#748b6420}

你可参考如下步骤，取消企业超级管理员身份，将其变更为成员。

::::tabs
@tab 团队版
在扣子的成员列表中，将角色改为**管理员**或**成员**，即可取消超级管理员身份。

1. **企业超级管理员**登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号** > **企业管理**。
3. 在左侧导航栏选择**企业成员管理**，在**成员列表**页面，设置目标成员为**管理员**或**成员**。
   ![Image=633x156](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/a194c254d2374efeba20075ed491c222~tplv-goo7wpa0wc-topic.webp)

@tab 企业版
在超级超级管理员列表中，取消目标成员的超级管理员身份。

1. 登录[火山引擎扣子控制台](https://console.volcengine.com/coze-pro/overview)。
2. 在**成员管理**页面，单击**设置超管**。
3. 在**设置超级管理员**对话框中，单击目标超级管理员对应的**删除**图标。
   ![Image=378x204](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/27fef78eee204d4e9572951773fd8f38~tplv-goo7wpa0wc-topic.webp)
::::

## 查看超级管理员 {#ba96b58c}

你可参考如下步骤，查看当前企业下所有的超级管理员。

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在左下角单击个人头像，选择**企业账号** > **企业管理。**
3. 在左侧导航栏选择**企业成员管理**，在**成员列表**页面，查看企业超级管理员。
   ![Image=521x174](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cd46d1ec416a4b4798609118cb63a8f7~tplv-goo7wpa0wc-topic.webp)
