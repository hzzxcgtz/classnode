"use client";
import { useState, useEffect } from "react";

const Highlight = (props: { children: React.ReactNode }) => (
  <span style={{ fontWeight: 600, color: "#2563eb" }}>{props.children}</span>
);

const SectionIcon = ({ name }: { name: string }) => {
  const icons: Record<string, React.ReactNode> = {
    rocket: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
    bot: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
        <path d="M8 4V2" />
        <path d="M16 4V2" />
        <path d="M8 20v2" />
        <path d="M16 20v2" />
      </svg>
    ),
    users: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    classroom: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    "log-in": (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
    ),
    monitor: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    shield: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    history: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    gift: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
      </svg>
    ),
    avatar: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M22 11l-2 2-4-4" />
      </svg>
    ),
  };
  return <>{icons[name] ?? null}</>;
};

const sectionList = [
  { id: "getting-started", mainLabel: "启程", subLabel: "首次见面安全锁" },
  { id: "ai-agents", mainLabel: "接入", subLabel: "配置AI助教团队" },
  { id: "classes", mainLabel: "组局", subLabel: "班级与学生管理" },
  { id: "classroom", mainLabel: "备课", subLabel: "创建与管理课堂" },
  { id: "student-join", mainLabel: "上课", subLabel: "学生端接入互动" },
  { id: "dashboard", mainLabel: "掌控", subLabel: "课堂看板与监控" },
  { id: "avatars", mainLabel: "形象", subLabel: "头像管理与奖励" },
  { id: "shield", mainLabel: "净化", subLabel: "违禁与频率管控" },
  { id: "data", mainLabel: "丰收", subLabel: "数据管理与导出" },
  { id: "backup", mainLabel: "保障", subLabel: "数据备份与恢复" },
];

