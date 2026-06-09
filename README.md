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
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=nodedotjs" alt="Node Version">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <span style="font-weight: 600;">简体中文</span> · <a href="README.en.md">English</a>
</p>

---

## 研发初心

当今 AI 技术日新月异，许多老师都能精妙地调教出优秀的 AI 智能体。然而，当满怀期待地想将这些成果带入真实课堂时，却往往被现实羁绊：脆弱的校园网络、繁琐的账号注册、无法被看见的互动过程、随下课铃声飘散的数据……

**当技术本身不再是门槛，真正的挑战在于"落地"。**

ClassNode 便是为打破这道壁垒而生。它是一个轻量级的本地化 AI 互动课堂系统，能将老师倾注心血的智能体，安全、平滑地推送到每一个学生的屏幕前——无惧网络波动，无谓设备差异。

> 让 AI 课堂从偶尔的"想试试"，变成常态化的"天天用"。

---

## 破局之道

| 传统痛点 | ClassNode 的解答 |
| :--- | :--- |
| **注册繁琐，分发壁垒高** | **扫码即入**，免密免注册，全班秒级接入 |
| **过程黑盒，学情难把控** | **实时同步**，教师端全景呈现，全程可视化监控 |
| **依赖外网，受制于带宽** | **局域互通**，不依赖互联网出口，无惧断网卡顿 |
| **数据易逝，教研无沉淀** | **本地留存**，完整记录轨迹，一键导出 Word 报告 |

---

## 核心特性

- **智能体聚合管理** — 支持接入 Coze、智谱清言及 OpenAI 兼容接口，内置连通性自动巡检机制
- **多维教学模式** — 灵活切换标准（独立对话）、分组（协作探究）、高级（分层教学）三种场景
- **全景课堂看板** — 上帝视角实时监控全班状态，动态高频词云与活跃榜单让学情一目了然
- **智能内容过滤** — 内置 100+ 屏蔽词库，支持自定义拦截规则与触碰红线自动锁定，守护纯净课堂
- **数据价值闭环** — 贯穿"备课→互动→复盘"全流程，支持一键导出 Word 学情报表与跨设备无缝迁移

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

如果你有一定的技术基础，也可以下载源码，通过命令行自行启动。支持 **Linux** 平台。

> Windows 和 macOS 用户建议直接使用安装包（见上方），体验最完整。

#### 第一步：安装 Node.js

从 [Node.js 官网](https://nodejs.org) 下载 **v24.16.0 LTS** 版本。

以统信 UOS 系统为例：

```bash
# 1. 创建并进入软件目录
mkdir -p ~/software && cd ~/software

# 2. 下载（ARM 架构用 arm64，x86 架构用 x64）
wget https://mirrors.huaweicloud.com/nodejs/v24.16.0/node-v24.16.0-linux-arm64.tar.xz

# 3. 解压
tar -xvf node-v24.16.0-linux-arm64.tar.xz
mv node-v24.16.0-linux-arm64 nodejs24

# 4. 将 Node.js 加入环境变量
echo 'export PATH=$HOME/software/nodejs24/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

#### 第二步：更换 npm 源（国内用户推荐）

```bash
npm config set registry https://registry.npmmirror.com

# 检查是否切换成功
npm config get registry
# 预期输出: https://registry.npmmirror.com/
```

#### 第三步：部署 ClassNode

从 [Release 页面](https://gitcode.com/weixin_41523975/classnode/releases) 下载源码压缩包（如 `classnode-v1.x.x.zip`），解压。

打开终端，进入解压目录，运行一键启动脚本：

```bash
# 进入项目目录（请以实际解压路径为准）
cd classnode-v1.3.9

# 推荐方式：使用 Node.js 直接运行启动脚本
node start.js
```

也可以在桌面玩意双击 `start-classnode-linux.sh` ，以终端方式运行（效果相同）。

> 首次启动会自动安装依赖、初始化数据库并构建（约 1-5 分钟，需联网）。后续启动时，数据库结构未变化则会跳过初始化，速度明显加快。版本升级后首次启动也会因数据库更新而略有延迟，属正常现象。

启动后访问：

- 教师端：`http://localhost:3001/teacher`
- 学生端：`http://localhost:3001/classroom`

> 学生端通过局域网访问，将 `localhost` 替换为教师电脑的局域网 IP 即可。

---
## 联系

张星昌 · 杭州市拱墅区教育研究院  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
