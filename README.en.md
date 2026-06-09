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

AI technology is advancing rapidly, and many teachers can skillfully craft excellent AI agents. Yet when they eagerly try to bring these achievements into real classrooms, they are often held back by harsh realities: fragile school networks, tedious account registration, invisible interaction processes, and data that scatters when the bell rings.

**When technology itself is no longer a barrier, the real challenge is deployment.**

ClassNode was born to break through this wall. It is a lightweight, local AI interactive classroom system that delivers a teacher's carefully crafted AI agents to every student's screen — safely, smoothly, regardless of network fluctuations or device differences.

> Turning AI in the classroom from an occasional "worth a try" into a daily "used in every class."

---

## Breaking Through

| Traditional Pain Points | ClassNode's Solution |
| :--- | :--- |
| **Cumbersome registration, hard to distribute** | **Scan to join** — no passwords, no registration, the whole class connects in seconds |
| **Black box process, no visibility into learning** | **Real-time sync** — full panorama on the teacher dashboard, fully visualized monitoring throughout |
| **Internet-dependent, limited by bandwidth** | **LAN-based** — no internet access needed, unafraid of network outages |
| **Data vanishes, nothing left for research** | **Local storage** — complete record of trajectories, one-click Word report export |

---

## Core Features

- **Unified Agent Management** — Supports Coze, Zhipu AI and OpenAI-compatible APIs, with built-in automatic connectivity check
- **Multi-Dimension Teaching Modes** — Flexibly switch between Standard (individual dialogue), Group (collaborative inquiry), and Advanced (differentiated instruction) scenarios
- **Panoramic Classroom Dashboard** — God's-eye real-time monitoring of the whole class; dynamic word clouds and leaderboards make learning clear at a glance
- **Intelligent Content Filtering** — 100+ built-in blocked words, custom rules, auto-lock when the threshold is triggered, keeping the classroom environment safe
- **Data Value Closed Loop** — Runs through the entire flow of "lesson prep → interaction → review"; one-click Word report export and seamless cross-device migration

---

## Quick Start

### Install from Package (Recommended)

Download the installer for your platform from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases). Double-click to install:

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

Download the **Source code** archive from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases) (e.g. `classnode-v1.x.x.zip`), extract it.

Open a terminal in the extracted directory:

```bash
# Enter the project directory (adjust path as needed)
cd classnode-v1.3.8

# Recommended: run the start script via Node.js
node start.js
```

You can also double-click `start-classnode-linux.sh` (same effect).

> The first run will automatically install dependencies and build (about 1-5 minutes, requires internet). Subsequent starts will be much faster.

Access after startup:

- Teacher Console: `http://localhost:3001/teacher`
- Student Portal: `http://localhost:3001/classroom`

> For student devices on the same LAN, replace `localhost` with the teacher's LAN IP address.

---
## Contact

Xingchang Zhang · Gongshu Education Research Institute, Hangzhou  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
