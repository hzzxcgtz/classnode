> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

将 AI 编程生成的工作流部署为 API 服务后，你可以通过 HTTP 请求在自己的应用或网页中调用该工作流，从而集成对应的 AI 能力。

## 接入准备 {#8349d337}
### 部署智能体 {#0c54c4a2}
已将 AI 编程生成的智能体部署为 API 服务。具体可参考[部署智能体](/guides/deploy_agent_as_api_service)。
### **查看 API 访问信息** {#2ea4ece4}
获取该服务的 API 访问地址、请求Header、请求参数等详细信息。

1. 在部署的**总览**页面，单击某条部署记录右侧的更多按钮，选择**查看**。
   ![Image=500x195](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/eef320d3063c4f90a0bd05f32110ba72~tplv-goo7wpa0wc-image.image)
2. 在**API 请求示例及接口说明**页面，查看该服务的 API 访问信息。
   ![Image=500x433](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/52d94dd609844ba98b4e7b9a4429f929~tplv-goo7wpa0wc-image.image)

### **创建 API Token** {#ebedfe84}
你需要创建 API Token，调用 API 时需要使用 API Token 进行身份验证。你需要将创建的 API Token  包含在请求头的 `Authorization` 参数中。

1. 在智能体开发页面，在右侧单击➕打开新的标签页，在弹出的标签页中选择**部署**。
2. 在部署的**总览**页面，单击某条部署记录右侧的更多按钮，选择**查看**。
3. 在**API 请求示例及接口说明**页面，单击**管理 API Token**，单击**创建 API Token** 生成新的 API Token。复制并妥善保存 API Token。 
   :::tip 说明
   * 生成的令牌仅在此时展示一次，请即刻复制并妥善保存，不要在浏览器或其他客户端代码中暴露 API Token。
   * API Token 的有效期为永久有效。
   * 每个项目最多能创建 10 个 API Token，你也可以在 **API Token** 页面查看已创建的 API Token 列表，删除不再使用的 API Token。
   * 暂时不支持在部署详情页面直接调用和调试 API。
   :::
   ![Image=500x541](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b009fab8cedb4c1a8b1849a0b4525778~tplv-goo7wpa0wc-image.image)

## API 接口说明 {#4465e288}
<!-- @cols-width: 162,288,352 -->
| | | | \
|**API 接口** |**请求地址** |**适用场景** |
|---|---|---|
| | | | \
|执行智能体 |`https://<your_domain>/stream_run` |适用于需要直接调用智能体，并通过 SSE 事件流持续接收智能体回复、工具调用等事件的场景。 |
| | | | \
|异步执行智能体 |`https://<your_domain>/async_run` |适用于执行时间较长（24小时以内）、不需要在当前请求中立即获取结果的场景。调用后会先返回异步任务 ID。 |
| | | | \
|查询异步执行任务状态 |`https://<your_domain>/task/{task_id}` |用于根据异步任务 ID 查询任务状态、执行结果或错误信息。 |

### 理解请求参数 {#d83d86a4}
智能体 API 的请求体通常包含智能体输入内容、请求类型、会话 ID 和项目 ID。不同智能体的可用输入内容可能不同，请以部署页面展示的参数说明和调用示例为准。
公共请求参数说明如下：
<!-- @cols-width: 256,100,490 -->
| | | | \
|**字段** |**类型** |**描述** |
|---|---|---|
| | | | \
|content |object |本次调用输入给智能体的内容。 |
| | | | \
|content.query.prompt |array |用户输入内容列表。文本输入时，元素的 type 为 text。 |
| | | | \
|content.query.prompt[].content.text |string |用户输入的文本内容。 |
| | | | \
|type |string |请求类型。文本问答场景通常为 query。 |
| | | | \
|session_id |string |会话 ID。由开发者自行定义，相同会话 ID 可用于关联多轮对话上下文。 |
| | | | \
|project_id |int |项目 ID。请使用部署页面调用示例中的项目 ID。 |


:::: tabs
@tab 文本输入
```JSON
{
  "content": {
    "query": {
      "prompt": [
        {
          "type": "text",
          "content": {
            "text": "今天天气真好，我们去爬山吧"
          }
        }
      ]
    }
  },
  "type": "query",
  "session_id": "B683KwyyyPEj3cbMxvuIx",
  "project_id": 7647467737832407091
}
```


