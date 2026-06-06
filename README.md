<p align="center">
  <img src="public/logo.png" alt="ClassNode" width="96" height="96" style="border-radius: 20px;">
</p>

<h1 align="center">ClassNode</h1>

<p align="center">
  <b>AI 互动课堂系统</b><br>
  专为真实课堂而生，让 AI 智能体安全、可控、零门槛地走进每一间教室
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-8A2BE2?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=nodedotjs" alt="Node Version">
</p>

---

## 为什么做 ClassNode

AI 技术发展很快，现在很多老师都能调教出很出色的 AI 智能体。但要让全班几十个孩子都用上，现实往往是另一回事：学校网络卡顿、学生注册账号太麻烦、屏幕后聊了什么你不知道、下课以后数据全没了……

**技术不难的时候，难的是落地。**

ClassNode 不是大厂的云平台，而是一个能装进你电脑里的 AI 互动课堂系统。老师用 Coze、智谱清言调教好的智能体，通过它就能安全可控地分发给全班学生——不管学校网络好不好，不管学生用的是平板还是手机。

> 目的只有一个：**让 AI 课堂从"想试试"变成"天天用"。**

---

## 解决的问题

| 痛点 | 解决方案 |
|------|----------|
| 分发难得像发传单——学生逐个注册太麻烦 | 互动码一开，全班扫码秒进 |
| 学生聊什么完全是"黑盒"——教师无法实时掌握 | 每一句话实时同步到教师端，一目了然 |
| 一断网 AI 就罢工——学校出口带宽不足 | 局域网互通设计，不依赖互联网出口 |
| 下课铃一响数据全丢——缺乏教研分析依据 | 本地存储，一键导出含高频词云的 Word 报告 |

---

## 核心功能

- **AI 智能体管理** —— 支持 Coze Bot、Coze Agent、智谱清言、OpenAI 兼容接口；连通性自动检测，在线状态一目了然
- **三种教学模式** —— 标准模式（独立对话）、分组模式（协作探究）、高级模式（分层教学，小组绑定不同 AI）
- **实时课堂看板** —— 全景监控全班状态，高频词云 + 活跃榜 Top10 辅助把握课堂节奏
- **屏蔽词系统** —— 内置 100+ 预设屏蔽词，多级阈值管控，自动锁定违规学生
- **数据全闭环** —— 从备课、课堂互动到课后复盘，完整留存，支持 Word 导出与跨设备迁移

---

## 快速开始

### 环境要求

- **Node.js 18+**（推荐 LTS 版，[下载地址](https://nodejs.org)）

### 启动

找到 ClassNode 文件夹，双击对应系统的启动脚本：

| 系统 | 启动文件 |
|------|----------|
| macOS | `start-classnode-mac.command` |
| Windows | `start-classnode-win.bat` |
| Linux | `bash start-classnode-linux.sh` |

首次启动会自动安装依赖并构建（约 1-5 分钟，需联网）。

### 访问

| 角色 | 地址 |
|------|------|
| 教师端 | `http://localhost:3000/teacher` |
| 学生端 | `http://localhost:3000/classroom` |

> 学生端通过局域网访问，将 `localhost` 替换为教师电脑的局域网 IP 即可。

首次进入教师端：设置管理密码 → 配置 AI 智能体 → 创建班级 → 创建课堂，即可开始上课。

## 打包

```bash
pnpm dev              # 开发模式
pnpm build:mac:arm64  # macOS Apple Silicon
pnpm build:mac:intel  # macOS Intel
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js (React) |
| 后端框架 | Express + Socket.IO |
| 数据库 | SQLite (Prisma ORM) |
| 桌面壳 | Tauri (Rust) |
| 包管理 | pnpm |

---

## 更新日志

[server/changelogs](server/changelogs)

---

## 联系

张星昌 · 杭州市拱墅区教育研究院  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
