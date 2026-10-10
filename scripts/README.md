# 开发脚本与命令参考

## 直接用 Shell 命令

日常操作只需根目录的 `dev.sh`，不必手动调用下面的 Node 或 pnpm 脚本。

```bash
cd /Users/zxc/myprojects/classnode
./dev.sh                       # 查看全部命令帮助
./dev.sh install               # 第一次使用：安装依赖和数据库客户端
./dev.sh start                 # 后台启动前端与后端
./dev.sh status                # 查看状态
./dev.sh logs                  # 看日志，Ctrl-C 退出查看
./dev.sh restart               # 重启
./dev.sh stop                  # 停止
./dev.sh build                 # 构建完整项目
./dev.sh serve                 # 运行已构建的项目
./dev.sh check                 # 检查脚本和代码规范
./dev.sh test                  # 全部测试
./dev.sh test scripts          # 只测开发工具
./dev.sh package mac-arm64     # Apple Silicon 安装包
./dev.sh package mac-intel     # Intel 安装包
./dev.sh package windows       # 远程 Windows 构建
./dev.sh version prepare patch # 准备下一个补丁版本
./dev.sh clean                 # 停服务并清理构建产物与日志
```

`start` 在后台运行，关终端后仍可用；`foreground` 在前台运行，Ctrl-C 停止服务。`build` 默认构建完整项目；只构建一部分用 `build web` 或 `build server`。`test web`、`test server`、`test scripts` 可选择测试范围。打包完成的本地安装包默认放在 `~/Downloads/ClassNode/installer/v版本/`。

只输入 `./dev.sh` 现在显示帮助；`./dev.sh build` 现在构建前后端。其他旧命令保持兼容。根目录的 `release.sh` 是专门的打包入口，日常也可以直接用 `./dev.sh package …` 调用。`build-release.sh`、`release-full.sh` 是旧入口，保留兼容即可。

下文是内部实现与高级命令参考；日常操作以以上 `.sh` 命令为准。

要求 Node.js ≥ 24、pnpm（版本由根 package.json 的 packageManager 指定）。先运行 `pnpm install` 和 `pnpm db:generate`。Shell 开发控制适用于 macOS/Linux；Windows 可分别运行 `pnpm dev`、`pnpm dev:server`，本机构建使用 Node.js 脚本。

## 日常命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 仅前端 Next.js（直接调用时默认 3000） |
| `pnpm dev:server` | 仅后端，tsx watch，自动设置 development 环境 |
| `pnpm dev:all` | 前台同时启动前后端，任一退出时关闭另一方 |
| `pnpm dev:start` / `pnpm dev:stop` | 后台启动 / 停止当前项目服务 |
| `pnpm dev:restart` / `pnpm dev:status` | 重启 / 查看状态 |
| `pnpm dev:logs [client\|server\|all]` | 持续查看日志 |
| `./dev.sh build [web\|server\|all]` | 按目标构建，默认 all |
| `./dev.sh db [generate\|push\|studio\|reset]` | Prisma 操作；reset 确认后停服务并删开发数据库 |
| `./dev.sh clean` | 停服务并清理构建产物、PID、开发日志，保留 Node 下载缓存 |
| `./dev.sh run <脚本名> [参数...]` | 转发任意 pnpm 脚本 |

组合开发环境默认前端 4000、后端 4001、探究空间 4002；可通过 `CLASSNODE_CLIENT_PORT`、`CLASSNODE_SERVER_PORT`、`CLASSNODE_WEBAPP_PORT` 设置，三个端口必须不同。PID 和日志在 `.dev/pids/`、`.dev/logs/`。

## 检查、构建与运行

| 命令 | 用途 |
| --- | --- |
| `pnpm check:scripts` | 对所有 Shell、JS、MJS、Python 脚本做语法检查，不执行业务逻辑；需要 Bash 和 Python |
| `pnpm test:scripts` | 脚本回归；用临时目录和模拟服务验证生命周期，Windows 跳过 Shell 生命周期测试 |
| `pnpm test:client` / `pnpm test:server` | 前端 / 后端测试；后端测试先编译 |
| `pnpm test` | 脚本、前端、后端全部测试 |
| `pnpm lint` | ESLint |
| `pnpm build` | 同步版本、静态导出至 out/、检查浏览器兼容性 |
| `pnpm build:server` | 编译至 server/dist/ |
| `pnpm package:web` | 将 out/ 复制至 server/frontend/ |
| `pnpm build:all` | 构建前后端并组装 Web 部署目录 |
| `pnpm start` | 启动 Express，提供 API 与静态前端；先执行 build:all |
| `pnpm db:generate` / `pnpm db:push` / `pnpm db:studio` | 从仓库根执行 Prisma 命令 |

