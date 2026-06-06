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

> macOS 和 Windows 用户建议直接使用安装包，无需看此章节。以下教程仅面向 **Linux / 统信 UOS** 用户。

#### 第一步：安装 Node.js

访问 [Node.js 官网](https://nodejs.org) 下载 LTS 版本的 Linux 预编译二进制包，也可以直接用命令行下载：

![Node.js 官网下载页面](public/images/help/nodejs-download.png)

以统信 UOS（ARM64 架构）为例：

```bash
# 创建并进入存放软件的目录
mkdir -p ~/software && cd ~/software

# 从华为云镜像站下载 v24.16.0 的 Linux ARM64 二进制包
wget https://mirrors.huaweicloud.com/nodejs/v24.16.0/node-v24.16.0-linux-arm64.tar.xz

# 解压压缩包
tar -xvf node-v24.16.0-linux-arm64.tar.xz

# 重命名文件夹，方便后续配置
mv node-v24.16.0-linux-arm64 nodejs24
```

配置环境变量：

```bash
# 将 Node.js 的 bin 目录加到环境变量中
echo 'export PATH=$HOME/software/nodejs24/bin:$PATH' >> ~/.bashrc

# 刷新配置，使环境变量立即生效
source ~/.bashrc
```

验证安装：

```bash
node -v   # 预期输出: v24.16.0
npm -v    # 预期输出对应的 npm 版本号
```

> 如果 CPU 是 x86 架构，请下载 `linux-x64` 版本；ARM 架构下载 `linux-arm64` 版本。

#### 第二步：更换 npm 源

```bash
npm config set registry https://registry.npmmirror.com

# 检查是否切换成功
npm config get registry
# 预期输出: https://registry.npmmirror.com/
```

#### 第三步：部署 ClassNode

从 [Release 页面](https://gitcode.com/weixin_41523975/classnode/releases) 下载 **Source code** 压缩包（如 `classnode-v1.x.x.zip`），解压后在终端进入解压目录，执行启动脚本：

```bash
# 进入解压后的目录（以 v1.3.4 为例）
cd classnode-v1.3.4

# 给启动脚本添加执行权限（仅首次需要）
chmod +x start-classnode-linux.sh

# 运行启动脚本
./start-classnode-linux.sh
```

首次启动会自动安装依赖并构建（约 1-5 分钟，需联网），之后启动会快很多。

启动后访问：

- 教师端：`http://localhost:3001/teacher`
- 学生端：`http://localhost:3001/classroom`

> 学生端通过局域网访问，将 `localhost` 替换为教师电脑的局域网 IP 即可。

---

## 更新日志

<details>
<summary>v1.3.4 — 2026-06-06（当前版本）</summary>

#### 关于页全面改版
- 新增开发者故事板块，以"缘起"信纸设计讲述 ClassNode 的诞生初衷
- 新增技术底座四宫格区域，突出轻量化、数据本地化、局域网互通等核心优势
- Hero 区域重新设计，Logo、系统名、版本号、更新日志按钮布局更清晰
- 整体字号提升，排版更疏朗，视觉质感大幅优化

#### 使用指南 UI 优化
- 左侧目录每个条目拆分为两行显示——上部大字主标题、下部小字副标题
- 整体字体增大，排版细节优化
</details>

<details>
<summary>v1.3.3 — 2026-06-06</summary>

#### 互动码二维码下载（带 Logo）
- 教师控制台「投屏发码」新增下载二维码图片功能，生成的二维码图片中心嵌入 ClassNode Logo

#### Windows 安装程序语言
- Windows NSIS 安装器新增简体中文支持，中文系统下安装界面自动显示中文
</details>

<details>
<summary>v1.3.1 — 2026-06-05</summary>

#### 互动码增加二维码扫码功能
- 教师进入课堂后，点击「投屏发码」可展示二维码 + 访问网址 + 四位互动码
- 学生使用手机或平板扫描二维码即可自动跳转至课堂页面，无需手动输入互动码
- 控制台首页课堂卡片新增「显示互动码」按钮，无需进入课堂即可快速查看

#### 优化
- 投屏发码画面全面放大，教室大屏幕后排可见
</details>

<details>
<summary>v1.2.4 — 2026-06-05</summary>

#### 仪表盘重构
- 全面引入 recharts 图表库，使用 BarChart / PieChart 替换原自定义 SVG 环形图
- 顶部新增核心 KPI 行（智能体/班级/学生/进行中课堂/总互动），一目了然
- 四宫格分区展示：AI 智能体、班级管理、课堂管理、数据管理

#### 系统屏蔽词支持逐条删除
- 展开系统屏蔽词分类后，每个词条右侧显示删除按钮
- 「恢复预设」一键补回所有已删除的默认屏蔽词
</details>

<details>
<summary>v1.2.3 — 2026-06-05</summary>

#### 智能体连通性自动检测
- 新增后台定时检测服务，按可配置的间隔周期测试所有已启用智能体的 API 连通性
- 支持单智能体手动测试和「全部检测」一键批量检测

#### 屏蔽词词库升级
- 内置 100+ 条预设屏蔽词，覆盖脏话辱骂、色情低俗、暴力威胁、自残自杀四大类
- 首次启动时自动填充

#### 课堂管理增强
- 课堂看板新增模式标签（标准模式 / 分组模式 / 高级模式）
- 分组/高级模式下展示小组真实学生成员列表

#### 修复
- 防止重复启动多个程序实例
- 屏蔽词违规警告事件未正确推送到教师端的问题
- 学生拉黑/取消拉黑事件未同步到教师端的问题
</details>

---

## 联系

张星昌 · 杭州市拱墅区教育研究院  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