@tab 文件输入
如果需要让智能体识别或分析图片、视频等文件内容，请使用 upload_file 类型传入文件 URL。AI 编程项目中不兼容低代码 API 文档中的[上传文件](/developer_guides/upload_files)等 API 。
```JSON
{
  "content": {
    "query": {
      "prompt": [
        {
          "type": "text",
          "content": {
            "text": "请分析这张图片的内容"
          }
        },
        {
          "type": "upload_file",
          "content": {
            "upload_file": {
              "url": "https://example.com/demo.awebp",
              "file_name": "demo.awebp"
            }
          }
        }
      ]
    }
  },
  "type": "query",
  "session_id": "B683KwyyyPEj3cbMxvuIx",
  "project_id": 764746773783240****
}
```


::::

### 执行智能体 {#773d3a73}
调用智能体的 API 是一个流式响应 API。调用该 API 时，服务端不会一次性发送所有数据，而是以数据流的形式逐条发送数据给客户端，数据流中包含智能体执行过程中触发的各种事件，直至处理完毕或处理中断。
#### 请求示例 {#84fd4ed0}
```Plain Text
curl --location --request POST 'https://<your_domain>/stream_run' \
  --header 'Authorization: Bearer <YOUR_API_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data '{
    "content": {
      "query": {
        "prompt": [
          {
            "type": "text",
            "content": {
              "text": "今天天气真好，我们去爬山吧"
            }
          }
        ]
      }
    },
    "type": "query",
    "session_id": "B683KwyyyPEj3cbMxvuIx",
    "project_id": 764746773783240****
  }'
```

其中，请将：

* <your_domain> 替换为部署页面提供的 API 服务域名。
* <YOUR_API_TOKEN> 替换为你创建的 API Token。
* text、session_id 和 project_id 替换为当前智能体实际需要的参数。

#### 返回示例 {#182b3908}
```Plain Text
event: message
data: {"type":"message_start","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"4a4d34bd-7772-40e5-8f41-a45670cbd897","sequence_id":1,"finish":true,"content":{"answer":null,"thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":{"local_msg_id":"","msg_id":"","execute_id":"63f6f0ee-7a76-4cb1-9ced-79ea35036556"},"message_end":null},"log_id":"20260604200843BED3BB46C848623AC0D8"}

event: message
data: {"type":"answer","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"8127b0e3-e5f6-4c79-a60e-ff4559f8fefa","sequence_id":2,"finish":false,"content":{"answer":"你","thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":null,"message_end":null},"log_id":"20260604200843BED3BB46C848623AC0D8"}

event: message
data: {"type":"answer","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"8127b0e3-e5f6-4c79-a60e-ff4559f8fefa","sequence_id":3,"finish":false,"content":{"answer":"还","thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":null,"message_end":null},"log_id":"20260604200843BED3BB46C848623AC0D8"}

event: message
data: {"type":"answer","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"8127b0e3-e5f6-4c79-a60e-ff4559f8fefa","sequence_id":28,"finish":false,"content":{"answer":"✨","thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":null,"message_end":null},"log_id":"20260604200843BED3BB46C848623AC0D8"}

event: message
data: {"type":"answer","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"8127b0e3-e5f6-4c79-a60e-ff4559f8fefa","sequence_id":29,"finish":true,"content":{"answer":"","thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":null,"message_end":null},"log_id":"20260604200843BED3BB46C848623AC0D8"}

event: message
data: {"type":"message_end","session_id":"kWzXiLlm2kZjWZaEB3Kn0","query_msg_id":"","reply_id":"6b7a19b7-8d5e-4925-9ff0-ec5558740e0a","msg_id":"16117493-add0-4eb6-8188-9de49fe0b62c","sequence_id":30,"finish":true,"content":{"answer":null,"thinking":null,"tool_request":null,"tool_response":null,"error":null,"message_start":null,"message_end":{"code":"0","message":"","token_cost":{"input_tokens":0,"output_tokens":0,"total_tokens":0},"time_cost_ms":2734}},"log_id":"20260604200843BED3BB46C848623AC0D8"}
```

#### 返回字段说明 {#6632f078}
<!-- @cols-width: 151,100,500 -->
| | | | \
|**字段** |**类型** |**描述** |
|---|---|---|
| | | | \
|event |string |SSE 事件类型，一般为 message。 |
| | | | \
|data |object |SSE 事件内容。不同 data.type 对应不同事件结构。 |\
| | |content 字段下为智能体的回复内容，例如 tool_request 类型消息内容可以从 data.content.tool_request 中获取。 |

常见事件说明如下：
<!-- @cols-width: 161,576 -->
| | | \
|**事件** |**说明** |
|---|---|
| | | \
|message_start |智能体开始处理本次消息。 |
| | | \
|answer |智能体回复内容。回复可能会拆成多条 answer 事件返回，调用端需要按 sequence_id 顺序拼接 data.content.answer。当 finish 为 true 时，表示回复内容片段返回结束。 |
| | | \
|tool_request |智能体发起工具调用请求，具体内容可从 data.content.tool_request 获取。 |
| | | \
|tool_response |工具调用结果，具体内容可从 data.content.tool_response 获取。 |
| | | \
|message_end |本次智能体回复结束。结束信息可从 data.content.message_end 获取，例如状态码、错误消息、Token 消耗和耗时。 |
| | | \
|error |执行过程中出现错误。 |

