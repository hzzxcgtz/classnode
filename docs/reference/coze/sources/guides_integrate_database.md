> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

本文将帮助你快速上手扣子编程内置的数据库服务，包括数据库服务的基础介绍，以及在 AI 编程项目中开通数据库、使用数据库等指引。

## 功能概述 {#aa16749d}

扣子编程内置的数据库服务是专为 AI 编程项目设计的结构化数据托管方案，基于 PostgreSQL 引擎提供开箱即用的数据库能力，无需关注底层部署与运维工作。

在开发 AI 编程项目过程中，你可以通过自然语言与扣子 AI 对话，让其为你开发的 AI 编程项目开通数据库功能，也可以在可视化界面中手动配置。开通后，扣子 AI 会自动创建并连接到对应的 PostgreSQL 数据库，你可以在扣子编程的 AI 编程环境中直接操作数据库。

核心功能特性如下：

* **多样化的交互方式**：支持通过自然语言对话、符合 PostgreSQL 方言的 SQL 语句和可视化界面三种操作方式，满足不同场景和用户习惯。
* **多层环境隔离**：
   * 环境隔离：开发数据库与生产数据库物理独立，确保开发阶段的数据操作不影响线上业务数据。
   * 项目隔离：不同 AI 编程项目的数据库相互独立，数据访问权限隔离，保障数据安全。
* **自动备份与恢复**：支持秒级自动备份，可在指定的回溯范围内按需选择时间点恢复数据库。
* **安全访问机制**：数据库连接凭据（如地址、端口、用户名、密码）通过环境变量统一管理，提升访问安全性。
* **向量化写入与检索**：知识库场景。支持集成向量处理能力，通过调用向量模型将文本转换为高维数值向量并存储。在检索时，通过计算语义相似度，返回更匹配的检索结果。更多信息，请参考[数据向量化写入与检索](/guides/vector_based_data_writing_and_search)。

## 开发与生产环境 {#b35ee1b4}

扣子编程提供两类独立的数据库环境：开发数据库和生产数据库。两者采用完全相同的 PostgreSQL 数据库引擎，以确保环境一致性，但它们在物理上是完全隔离的，各自拥有独立的数据、表结构和配置。

<!-- @cols-width: 111,319,431 -->
| | | | \
|**环境类型** |开发数据库 |生产数据库 |
|---|---|---|
|**适用阶段** |AI 编程项目开发/调试阶段 |AI 编程项目部署上线后 |
|**说明** |开发阶段仅创建开发环境数据库。 |生产环境数据库在首次部署项目时，基于开发环境表结构自动创建，部署前无法手动开通数据库。 |\
| | | |\
| | |* 首次部署：支持同步开发环境的表数据至生产环境。如果不勾选同步数据，则仅同步表结构（Schema）。 |\
| | |* 后续部署：仅同步开发环境的表结构（Schema）变更，不同步具体数据。 |

## 支持的数据类型 {#e4d65bb5}

扣子编程的 PostgreSQL 数据库支持如下数据类型。

<!-- @cols-width: 162,545 -->
| | | \
|**数据类型** |**说明** |
|---|---|
|int2 |小整数类型，占用 2 字节。 |
|int4 |标准整数类型，占用 4 字节。 |
|int8 |大整数类型，占用 8 字节。 |
|float4 |单精度浮点数，占用 4 字节，精度约 6-7 位有效数字。 |
|float8 |双精度浮点数，占用 8 字节，精度约 15-17 位有效数字。 |
|numeric |任意精度的定点数，可自定义精度。 |
|json |JSON 格式文本。 |
|jsonb |将 JSON 数据解析为二进制格式存储。 |
|text |无长度限制的文本类型。 |
|varchar |可指定最大长度的文本，例如 `varchar(255)`。超出长度会报错，未指定长度时等效于 text。 |
|uuid |通用的唯一标识符。 |
|date |日期类型，无时间部分。 |
|time |时间类型，无日期部分，不包含时区信息。 |
|timetz |时间类型，无日期部分，包含时区信息。 |
|timestamp |时间戳。 |
|timestamptz |包含时区的时间戳。 |
|bool |布尔类型。 |
|bytea |二进制类型。 |
|vector |标准稠密向量。 |\
| | |\
| |仅在知识库场景中使用。在数据库的 Knowledge Schema 下，`embedding` 列被默认指定为 vector 类型。 |

