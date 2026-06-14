[comment]: # (ClassNode README)

<p align="center">
  <img src="public/logo.png" alt="ClassNode" width="96" height="96" style="border-radius: 20px;">
</p>

<h1 align="center">ClassNode</h1>

<p align="center">
  <b>AI Interactive Classroom System</b><br>
  Rooted in the real teaching workflow, letting AI agents blend into every classroom — light, safe, and natural
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-8A2BE2?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=nodedotjs" alt="Node Version">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <span style="font-weight: 600;">English</span>
</p>

---

## Why It Was Built

AI technology is advancing fast. Many teachers can now craft impressive AI agents on platforms like Coze and Zhipu AI. But here's the real question: how do you get an entire class of 40 students to use it at the same time?

The reality is often frustrating — sluggish school networks, students struggling to register, teachers blind to what students are discussing with AI, and all conversation data vanishing when the bell rings. The technology is ready, but deployment isn't.

**When technology itself is no longer the barrier, the real challenge is making it work in the classroom.**

ClassNode was built to solve this. It's not a cloud platform — it's an AI classroom system that lives on your computer. Teachers can deliver their carefully crafted AI agents to every student safely and effortlessly, regardless of network quality or device type. Just open a browser and start class.

> One goal only: make AI in the classroom an everyday reality, not just an occasional experiment.

---

## Breaking Through

| Traditional Pain Points | ClassNode's Solution |
| :--- | :--- |
| **Students can't even log in, the AI lesson stalls before it starts** | **No-registration QR access** — scan or enter a 4-digit code, the whole class joins in seconds |
| **Teachers have no idea what students are doing with AI** | **Real-time dashboard** — full visibility into every student's conversation, no blind spots |
| **One network hiccup and the AI lesson breaks** | **Students don't need internet** — the teacher's computer acts as the gateway, lessons keep running regardless of network quality |
| **Conversation data vanishes when the bell rings** | **All data stays on the local hard drive** — review anytime, one-click Word report with word cloud export |

---

## Core Features

- **Multi-Platform Agent Support** — Coze Low-Code, Coze Code, Zhipu AI, and Wenxin AI agents with automatic connectivity checks
- **Three Teaching Modes** — Standard (individual chat), Group (collaborative inquiry), and Advanced (differentiated instruction) to fit different classroom scenarios
- **Full Classroom Dashboard** — Real-time monitoring of all student conversations, with word clouds and activity leaderboards
- **Smart Content Filtering** — Built-in blocked word library with custom rules and auto-black screen when threshold is triggered
- **Complete Data Workflow** — Covers lesson prep, classroom interaction, and post-class review; one-click Word report export with cross-device migration support

---

## Quick Start

### Install from Package (Recommended)

Download the installer for your platform from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases). Double-click to install:

> On the **first launch** after installation or update, the application will automatically initialize the database, which may cause a **10-30 second** delay. Please be patient — subsequent launches will be much faster.

| Platform | Package |
|------|--------|
| macOS Apple Silicon | `ClassNode_1.x.x_macos_apple-silicon.dmg` |
| macOS Intel | `ClassNode_1.x.x_macos_intel.dmg` |
| Windows (64-bit) | `ClassNode_1.x.x_x64-setup.exe` |

### Deploy from Source

If you have some technical background, you can also download the source code and start via command line. Supports **Linux**.

> Windows and macOS users should use the installer package above for the best experience.

#### Step 1: Install Node.js

Download **v24.16.0 LTS** from the [Node.js official website](https://nodejs.org).

Example for Linux (UOS):

```bash
# 1. Create and enter the software directory
mkdir -p ~/software && cd ~/software

# 2. Download (use arm64 for ARM CPUs, x64 for x86 CPUs)
wget https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-arm64.tar.xz

# 3. Extract
tar -xvf node-v24.16.0-linux-arm64.tar.xz
mv node-v24.16.0-linux-arm64 nodejs24

# 4. Add Node.js to PATH
echo 'export PATH=$HOME/software/nodejs24/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

#### Step 2: Change npm registry (recommended for China users)

```bash
npm config set registry https://registry.npmmirror.com
npm config get registry
```

#### Step 3: Deploy ClassNode

Download the **Source code** archive from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases) (e.g. `classnode-v1.4.1x.x.zip`), extract it.

Open a terminal in the extracted directory:

```bash
# Enter the project directory (adjust path as needed)
cd classnode-v1.4.1

# Recommended: run the start script via Node.js
node start.js
```

You can also double-click `start-classnode-linux.sh` (same effect).

> The first run will automatically install dependencies, initialize the database, and build (about 1-5 minutes, requires internet). Subsequent starts will skip database initialization if the schema hasn't changed, making them significantly faster. A brief delay is also expected after version upgrades due to database updates.

Access after startup:

- Teacher Console: `http://localhost:3001/teacher`
- Student Portal: `http://localhost:3001/classroom`

> For student devices on the same LAN, replace `localhost` with the teacher's LAN IP address.

---
## Contact

Xingchang Zhang · Gongshu Education Research Institute, Hangzhou  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