`pnpm start` 已修正为 Express 入口；项目使用 Next.js 静态导出，不能用 next start。测试日志集中在 `.dev/logs/test-client.log`、`.dev/logs/test-server.log`、`.dev/logs/test-scripts.log`。测试筛选参数可直接传入，例如 `pnpm test:client --test-name-pattern=绘图`。

## 桌面与发布

| 命令 | 用途 |
| --- | --- |
| `pnpm build:desktop --target <Rust目标>` | 统一本机桌面构建；省略目标时使用 rustc 本机目标 |
| `pnpm build:mac:arm64` / `pnpm build:mac:intel` | macOS Apple Silicon / Intel，需要 macOS、Rust、Xcode 工具 |
| `pnpm build:windows` / `pnpm build:windows:arm64` | Windows x64 / ARM64 本机构建，需要 Windows 和 Rust/MSVC 工具 |
| `pnpm package:desktop --target <Rust目标>` | 从已构建的 out/、server/dist/ 组装桌面资源与内置 Node，不运行 Tauri |
| `pnpm version:sync` | 同步 package、Tauri、更新清单、门户版本；重复执行不改日期 |
| `pnpm release:prepare patch` | 准备新版本与日志，支持 major、minor、patch 或明确递增版本 |
| `pnpm release:package <目标>` | 统一发布入口，相当于 ./release.sh |
| `./dev.sh package [目标]` | 发布入口，默认 mac |
| `./release.sh windows [both\|x64\|arm64]` | 派发远程 GitHub Actions，立即返回 |
| `bash scripts/build-windows.sh [架构] --wait` | 派发远程构建并等待结果；可用 --run-id-file 保存任务号 |
| `./release.sh source` | 打包 HEAD 的源码 zip、tar.gz |

发布目标：`all`、`mac`、`mac-arm64`、`mac-intel`、`windows`、`source`。dev.sh 也接受 `mac-arm`、`win` 等简写。发布默认要求工作区干净；`CLASSNODE_ALLOW_DIRTY_RELEASE=1` 仅放行调试。源码包始终来自 HEAD，当前版本必须已提交；Windows 远程构建使用 `CLASSNODE_RELEASE_BRANCH`（默认 main），不会上传本地未提交代码。

产物临时目录默认 `dist/releases/v版本/`，成功后归档到 `~/Downloads/ClassNode/installer/v版本/`。可设置 `CLASSNODE_RELEASE_DIR`、`CLASSNODE_INSTALLER_DIR`。远程 Windows 构建的产物需要从 Actions 下载。

Node.js 打包设置统一在 `lib/project.mjs` 和 `lib/node-runtime.mjs`：`CLASSNODE_NODE_VERSION` 默认 24.18.0；`CLASSNODE_NODE_CACHE_DIR` 默认 `.dev/cache/node/`；下载源为 `CLASSNODE_NODE_DOWNLOAD_BASE`、备用 `CLASSNODE_NODE_MIRROR_BASE`。`--without-node` 跳过内置 Node，适用于特定调试构建。

## 脚本文件清单

| 文件 | 职责与入口 |
| --- | --- |
| 根 dev.sh | 开发进程、日志、维护命令；help 查看全部 |
| 根 release.sh | 本地打包、远程派发、源码包和归档 |
| build-desktop.mjs | macOS/Windows 构建的统一编排 |
| package-server.mjs | 生产依赖、Prisma、空数据库、静态前端、Node 资源；排除后端测试 |
| package-frontend.mjs | web/desktop 前端复制；desktop 注入 dashboard 版本 |
| rename-bundle.mjs | macOS/Windows 安装包统一命名；只处理当前版本，支持重复执行 |
| sync-version.mjs / prepare-release.mjs | 幂等版本同步 / 版本递增、发布日期与变更日志 |
| dev-server.mjs | 跨平台启动 tsx watch，设置 NODE_ENV |
| run-tests.mjs | 三组测试的统一执行与日志；不存在测试文件时报错 |
| check-scripts.mjs | 所有开发脚本的静态语法检查 |
| check-classroom-browser-compat.mjs | 构建后检查学生端输出的兼容性，随 pnpm build 执行 |
| lib/project.mjs | 根目录、Node 版本、运行环境和子命令执行 |
| lib/node-runtime.mjs | macOS/Windows Node 下载、缓存、格式校验及提取 |
| lib/answer-snapshots.mjs | 测试用绘图答案快照，复用产品逻辑 |
| tests/tooling.test.mjs | 隔离脚本回归，不连接业务数据库 |
| generate-icons.py | 生成 Tauri 托盘图标，需要 Pillow |
| make-answer-photos.py | 按 JSON 清单生成照片作答，需要 Pillow；供种子脚本调用 |

