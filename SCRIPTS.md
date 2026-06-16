# ClassNode 脚本使用说明

## 开发服务器

```bash
./dev.sh dev:all          # 启动前端 + 后端（开发模式）
./dev.sh dev              # 仅启动前端
./dev.sh dev:server       # 仅启动后端
```

默认端口：前端 4000，后端 4001
自定义端口：`./dev.sh dev:all --port 3000 --api-port 3001`

```bash
./dev.sh stop             # 停掉开发服务
./dev.sh status           # 查看服务运行状态
```

---

## 构建

```bash
./dev.sh build:all        # 构建前端静态页 + 编译后端
./dev.sh clean            # 清理构建产物
./dev.sh fresh            # 重装依赖 + 重建数据库
```

---

## 版本号管理

```bash
./dev.sh version                    # 查看当前版本
./dev.sh version:bump patch         # 修订号 +1（如 1.4.0 → 1.4.1）
./dev.sh version:bump 1.5.0         # 升级到指定版本
```

`version:bump` 自动更新文件：`package.json`、`server/package.json`、`tauri.conf.json`、`Cargo.toml`、`README.md`、`README.en.md`、`portal/index.html`、`portal/deploy.html`，并 commit。

---

## 数据库

```bash
./dev.sh db:push          # 同步表结构
./dev.sh db:studio        # Prisma Studio（GUI）
./dev.sh db:generate      # 重新生成 Prisma Client
./dev.sh reset-db         # 重置数据库
```

---

## 发行版 — macOS（本地构建）

产物输出到 `/Users/zxc/Downloads/ClassNode/installer/v{版本号}/`

```bash
# 常用（r 系列）
./dev.sh r                # macOS ARM64
./dev.sh r intel          # macOS Intel
./dev.sh r both           # macOS 双架构（ARM64 + Intel）
./dev.sh r all            # macOS 双架构 + 源码包
```

---

## 发行版 — Windows（GitHub Actions CI）

```bash
./dev.sh ci               # Windows x64 + arm64
./dev.sh ci x64           # 仅 Windows x64
./dev.sh ci arm64         # 仅 Windows arm64
./dev.sh ci both          # 仅 Windows x64
```

---

## 发行版 — 全平台（推荐）

一键完成：本地 macOS（ARM64+Intel）+ CI Windows 全部架构，汇总到同一目录。

```bash
./dev.sh release:full     # 完整的四个平台的全流程操作

# Windows 远程构建（仅触发 CI，不下载不上传）
./dev.sh release          # Windows x64
./dev.sh release both     # 仅 Windows x64
./dev.sh release all      # Windows x64 + ARM64
```

流程：
```
触发 Windows CI ──→ 立即开始本地构建 macOS
                       ├─ ARM64 DMG
                       ├─ Intel DMG
                       └─ 源码 zip
                    ──→ 等待 CI 完成（实时显示耗时）
                       └─ 提示手动下载和上传
```

---

## 下载与分发

```bash
./download-release.sh             # 下载 GitHub 最新版
./download-release.sh 1.4.1       # 下载指定版本

./upload-dist.sh                  # 上传最新版到网盘
./upload-dist.sh 1.4.1            # 上传指定版本
```

---

## Git 快捷

```bash
./dev.sh gs              # 查看变更
./dev.sh gl              # 提交历史（最近 10 条）
./dev.sh gd              # 查看改动
./dev.sh git:pull        # 拉取
./dev.sh git:push        # 推送
```

---

## 其他

```bash
./dev.sh help            # 完整帮助
./dev.sh lint            # ESLint
./dev.sh dist            # 源码分发包
./dev.sh start           # 生产启动
./dev.sh ps              # 进程状态
```

---

## 完整发版流程

```
1. ./dev.sh version:bump patch   # 升版本，自动 commit
2. git push                      # 推送 GitHub
3. ./dev.sh release:full         # 全平台构建（4 个架构）
   ├── macOS ARM64  ← 本地
   ├── macOS Intel  ← 本地
   ├── Windows x64  ← CI
   └── Windows arm64 ← CI
4. ./upload-dist.sh              # 上传网盘
```
