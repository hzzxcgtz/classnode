> ## Documentation Index
> Fetch the complete documentation index at: https://docs.coze.cn/llms.txt
> Use this file to discover all available pages before exploring further.

Coze Storage Client 是扣子编程官方推出的 Python SDK，采用同步实现方式，用于管理 Client 与 Coze S3 兼容存储的交互。通过该 SDK，你可以以编程方式上传、下载、删除文件，检查对象是否存在，以及通过 Coze S3 Proxy 生成签名下载 URL。本文介绍了 `S3SyncStorage` 类及对应的方法示例。

## Client  {#80384fe2}
`S3SyncStorage` 类用于与 Coze Storage 交互。该类基于 S3 兼容协议实现，通过注入代码添加身份令牌（x-storage-token）。支持通过环境变量配置端点和桶名。 
例如使用以下代码创建一个与 Coze Storage 交互的实例。
```Python
storage = S3SyncStorage(
    endpoint_url="https://your-s3-endpoint",
    access_key="YOUR_ACCESS_KEY",
    secret_key="YOUR_SECRET_KEY",
    bucket_name="your-bucket",
    region="cn-beijing",
)
```

## 构造函数 {#8b4b863a}
创建一个与 Coze Storage 交互的 S3SyncStorage 实例。

* constructor
   ```Plain Text
   S3SyncStorage(endpoint_url: Optional[str] = None, access_key: str, secret_key: str, bucket_name: str, region: str = "cn-beijing"): S3SyncStorage 
   ```

* 参数
   <!-- @cols-width: 165,130,538 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |endpoint_url |Optional[str] |S3 兼容存储端点。如果未显式传入，将优先使用环境变量 `COZE_BUCKET_ENDPOINT_URL`。若仍为空，会尝试通过 `coze_workload_identity` 获取项目环境变量中的 `COZE_BUCKET_ENDPOINT_URL`。最终若仍为空则抛出错误。 |
   | | | | \
   |access_key |str |访问存储的访问密钥。扣子编程的对象存储使用身份令牌鉴权，无需填写 `access_key`。 |
   | | | | \
   |secret_key |str |访问存储的私密密钥。扣子编程的对象存储使用身份令牌鉴权，无需填写 `secret_key`。 |
   | | | | \
   |bucket_name |str |默认目标桶名。方法未显式传入 Bucket 时将使用该值或环境变量 `COZE_BUCKET_NAME`。  |
   | | | | \
   |region |str |区域名，默认为 `cn-beijing`。 |

* 返回值
   返回 S3SyncStorage 实例。

## 方法 {#c885449e}
### list_files {#1b2e0c43}
列出对象，支持按前缀过滤与分页返回。
```Python
list_files(prefix: Optional[str] = None, bucket: Optional[str] = None, max_keys: int = 1000, continuation_token: Optional[str] = None): ListFilesResult 
```


* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |prefix |Optional[str] |仅返回以该前缀开头的对象 Key。如果为空则返回全部。 |
   | | | | \
   |bucket |Optional[str] |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。 |
   | | | | \
   |max_keys |int |单页返回的最大数量，取值范围为1～1000，默认为 1000。 |
   | | | | \
   |continuation_token  |Optional[str]  |翻页标记，用于获取下一页结果。 |

* 返回值
   返回 ListFilesResult（TypedDict 类型），结构如下：
   * `keys`：List[str] 类型，对象 key 列表。
   * `is_truncated`：Bool 类型，是否还有下一页。
   * `next_continuation_token`：Optional[str] 类型，下一页的标记。

### upload_file  {#88590370}
上传对象（使用内存字节）到目标桶。对象键由原始文件名+随机后缀生成，避免重复内容产生不同键。
```Python
upload_file(file_content: bytes, file_name: str, content_type: str = "application/octet-stream", bucket: Optional[str] = None): str
```


* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |file_content  |bytes |对象的原始字节内容。 |
   | | | | \
   |file_name |str |用户指定的文件名，用于生成对象键。需满足命名规范。 |
   | | | | \
   |content_type |str |对象的内容类型，默认为 `application/octet-stream`。 |
   | | | | \
   |bucket |str |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。 |

* 返回值

      返回成功上传后生成的对象键，str 类型。
### delete_file  {#854f1338}
删除目标桶中的对象。
```Python
delete_file(file_key: str, bucket: Optional[str] = None): bool 
```


* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |file_key  |str |对象键。  |
   | | | | \
   |bucket |str |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。  |

* 返回值

     返回值为 bool 类型，删除成功返回 True，异常将抛出。
### file_exists  {#95670fd3}
检查对象是否存在。 
```Python
file_exists(file_key: str, bucket: Optional[str] = None): bool 
```


* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |file_key  |str |对象键。  |
   | | | | \
   |bucket |str |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。 |

* 返回值
   返回值为 bool 类型，对象存在返回 True。对于 404/NoSuchKey/NotFound 错误返回 False；其他错误会记录日志并返回 False。

### read_file {#6ac81f49}
读取对象并返回其原始字节内容。
```Python
read_file(file_key: str, bucket: Optional[str] = None): bytes
```

  

* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |file_key  |str |对象键。  |
   | | | | \
   |bucket |str |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。 |

* 返回值
   返回对象的原始字节内容，bytes 类型。

### generate_presigned_url  {#2df0618b}
通过 Coze S3 Proxy 生成对象的签名下载 URL。
```Python
generate_presigned_url(key: str, bucket: Optional[str] = None, expire_time: int = 1800): string
```


