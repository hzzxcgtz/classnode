	[comment]: # (ClassNode README)

<p align="center">
  <img src="public/logo.png" alt="ClassNode" width="96" height="96" style="border-radius: 20px;">
</p>

<h1 align="center">ClassNode</h1>

<p align="center">
  <b>AI 互动课堂系统</b><br>
  回归真实教学脉络，让 AI 智能体以轻盈、安全的方式，自然融入每一方课堂
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-8A2BE2?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs" alt="Node Version">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <span style="font-weight: 600;">简体中文</span> · <a href="README.en.md">English</a>
</p>

---

## 研发初心

AI 技术发展很快，如今很多老师都能在 Coze、智谱清言、百度文心等平台上调教出相当出色的 AI 智能体。但问题来了：怎么让全班四十个孩子同时用上它？

现实往往很骨感——学校带宽不够，打开一个网页都要转半天；让学生自己注册账号，折腾大半节课还没全进来；学生跟 AI 聊了什么，老师在讲台上完全不知道；下课铃一响，所有对话记录烟消云散……

**技术不难的时候，难的是落地。**

ClassNode 正是为此而生。它不是一个云平台，而是一个能装进你电脑里的"AI 互动课堂系统"。老师在 Coze、智谱清言、百度文心等平台调教好的智能体，通过它就能安全、可控、零门槛地分发给全班每一个学生——不管学校网络好不好，不管学生用的是平板还是手机，打开浏览器就能开课。

> 目的只有一个：让 AI 课堂从"想试试"变成"天天用"。

---

## 破局之道

| 传统痛点 | ClassNode 的解答 |
| :--- | :--- |
| **学生登都登不进，AI 课还没开始就卡住了** | **免注册扫码即入**，互动码一开，平板手机秒级接入 |
| **学生拿 AI 在干嘛，讲台上完全看不到** | **全程实时同步**，教师端全景看板，谁在学谁在摸鱼一目了然 |
| **教室网一卡，AI 对话就断** | **学生端无需互联网**，通过教师机统一接入 AI，网络再差也不影响上课 |
| **一下课对话记录全没了，白讲一场** | **本地完整留存**，随时回溯查看，一键导出含高频词云的 Word 报告 |

---

## 核心特性

- **多平台智能体接入** — 支持 Coze 低代码、Coze 编程、智谱清言、文心智能体，内置连通性自动巡检
- **三种教学模式** — 标准模式（独立对话）、分组模式（协作探究）、高级模式（分层教学），灵活适配不同课堂
- **全景课堂看板** — 实时监控全班对话状态，高频词云与活跃榜单让学情一目了然
- **智能内容过滤** — 内置屏蔽词库，自动拦截不当言论，支持自定义规则与触发阈值自动黑屏
- **数据完整闭环** — 从备课、课堂互动到课后复盘全覆盖，一键导出 Word 学情报告，支持跨设备迁移

---

## 快速开始

### 安装包安装（推荐）

从 [Release 页面](https://gitcode.com/weixin_41523975/classnode/releases) 下载对应系统安装包，双击安装即可：

> 安装或更新版本后**首次启动**时，程序会自动初始化数据库结构，可能会有 **10-30 秒**的短暂延迟，请耐心等待，后续启动将恢复正常速度。

| 平台 | 安装包 |
|------|--------|
| macOS Apple Silicon | `ClassNode_1.x.x_macos_apple-silicon.dmg` |
| macOS Intel | `ClassNode_1.x.x_macos_intel.dmg` |
| Windows (64 位) | `ClassNode_1.x.x_x64-setup.exe` |

### 本地源码部署

详细部署指南与系统要求请查看 [安装部署指南](myportal/deploy.html)。 学生端通过局域网访问，将 `localhost` 替换为教师电脑的局域网 IP 即可。
>
> **💡 贴心提示：学生机连不上？** Windows 系统默认的安全策略有时会误拦截网络。若学生机连接失败，多半是教师机的 3001 端口被防火墙阻挡。请在教师电脑上尝试：<br>
> **方式一：** 打开「Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙」，勾选 **ClassNode** (或 **Node.js**) 的专用与公用网络（若无，点「允许其他应用」手动添加）。<br>
> **方式二：** 进同页面的「高级设置 → 入站规则 → 新建规则」，按提示勾选：端口 → TCP → 输入 3001 → 允许连接。

---
## 联系

张星昌 · 杭州市拱墅区教育研究院  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
