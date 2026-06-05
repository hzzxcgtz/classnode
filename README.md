<!-- 插入项目截图（可选） -->
<p align="center">
  <img src="public/logo.png" alt="ClassNode" width="96" height="96" style="border-radius: 20px;" />
</p>

<h1 align="center">ClassNode · AI 互动课堂系统</h1>

<p align="center">
  <strong>专为真实课堂教学场景深度定制的 AI 互动课堂系统</strong><br />
  打破 AI 技术落地课堂的「最后一公里」障碍
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node Version" />
</p>

---

## 📖 简介

ClassNode 是一款面向 K12 与职业教育的 AI 互动课堂系统。教师接入 Coze、智谱清言等 AI 智能体后，学生通过局域网即可与 AI 实时对话，教师通过课堂看板全程监控学情。

### 解决的教学痛点

| 痛点 | 解决方案 |
|------|----------|
| 教师调优的 AI 智能体难以分发给全班使用 | 一键分发，支持个人/小组/高级模式 |
| 学生与 AI 交互时教师无法实时查看 | 课堂看板「上帝视角」实时监测 |
| 学校网络环境限制，出口带宽不足 | 局域网互通，无需互联网访问 |
| 课后对话数据流失，缺乏分析依据 | 数据完整留存，支持导出 Word 文档 |

---

## ✨ 功能特性

- **AI 智能体管理** — 接入 Coze、Coze Agent、智谱清言、OpenAI 兼容接口，支持连通性自动检测
- **课堂管理** — 标准/分组/高级三种模式，互动码快速加入
- **实时课堂看板** — 监控每位学生的对话内容与进度
- **屏蔽词系统** — 内置 100+ 预设屏蔽词，支持自定义与批量导入
- **数据管理** — 历史存档、Word 导出、高频词云分析、数据备份与恢复
- **数据本地化** — SQLite 本地存储，无需外部云服务，保障学生隐私

---

## 🚀 快速开始

### 环境要求

- **Node.js 18 或更高版本**（LTS 版）
  - 下载地址：https://nodejs.org
  - 安装时全部默认选项即可

### 启动应用

找到 ClassNode 文件夹，双击对应系统的启动脚本：

| 系统 | 启动文件 |
|------|----------|
| macOS | `start-classnode-mac.command` |
| Windows | `start-classnode-win.bat` |
| Linux | `bash start-classnode-linux.sh` |

首次启动会自动安装依赖并构建（需联网，约 1-5 分钟），之后启动会快很多。

### 访问入口

| 角色 | 地址 |
|------|------|
| 教师端 | `http://localhost:3000/teacher` |
| 学生端 | `http://localhost:3000/classroom` |

> 如需在**其他设备**访问（如学生手机），将 `localhost` 替换为教师电脑的局域网 IP 地址，例如 `http://192.168.x.x:3000/classroom`。

首次进入教师端，按页面提示设置管理密码，然后配置 AI 智能体、创建班级和课堂即可。

---

## 📦 桌面应用打包

支持通过 Tauri 打包为独立的 macOS / Windows 桌面应用：

```bash
# 开发模式
pnpm dev

# macOS Apple Silicon 打包
pnpm build:mac:arm64

# macOS Intel 打包
pnpm build:mac:intel
```

---

## ❓ 常见问题

**Q：双击脚本后没反应？**  
Node.js 没有安装或安装不正确，请先安装 Node.js 18+。

**Q：提示端口被占用？**  
关闭其他正在运行的程序，或者重启电脑后再试。

**Q：如何重置所有数据？**  
进入教师端「数据管理」页面，点击「初始化清零」。或者直接删除 `server/prisma/dev.db` 文件，重启后会自动重建。

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js (React) |
| 后端框架 | Express + Socket.IO |
| 数据库 | SQLite (Prisma ORM) |
| 桌面壳 | Tauri (Rust) |
| 包管理 | pnpm |

---

## 📄 更新日志

详见 [changelogs/v1.2.3.md](changelogs/v1.2.3.md)

---

## 📬 联系方式

- 开发者：张星昌 · 杭州市拱墅区教育研究院
- 邮箱：[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