* 参数
   <!-- @cols-width: 165,130,797 -->
   | | | | \
   |**参数名称** |**数据类型** |**说明** |
   |---|---|---|
   | | | | \
   |key |str |对象键，例如 uploads/new-file.txt。 |
   | | | | \
   |bucket |str |目标桶。若为空，使用环境变量 `COZE_BUCKET_NAME` 或实例的 `bucket_name`。 |
   | | | | \
   |expire_time |int |过期时间（秒），默认 1800。 |

* 返回值
   返回签名 URL，str 类型。

## 环境与鉴权 {#254405f2}
### 端点配置 {#65f8a453}
优先使用环境变量 `COZE_BUCKET_ENDPOINT_URL`；若未设置，使用方法参数 `endpoint_url`；若仍为空，会尝试通过 `coze_workload_identity.Client().get_project_env_vars() `读取项目环境变量中的端点。端点最终为空时会抛出错误。
### 桶名配置 {#36fb6255}
方法的 bucket 参数、环境变量 `COZE_BUCKET_NAME`、构造函数中的 `bucket_name` 依次回退。
### 身份令牌注入 {#57d31ec6}
在向 S3 发起请求前，SDK 会通过 `coze_workload_identity.Client().get_access_token() `获取令牌，并在所有 S3 请求上注入 `x-storage-token` 头（使用 boto3 的 `before-call` 钩子）。
### 签名 URL {#0fdbaa9c}
向 `${COZE_BUCKET_ENDPOINT_URL}/sign-url` 发送 POST，Content-Type 为 `application/json`，载荷为 `{ bucket_name, path: key, expire_time }`，返回体中的 `data.url/url/signed_url/presigned_url` 将作为最终链接。
签名有效期最长为 30 天，可通过 generate_presigned_url 方法中的 `expire_time` 参数自定义有效期。
## 对象键生成与文件命名规范 {#5880be2c}
### 对象键生成规则 {#62bdec5b}
对象键由原始文件名+随机后缀生成，格式如下：
```Python
def _generate_object_key(self, *, original_name: str) -> str:
suffix = Path(original_name).suffix.lower()
stem = Path(original_name).stem
uniq = uuid4().hex[:8]
return f"{stem}_{uniq}{suffix}"
```

### 文件命名规范（file_name 约束） {#79647c65}

* 长度 1～1024 字节。
*  仅允许字母、数字、点（.）、下划线（_）、短横（-）、目录分隔符（/）。
* 不允许空格或以下特殊字符`? # & % { } ^ [ ] \ < > ~ | " ' + = : ;`。
* 不以 `/` 开头或结尾，且不包含连续的 `//`。 

例如：report_2025-12-11.pdf、images/photo-01.png。
## 方法示例 {#fd1abc43}
以下示例展示如何使用 S3SyncStorage 管理对象。
### 初始化客户端 {#084094b5}
```Python
storage = S3SyncStorage(
    endpoint_url="https://your-s3-endpoint",
    access_key="YOUR_ACCESS_KEY",
    secret_key="YOUR_SECRET_KEY",
    bucket_name="your-bucket",
    region="cn-beijing",
)
```

### 上传文本（字节） {#dd91820d}
```Python
data = "Hello, Coze Storage".encode("utf-8")
key = storage.upload_file(
    file_content=data,
    file_name="docs/hello.txt",
    content_type="text/plain"
)
print("Uploaded key:", key)
```

### 检查对象是否存在 {#1c9a9aef}
```Python
exists = storage.file_exists(file_key=key)
print("Exists:", exists)
```

### 读取对象 {#a3637867}
```Python
content = storage.read_file(file_key=key)
print("Content:", content.decode("utf-8"))
```

### 生成签名 URL（10 分钟过期） {#a73b8d28}
```Python
url = storage.generate_presigned_url(key=key, expire_time=600)
print("Signed URL:", url)
```

### 列举对象（前缀与分页） {#f280a9d3}
```Python
# 第一页
page = storage.list_files(prefix="images/", max_keys=100)
print("Keys:", page["keys"])

# 后续页
while page.get("is_truncated"):
    token = page.get("next_continuation_token")
    page = storage.list_files(prefix="images/", continuation_token=token)
    print("Next page keys:", page["keys"])
```

### 删除对象 {#8d4fa241}
```Python
deleted = storage.delete_file(file_key=key)
print("Deleted:", deleted)
```

## 错误与排查 {#2ccb48c8}
<!-- @cols-width: 178,668 -->
| | | \
|**错误场景** |**说明** |
|---|---|
| | | \
|未配置端点 |当 `endpoint_url`、`COZE_BUCKET_ENDPOINT_URL` 与项目环境变量均缺失时，抛出 `ValueError("未配置存储端点：请设置endpoint_url")`错误。 |
| | | \
|未配置桶名 |在生成签名 URL 时若无法确定桶名，抛出 `ValueError("未配置 bucket...")`错误。 |
| | | \
|身份令牌获取失败 |coze_workload_identity 获取令牌失败时会记录错误 `Error loading COZE_WORKLOAD_IDENTITY_TOKEN` ，并导致请求无法注入 `x-storage-token`；签名 URL 生成会抛出异常。 |
| | | \
|文件名不合法 |违反命名规范会抛出 `ValueError("file name invalid: ...")` 错误，请按规范修正。 |
| | | \
|对象不存在 |针对`file_exists` 方法，对于 404/NoSuchKey/NotFound 返回 False；其他错误会记录日志并返回 False。 |
| | | \
|列表分页 |当 `max_keys` 不在 1～1000 范围内时，将抛出 `ValueError`。权限不足或桶不存在将抛出 `ClientError`。 |