## 示例数据与专项验收

这些脚本保留独立职责。数据库脚本使用本地开发数据，部分还依赖特定课堂名、学习单 ID；执行前应查看文件头和目标配置。需要 server/dist/ 的脚本先运行 `pnpm build:server`。依赖源码 .ts 模块的脚本用本地 tsx，避免 npx 临时下载：`pnpm --filter classnode-server exec tsx ../scripts/<文件> [参数...]`。

| 文件 / 命令 | 默认行为与依赖 |
| --- | --- |
| seed-math-worksheet.mjs / `pnpm seed:worksheet` | 校验全题型数学学习单；--apply 写入 |
| seed-worksheet-demo.mjs / `pnpm seed:answers` | 演练作答数据；--apply 写入并替换目标旧作答，--keep 追加；--dry-run 显式演练（兼容 --dry）；--classroom 指定目标，--python 指定 Pillow 解释器 |
| seed-math-garden.mjs | 综合数学示例规划；--apply 创建，--update --apply 更新既有示例；需要后端编译、sharp、Python |
| seed-chinese-writing.mjs | 拍照习作示例规划；--apply 创建；需要后端编译、sharp、Python |
| create-conference-classroom.mjs | 根据固定配置规划示例课堂；--apply 调用真实路由创建 |
| fix-math-worksheet-background.mjs | 特定学习单的历史数据修复；默认演练，--apply 写入 |
| set-worksheet-analysis-agent.mjs | 列出分析智能体或预览绑定；--worksheet、--agent、--apply 写入 |
| verify-analysis-sheets.mjs | --classroom、--worksheet 必填，--out 设置 PNG 输出；聚合载荷会写分析记录，不调用 AI |
| verify-phase2-browser.mjs / `pnpm verify:security` | 隔离浏览器安全回归，需后端编译和 Chrome；CLASSNODE_TEST_CHROME 设置路径 |
| verify-release-browser.mjs / `pnpm verify:browser` | 生产静态前端与真实后端隔离冒烟；需 build:all 和 Chrome；输出截图、result.json、runtime.log |
| verify-packaged-data.mjs / `pnpm verify:package` | 打包运行时升级与跨目录备份回归；CLASSNODE_VERIFY_RUNTIME 指定运行时，需 Python |
| verify-live-agents.mjs | 真实平台连通性、流式与附件请求，会使用现有凭证和平台额度；只在需要真实接口验收时显式执行 |

**行为调整：seed-worksheet-demo.mjs 现在默认演练，写入须加 --apply。** `.dev/` 中的示例输出和上传图片沿用现有脚本路径；示例说明文档统一输出到 `docs/project-notes/`。

## 兼容入口

| 旧入口 | 推荐入口 |
| --- | --- |
| `pnpm stop` | `pnpm dev:stop` |
| `pnpm sync-version` | `pnpm version:sync` |
| `pnpm prepare-release` | `pnpm release:prepare` |
| `./dev.sh pkg` | `./dev.sh package` |
| `./dev.sh version:bump` | `./dev.sh version:prepare` |
| scripts/build-mac.sh | `pnpm build:desktop --target …` |
| scripts/package-web.mjs | `pnpm package:web` |
| scripts/build-dashboard.js | package-frontend.mjs desktop；保留 Tauri beforeBuildCommand 兼容 |
| 根 build-release.sh | 兼容远程 Windows 派发；推荐 ./release.sh windows |
| 根 release-full.sh | 兼容 full、mac、arm64、intel；win/windows 现在准确映射 Windows |

兼容文件仅转发参数或调用共用实现，不再维护第二套构建/复制逻辑。
