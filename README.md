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

| 平台 | 安装包 |
|------|--------|
| macOS Apple Silicon | `ClassNode_1.x.x_macos_apple-silicon.dmg` |
| macOS Intel | `ClassNode_1.x.x_macos_intel.dmg` |
| Windows (64 位) | `ClassNode_1.x.x_x64-setup.exe` |
| Windows (32 位) | `ClassNode_1.x.x_x32-setup.exe` |

### 本地源码部署

如果你有一定的技术基础，也可以下载源码，通过命令行自行启动。支持 **Windows** 和 **Linux**。

> macOS 用户建议直接使用安装包（见上方），体验最完整。

#### 第一步：安装 Node.js

从 [Node.js 官网](https://nodejs.org) 下载 **v24.16.0 LTS** 版本，或参考下方命令行操作：

**Windows 用户** 直接下载安装包：
- 访问 https://nodejs.org 下载 `Windows Installer (.msi)` 64 位版本
- 双击安装，安装过程中勾选"自动添加到 PATH"
- 安装完成后打开命令提示符（cmd），验证安装是否成功：
  ```bash
  node -v   # 预期输出: v24.16.0
  npm -v    # 预期输出对应的 npm 版本号
  ```

**Linux 用户** 下载预编译包：

<img src="public/images/help/nodejs-download.png" alt="Node.js 官网下载页面" width="400">

```bash
mkdir -p ~/software && cd ~/software
wget https://mirrors.huaweicloud.com/nodejs/v24.16.0/node-v24.16.0-linux-arm64.tar.xz
tar -xvf node-v24.16.0-linux-arm64.tar.xz
mv node-v24.16.0-linux-arm64 nodejs24

# 将 Node.js 的 bin 目录加到环境变量中
echo 'export PATH=$HOME/software/nodejs24/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

> 如果 CPU 是 x86 架构，请下载 `linux-x64` 版本；ARM 架构下载 `linux-arm64` 版本。

#### 第二步：更换 npm 源（国内用户推荐）

```bash
npm config set registry https://registry.npmmirror.com

# 检查是否切换成功
npm config get registry
# 预期输出: https://registry.npmmirror.com/
```

#### 第三步：部署 ClassNode

从 [Release 页面](https://gitcode.com/weixin_41523975/classnode/releases) 下载 **Source code** 压缩包（如 `classnode-v1.x.x.zip`），解压。

**Windows 用户**：双击 `start-classnode-windows.bat`，或打开命令提示符运行：

```bash
cd classnode-v1.3.4
start-classnode-windows.bat
```

**Linux 用户**：在终端进入解压目录：

```bash
cd classnode-v1.3.4
chmod +x start-classnode-linux.sh   # 仅首次需要
./start-classnode-linux.sh
```

首次启动会自动安装依赖并构建（约 1-5 分钟，需联网），之后启动会快很多。

启动后访问：

- 教师端：`http://localhost:3001/teacher`
- 学生端：`http://localhost:3001/classroom`

> 学生端通过局域网访问，将 `localhost` 替换为教师电脑的局域网 IP 即可。

---
## 联系

张星昌 · 杭州市拱墅区教育研究院  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