const sections = [
  {
    id: "getting-started",
    title: "一、启程：首次见面安全锁",
    icon: "rocket",
    items: [
      <>
        <strong>唤醒系统</strong>
        ：双击启动程序，打开浏览器访问教师控制台，开始使用。
      </>,
      <>
        <strong>给您的讲台上一道锁</strong>：首次使用会要求设置管理密码（至少 6
        位）。这里存放着全班的学情数据和 AI 配置，须防止学生误入。
      </>,
      <>
        <strong>修改密码</strong>：在控制台主页找到「
        <Highlight>修改密码</Highlight>」即可更换。若遗忘密码，可在桌面端
        <Highlight>「控制面板」</Highlight>
        窗口中点击「重置管理密码」，登录后请及时修改。
      </>,
    ],
  },
  {
    id: "ai-agents",
    title: "二、接入：配置AI助教团队",
    icon: "bot",
    items: [
      <div>
        想要课堂出彩，先要有好的 AI 帮手。进入「<Highlight>AI 智能体</Highlight>
        」页面，将在 Coze、智谱清言、百度文心等平台创建好的智能体接入 Classroom：
      </div>,
      <>
        <strong>多平台兼容</strong>：目前已支持{" "}
        <Highlight>Coze 低代码</Highlight>、<Highlight>Coze 编程</Highlight>、
        <Highlight>清言智能体</Highlight>（智谱清言）和{" "}
        <Highlight>文心智能体</Highlight>（百度文心）四种平台。
      </>,
      <>
        <strong>配置更直观</strong>：填入平台提供的 API Key / Secret Key
        等信息，可自定义本地名称（如"李白学长"）。Coze 低代码支持一键从 Coze
        拉取头像和开场白。
      </>,
      <div
        style={{
          background: "#f0f7ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          padding: "14px 18px",
          fontSize: "0.875rem",
          color: "#1e40af",
          lineHeight: 1.7,
        }}
      >
        <div
          style={{ fontWeight: 600, fontSize: "0.938rem", marginBottom: 10 }}
        >
          各平台特点速览
        </div>
        <div style={{ width: "100%", fontSize: "0.813rem" }}>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #bfdbfe",
              padding: "6px 0",
              fontWeight: 600,
            }}
          >
            <div style={{ width: 110 }}>智能体类型</div>
            <div style={{ width: 80, textAlign: "center" }}>AI 平台提供</div>
            <div style={{ width: 70, textAlign: "center" }}>流式输出</div>
            <div style={{ width: 70, textAlign: "center" }}>图片附件</div>
            <div style={{ width: 120, textAlign: "center" }}>官方链接</div>
            <div style={{ flex: 1 }}>说明</div>
          </div>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #e2e8f0",
              padding: "6px 0",
            }}
          >
            <div style={{ width: 110, fontWeight: 600, color: "#7c3aed" }}>
              清言智能体
            </div>
            <div style={{ width: 80, textAlign: "center", color: "#64748b" }}>
              智谱
            </div>
            <div
              style={{
                width: 70,
                textAlign: "center",
                color: "#22c55e",
                fontWeight: 600,
              }}
            >
              ✓
            </div>
            <div
              style={{
                width: 70,
                textAlign: "center",
                color: "#22c55e",
                fontWeight: 600,
              }}
            >
              ✓
            </div>
            <div style={{ width: 120, textAlign: "center" }}>
              <a
                href="https://www.chatglm.cn/main/alltoolsdetail?lang=zh"
                target="_blank"
                rel="noopener noreferrer"
                title="前往清言智能体"
                style={{
                  color: "#2563eb",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span style={{ fontSize: "0.75rem" }}>去创作</span>
              </a>
            </div>
            <div style={{ flex: 1, color: "#475569" }}>
              <strong style={{ color: "#7c3aed" }}>推荐使用</strong>
              ，流式与图片均支持，体验完整
            </div>
          </div>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #e2e8f0",
              padding: "6px 0",
            }}
          >
            <div style={{ width: 110, fontWeight: 600, color: "#2563eb" }}>
              Coze 低代码
            </div>
            <div style={{ width: 80, textAlign: "center", color: "#64748b" }}>
              字节
            </div>
            <div
              style={{
                width: 70,
                textAlign: "center",
                color: "#22c55e",
                fontWeight: 600,
              }}
            >
              ✓
            </div>
            <div
              style={{
                width: 70,
                textAlign: "center",
                color: "#22c55e",
                fontWeight: 600,
              }}
            >
              ✓
            </div>
            <div style={{ width: 120, textAlign: "center" }}>
              <a
                href="https://code.coze.cn/home"
                target="_blank"
                rel="noopener noreferrer"
                title="前往 Coze"
                style={{
                  color: "#2563eb",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span style={{ fontSize: "0.75rem" }}>去创作</span>
              </a>
            </div>
            <div style={{ flex: 1, color: "#475569" }}>
              <strong style={{ color: "#2563eb" }}>推荐使用</strong>
              ，流式与图片均支持，两者兼备
            </div>
          </div>
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #e2e8f0",
              padding: "6px 0",
            }}
          >
            <div style={{ width: 110, fontWeight: 600, color: "#10b981" }}>
              Coze 编程
            </div>
            <div style={{ width: 80, textAlign: "center", color: "#64748b" }}>
              字节
            </div>
            <div
              style={{
                width: 70,
                textAlign: "center",
                color: "#22c55e",
                fontWeight: 600,
              }}
            >
              ✓
            </div>
            <div style={{ width: 70 }} />
            <div style={{ width: 120, textAlign: "center" }}>
              <a
                href="https://code.coze.cn/home"
                target="_blank"
                rel="noopener noreferrer"
                title="前往 Coze"
                style={{
                  color: "#2563eb",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span style={{ fontSize: "0.75rem" }}>去创作</span>
              </a>
            </div>
            <div style={{ flex: 1, color: "#475569" }}>
              支持流式输出，仅文本对话
            </div>
          </div>
          <div style={{ display: "flex", padding: "6px 0" }}>
            <div style={{ width: 110, fontWeight: 600, color: "#f97316" }}>
              文心智能体
            </div>
            <div style={{ width: 80, textAlign: "center", color: "#64748b" }}>
              百度
            </div>
            <div style={{ width: 70 }} />
            <div style={{ width: 70 }} />
            <div style={{ width: 120, textAlign: "center" }}>
              <a
                href="https://agents.baidu.com/center"
                target="_blank"
                rel="noopener noreferrer"
                title="前往文心智能体"
                style={{
                  color: "#2563eb",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span style={{ fontSize: "0.75rem" }}>去创作</span>
              </a>
            </div>
            <div style={{ flex: 1, color: "#475569" }}>
              基础可用，非流式纯文本
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: "0.813rem",
            color: "#64748b",
            lineHeight: 1.7,
          }}
        >
          <div>
            <strong style={{ color: "#475569" }}>流式输出</strong>：指 AI
            逐字逐句实时生成回复内容，而非等待全部生成完毕后再一次性呈现。流式体验让对话节奏更自然、响应更及时，学生端感知到的等待时间大幅缩短。不支持流式的平台，学生需等待
            AI 完成整个回复后才会看到内容。
          </div>
          <div style={{ marginTop: 4 }}>
            <strong style={{ color: "#475569" }}>图片附件</strong>
            ：学生可在对话中上传图片供 AI 识别分析。该能力取决于平台 API
            是否开放了图片上传接口，并非平台本身功能缺失，也非本系统能力限制。我们持续关注各平台
            API 更新动态，待接口开放后及时纳入支持。
          </div>
        </div>
      </div>,
      <div>
        <div>
          <strong>连通性检测</strong>：系统启动时自动检测 AI 智能体在线状态。
        </div>
        <div
          style={{
            paddingLeft: 20,
            lineHeight: 2,
            fontSize: "0.938rem",
            color: "#475569",
          }}
        >
          <div>
            • 卡片底部指示灯：
            <span style={{ color: "#22c55e", fontWeight: 600 }}>绿色</span>{" "}
            代表在线，
            <span style={{ color: "#ef4444", fontWeight: 600 }}>红色</span>{" "}
            代表离线。
          </div>
          <div>
            • <strong>实时告警</strong>：课堂上 AI
            连接异常时，左侧导航栏自动弹出通知。
          </div>
          <div>• 也可手动点击智能体的「检测」按钮进行排查。</div>
        </div>
      </div>,
      <>
        <strong>智能体状态</strong>：不使用的 AI
        可随时禁用，创建课堂时列表更清爽。
      </>,
    ],
  },
  {
    id: "classes",
    title: "三、组局：班级与学生管理",
    icon: "users",
    items: [
      <div>
        进入「<Highlight>班级管理</Highlight>」，建好班级后准备迎接学生：
      </div>,
      <div>
        <div>
          <strong>极速导入学生</strong>
        </div>
        <div
          style={{
            paddingLeft: 20,
            lineHeight: 2,
            fontSize: "0.938rem",
            color: "#475569",
          }}
        >
          <div>
            • <strong>慢工出细活</strong>：人数较少时，手动逐个输入姓名即可。
          </div>
          <div>
            • <strong>魔法一键导入</strong>：将 Excel
            学生名单复制粘贴（一行一个姓名），系统自动生成学号，3 秒完成建班。
          </div>
        </div>
      </div>,
      <>
        <strong>灵活分组</strong>
        ：切换到「分组管理」，像框选桌面图标一样拖拽学生进不同小组。点击小组右上角的「全部移除」即可重置。
      </>,
    ],
  },
  {
    id: "classroom",
    title: "四、备课：创建与管理课堂",
    icon: "classroom",
    items: [
      <div>
        在「<Highlight>课堂管理</Highlight>
        」中点击「创建新课堂」，为课堂命名并选择合适的<strong>教学模式</strong>
        ：
      </div>,
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingLeft: 20,
          lineHeight: 1.8,
          fontSize: "0.938rem",
          color: "#475569",
        }}
      >
        <div>
          <span
            style={{
              background: "#eef2ff",
              color: "#2563eb",
              fontWeight: 600,
              fontSize: "0.813rem",
              padding: "2px 10px",
              borderRadius: 4,
              marginRight: 6,
            }}
          >
            标准模式
          </span>
          —— 每人一个独立账号，各自与 AI 对话，适合普适性练习。
        </div>
        <div>
          <span
            style={{
              background: "#f5f3ff",
              color: "#7c3aed",
              fontWeight: 600,
              fontSize: "0.813rem",
              padding: "2px 10px",
              borderRadius: 4,
              marginRight: 6,
            }}
          >
            分组模式
          </span>
          —— 全组共用一个账号，同屏与 AI 讨论，适合协作探究。
        </div>
        <div>
          <span
            style={{
              background: "#fef3c7",
              color: "#d97706",
              fontWeight: 600,
              fontSize: "0.813rem",
              padding: "2px 10px",
              borderRadius: 4,
              marginRight: 6,
            }}
          >
            高级模式
          </span>
          —— 可为不同小组绑定不同的 AI 智能体，真正实现分层教学。
        </div>
      </div>,
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 8,
          padding: "12px 16px",
          fontSize: "0.875rem",
          color: "#92400e",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "#b45309" }}>💡 小贴士</strong>
        ：课堂创建后仅可修改名称，AI 智能体等配置创建时即固定，请提前规划好。
      </div>,
    ],
  },
  {
    id: "student-join",
    title: "五、上课：学生端接入互动",
    icon: "log-in",
    items: [
      <>
        <strong>扫码即入</strong>：大屏点击「投屏发码」，学生扫码或在浏览器输入{" "}
        <Highlight>http://教师机局域网IP:3001/classroom</Highlight> 及 4
        位互动码即可加入。若教师电脑有多个网卡，投屏码界面可选择对应网段的 IP
        地址。
      </>,
      <>
        <strong>认领身份</strong>
        ：输入互动码后，点选自己的姓名或小组进入对话界面。
      </>,
      <>
        <strong>专注学习</strong>：页面顶部展示 AI 开场白。AI
        回复时输入框暂时冻结，防止学生连击导致消息错乱。所有对话实时同步至教师控制台。
      </>,
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 8,
          padding: "12px 16px",
          fontSize: "0.875rem",
          color: "#92400e",
          lineHeight: 1.8,
        }}
      >
        <strong style={{ color: "#b45309" }}>💡 提示：学生机连不上？</strong
        >通常是防火墙拦截了端口 <strong>3001</strong>，在教师电脑上任选一种方式：<br />
        <strong>方式一（放行软件）</strong
        >：打开「Windows 安全中心 → 防火墙和网络保护 →
        允许应用通过防火墙」，勾选 <strong>ClassNode</strong> 或
        <strong>Node.js</strong> 的专用和公用网络（若没有，点「允许其他应用」手动添加）。<br />
        <strong>方式二（开放端口）</strong
        >：在「高级设置 → 入站规则 → 新建规则」，依次选：端口 → TCP
        → 特定本地端口
        <code style={{ color: "#92400e" }}>3001</code> → 允许连接。
      </div>,
    ],
  },
  {
    id: "dashboard",
    title: "六、掌控：课堂看板与监控",
    icon: "monitor",
    items: [
      <div>
        点击进行中的课堂，进入「<Highlight>课堂看板</Highlight>」：
      </div>,
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          lineHeight: 1.8,
          fontSize: "0.938rem",
          color: "#475569",
        }}
      >
        <div>
          <strong>全景监控</strong>
          ：主区域展示全班卡片，在线状态与对话轮次一目了然。卡片滚动显示学生最新问答。
        </div>
        <div>
          <strong>实时学情雷达</strong>
          <div
            style={{
              paddingLeft: 20,
              marginTop: 2,
              lineHeight: 2,
              fontSize: "0.938rem",
              color: "#475569",
            }}
          >
            <div>
              • <strong>高频词云</strong>
              ：抓取学生提问热点词，辅助调整讲课方向。
            </div>
            <div>
              • <strong>活跃榜 Top 10</strong>
              ：展示提问达人与沉默学员，掌握参与度。
            </div>
          </div>
        </div>
        <div>
          <strong>深度查阅与投屏</strong>
          ：点开学生卡片查看完整对话记录，点击「全屏投屏」将精彩问答展示在大屏上供全班观摩。
        </div>
        <div>
          <strong>课堂节奏控制</strong>
          ：讲解时「暂停课堂」冻结所有学生端输入；下课「结束课堂」自动打包数据并回收互动码。
        </div>
        <div>
          <strong>实时消息引导</strong>
          ：工具栏「发通知」可向全班发送引导提示，学生卡片上的「发消息」按钮可单独联系某位学生。消息将在学生端右下角气泡展示，学生可关闭。
        </div>
      </div>,
    ],
  },
  {
    id: "avatars",
    title: "七、形象：头像管理与奖励",
    icon: "avatar",
    items: [
      <div>
        进入「<Highlight>头像管理</Highlight>
        」管理头像库，或在课堂中奖励学生换头像：
      </div>,
      <div>
        <strong>头像库管理</strong>
        ：分为学生头像（男孩/女孩分区）和班级图标。点击「
        <Highlight>随机生成</Highlight>
        」每次生成10男10女，满意的一键导入。学生自定义上传的头像单独展示，教师可管理删除。
      </div>,
      <div>
        <strong>奖励头像</strong>
        ：课堂看板中学生卡片操作栏点击⭐按钮，奖励学生一次换头像权限。学生端实时收到通知，点击姓名旁的⭐即可兑换。
      </div>,
      <div>
        <strong>兑换方式</strong>：学生可从教师头像库选择、粘贴自定义 SVG
        代码或上传图片（JPG/PNG/WebP），每次消耗一次奖励机会，长期有效。
      </div>,
    ],
  },
  {
    id: "shield",
    title: "八、净化：违禁与频率管控",
    icon: "shield",
    items: [
      <div>
        进入「<Highlight>屏蔽管理</Highlight>」，营造绿色课堂环境：
      </div>,
      <>
        <strong>小黑屋机制</strong>：设定警告阈值（如触发 3
        次违禁词），学生屏幕自动锁定黑屏，强制冷静。
      </>,
      <>
        <strong>提问频率控制</strong>
        ：限制每位学生每分钟的提问次数，防止刷屏干扰，被拦截的违禁内容不计入次数。
      </>,
      <>
        <strong>违禁词库</strong>
        ：系统内置多类屏蔽词库，在学生发送消息时自动拦截。系统词和自定义词可分别一键开启或禁用。
      </>,
      <>
        <strong>自定义规则</strong>：可自由添加自定义屏蔽词，灵活管控课堂言论。
      </>,
      <div>
        切换至「<Highlight>拦截记录</Highlight>
        」标签，可查看学生触发屏蔽词的完整记录：
      </div>,
      <>
        <strong>详情追溯</strong>
        ：按课堂汇总拦截次数，每条记录包含学生姓名、触发时间、原文内容，匹配的屏蔽词自动高亮标记。
      </>,
      <>
        <strong>记录管理</strong>
        ：支持单条删除和课堂级一键清空。拦截记录与学生对话数据独立，删除不影响聊天历史。
      </>,
    ],
  },
  {
    id: "data",
    title: "九、丰收：数据管理与导出",
    icon: "history",
    items: [
      <div>
        前往「<Highlight>仪表盘</Highlight>
        」查看系统运行全景概览：总课堂数、总参与人次、总交互轮数、平均时长——这些数据是
        AI 教学成效的最佳证明。
      </div>,
      <div>
        前往「<Highlight>数据管理</Highlight>」查看历史课堂记录，一键生成 Word
        报告：
      </div>,
      <div
        style={{
          paddingLeft: 20,
          lineHeight: 2,
          fontSize: "0.938rem",
          color: "#475569",
        }}
      >
        <div>
          • <strong>导出对话</strong>：全班聊天实录一键导出，复盘学生思维走向。
        </div>
        <div>
          • <strong>导出报表</strong>
          ：自动生成学情统计文档，适合教学案例、课题研究等场景。
        </div>
      </div>,
    ],
  },
  {
    id: "backup",
    title: "十、保障：数据备份与恢复",
    icon: "gift",
    items: [
      <div>
        在「<Highlight>数据管理</Highlight>」底部，我们为您准备了数据保障功能：
      </div>,
      <>
        <strong>一键备份</strong>
        ：点击「立即备份」，系统自动打包数据库和所有附件文件。
      </>,
      <>
        <strong>历史管理</strong>
        ：每次备份记录在列表中，可随时下载或恢复到任意历史版本。
      </>,
      <>
        <strong>跨设备迁移</strong>：A 电脑下载备份文件 → B 电脑上传备份 →
        恢复，完整迁移所有数据。
      </>,
      <>
        <strong>学期重置</strong>
        ：新学期开始？输入"确认清零"清空旧业务数据（保留密码），轻装迎接新生。
      </>,
    ],
  },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            margin: "0 0 6px",
            color: "#0f172a",
          }}
        >
          使用指南
        </h1>
        <p
          style={{
            fontSize: "0.938rem",
            color: "#64748b",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          欢迎来到
          ClassNode！这份指南将像一位贴心的助教，陪您走完从"系统开机"到"打磨出一堂完美
          AI 课"的全过程。
        </p>
      </div>

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
        {/* 左侧目录 */}
        <div
          style={{
            position: "sticky",
            top: 24,
            width: 210,
            flexShrink: 0,
            background: "linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)",
            borderRadius: 14,
            border: "1px solid #e8ecf0",
            padding: 0,
            overflow: "hidden",
            boxShadow:
              "0 4px 20px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
            maxHeight: "calc(100vh - 80px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 头部 */}
          <div
            style={{
              padding: "16px 20px 12px",
              borderBottom: "1px solid #f1f4f7",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#64748b"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
              <span
                style={{
                  fontSize: "0.813rem",
                  fontWeight: 600,
                  color: "#475569",
                  letterSpacing: 1,
                }}
              >
                目 录
              </span>
              <span
                style={{
                  fontSize: "0.625rem",
                  color: "#94a3b8",
                  fontWeight: 500,
                  marginLeft: "auto",
                  background: "#f1f4f7",
                  padding: "1px 7px",
                  borderRadius: 6,
                }}
              >
                {sectionList.length}
              </span>
            </div>
          </div>

          {/* 列表 */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "4px 0",
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {sectionList.map((item, idx) => {
              const isActive = activeSection === item.id;
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById(item.id)
                      ?.scrollIntoView({ behavior: "smooth" });
                    setActiveSection(item.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 16px 8px 16px",
                    textDecoration: "none",
                    transition: "all 0.18s",
                    position: "relative",
                    background: isActive
                      ? "linear-gradient(90deg, #eff6ff 0%, #ffffff 100%)"
                      : "transparent",
                    borderLeft: `3px solid ${isActive ? "#3b82f6" : "transparent"}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "#f8fafc";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* 编号 */}
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.625rem",
                      fontWeight: 700,
                      background: isActive ? "#3b82f6" : "#f1f4f9",
                      color: isActive ? "#ffffff" : "#94a3b8",
                      transition: "all 0.18s",
                    }}
                  >
                    {idx + 1}
                  </div>

                  {/* 两行标题 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.875rem",
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? "#1e3a5f" : "#334155",
                        lineHeight: 1.4,
                      }}
                    >
                      {item.mainLabel}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 400,
                        color: isActive ? "#64748b" : "#94a3b8",
                        lineHeight: 1.3,
                        marginTop: 1,
                      }}
                    >
                      {item.subLabel}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* 右侧内容 */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {sections.map((section, si) => {
            const sectionColors = [
              { icon: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
              { icon: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
              { icon: "#059669", bg: "#ecfdf5", border: "#a7f3d0" },
              { icon: "#d97706", bg: "#fffbeb", border: "#fde68a" },
              { icon: "#0284c7", bg: "#f0f9ff", border: "#bae6fd" },
              { icon: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
              { icon: "#7c3aed", bg: "#faf5ff", border: "#e9d5ff" },
              { icon: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
              { icon: "#ca8a04", bg: "#fefce8", border: "#fef08a" },
            ];
            const sc = sectionColors[si] || sectionColors[0];
            return (
              <div
                key={section.id}
                id={section.id}
                style={{
                  background: "white",
                  borderRadius: 14,
                  border: "1px solid #eef2f6",
                  overflow: "hidden",
                  boxShadow:
                    "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)",
                  scrollMarginTop: 80,
                  transition: "box-shadow 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 4px 20px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow =
                    "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.02)";
                }}
              >
                {/* 标题栏 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "16px 24px",
                    borderBottom: "1px solid #f1f5f9",
                    background: sc.bg,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: sc.icon + "18",
                      color: sc.icon,
                    }}
                  >
                    <SectionIcon name={section.icon} />
                  </span>
                  <h2
                    style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      margin: 0,
                      color: "#0f172a",
                    }}
                  >
                    {section.title}
                  </h2>
                </div>

                {/* 内容 */}
                <div
                  style={{
                    padding: "20px 24px",
                    fontSize: "0.938rem",
                    color: "#334155",
                    lineHeight: 1.8,
                  }}
                >
                  {section.items.map((item, j) => (
                    <div
                      key={j}
                      style={{
                        marginBottom: j < section.items.length - 1 ? 14 : 0,
                        padding:
                          typeof item === "object" &&
                          (item as any).props?.style?.padding
                            ? undefined
                            : "2px 0",
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
