> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

内置集成是扣子编程预先打包的一系列 AI 功能和服务。你可以将它理解为“即用工具箱”，无需提供 API 密钥或进行任何配置，即可直接用来增强你的应用能力。这些内置集成包括了豆包、Kimi 等主流供应商的 AI 模型，数据库、存储、联网搜索等基础能力。

:::tip 说明
在团队版和企业版中，企业超级管理员可以通过**功能访问控制​**和**空间资源可见性**，控制成员可见的功能入口和空间资源范围。如果你未看到预期的功能和资源，请联系企业超级管理员确认。更多信息，请参考[功能访问控制](/guides_team_config#hnd1HfjfQ)和[空间资源访问控制](/guides_team_config#hCId5unoV)。
:::

## 如何使用内置集成？ {#8f4f0925}

在开发项目时，你只需与扣子 AI 对话，扣子 AI 即会加载相应的技能，为 AI 编程项目接入所需的内置集成服务。

* **初始构建项目**：开发具有 AI 功能的新项目时，扣子 AI 会自动接入所有预置的大语言模型。例如输入如下指令：
   ```Plain Text
   开发一个智能体，总结今天的科技新闻
   ```
   开发完成后，你可以切换使用不同的大语言模型，具体操作，请参考[如何切换大语言模型？](/guides/vibe_coding_faq#73ae833d)。
* **针对已有的项目**：在已开发的 AI 编程项目中，你可以继续通过对话方式，让扣子 AI 搜索并加载对应技能，来为项目接入内置集成服务。例如输入如下指令：
   ```Plain Text
   为当前的 Agent 添加一个数据库，用于存放员工的基本信息
   ```   


## 费用说明 {#06851e04}

扣子 AI 编程目前**免收存储、数据库、向量模型的内置集成费用**，后续正式计费的时间计划与产品定价请关注平台公告。

如果你的项目接入了其他内置集成，将根据不同内置集成服务的资费标准单独计费。更多信息，请参考[内置集成费用](/coze_pro/internal_integrations_fee)。

## 支持的内置集成 {#b9027063}

目前扣子编程已集成本文罗列的主流 AI 模型，并且支持扩展模型。你可以通过火山方舟集成服务来接入火山方舟模型，也可在 AI 编程项目对话区提供模型 API 信息，选择由扣子 AI 自动生成接入代码或者手动编写代码，完成自定义模型的接入。

### 大语言模型 {#eba94a79}

扣子编程提供了各类主流的大语言模型，如豆包模型、Kimi 模型等。你无需任何配置，扣子 AI 会自动为你的 AI 编程项目接入 AI 能力，满足文本生成、语义理解、多轮对话等核心 AI 需求。更多信息，请参考[集成大模型能力](/guides/integrate_llm)。

例如开发一个通过大模型总结阅读笔记的工作流，可以输入指令：

```Plain Text
开发一个阅读笔记总结工作流，通过大模型可以将获取到的文章内容进行总结、提炼，并输出总结笔记
```

![Image=508x303](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/13c779ff13cc4d81bdd545e1ec1a8119~tplv-goo7wpa0wc-topic.webp)

### 生图大模型 {#51dee5d0}

扣子编程提供了专业的豆包生图模型（如 Doubao-Seedream-5.0 ）。为 AI 编程项目接入生图大模型后，只需通过自然语言描述，即可生成高质量、风格多样的图片。具体的生图指令，请参考[基本能力](/tutorial/seedream4_prompt#d2e61fc8)。

例如开发一个生图智能体，可以输入指令：

```Plain Text
创建一个生图智能体
```

![Image=517x289](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c2238cb2e2a64bb29e51629b51439ec6~tplv-goo7wpa0wc-topic.webp)

### 视频生成大模型 {#a7d35caf}

扣子编程提供了专业的豆包视频生成模型（如 Doubao-Seedance-1.5-pro）。为 AI 编程项目接入视频生成大模型后，只需通过自然语言描述，即可快速生成符合场景需求的视频。

例如开发一个视频生成智能体，可以输入指令：

```Plain Text
开发一个生视频智能体，能够分析用户输入的关键词，识别其中的主体、动作、环境和情感氛围，生成 5-10 秒的高清视频。
```

![Image=408x226](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5e608620ca804e63b2ca1bff09011057~tplv-goo7wpa0wc-topic.webp)

### 内容处理 {#497256f8}

扣子编程提供的内容处理工具，包括视频剪辑和链接读取，用于处理音视频和网页链接等多种媒体内容。

* **视频剪辑**
   为你的 AI 编程项目接入视频剪辑工具后，只需提供对应的音视频素材和指令，大模型即可调用该工具完成视频剪辑。支持的剪辑能力如下：
   <!-- @cols-width: 239,568 -->
   | **工具列表**  | **说明**  |
   | --- | --- |
   | audio_to_subtitle  | 将音频转换为字幕文件。  |
   | concat_videos  | 输入视频 URL 列表和对应的转场效果 ID 列表，工具即会自动按顺序拼接视频，并在各视频片段的拼接处添加指定的转场效果。  |
   | add_subtitles  | 基于视频 URL、字幕文件 URL/自定义文本、字幕样式，为视频添加字幕。  |
   | audio_extract  | 抽取视频中的音频，并支持将其保存为指定格式的音频文件。  |
   | video_trim  | 裁剪视频时长，保留从指定的裁剪开始时间到结束时间范围内的视频。  |
   | compile_video_audio  | 指定待合成的音频和视频 URL，合成音视频。  |
* **链接读取**
   为你的 AI 编程项目接入链接读取工具后，只需提供网页 URL，大模型即可快速抓取并解析多类型的网页内容，包括网页、pdf、doc、docx、xlsx、csv 和 text 格式。请注意，由于部分网站设有访问限制，该工具可能无法获取其内容。   


例如开发一个音视频剪辑工作流，可以输入指令：

```Plain Text
开发一个音视频剪辑工作流，能够将用户上传的视频、音频按照要求完成剪辑
```

![Image=425x205](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2b31ffbbd68742adb52059565b55b9c9~tplv-goo7wpa0wc-topic.webp)

### 向量模型 {#17dcc4c3}

扣子编程提供的向量模型，能够将图片、音频等非结构化的内容转换为向量并存储于数据库中，提升大模型对非结构数据的召回能力。向量是描述文本、图片等对象特征的高维数值数组。你可以把**数据向量化**功能想象成一个数据转化器，它能将不同类型的内容（如文档、图片）都转换为统一的数字格式—**向量**，让大模型能跨模态做语义级检索与匹配。更多信息，请参考[数据向量化写入与检索](/guides/vector_based_data_writing_and_search)。

例如开发一个智能客服智能体，并需要具备数据向量化写入与检索功能，可以输入指令：

```Plain Text
搭建知识库智能客服Agent，支持将知识向量化写入到知识库中。
将如下内容向量写入到知识库中，设置 Score 为 0.7，TopK 为 5。
```

::::cols
@col 50
![Image=525x252](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/9a28e0b22b734f3186a013e4108c7153~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=1895x1263](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b5d8ede456224be391f980a5502c1889~tplv-goo7wpa0wc-topic.webp)
::::

### 语音大模型 {#ae7d94a2}

扣子编程提供了专业的豆包语音模型，为你的 AI 编程项目赋予“能听会说”的能力，覆盖语音识别和语音合成两大场景。

* 语音识别：能高准确率地将语音转为文字，更能结合上下文理解多语言、多方言背后的真实意图。
* 语音合成：能智能判断文本的情绪，用极其自然、富有感染力的语调说话，告别冰冷的机器音，带来真人般的听觉体验。

例如为英语学习智能体，添加语音播放功能，可以输入指令：

```Plain Text
添加语音能力，回复的内容能够语音播放
```

![Image=428x238](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/46ace80ea06a4073b63058f5666f087a~tplv-goo7wpa0wc-topic.webp)

### 联网搜索能力 {#8491b016}

大模型本身不具备联网搜索能力，无法通过搜索引擎获取最新的知识和数据。扣子编程提供了融合信息搜索工具，为你的 AI 编程项目接入联网搜索能力，使其能够高效获取全网的公开信息，如最新的天气、新闻、热点话题等。

该工具还深度集成豆包大模型的推理能力，能够精准解析用户检索意图，从而为大模型的决策过程提供更智能、更全面的信息补充。

例如开发 AI 新闻获取与总结工作流，该工作流需具备联网搜索能力，可以输入指令：

```Plain Text
建一个新闻工作流，每天获取最新的 AI 方向的信息，并提取关键内容
```

![Image=420x232](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7eed12a1cd224a76b794e564919e92b8~tplv-goo7wpa0wc-topic.webp)

### 数据库能力 {#c0f94941}

扣子编程提供的数据库服务，可帮助开发者为 AI 编程项目快速接入数据库，用于存储和管理各类结构化数据，如用户信息、订单历史等。

该服务基于 PostgreSQL 引擎并由平台完全托管，开箱即用。开发者无需关注底层部署与运维工作，即可使用专业、稳定的数据库。更多信息，请参考[集成数据库能力](/guides/integrate_database)。

例如为发票信息提取工作流添加数据库能力，用来存储提取记录，可以输入指令：

```Plain Text
添加数据库能力，将每次发票提取记录添加到数据库中
```

::::cols
@col 50
![Image=2127x1116](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee56965a5ae04d9180b42d341f8869e8~tplv-goo7wpa0wc-topic.webp)

@col 50
![Image=2056x385](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/591ae6dc942c49cbb1daf22ddeeb84de~tplv-goo7wpa0wc-topic.webp)
::::

### 文件存储能力 {#1459d0f4}

扣子编程提供的文件存储服务，可帮助开发者为 AI 编程项目快速接入对象存储，用于存储和管理图像、文档、音频、视频等各类非结构化数据。

该服务开箱即用，由平台完全托管。开发者无需关注底层部署与运维工作，即可使用专业、稳定的对象存储服务。更多信息，请参考[集成对象存储能力](/guides/integrate_storage)。

例如为 AI 新闻总结工作流添加文件存储能力，用于存储历史新闻，可以输入指令：

```Plain Text
为我的工作流添加文件存储功能
```

![Image=555x287](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e936704173154014a9a5116dcaf2fac1~tplv-goo7wpa0wc-topic.webp)

## 常见问题 {#0b20596e}

* [如何查看内置集成消耗的积分？](/guides/vibe_coding_faq#eed61c76)
* [如何切换大语言模型？](/guides/vibe_coding_faq#73ae833d)
* [如何批量切换待下架模型？](/guides/vibe_coding_faq#aaa08f29)

## 附件：内置集成模型列表 {#3cfc1d4f}

关于模型的具体介绍，可参考[模型发布动态](/guides/model_release_note)。

<!-- @cols-width: 192,124,286 -->
| **内置集成服务**  | **模型供应商**  | **模型列表**  |
| --- | --- | --- |
| 大语言模型  | 字节跳动  | * doubao-seed-2.0-pro | \
| | | * doubao-seed-2.0-lite | \
| | | * doubao-seed-2.0-mini  |
|^^| 智谱 AI  | GLM-4.7  |
| 生图大模型  | 字节跳动  | * Doubao-Seedream-4.5 | \
| | | * Doubao-Seedream-5.0  |
| 视频生成大模型  | 字节跳动  | Doubao-Seedance-1.5-pro  |
| 语音大模型  | 字节跳动  | * 语音识别 | \
| | | * 语音合成  |
| 向量大模型  | 字节跳动  | * Doubao-embedding | \
| | | * Doubao-embedding-vision  |