## 异步执行智能体 {#870ec2ac}
异步执行接口会创建一个异步执行任务，并立即返回任务信息。调用端不需要一直保持连接，可以后续通过任务 ID 查询执行状态和结果。

* 异步任务会在当前部署对应的沙箱实例中运行。如果重新部署导致实例被回收或停止，实例中正在运行的异步任务也会被终止。因此，重新部署前请确认没有运行中的异步任务。
* 沙箱实例如果长时间未收到请求，可能会被系统回收。目前这个时间约为 1 小时。对于仍需保活的异步任务，建议在此期间持续轮询任务状态。
* 异步任务默认最长运行时间为 24 小时，具体截止时间以接口返回的 deadline 为准。超过 deadline 后，任务可能会超时。
* 受沙箱、数据库等资源限制影响，提交任务后可能长时间处于 pending 状态。如果任务长时间仍为 pending，通常表示任务未被系统接纳，建议重新提交任务。

### 请求示例 {#3d9a6fcb}
```Plain Text
curl --location --request POST 'https://<your_domain>/async_run' \
  --header 'Authorization: Bearer <YOUR_API_TOKEN>' \
  --header 'Content-Type: application/json' \
  --data '{
    "content": {
      "query": {
        "prompt": [
          {
            "type": "text",
            "content": {
              "text": ""
            }
          }
        ]
      }
    },
    "type": "query",
    "session_id": "B683KwyyyPEj3cbMxvuIx",
    "project_id": 7647467737832407091
  }'
```

其中，请将：

* <your_domain> 替换为部署页面提供的 API 服务域名。
* <YOUR_API_TOKEN> 替换为你创建的 API Token。
* text、session_id 和 project_id 替换为当前智能体实际需要的参数。

### 返回示例 {#669358e1}
```JSON
{
  "task_id": "6a5fa5ade320435a9c44fd5052a3b2a0",
  "status": "pending",
  "created_at": "2026-05-25T15:16:10.151364+08:00",
  "deadline": "2026-05-26T15:16:10.151364+08:00"
}
```

### 返回字段说明 {#ee521e14}
<!-- @cols-width: 100,100,605 -->
| | | | \
|**字段** |**类型** |**描述** |
|---|---|---|
| | | | \
|task_id |string |异步执行任务 ID。后续查询任务状态时需要使用该 ID。 |
| | | | \
|status |string |异步执行任务状态，枚举值包括 pending、running、completed、failed、timeout。 |
| | | | \
|created_at |string |异步执行任务创建时间，使用 ISO 时间格式。 |
| | | | \
|deadline |string |异步执行任务截止时间，使用 ISO 时间格式。任务的最长运行时间以该字段为准。 |

## 查询异步执行任务状态 {#f50522ac}
调用异步执行接口后，你可以使用 task_id 查询任务状态。任务完成后，接口会返回执行结果；任务失败时，接口会返回错误信息。
### 请求示例 {#f9914bbd}
```Plain Text
curl --location --request GET 'https://<your_domain>/task/{task_id}' \
  --header 'Authorization: Bearer <YOUR_API_TOKEN>'
```

其中，请将 {task_id} 替换为调用 /async_run 后返回的任务 ID。
### 返回示例 {#23c6936c}
```Plain Text
{
  "status": "completed",
  "result": "{\"answer\":\"今天天气确实不错，很适合去爬山。\"}",
  "error": null
}
```

### 返回字段说明 {#9b7f347e}
<!-- @cols-width: 100,100,584 -->
| | | | \
|**字段** |**类型** |**描述** |
|---|---|---|
| | | | \
|status |string |异步执行任务状态，可能值包括 pending、running、completed、failed、timeout。 |
| | | | \
|result |string |智能体执行结果。任务完成后返回，内容结构以实际智能体输出为准。 |
| | | | \
|error |string |错误信息。任务执行成功时通常为 null。 |

### 异步任务状态说明 {#0c922779}
<!-- @cols-width: 100,679 -->
| | | \
|**状态** |**说明** |
|---|---|
| | | \
|pending |任务已创建，等待被执行。 |
| | | \
|running |任务正在执行中。 |
| | | \
|completed |任务执行完成。 |
| | | \
|failed |任务执行失败。 |
| | | \
|timeout |任务执行超时。 |

##  {#392394f3}
