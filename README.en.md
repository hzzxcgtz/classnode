[comment]: # (ClassNode README)

<p align="center">
  <img src="public/logo.png" alt="ClassNode" width="96" height="96" style="border-radius: 20px;">
</p>

<h1 align="center">ClassNode</h1>

<p align="center">
  <b>AI-Powered Interactive Classroom System</b><br>
  Rooted in real teaching — let AI agents blend into your classroom, lightly and safely
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

## Why ClassNode

AI is advancing at a breathtaking pace, and many teachers can already craft remarkable AI agents. Yet bringing them into a real classroom often hits hard walls: fragile school networks, tedious account registrations, invisible student interactions, and data that vanishes when the bell rings.

**When technology itself is no longer the barrier, the real challenge is deployment.**

ClassNode was built to break through this wall. It is a lightweight, local-first AI classroom system that delivers a teacher's carefully crafted AI agents to every student's screen — smoothly, safely, and regardless of network conditions or device types.

> From an occasional "worth a try" to a daily "used in every class."

---

## Problems Solved

| Traditional Pain Points | ClassNode's Answer |
| :--- | :--- |
| **Cumbersome registration, hard to distribute** | **QR code access** — no accounts, no passwords, join in seconds |
| **Invisible process, no insight into learning** | **Real-time sync** — full panorama on teacher dashboard |
| **Internet-dependent, limited by bandwidth** | **LAN-based** — no internet dependency, works when the network goes down |
| **Data vanishes, nothing left for review** | **Local storage** — complete history, one-click Word export for reports |

---

## Features

- **Unified AI Agent Management** — Supports Coze, Zhipu AI, and OpenAI-compatible APIs; built-in automatic connectivity health checks
- **Multi-Dimension Teaching Modes** — Switch between Standard (individual chat), Group (collaborative inquiry), and Advanced (differentiated instruction)
- **Panoramic Dashboard** — God's-eye view of the entire class in real time; dynamic word clouds and leaderboards make learning visible at a glance
- **Intelligent Content Filtering** — 100+ built-in blocked words, custom rules, and auto-lock on violation for a safe classroom environment
- **Full Data Lifecycle** — Covers the complete loop from lesson prep to interaction to review; one-click Word report export and seamless cross-device migration

---

## Quick Start

### Install from Package (Recommended)

Download the installer for your platform from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases). Double-click to install:

| Platform | Package |
|------|--------|
| macOS Apple Silicon | `ClassNode_x.x.x_macos_apple-silicon.dmg` |
| macOS Intel | `ClassNode_x.x.x_macos_intel.dmg` |
| Windows (64-bit) | `ClassNode_x.x.x_x64-setup.exe` |
| Windows (32-bit) | [Go to Release page](https://gitcode.com/weixin_41523975/classnode/releases) |
| Linux / UOS | AppImage / deb (community packaging in progress) |

### Deploy from Source

**Install Node.js**

Download and install Node.js 18+ from the [official website](https://nodejs.org). Using nvm is recommended:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload shell config
source ~/.bashrc

# Install the latest LTS version
nvm install --lts
```

**Deploy ClassNode**

Download the **Source code** archive from the [Release page](https://gitcode.com/weixin_41523975/classnode/releases), extract it, then run the startup script for your system:

| System | Script |
|------|--------|
| macOS | `start-classnode-mac.command` |
| Windows | `start-classnode-win.bat` |
| Linux | `bash start-classnode-linux.sh` |

The first run will automatically install dependencies and build (about 1-5 minutes, requires internet). Subsequent starts will be much faster.

Access after startup:

- Teacher Console: `http://localhost:3001/teacher`
- Student Portal: `http://localhost:3001/classroom`

> For student devices on the same LAN, replace `localhost` with the teacher's LAN IP address.

### Desktop App Build

```bash
npm run dev              # Development mode
npm run build:mac:arm64  # macOS Apple Silicon
npm run build:mac:intel  # macOS Intel
```

---

## Changelog

<details>
<summary>v1.3.4 — 2026-06-06 (Latest)</summary>

#### About Page Redesign
- Added developer story section ("The Origin" letter-paper design) telling the story behind ClassNode
- Added tech foundation quad-grid highlighting lightweight deployment, local data, LAN-based design
- Redesigned hero area with cleaner layout for logo, name, version, and changelog button
- Improved typography and spacing for better visual quality

#### Guide Page UI Optimization
- Sidebar entries split into two-line display — bold main title + smaller subtitle
- Increased font size and refined spacing details
</details>

<details>
<summary>v1.3.3 — 2026-06-06</summary>

#### QR Code Download with Logo
- Added QR code image download to the classroom projection screen, with ClassNode logo embedded in the center

#### Windows Installer Language
- Added Simplified Chinese support for Windows NSIS installer; auto-detects Chinese system language
</details>

<details>
<summary>v1.3.1 — 2026-06-05</summary>

#### QR Code for Classroom Access
- Teachers can now display a QR code + URL + 4-digit room code from the classroom screen
- Students scan the QR code with their phone or tablet to auto-join, no manual code entry needed
- Added "Show Room Code" button to classroom cards on the dashboard homepage

#### Optimization
- Enlarged the projection screen for better visibility on large classroom displays
</details>

<details>
<summary>v1.2.4 — 2026-06-05</summary>

#### Dashboard Redesign
- Migrated to recharts library, replacing custom SVG charts with BarChart / PieChart
- Added KPI row at the top (agents / classes / students / active classrooms / total interactions)
- Four-quadrant layout: AI Agents, Class Management, Classroom Management, Data Management

#### System Block Words — Individual Deletion
- Each blocked word now shows a delete button when expanded by category
- "Reset to Default" restores all deleted built-in words with one click
</details>

<details>
<summary>v1.2.3 — 2026-06-05</summary>

#### Agent Connectivity Auto-Check
- Background health-check service that periodically tests all enabled agents' API connectivity
- Supports manual test per agent and "Check All" batch testing

#### Block Words Upgrade
- 100+ preset blocked words across 4 categories: profanity, adult content, violence, self-harm
- Auto-populated on first startup

#### Classroom Management Enhancement
- Dashboard now shows mode labels (Standard / Group / Advanced)
- Group mode and Advanced mode display real student member lists

#### Bug Fixes
- Prevented multiple application instances
- Fixed blocked-word violation alerts not pushed to teacher dashboard
- Fixed student block/unblock events not synced to teacher dashboard
</details>

---

## Contact

Xingchang Zhang · Gongshu Education Research Institute, Hangzhou  
[hzzxc2012@163.com](mailto:hzzxc2012@163.com)
