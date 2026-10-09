# Phase 2 权限、通知隐私与网页隔离验收

日期：2026-10-09。Git 基线：`6c1aeb2bd160d2451cdd3f6c7b72f7fbb3ca9977`。阶段 1 和本阶段的修改均未提交。

## 完成范围

| 问题 | 修改后的行为 | 验证 |
|---|---|---|
| R05 教师权限来源隔离 | API 明确校验 Origin / Referer / Fetch Metadata；生产同源、明确开发端口和本机 Tauri 来源正常访问。托管端口、其他端口/主机及 opaque origin 被拒绝。Socket.IO 的 polling 和 WebSocket 握手执行同一来源策略。 | 真实 HTTP、两种 Socket.IO transport、隔离 Chrome iframe 携带教师 Cookie 的读写/表单/no-cors/原生 WebSocket 请求 |
| R08 定向通知隐私 | 从学生 token 及当前课堂参与者记录取得范围，省略查询参数也强制过滤；全班广播要求 studentId、groupId 同时为空。保留本人旧 Student ID 通知与本组旧 group-only 通知；教师可以读取全部。 | 真实路由 + 权限门 + 临时 Prisma SQLite；两名学生、两个小组、伪造参数、跨课堂、无身份、已删除参与者、查询限制后的隐私 |
| R12 实时局域网策略 | 主服务在静态文件之前执行访问门，独立网页服务每次请求读取当前开关；关闭时断开已有局域网 Socket，后续握手拒绝，重新开启即恢复。 | 通过实际非回环网卡地址开→关→开，验证 API、附件、网页、已有连接和新连接；本机访问保留 |
| R14 SVG 内容校验 | XML 严格解析，验证解码后的元素、属性和 URL，再序列化白名单树。拒绝脚本、事件、动画、HTML、命名空间变体、实体危险 URL 与外部 CSS URL。保留基本图形、渐变、裁剪及应用上传的 PNG/JPEG/WebP 引用。 | 23 个危险内容用例、尺寸/层级边界、44 个内置头像、200 个随机学生头像、合法渐变浏览器呈现 |

SVG 历史数据也受保护：头像列表、编辑响应、学生自选响应及实时推送都返回校验后的 SVG；不安全旧行展示占位头像，不修改原数据库。历史上传的 SVG 直接访问时使用 CSP sandbox 限制脚本。教师编辑框中的未保存 SVG 以图片呈现，不再直接插入 DOM；浏览器确认图片可以显示但 onload 脚本不执行。

无 Origin/Referer/Fetch Metadata 的命令行与本机原生请求仍沿用既有身份验证规则。来源验证不替代教师会话或学生 token，也不授予额外权限。

## 验证结果

- `pnpm test:server`：**1053/1053**，0 失败、0 跳过，含本阶段新增 42 个用例；TypeScript 服务端构建通过。
- 修改文件的定向 ESLint：0 错误、0 警告；`git diff --check` 通过。
- `pnpm build`：Next.js 静态导出及学生端 Safari 15 兼容门通过。构建仍报告既有未使用变量警告及既有 docx lookbehind 容忍项，不将其当作新增问题或真实 Safari 设备验收。
- `node scripts/verify-phase2-browser.mjs`：**PASS**。使用独立 Chrome 155 headless profile、真实安全/认证/设置路由及隔离内存设置存储，不接触真实业务库。
- 浏览器生产入口登录/读取/写入均 200，开发入口读取/写入均 200。托管 iframe 实際携带教师 Cookie 发出 4 个 API 请求：读取、预检写入、普通 POST、no-cors 与表单均不能获得管理数据或产生修改；WebSocket 握手失败；越权写入 **0**。
- 将验收脚本的来源策略替换为原基线的任意 Origin + credentials / 无握手来源检查，在隔离模拟数据中同一脚本正确失败：托管读取与写入均 200，设置变为 `stolen`，产生 **3** 个未授权 POST，WebSocket 打开。这是对原来源策略的对照，不声称执行了旧版完整安装包。
- 历史 SVG 文档的脚本被限制，未发出写入请求；未保存 SVG 图片预览脚本未执行；合法渐变 SVG 图片正常解码。

复跑浏览器脚本前需先 `pnpm build:server`。默认 Chrome 路径为 macOS Google Chrome；其他环境可设置 `CLASSNODE_TEST_CHROME` 指向可执行文件。测试会自行创建并清理临时网页、浏览器 profile 和服务。

## 证据

- 完整服务端：`/private/tmp/classnode-phase2-server.log`
- 前端构建：`/private/tmp/classnode-phase2-build.log`
- 定向 lint：`/private/tmp/classnode-phase2-lint.log`
- 浏览器修复后：`/private/tmp/classnode-phase2-browser.log`
- 浏览器原策略对照：`/private/tmp/classnode-phase2-browser-before.log`
- 对照脚本：`/private/tmp/classnode-phase2-browser-before.mjs`

## 边界及下一阶段

本阶段完成 R05、R08、R12、R14，未清理项目文件、迁移真实数据库、修改版本号、提交、推送或发布。新增直接生产依赖 `sax@1.6.0`，锁文件已同步；该包此前已作为传递依赖存在。

浏览器级验证针对 HTTP / iframe / WebSocket / SVG 边界，使用测试页面和模拟设置存储；不是完整产品人工走查。Tauri 原生来源已通过策略测试，尚未执行打包桌面运行验收；Safari/iPad 实机和第三方 AI 平台验收仍属于阶段 6。

发布尚未放行：旧库迁移、完整备份恢复、清零、名册和课堂状态并发等剩余问题继续按阶段 3–6 实施。
