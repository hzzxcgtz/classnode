# 阶段 6：候选版本验收（进行中）

日期：2026-10-09。当前版本仍为 2.0.0。用户已授权真实智能体联调、将当前修改提交推送 GitHub，并运行 Windows Action。尚未授权正式发布。

## 已完成的本机验收

| 项目 | 结果 |
|---|---|
| 全量前端逻辑测试 | 1523/1523 通过 |
| 全量后端测试 | 1086/1086 通过，无跳过 |
| Rust 离线测试 | 4/4 通过 |
| 前端类型检查、生产构建及 Safari 15 兼容门 | 通过，保留原有 docx 容忍项 |
| lint | 0 错误，657 条已有警告；新增验收脚本定向 lint 通过 |
| 浏览器权限/教学网页隔离回归 | 通过，真实临时 Chrome 配置 |
| 生产前端浏览器走查 | 教师 5 个页面、学生入课、保存、实时清除、重答、存储拒绝提示及继续保存均通过；运行异常 0；HTML no-store |
| Apple Silicon 候选 DMG | 构建成功，镜像校验与只读挂载通过；包内 arm64 Node 24.18.0 与应用架构正确 |
| Intel 候选 DMG | 构建成功，只读挂载通过；包内 x64 Node 在本机 Rosetta 下运行 |
| 两个镜像内完整运行资源 | 使用包内 Node、Prisma、依赖、空库和前端重复浏览器走查，均通过 |
| 两个镜像内数据库流程 | 原始 v1.5.1 临时旧库升级通过；跨目录完整备份恢复后，虚构消息、答案、凭据、附件和教学网页均保留 |
| 版本及构建内容 | sync-version 无改动；myportal 当前标签与下载名均为 2.0.0。包内无本机 API 密钥文件，内置 Agent、PlatformToken、Student、Classroom、Message、Setting 均为空 |

候选包位于 `release-candidates/2.0.0/`，校验和见其中 `SHA256SUMS.txt`。该目录已排除 Git，避免安装包入库。版本未递增；没有替换真实业务数据库。镜像挂载与临时后台服务验收不等于已经在桌面主程序中完成所有启停操作。

## 真实 AI 联调

只读现有配置，使用虚构学生名、虚构提示和人工生成的测试图；不写入本机业务数据库，不输出 API 凭据。

- 文心「语文大百科」：普通回答、流式回答、收到首段后主动停止均通过。当前代理没有向文心提供文件识别接口，附件不记为通过。
- 扣子低代码「数学连环画评价助手」：普通回答、流式回答、主动停止通过。首次 1 像素测试图收到模型参数错误；替换成标准 256×256 测试图后附件请求成功。此次不据极小样本错误判断产品图片路径故障。
- 本机没有 Coze Agent 和智谱配置，无法以真实平台验证这两项。历史截图中的 Coze Agent 接入错误也不能用此次低代码联调视作已解决。

## Windows 候选构建

目标仓库：`https://github.com/hzzxcgtz/classnode`。验收分支：`codex/worksheet-review-workspace`。

已检查远端主分支是当前分支的祖先，没有将验收修改直接合入主分支。已准备 workflow：每个 Windows 架构在安装依赖、生成 Prisma 后运行完整测试和 lint；候选手动构建默认只上传产物，`publish_release=false` 时不创建 Release。标签发布路径保留。

首次 Action：https://github.com/hzzxcgtz/classnode/actions/runs/37934358798（提交 `cfb39aa`）。两种架构均在测试入口失败：package.json 使用 Unix shell 的 `code=$?; cat ...; exit $code`，Windows 无法正确执行，日志也没有展示。已将前后端入口改为 Node.js 子进程执行测试，同时输出控制台、保留日志、传递测试退出码；CI 在失败时也上传测试日志。修复后的远端重跑结果待补记，不能提前标成已通过。

### Windows CI 后续适配

- `745659a`：跨平台 Node 测试入口；失败时保留并上传测试日志。本机前端 1523/1523、后端 1086/1086 通过。
- `b77b64a`：Git 文本 checkout 统一 LF（bat/cmd 保留 CRLF）；前端源码所有者断言统一路径分隔符。Windows 第三轮已确认前端 1523/1523 通过。
- `070ccc4`：25 个 Prisma 临时库测试入口改由 Node 执行 CLI；修正 Windows 文件 URL 到磁盘路径的转换。远端旧运行中数据库用例已开始通过。
- `7b9b470`：测试超时与 CI 步骤超时；启动回归 preload 改为 file URL。
- `a0a1d64`：后端源码允许名单路径归一化；DOCX 内容验证使用现有 adm-zip，去掉系统 unzip 缺失时的略过。修改后本机后端 1086/1086 通过。

最新运行：https://github.com/hzzxcgtz/classnode/actions/runs/37938865459（`a0a1d64`）；结果仍待确认。所有修复均在验收分支，没有合入 main，没有创建正式 Release。

`333d94a` 修复实际应用问题：RAR/7Z 头部加密包会触发解压库同步读取标准输入，Windows 下可能阻塞后端及测试。解压实例明确提供立即 EOF 的 stdin；回归断言验证没有读取宿主输入，撤回修复时断言确实失败。修复后本机后端 1086/1086 通过。macOS 两种候选镜像已据此重建，包内复验进行中。

另调整两条权限测试：所有平台都截获并验证真实文件写入请求指定 `0600`，POSIX 系统再核对落盘权限；Windows 的 stat 权限位不代表 POSIX 用户/组隔离，不将它误作相同位掩码。

## 仍待人工或目标环境验收

- macOS 桌面主程序：首次安装、托盘/面板交替启停、升级已有用户目录、退出后子进程回收、卸载后数据保留。
- Intel 真机，以及 Windows x64 / ARM64 的安装、升级、启停和卸载行为。Rosetta 和 CI 构建不能替代这些操作。
- 目标旧 iPad / Safari 15 / 触摸设备全流程；此次浏览器为 Chrome 1024×768，并非真实 Safari 硬件。
- Coze Agent、智谱真实接入，以及文心附件能力的产品约定。

因此阶段 6 尚未全部完成，当前只形成候选包与验收证据，不作为正式发布放行。

## 复跑入口

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
# 先单独确认 ./dev.sh status 为未运行，再执行 pnpm build
node scripts/verify-phase2-browser.mjs
node scripts/verify-release-browser.mjs
CLASSNODE_VERIFY_RUNTIME=/path/to/ClassNode.app/Contents/Resources/server node scripts/verify-release-browser.mjs
CLASSNODE_VERIFY_RUNTIME=/path/to/ClassNode.app/Contents/Resources/server node scripts/verify-packaged-data.mjs
# 仅在明确允许发送真实请求时使用；只读已有配置，但会消耗平台额度
node scripts/verify-live-agents.mjs
```

日志保留在 `/private/tmp/classnode-phase6-*.log`；各浏览器运行日志给出截图与 result.json 的临时证据目录。真实联调日志只记录结果、长度及经脱敏的错误。
