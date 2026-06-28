# ClassNode 脚本手册

项目中共有 **11 个可执行脚本**（不含配置文件），分为 shell 脚本和 Node.js 脚本两大类。

---

## 快速索引

| 类别 | 脚本 | 一句话用途 |
|------|------|-----------|
| **开发** | [`dev.sh`](#-devsh--主开发工具) | 🏆 主开发工具，覆盖 dev/build/release/git/db |
| **启动** | [`start.js`](#-启动脚本) | Linux 一键启动（全自动构建+运行） |
| | `start-classnode-linux.sh` | Linux 启动封装（双击运行） |
| | `serve-frontend.js` | 纯 Node.js 静态文件服务器 |
| **构建** | [`release-full.sh`](#-release-fullsh--全平台发行版构建) | 全平台发行版构建（macOS + Windows CI） |
| | `build-release.sh` | GitHub Actions Windows CI 构建 |
| | `scripts/build-mac.sh` | macOS 独立构建（含 Node.js 捆绑） |
| | `scripts/package-server.mjs` | 打包服务端到 Tauri 资源目录 |
| | `scripts/rename-bundle.mjs` | 重命名 Tauri 构建产物 |
| **版本** | [`scripts/sync-version.mjs`](#-scriptssync-versionmjs--版本号同步) | 版本号同步（构建前自动执行） |
| | `scripts/bump-version.sh` | 版本号升级（手动执行） |
| | `scripts/update-updater-manifest.mjs` | 更新 updater 清单文件 |

---

## 🏆 `dev.sh` — 主开发工具

**文件**: `dev.sh`

一站式工具，覆盖开发、构建、发行、Git、数据库的全流程。推荐日常开发仅使用此脚本。

```bash
# 查看完整帮助
./dev.sh help

# ── 开发 ──
./dev.sh dev                   # 启动前端 (Next.js)
./dev.sh dev:server            # 启动后端 (Express)
./dev.sh dev:all               # 同时启动前后端
./dev.sh status                # 查看当前服务状态
./dev.sh stop                  # 停掉开发服务

# ── 构建 ──
./dev.sh build                 # 构建前端
./dev.sh build:server          # 编译后端
./dev.sh build:all             # 构建前后端 + 复制静态资源

# ── 版本号 ──
./dev.sh version               # 查看版本
./dev.sh version:bump 1.6.0    # 升级到指定版本
./dev.sh version:bump patch    # 修订号 +1
./dev.sh version:sync          # 同步到所有子项目

# ── 发行版 ──
./dev.sh r                     # 构建 macOS ARM64
./dev.sh r intel               # 构建 macOS Intel
./dev.sh r all                 # macOS 双架构 + 源码包
./dev.sh release               # Windows CI 构建（默认 x64）
./dev.sh release:full          # 全平台：macOS 本地 + Windows CI

# ── Git ──
./dev.sh gs                    # 查看 git 变更
./dev.sh gl                    # 查看 git 提交历史（最近 10 条）
./dev.sh gd                    # 查看改动内容
./dev.sh git:pull              # 拉取
./dev.sh git:push              # 推送

# ── 数据库 ──
./dev.sh db:push               # 同步数据库表结构
./dev.sh db:studio             # 打开 Prisma Studio
./dev.sh db:generate           # 重新生成 Prisma Client
./dev.sh reset-db              # 重置数据库

# ── 维护 ──
./dev.sh clean                 # 清理构建产物
./dev.sh clean:all             # 深度清理（含 node_modules）
./dev.sh fresh                 # 全新安装
./dev.sh lint                  # ESLint 检查
./dev.sh dist                  # 打包源码分发包
./dev.sh start                 # 生产启动
```

**端口选项**（适用于 `dev`、`dev:server`、`dev:all`）：

```bash
./dev.sh dev:all --port 4000 --api-port 4001
```

---

## 🚀 启动脚本

### `start.js`

**文件**: `start.js` | **平台**: Linux

一键启动脚本，自动完成：环境检查 → 安装依赖 → 初始化数据库 → 编译 TypeScript → 构建前端 → 启动服务。

```bash
node start.js
```

> Windows / macOS 用户建议使用 Release 页面下载的安装包。

### `start-classnode-linux.sh`

**文件**: `start-classnode-linux.sh`

薄封装，调用 `node start.js`，方便 Linux 用户双击执行。

```bash
./start-classnode-linux.sh
```

### `serve-frontend.js`

**文件**: `serve-frontend.js`

零依赖的静态文件服务器，用于 Next.js 静态导出文件（`out/` 目录）。支持无扩展名 URL 自动补全 `.html`，注入 JS 错误捕获脚本。

```bash
PORT=3000 node serve-frontend.js
```

> 生产环境由 Express 后端直接托管前端，此文件通常仅用于调试或独立部署测试。

---

## 🔨 构建脚本

### `release-full.sh` — 全平台发行版构建

**文件**: `release-full.sh`

全平台发行版构建：macOS（ARM64 + Intel）本地构建 + 触发 GitHub Actions Windows CI + 更新 updater 清单 + 源码包。

```bash
# 全平台（macOS + Windows CI）
./release-full.sh

# 仅 macOS（ARM64 + Intel）
./release-full.sh mac

# 仅 macOS ARM64
./release-full.sh arm64

# 仅 macOS Intel
./release-full.sh intel
```

**工作流**:

1. 触发 GitHub Actions Windows CI（x64 + arm64）
2. 本地构建 macOS ARM64
3. 本地构建 macOS Intel
4. 导出 DMG 到安装包目录
5. 更新 `updater/latest.json`（版本、签名、URL、发布日期）
6. 打包源码分发包
7. 等待 Windows CI 完成并展示结果

### `build-release.sh` — Windows CI 构建

**文件**: `build-release.sh`

远程触发 GitHub Actions 为 Windows 构建安装包，生成 draft release。

```bash
# 触发 x64 + arm64 构建
./build-release.sh

# 仅 x64
./build-release.sh x64

# 仅 arm64
./build-release.sh arm64
```

> 需要 `gh` CLI 已登录（`gh auth login`）。

### `scripts/build-mac.sh` — macOS 独立构建

**文件**: `scripts/build-mac.sh`

独立的 macOS 构建脚本，适用于需要捆绑 Node.js 运行时的场景（与 Tauri 桌面版不同）。

```bash
# 构建当前架构
./scripts/build-mac.sh

# 构建 Intel 版本（在 ARM Mac 上交叉编译）
./scripts/build-mac.sh --target x86_64-apple-darwin

# 不含 Node.js（快速调试用）
./scripts/build-mac.sh --without-node
```

### `scripts/package-server.mjs` — 打包服务端

**文件**: `scripts/package-server.mjs`

构建完成后将服务端文件打包到 Tauri 资源目录 `src-tauri/resources/server/`。在 `pnpm build:mac:*` 和 `build:windows` 中自动调用。

执行流程：
1. 复制 `server/dist/`、`prisma/schema.prisma`、`server/package.json`
2. 复制 `out/`（前端静态文件）
3. 安装生产依赖（`npm install --production`）
4. 初始化数据库（`prisma db push --accept-data-loss`）

### `scripts/rename-bundle.mjs` — 重命名构建产物

**文件**: `scripts/rename-bundle.mjs`

Tauri 构建后重命名产物文件，统一命名格式。

```bash
node scripts/rename-bundle.mjs aarch64   # ARM64 产物
node scripts/rename-bundle.mjs x86_64    # Intel 产物
```

重命名对象：`.dmg`、`.app`、`.tar.gz`、`.tar.gz.sig`。

---

## 🔖 版本号脚本

### `scripts/sync-version.mjs` — 版本号同步

**文件**: `scripts/sync-version.mjs`

从根 `package.json` 读取版本号，同步到以下位置：

| 目标文件 | 说明 |
|----------|------|
| `server/package.json` | 后端版本 |
| `src-tauri/resources/server/package.json` | Tauri 捆绑的后端版本 |
| `src-tauri/tauri.conf.json` | Tauri 桌面配置 |
| `src-tauri/Cargo.toml` | Rust 工程版本 |
| `README.md` / `README.en.md` | 用户文档中的 cd 命令版本 |
| `portal/index.html` | 门户页版本徽章 + 横幅日期 |
| `updater/latest.json` | 更新清单 |

**自动执行**：构建命令 `pnpm build` 的 `prebuild` 钩子会先执行此脚本。

```bash
# 手动执行
pnpm sync-version
```

### `scripts/bump-version.sh` — 版本号升级

**文件**: `scripts/bump-version.sh`

手动升级版本号，自动修改所有相关文件并生成 git 提交。

```bash
# 指定版本号
./scripts/bump-version.sh 1.6.0

# 也可通过 dev.sh 执行（推荐）
./dev.sh version:bump 1.6.0
./dev.sh version:bump patch    # 修订号 +1
```

执行的操作：
1. 更新所有 `package.json`、`tauri.conf.json`、`Cargo.toml`、README、portal 等文件
2. 自动从 git log 提取提交信息，生成 `server/changelogs/v<version>.md` 更新日志
3. 自动 `git add && git commit`

### `scripts/update-updater-manifest.mjs` — 更新 updater 清单

**文件**: `scripts/update-updater-manifest.mjs`

Tauri 构建后，更新 `updater/latest.json`，写入版本号、签名、下载 URL 和发布日期。

```bash
# ARM64 构建后执行
node scripts/update-updater-manifest.mjs aarch64

# Intel 构建后执行
node scripts/update-updater-manifest.mjs x86_64
```

> 在 `pnpm build:mac:arm64` / `build:mac:intel` 的 `update-updater-manifest` 步骤中自动调用。

---

## 脚本关系图

```
                            dev.sh
                    ┌──────────┼──────────┐
                    ↓          ↓          ↓
          build-release.sh   release-full.sh   bump-version.sh
          (Windows CI)      (全平台构建)
                                  │
                    ┌─────────────┼─────────────┐
                    ↓             ↓             ↓
         scripts/build-mac.sh  scripts/         dev.sh dist
         (macOS 独立构建)     package-server   (内联源码包)
                              rename-bundle
                              update-updater-manifest
                              sync-version (← prebuild 自动)
```

---

## 完整发版流程

```
1. ./dev.sh version:bump patch   # 升版本，自动 commit
2. git push                      # 推送 GitHub
3. ./dev.sh release:full         # 全平台构建
   ├── macOS ARM64  ← 本地构建
   ├── macOS Intel  ← 本地构建
   ├── Windows x64  ← GitHub Actions CI
   └── Windows arm64 ← GitHub Actions CI
4. 前往 GitHub Release 发布 draft release
```

---

## 已清理的旧脚本

以下脚本已在本次整理中删除：

| 脚本 | 删除原因 |
|------|---------|
| `download-release.sh` | 旧自动下载脚本，功能已由 Tauri updater 替代，后 Tauri updater 也被移除 |
| `upload-dist.sh` | 旧上传到网盘脚本，不再需要 |
| `make-dist.sh` | 已被 `dev.sh` 内联的 `dist` 命令替代 |
| `scripts/update-updater-manifest.mjs` | Tauri updater 清单更新脚本，随 updater 一起移除 |