## 权限说明 {#a8f3d9d6}

* 仅 AI 编程项目的所有者具备对应数据库的操作权限。
* 在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。

## 使用限制 {#dd17d70d}

每个项目均只提供一个开发环境数据库和一个生产环境数据库。

## 费用说明 {#38e2dd8f}

* 在项目开发过程中，你与扣子 AI 的每轮对话均会产生扣子编程任务费用，更多信息，请参考[扣子编程任务费用](/coze_pro/task_fee)。
* 目前**免收存储、数据库、向量模型**的内置集成费用，后续正式计费的时间计划与产品定价请关注平台公告。

## 使用数据库 {#997a58dc}

### 为项目接入数据库能力 {#22d08a4e}

你在开发 AI 编程项目时，可以与扣子 AI 对话为项目接入数据库能力。

1. 登录[扣子编程](https://code.coze.cn/home?surl_token=FJvCs&zlink_code=FFKdE&utm_medium=docs&utm_source=docs&utm_content=landingpage&utm_id=&utm_campaign=&utm_term=docs&utm_source_platform=)。
2. 在页面顶部选择目标工作空间，然后在左侧导航栏中单击**新建项目**。
3. 按需输入你的开发需求，包括为项目接入数据库服务。
   例如输入：
   ```Plain Text
   开发一个英语单词学习智能体，并为 Agent 添加一个数据库，用于存储已学习的单词
   ```
   ![Image=604x388](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/62207c67291f47d8a8bb38b7a5cdb5b4~tplv-goo7wpa0wc-topic.webp)
   为项目接入数据库能力后，你可以像聊天一样，通过自然语言指令直接对数据库进行操作。例如：
   * 创建数据表：
      ```Plain Text
      创建产品表，包含产品ID、名称、价格和库存字段
      ```
   * 插入数据：
      ```Plain Text
      帮我插入一条新的产品记录，名称是“智能耳机”，价格是 799
      ```      


### 可视化界面操作数据库 {#edbabfe3}

为项目接入数据库能力后，你也可以像操作电子表格一样管理表数据，避免 SQL 语法错误。

1. 在 AI 编程开发界面的右上角，单击➕，然后在**集成服务**区域，单击**数据库**。
2. 在**表管理**中，操作数据表。
   你可以执行增加、删除、修改或查询数据表，增加、删除、修改或查询数据等操作。
   ![Image=411x309](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6991fa6e356c47cbbbe71c97403b8093~tplv-goo7wpa0wc-topic.webp)   


### 执行 SQL 语句 {#990e913e}

如果你熟悉 SQL 语句，可直接在 SQL 编辑器中输入 SQL 语句进行操作。

1. 在 AI 编程开发界面的右上角，单击➕，然后在**集成服务**区域，单击**数据库**。
2. 在开发数据库的 **SQL查询**页签中，执行 SQL 语句。
   例如输入如下语句，并单击**运行**。
   ![Image=623x274](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/711d1aaee3ae4b07ba4e7b4d946f2105~tplv-goo7wpa0wc-topic.webp)
   ```SQL
   CREATE TABLE users (
       -- 1. 自增主键：唯一标识用户，BIGINT 适配海量用户场景
       user_id BIGSERIAL PRIMARY KEY,
       -- 2. 用户名：非空，唯一，VARCHAR(50) 限定长度
       username VARCHAR(50) NOT NULL UNIQUE,
       -- 3. 密码：非空，建议实际存储加密后的密文，VARCHAR(255) 适配加密串长度
       password VARCHAR(255) NOT NULL,
       -- 4. 手机号：唯一，可选填，用于登录/验证
       phone VARCHAR(20) UNIQUE,
       -- 5. 邮箱：唯一，可选填，用于登录/找回密码
       email VARCHAR(100) UNIQUE,
       -- 6. 用户状态：小整数，1-正常，0-禁用，默认正常
       status SMALLINT DEFAULT 1 CHECK (status IN (0, 1)),
       -- 7. 创建时间：自动记录用户注册时间，带时区
       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
       -- 8. 更新时间：自动记录信息修改时间，带时区
       updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   );
   ```   


### 数据库备份与恢复 {#ba1492eb}

扣子编程的数据库服务提供备份与恢复机制，确保数据安全。你可以按需设置**可追溯时间**，在恢复数据库时，选择恢复到**可追溯时间**范围内的数据库。

#### **备份与恢复机制** {#6821c978}

* 扣子编程的数据库服务，支持秒级自动备份。
* 恢复数据库时，仅支持恢复到指定**可追溯时间**范围内的数据库。
* 回滚 AI 编程项目时，也可同步回滚、恢复数据库。
* 数据库恢复时，无法进行数据导入、修改等操作，请稍后再试。
* 恢复操作不可撤销，当前数据将被所需的备份数据替换。为最大程度地减少数据丢失，请选择最接近所需恢复点的有效时间点。
   如果需要重新恢复到稍后的状态，请在**可追溯时间**范围内选择较晚的时间戳再次运行恢复操作。   


#### **操作步骤** {#04554108}


1. 在 AI 编程环境的右上角，单击➕，然后在**集成服务**区域，单击**数据库**。
2. 设置可溯回的时间。
   在**总览**页签的**数据恢复**区域，设置可溯回的时间，单击**保存**。
   ![Image=413x246](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c987bc60ac294a99837b0f2578bb4248~tplv-goo7wpa0wc-topic.webp)
3. 恢复数据库。
   在**数据恢复至指定时间**区域，选择恢复的时间点，单击**恢复**。
   ![Image=439x344](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/515200e4f677437399afdb7bade9c250~tplv-goo7wpa0wc-topic.webp)   


## 管理数据库 {#9acc9ad5}

下述表格罗列了数据库的相关操作。

<!-- @cols-width: 111,179,397,102 -->
| | | | | \
|**分类** |**操作** |**说明** |**图例** |
|---|---|---|---|
|管理数据表 |创建表 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以单击**新建表**，新建一张数据表。 |![Image=1822x911](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/84d7bb89409f449eb387cc1fdef6f0c3~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |编辑表 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以选择目标数据表对应的··· > **编辑表**，编辑表结构。 |![Image=1562x566](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3953c9a964d544ca9f80f2b6daad54dd~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |删除表 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以选择目标数据表对应的··· > **删除表**，删除表。删除时支持选择级联删除表。 |\
| | | |\
| | |:::notice 注意 |\
| | |删除后不可恢复，请谨慎操作。 |\
| | |::: |\
| | | |\
| | | |![Image=973x571](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cb7327c8bf624fd9ab67faf74a66ef8e~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |复制表 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以选择目标数据表对应的··· > **复制表**，复制数据表。 |\
| | | |\
| | |复制时，可以选择仅复制表结构，也可以勾选复制表数据，同步复制表数据。 |\
| | | |\
| | |如果已存在同名数据表，将复制失败。 |![Image=1010x568](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b428b8f6df3e4594b3bd69bad29c6717~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |复制表模式 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以选择目标数据表对应的··· > **复制表模式**，复制数据表的 Schema 数据到剪贴板。 |![Image=891x642](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/867add43a0a7426d95f8cfede9dc29e3~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |导出表数据 |在 AI 编程环境的**数据库** > **表管理**页签中，你可以选择目标数据表对应的··· > **导出表数据**，将表数据以 CSV 格式或 SQL 格式导出到本地。 |![Image=850x520](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/837d6bb77d15491190fc7fed99fb3328~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |管理表数据 |在 AI 编程环境**数据库** > **表管理**页签中，你可以选中目标数据表，在表中执行添加、删除、编辑、查询数据等操作。 |![Image=1568x744](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/fcdad5038232444ca49d0adc95bfbb99~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |查看表 Schema |在 AI 编程环境的**数据库** > **表管理**页签中，你可以单击目标数据表，然后单击其右下角的 **Definition**，切换查看数据表的 Schema。 |![Image=2856x1337](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f795ca76d0d34aa6884556bcfee48e0b~tplv-goo7wpa0wc-topic.webp) |
|管理数据库 |查看数据库配置 |在 AI 编程环境的**数据库** > **设置**页签中，查看数据库存储容量、环境变量等信息。 |\
| | | |\
| | |添加数据库时，扣子编程会自动将连接凭据保存为环境变量，并使用这些凭据安全地连接到数据库服务器。 |![Image=2542x1016](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ddb47e57be4f49ed962ad71ee2075146~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |删除数据库 |在 AI 编程环境的**数据库** > **设置**页签中，单击**删除数据库**，移除当前 AI 编程项目的数据库集成功能。 |\
| | | |\
| | |在此处删除数据库集成服务，不会触发代码更新，也不会影响项目的其他功能。你也可以通过与扣子 AI 对话，修改代码，删除代码中关于数据库集成服务调用的相关逻辑。 |\
| | | |\
| | |:::notice 注意 |\
| | |删除后不可恢复，请谨慎操作。 |\
| | |::: |\
| | | |\
| | | |![Image=2541x1143](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5c352a8624b442959c2873b2469a553c~tplv-goo7wpa0wc-topic.webp) |
|^^| | | | \
| |回滚数据库 |当你回滚 AI 编程项目时，可以选择是否回滚数据库。回滚编辑版本时，仅回滚开发环境数据库。目前，回滚部署版本时，不涉及回滚生产环境数据库。 |\
| | | |\
| | |如果勾选**同时回滚数据库**，系统将把数据库还原至对应版本状态，该版本之后添加的数据将丢失，包括 Schema 以及数据。 |\
| | | |\
| | |回滚数据库存在时间限制，目标版本的时间戳需处于当前数据库配置的**可追溯时间**范围内，否则将无法执行回滚。 |![Image=871x422](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/99d25aa36c06408aaf0eb2896c690443~tplv-goo7wpa0wc-topic.webp) |
|管理 SQL 语句 |保存 SQL 语句执行记录 |系统自动保存 SQL 语句执行记录，你可以单击对应的记录，查看所有已执行 SQL 语句，支持回溯与复用。 |![Image=1788x804](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/307e0814173f4ff1888efcc601e7c1c8~tplv-goo7wpa0wc-topic.webp) |

## 参考信息：设置级联删除 {#91d68ff7}

在创建数据表时，可以添加外键关系，并通过**如果引用的行删除时的操作**配置，来实现级联删除。即指定父表行删除时对子表关联行的处理规则，选项如下：

**Cascade**：从父表中删除一行时，将进行级联删除，即子表中所有相关的行也会被删除。

**Restrict**：从父表中删除一行时，如果子表中存在任何相关行，则删除操作将被中止。

**Set NULL**：当从父表中删除一行时，子表中外键列的值将被设置为 NULL。

**Set default**：当从父表中删除一行时，子表中外键列的值将设置为其默认值。

**No action**：当从父表中删除一行时，如果子表中存在任何相关行，将引发报错。

## 常见问题 {#4e5225fc}

* [如何为项目接入数据库能力？](/guides_vibe_coding_faq#0cf37807)
* [各个项目之间的数据库是共享的吗？](/guides_vibe_coding_faq#4378ae2c)
* [首次部署和二次部署的数据库同步策略有什么不同？](/guides/vibe_coding_faq#2e9ac852)
* [回滚项目版本对数据库有什么影响？](/guides/vibe_coding_faq#ddc16eac)
* [如何设置级联删除？](/guides/vibe_coding_faq#af4a3278)
