# dev.sh 使用说明

项目根目录下的 `./dev.sh` 统一入口脚本，涵盖了所有日常开发操作。

每条命令旁标注了对应的原始命令，方便对照。

## 日常开发

| dev.sh | 原始命令 | 说明 |
|---|---|---|
| `./dev.sh dev` | `pnpm dev` | 启动前端 (Next.js) |
| `./dev.sh dev --port 5000` | `PORT=5000 pnpm dev` | 前端指定端口 |
| `./dev.sh dev:server` | `pnpm dev:server` | 启动后端 (Express) |
| `./dev.sh dev:server --api-port 5001` | `PORT=5001 pnpm dev:server` | 后端指定端口 |
| `./dev.sh dev:all` | `pnpm dev:all` | **常用** 同时启动前端 + 后端 |
| `./dev.sh dev:all --port 5000 --api-port 5001` | 见下方 | 自定义端口启动 |
| `./dev.sh tauri` | `pnpm tauri dev` | Tauri 桌面壳开发模式 |
| `./dev.sh status` | `lsof` + `pgrep` | 查看当前服务运行状态 |
| `./dev.sh --version` / `-v` | - | 快速查看版本号 |

前端默认 `localhost:4000`，后端默认 `localhost:4001`。

### 自定义端口

默认端口被占用时，用 `--port`（前端）和 `--api-port`（后端）指定其他端口：

```bash
./dev.sh dev:all --port 5000 --api-port 5001
```

这会同时启动前端 `:5000` 和后端 `:5001`，前端自动将 API 请求指向 `:5001`。

### 端口配置原理

```
                     开发模式                         生产模式 (Tauri)
                    ──────────                       ────────────────
前端 (Next.js)       localhost:4000                  由 Express 同源提供
后端 (Express)       localhost:4001                  端口 3001
                    ──────────                       ────────────────
API 请求            自动指向后端端口                  同源，空字符串即可
教室访问地址         使用后端端口 (Express)            同源，即 window 端口
```

## Git 快捷操作

不再需要每次打开 Claude 处理简单的 Git 操作，直接在终端执行：

| dev.sh | 说明 |
|---|---|
| `./dev.sh gs` 或 `./dev.sh git:status` | 查看文件变更状态 |
| `./dev.sh gl` 或 `./dev.sh git:log` | 最近 10 条提交历史 |
| `./dev.sh gl 20` | 最近 20 条（带分支图） |
| `./dev.sh gd` 或 `./dev.sh git:diff` | 查看改动文件列表 |
| `./dev.sh gd src/file.ts` | 查看某个文件的改动 |
| `./dev.sh git:pull` | 拉取最新代码（rebase） |
| `./dev.sh git:push` | 推送到远程 |

## 进程管理

| dev.sh | 说明 |
|---|---|
| `./dev.sh ps` | 查看运行中的服务进程（端口 4000/4001/3000/3001） |
| `./dev.sh stop` | 停掉 4000/4001 端口（优雅退出） |
| `./dev.sh stop 3000 3001` | 停掉指定端口 |

## 构建

| dev.sh | 原始命令 | 说明 |
|---|---|---|
| `./dev.sh build` | `pnpm build` | 构建前端 (Next.js 生产构建) |
| `./dev.sh build:server` | `pnpm --filter classnode-server build` | 编译后端 |
| `./dev.sh build:all` | 前端+后端+复制静态文件 | 发版前验证构建 |

## 数据库

| dev.sh | 原始命令 | 说明 |
|---|---|---|
| `./dev.sh db:push` | `pnpm --filter classnode-server db:push` | 改过 schema 后执行 |
| `./dev.sh db:studio` | `pnpm --filter classnode-server db:studio` | 打开 Prisma 可视化工具 |
| `./dev.sh db:generate` | `pnpm --filter classnode-server db:generate` | 重新生成 Prisma Client |
| `./dev.sh reset-db` | 删除 dev.db + db:push | **危险** 重置数据库 |
| `./dev.sh prisma:format` | `prisma format` | 格式化 Prisma schema |

## 版本号

| dev.sh | 原始命令 | 说明 |
|---|---|---|
| `./dev.sh version` | 读取 `package.json` | 查看当前版本号 |
| `./dev.sh version:bump 1.4.0` | `bash scripts/bump-version.sh` | 升级到指定版本 |
| `./dev.sh version:bump patch` | 同上 | 修订号 +1 |
| `./dev.sh version:sync` | `node scripts/sync-version.mjs` | 同步到所有子项目 |

`version:bump` 一次更新：`package.json`、`tauri.conf.json`、`Cargo.toml`、`about` 页面等。

## 维护

| dev.sh | 说明 |
|---|---|
| `./dev.sh clean` | 清理构建产物（out、server/dist、frontend） |
| `./dev.sh clean:all` | 深度清理（含 node_modules） |
| `./dev.sh fresh` | 全新安装（clean:all + 重装依赖 + db push） |
| `./dev.sh lint` | ESLint 检查 |
| `./dev.sh start` 或 `./dev.sh run` | 运行 `node start.js`（分发包测试） |
| `./dev.sh dist` 或 `./dev.sh package` | 运行 `make-dist.sh` 打包分发 |
| `./dev.sh help` | 查看所有命令 |

`clean` 对应的原始命令：
```bash
rm -rf out server/dist server/frontend
rm -rf src-tauri/resources/server/dist src-tauri/resources/server/changelogs src-tauri/resources/server/frontend
```

## 构建发行版

| dev.sh | 原始命令 | 说明 |
|---|---|---|
| `./dev.sh release` | `pnpm build:mac:arm64` | 构建 Apple Silicon (ARM64) 版 |
| `./dev.sh release:intel` | `pnpm build:mac:intel` | 构建 Intel (x86_64) 版 |
| `./dev.sh release:all` | ARM64 + Intel 依次构建 | 同时打两个架构的包 |
| `./dev.sh release:export` | - | 导出安装包到下载目录 |

> 只在正式发版时才用，日常开发不需要。

原始命令内部流程：
```
node scripts/sync-version.mjs   # 同步版本号
pnpm build                       # 构建前端
pnpm build:server                # 编译后端
rm -rf ... && cp ...             # 复制资源到 Tauri 目录
cd src-tauri/resources/server && npx prisma db push
cd ../../.. && tauri build       # Tauri 构建
node scripts/rename-bundle.mjs   # 重命名 DMG 文件
```

产物在 `src-tauri/target/.../release/bundle/dmg/` 下，自动重命名。

## 和 `package.json` 的关系

`dev.sh` 本质是对已有 `pnpm` 脚本的封装，不改变原有用法。如果你已经习惯 `pnpm dev:all`，完全可以直接用。`dev.sh` 的好处是：

- 命令更简短好记（`./dev.sh stop` vs `lsof -ti:3000,3001 | xargs kill -9`）
- 支持 `--port` / `--api-port` 参数快速换端口
- `gs`、`gl`、`gd` 等 Git 快捷操作不用记命令
- `help` 可随时查阅，不用翻 `package.json`
- 扩展自定义命令方便（如 `clean`、`fresh`、`reset-db`）

## 完整发版流程

```bash
./dev.sh version:bump patch    # 1. 修订号 +1
./dev.sh build:all             # 2. 验证构建通过
                               # 3. Claude 自动提交
                               # 4. 你确认后推送
```
