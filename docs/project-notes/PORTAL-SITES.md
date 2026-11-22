# 工坊与支点课堂官网部署

在仓库根目录运行 `pnpm build:portal`。两个目录中的**内容**分别上传到对应 OSS Bucket 的根目录。

| 域名 | 上传目录 | 默认首页 |
| --- | --- | --- |
| `www.aicls.xyz` | `dist/portal/workshop/` | `index.html`，编程研习工坊 |
| `zd.aicls.xyz` | `dist/portal/classnode/` | `index.html`，支点课堂产品介绍 |

维护源码仍在 `myportal/`，继续走现有版本同步流程。打包会排除试验版 `demo/`。网站仅包含静态页面和资源，与 ClassNode 应用服务的部署独立。

## 首次迁移顺序

1. 在阿里云 OSS 选择支点课堂专用 Bucket，根据[静态网站托管](https://help.aliyun.com/zh/oss/user-guide/hosting-static-websites)设置默认首页 `index.html` 和错误页 `404.html`，使站点资源可以公开读取。上传 `dist/portal/classnode/` 中的文件。
2. 在该 Bucket 绑定 `zd.aicls.xyz`，按控制台提示验证域名归属。然后在 `aicls.xyz` 的解析记录中添加主机记录 `zd`，类型选 `CNAME`，记录值填新 Bucket 绑定页面给出的外网访问域名。为 `zd.aicls.xyz` 配置 HTTPS 证书。保留现有 `www` 的解析和证书。参见[绑定自定义域名](https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names)与[配置 HTTPS](https://help.aliyun.com/zh/oss/user-guide/access-oss-by-https-protocol)。
3. 验证新域名根路径、`/guide.html`、`/guide/overview.html`、`/deploy.html` 和首页下载链接。确认图文资源、GIF 和手机导航能打开。
4. 新站验证通过后，再将 `dist/portal/workshop/` 上传到现有门户 Bucket。旧 `classnode.html`、`guide.html`、`deploy.html` 及已有 `guide/*.html` 会变成静态跳转页。启用 JavaScript 的浏览器会保留查询参数和锚点，例如 `/classnode.html#download` 跳到 `https://zd.aicls.xyz/#download`。禁用 JavaScript 时仍能跳到目标页面，旧锚点不会随之传递。

原门户上的 `/prompt-templates/` 文件保留，供仍引用旧地址的应用版本使用。静态跳转通过 HTML 实现，如果以后接入支持跨域 301 的代理，可以在代理层配置对应永久跳转。
