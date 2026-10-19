"use client";

import { useEffect, useState } from "react";
import styles from "./guide.module.css";

/**
 * 使用指南（2026-10-18 按 2.1.1 核对学习单、开放控制、评价与备份）。
 *
 * 🔴 **这一页的每一条界面文案都是从代码里逐字核过的**，不凭印象。理由：指南写错一个字，
 *    教师就会在界面上找一个不存在的按钮 —— 而他会以为是自己的版本不对，不是指南错了。
 *    本页第二轮改版时抓到 5 处与实现不符（写在下面 `README` 里），全是被时间甩下的旧文案。
 *
 * ── 改版记录（2026-10-09）────────────────────────────────────────────────
 *
 * **2.0 起课堂由三个学习模块组成**（`server/changelogs/v2.0.0.md`）：学习单 / 探究空间 / 智能学伴。
 * 旧指南（1.X 时代）只讲「学生和 AI 对话」，三件套一条都没有 ⇒ 本轮新增两整章
 * （`worksheet` / `webapp`），并重写了 `overview` / `create` / `live` / `review`。
 *
 * **本轮修掉的 5 处错误**（改版前逐条核过，都已在下面改对）：
 *   ① 管理密码写「至少 8 位」—— 实际**不限长度、但非空**（`teacher/layout.tsx:276-281`）。
 *   ② 「导出报表」—— **界面上没有这个按钮**；真实按钮是 `导出学习单与探究空间`
 *      （`history/page.tsx:406`）。
 *   ③ 「屏蔽管理」—— 侧栏叫 `安全管理`，页标题为 `智能学伴安全`（`teacher/layout.tsx:38`）。
 *   ④ 数据管理页「查看详情」—— **没有这个入口**，只有 `导出对话` / `导出学习单与探究空间` / `恢复`。
 *   ⑤ 平台能力表里**文心的「流式输出」标成了支持** —— 实际文心带 `非流式` 标签
 *      （`agents/agent-card.tsx:106`：`agent.platform === 'wenxin' && <CapabilityTag>非流式</CapabilityTag>`）。
 *      其余 19 格逐条对过源码（`ai-proxy.ts` 的四个平台分支 + `coze-bot/chat.ts` 的 `follow_up`），无误。
 *
 * ★ 2026-10-09：**22 张界面示例已全部就位**（`public/images/guide/<id>.png`），
 *   原先那套「占位卡片 + 待补清单 + 截什么/别出现什么」的脚手架随之删除。
 *   示例图**不可点击放大**（理由写在 `Screenshot` 上）。
 */

type GuideSectionId =
  | "overview"
  | "setup"
  | "ai-agents"
  | "roster"
  | "worksheet"
  | "webapp"
  | "create"
  | "join"
  | "live"
  | "review"
  | "manage";

/**
 * 所有截图的**唯一真源**：正文里就地渲染，**没有第二份清单**。
 *
 * 🔴 图片路径**由 id 推**（`/images/guide/<id>.png`），不在这里手写 —— 手写的那份必然会与
 *    文件名分叉，而 `<img>` 指错文件是**静默**的（只出现一个破图图标）。
 *    `guide-structure.test.ts` 双向钉着：每个 id 必须有对应文件、每个文件必须有对应 id。
 *
 * ★ 2026-10-09：本表原先还带 `instruction` / `avoid`（「截什么」「别出现什么」）与一份
 *   「待补截图清单」。22 张截齐之后那些全是死脚手架，连同占位卡片那条分支一起删了。
 */
const SHOTS = {
  "agent-form": { title: "接入 / 编辑智能体弹窗", where: "AI智能体 → 接入智能体", width: 1710, height: 1390 },
  "agent-list": { title: "智能体列表与用途分档", where: "AI智能体", width: 2880, height: 988 },
  "class-roster": { title: "班级管理 · 学生列表", where: "班级管理 → 学生列表", width: 2882, height: 1538 },
  "dashboard": { title: "仪表盘", where: "仪表盘", width: 2906, height: 1772 },
  "worksheet-list": { title: "学习单列表", where: "学习单", width: 2896, height: 1220 },
  "worksheet-editor": { title: "学习单编辑器 · 表达题", where: "学习单 → 编辑", current: true, width: 1274, height: 1302 },
  "worksheet-types": { title: "添加任务：作答形式选择", where: "学习单 → 编辑 → 添加任务", current: true, width: 560, height: 508 },
  "worksheet-drawing": { title: "绘图题设置", where: "学习单 → 编辑 → 一道绘图题", width: 2200, height: 1490 },
  "worksheet-settings": { title: "学习单设置 · 年级学科与作答规则", where: "学习单 → 编辑 → 设置", current: true, width: 640, height: 634 },
  "worksheet-reward": { title: "学习单设置 · 学生奖励", where: "学习单 → 编辑 → 设置", width: 1164, height: 1018 },
  "worksheet-ai": { title: "评价依据、AI 评分与学生自主评价", where: "学习单 → 编辑 → 一道表达题或绘图题", current: true, width: 1274, height: 1594 },
  "worksheet-collection": { title: "无标准答案的信息收集", where: "学习单 → 编辑 → 客观题 → 作答用途", current: true, width: 1274, height: 1027 },
  "worksheet-release": { title: "开放进度浮窗", where: "课堂看板右侧 → 开放进度", current: true, width: 1274, height: 781 },
  "analysis-clear": { title: "清除 AI 评分或班级分析", where: "按任务查看 → AI 分析 → 清除数据", current: true, width: 1274, height: 890 },
  "webapp-list": { title: "探究空间 · 网页库", where: "探究空间", width: 2888, height: 970 },
  "webapp-form": { title: "添加探究网页", where: "探究空间 → 添加网页", width: 1228, height: 874 },
  "create-classroom": { title: "创建新课堂", where: "课堂管理 → 创建新课堂", width: 1568, height: 1808 },
  "student-join": { title: "学生加入与选择身份", where: "学生端", width: 662, height: 1052 },
  "student-home": { title: "学生端首页：三个学习模块", where: "学生端", width: 2480, height: 1080 },
  "live-board": { title: "课堂看板全景", where: "课堂管理 → 进入课堂", width: 2900, height: 1560 },
  "live-modules": { title: "学习模块：开放 / 暂停 / 隐藏", where: "课堂看板 → 学习模块", width: 628, height: 640 },
  "live-worksheet": { title: "看板上的学习单：作答情况", where: "课堂看板 → 学习单 → 学习单矩阵", width: 1010, height: 1644 },
  "live-analysis": { title: "AI 分析结果与补评操作", where: "课堂看板 → 学习单 → 按任务查看 → 某项任务的 AI 分析", current: true, width: 1274, height: 890 },
  "history": { title: "数据管理 · 历史课堂与导出", where: "数据管理", width: 2892, height: 1584 },
  "shield": { title: "智能学伴安全", where: "安全管理", width: 2890, height: 1268 },
} as const;

/** 图片路径由 id 推得 —— 全仓只此一处拼这个路径。 */
const shotSrc = (id: keyof typeof SHOTS) => `/images/guide/${id}.png`;

type ShotId = keyof typeof SHOTS;

const sections: Array<{ id: GuideSectionId; label: string; desc: string; tag?: string }> = [
  { id: "overview", label: "先看这里", desc: "课堂的三个学习模块" },
  { id: "setup", label: "首次设置", desc: "密码与网络准备" },
  { id: "ai-agents", label: "接入 AI 智能体", desc: "学伴型与分析型" },
  { id: "roster", label: "准备班级", desc: "名单与分组" },
  { id: "worksheet", label: "制作学习单", desc: "作答形式、开放作答与评价" },
  { id: "webapp", label: "准备探究空间", desc: "上传交互网页" },
  { id: "create", label: "创建课堂", desc: "模式与学习模块" },
  { id: "join", label: "学生加入", desc: "互动码与身份" },
  { id: "live", label: "课堂进行中", desc: "开放学习模块与控制" },
  { id: "review", label: "分析与复盘", desc: "AI 分析与导出" },
  { id: "manage", label: "日常管理", desc: "安全、头像与备份" },
];

type IconName =
  | "route" | "lock" | "bot" | "users" | "book" | "phone" | "monitor" | "chart"
  | "settings" | "check" | "arrow" | "clipboard" | "compass" | "gauge" | "spark";

function Icon({ name }: { name: IconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    route: <><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M8.6 17.5 15.4 6.5"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    bot: <><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M9 10h.01M15 10h.01M8 15h8M12 5V2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h4"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></>,
    gauge: <><path d="M12 20a8 8 0 1 1 8-8"/><path d="m12 12 4-3"/></>,
    spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name]}</svg>;
}

function SectionHeading({ icon, eyebrow, title, intro }: { icon: IconName; eyebrow: string; title: string; intro: string }) {
  return (
    <div className={styles.sectionHeading}>
      <span className={styles.sectionIcon}><Icon name={icon} /></span>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
    </div>
  );
}

function Steps({ items }: { items: Array<{ title: string; text: React.ReactNode }> }) {
  return (
    <ol className={styles.steps}>
      {items.map((item, index) => (
        <li key={item.title}>
          <span className={styles.stepNumber}>{index + 1}</span>
          <div><strong>{item.title}</strong><p>{item.text}</p></div>
        </li>
      ))}
    </ol>
  );
}

function Note({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "amber" | "green" }) {
  return <div className={`${styles.note} ${styles[`note${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>{children}</div>;
}

/** 界面小字。**只用来标真实的界面文案**，不用来强调语气（强调用 `<strong>`）。 */
function Ui({ children }: { children: React.ReactNode }) {
  return <code className={styles.uiText}>{children}</code>;
}

const platformCapabilities = [
  {
    name: "Coze 低代码",
    provider: "字节扣子",
    tone: "blue",
    recommended: true,
    capabilities: [true, true, true, true, true],
    url: "https://www.coze.cn/",
    summary: "能力覆盖最完整，也是本版**唯一能做学习单 AI 分析**的平台。",
  },
  {
    name: "Coze 编程",
    provider: "字节扣子",
    tone: "green",
    recommended: false,
    capabilities: [true, true, false, false, false],
    url: "https://www.coze.cn/",
    summary: "发布和接入较直接，适合以文字对话为主的轻量课堂应用。",
  },
  {
    name: "清言智能体",
    provider: "智谱清言",
    tone: "purple",
    recommended: false,
    capabilities: [true, true, true, true, false],
    url: "https://chatglm.cn/",
    summary: "文字、图片与追问能力较均衡，适合连续探究和多模态任务。",
  },
  {
    name: "文心智能体",
    provider: "百度文心",
    tone: "orange",
    recommended: false,
    // ⚠️ 只有 5 格都照源码核过才敢这么写：文心在卡片上带 `纯文字` 与 `非流式` 两个标签
    //    （`agents/agent-card.tsx:105-106`）⇒ 图片、流式、追问、深度思考全不支持。
    capabilities: [true, false, false, false, false],
    url: "https://agents.baidu.com/center",
    summary: "满足日常文字问答，适合已经在文心平台建设智能体的教师。回答需等待完整回复。",
  },
] as const;

function PlatformComparison() {
  const capabilityNames = ["基础问答", "流式输出", "图片理解", "追问建议", "深度思考"];

  return (
    <div className={styles.platformComparison}>
      <div className={styles.comparisonHeading}>
        <div>
          <span>选型参考</span>
          <h3>四种平台，怎么选？</h3>
          <p>先看课堂需要哪些能力，再选择你熟悉的平台。功能会随平台接口调整，以实际的连通性检测结果为准。</p>
        </div>
        <div className={styles.comparisonLegend}><i>✓</i> 当前支持 <span>—</span> 暂不支持</div>
      </div>

      <div className={styles.comparisonTableWrap}>
        <table className={styles.comparisonTable}>
          <thead>
            <tr>
              <th>智能体类型</th>
              <th>平台提供</th>
              {capabilityNames.map(name => <th key={name}>{name}</th>)}
              <th>适合的使用场景</th>
              <th><span className={styles.visuallyHidden}>官方平台</span></th>
            </tr>
          </thead>
          <tbody>
            {platformCapabilities.map(platform => (
              <tr key={platform.name}>
                <td>
                  <strong className={styles[`platform${platform.tone[0].toUpperCase()}${platform.tone.slice(1)}`]}>{platform.name}</strong>
                  {platform.recommended && <span className={styles.recommendedBadge}>推荐</span>}
                </td>
                <td>{platform.provider}</td>
                {platform.capabilities.map((supported, index) => (
                  <td key={capabilityNames[index]} className={supported ? styles.supported : styles.unsupported} aria-label={`${capabilityNames[index]}：${supported ? "支持" : "暂不支持"}`}>
                    {supported ? "✓" : "—"}
                  </td>
                ))}
                <td>{platform.summary}</td>
                <td><a href={platform.url} target="_blank" rel="noopener noreferrer">去创作 <span aria-hidden="true">↗</span></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.capabilityNotes}>
        <div><strong>流式输出</strong><span>回答边生成边显示，学生等待感更短。</span></div>
        <div><strong>图片理解</strong><span>学生可上传图片，请 AI 识别、分析或反馈。</span></div>
        <div><strong>追问建议</strong><span>回答后提供可点击的问题，引导学生继续探究。</span></div>
        <div><strong>深度思考</strong><span>展示较长任务的思考状态，适合复杂问题。</span></div>
      </div>
    </div>
  );
}

/**
 * 一张界面示例。**不可点击放大**（2026-10-09 教师裁定）。
 *
 * 🔴 为什么不做放大：**指南就在应用里** —— 它展示的每一屏在同一个控制台里点一下就到自己
 *    眼前，而且是活的。放大一张冻结的 PNG 严格劣于直接走过去看。
 *    加上整窗截图在版心里本就读不出字（实测有效字号 8.6～10.5px），
 *    图的作用是「让你认出是哪个界面」，**定位**靠下面那行「在哪儿」，信息由正文承载。
 *    ⇒ 所以这里既不包 `<a>`，也不留任何「看起来能点」的暗示：样式表里那两条与点击有关的
 *      规则（hover 放大、原图提示）一并删了，别造一个点了没反应的壳。
 */
function Screenshot({ id }: { id: ShotId }) {
  const shot = SHOTS[id];
  return (
    <figure className={styles.screenshot}>
      <figcaption>
        <span>{"current" in shot ? "2.1.1 界面示例 · 模拟数据" : "界面示例"}</span>
        <strong>{shot.title}</strong>
      </figcaption>
      {/* 截图按需加载，避免打开指南时一次请求所有图片。 */}
      <div className={styles.screenshotPreview}>
        <img src={shotSrc(id)} alt={shot.title} width={shot.width} height={shot.height} loading="lazy" />
      </div>
      <p className={styles.screenshotWhere}><b>在哪儿：</b>{shot.where}</p>
    </figure>
  );
}

function GuideSection({ id, children }: { id: GuideSectionId; children: React.ReactNode }) {
  return <section id={id} className={styles.section}>{children}</section>;
}

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState<GuideSectionId>(() => {
    if (typeof window === "undefined") return "overview";
    const hash = window.location.hash.slice(1) as GuideSectionId;
    return sections.some(section => section.id === hash) ? hash : "overview";
  });

  useEffect(() => {
    const hash = window.location.hash.slice(1) as GuideSectionId;
    if (sections.some(section => section.id === hash)) {
      window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (visible) setActiveSection(visible.target.id as GuideSectionId);
    }, { rootMargin: "-90px 0px -65% 0px" });
    sections.forEach(section => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  const goTo = (id: GuideSectionId) => {
    setActiveSection(id);
    history.replaceState(null, "", `#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>CLASSNODE 使用指南 · 适用 2.1.1</span>
          <h1>从第一次打开，到完成一堂 AI 互动课</h1>
          <p>
            一堂课由三个学习模块组成：<strong>学习单</strong>学习任务、<strong>探究空间</strong>动手体验、
            <strong>智能学伴</strong>对话思考。这份指南按真实使用顺序编排 —— 第一次顺着读，熟悉之后从左侧目录直接查。
          </p>
        </div>
        <div className={styles.heroPromise}>
          <strong>建议先走通一条最小路径</strong>
          <span>接入 1 个智能体 · 建立 1 个班级 · 做 1 份学习单 · 开 1 堂测试课</span>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="使用指南目录">
          <div className={styles.sidebarTitle}>上手路线 <span>{sections.length}</span></div>
          <nav>
            {sections.map((section, index) => (
              <button key={section.id} type="button" onClick={() => goTo(section.id)} className={activeSection === section.id ? styles.navActive : ""}>
                <span>{index + 1}</span>
                <div>
                  <strong>{section.label}{section.tag && <em className={styles.navTag}>新</em>}</strong>
                  <small>{section.desc}</small>
                </div>
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.content}>
          <GuideSection id="overview">
            <SectionHeading
              icon="route"
              eyebrow="先建立全局认识"
              title="一堂课，由三个学习模块组成"
              intro="教师可以组合学习单、探究空间和智能学伴，并在同一块看板上决定各模块什么时候开放，观察学生作答与互动。"
            />
            <div className={styles.modeGrid}>
              <div><span>学习任务</span><strong>学习单</strong><p>围绕主题设计学习任务，学生逐项作答、逐项提交。教师在教室大屏上看到的不再只是「谁交了」，而是每个人此刻正在写什么。</p></div>
              <div><span>动手体验</span><strong>探究空间</strong><p>学生打开你上传的交互网页，在沙箱里动手操作，不用离开课堂去访问外网。教师能看到每台设备正停在哪一步。</p></div>
              <div><span>对话思考</span><strong>智能学伴</strong><p>学生与 AI 一对一对话，教师可通过对话分析了解交流情况。</p></div>
            </div>
            <div className={styles.journey}>
              {[
                ["接入", "连接已有的 AI 智能体"],
                ["建班", "导入学生并按需分组"],
                ["备课", "做学习单、传探究网页"],
                ["开课", "选模式与学习模块，发码"],
                ["引导", "开放学习模块、观察、介入"],
                ["复盘", "AI 分析与导出记录"],
              ].map(([title, text], index) => (
                <div key={title} className={styles.journeyItem}>
                  <span>{index + 1}</span><strong>{title}</strong><small>{text}</small>
                  {index < 5 && <i><Icon name="arrow" /></i>}
                </div>
              ))}
            </div>
            <Note tone="green">
              <strong>学习模块不必都配。</strong>创建课堂时，<Ui>AI 智能体</Ui>、<Ui>探究网页</Ui>、<Ui>学习单</Ui> 任选其一即可开课 ——
              只挂一份学习单也能发起课堂。第一次体验建议用 2—3 名测试学生、标准模式，确认三个学习模块都正常再用于正式班级。
            </Note>
          </GuideSection>

          <GuideSection id="setup">
            <SectionHeading icon="lock" eyebrow="步骤 1" title="首次设置：先把教师控制台保护好" intro="教师端保存着学生名单、课堂记录和智能体凭据。第一次打开时，先完成管理密码与网络检查。" />
            <Steps items={[
              { title: "设置管理密码", text: <>首次进入教师端时设置管理密码。它只用于保护本机控制台，请不要与学生分享。</> },
              { title: "确认学生访问方式", text: <>学生设备需要和教师电脑处在同一局域网。课堂开始前，在「课堂管理」页确认顶部显示 <Ui>局域网访问已开放</Ui>；需要临时断开时点它即可切换。</> },
              { title: "记住恢复入口", text: <>忘记密码时，可在桌面端控制面板重置。重置后应立即登录并修改为自己的密码。</> },
              { title: "留意新版本提醒", text: <>服务启动时会自动检查更新，有新版本时侧栏「关于」图标上会出现小红点。升级前建议先备份。</> },
            ]} />
            <Note tone="amber"><strong>课堂前 3 分钟检查：</strong>教师电脑能访问 AI 平台、学生设备能打开学生端、投屏设备能看清互动码。三样都确认过，再开始正式课堂。</Note>
          </GuideSection>

          <GuideSection id="ai-agents">
            <SectionHeading icon="bot" eyebrow="步骤 2" title="接入 AI 智能体：学伴给学生，分析给教师" intro="支点课堂不替你创作智能体，而是把各平台上已经做好的智能体安全、可控地接进真实课堂。" />
            <Steps items={[
              { title: "选择平台", text: <>在「AI智能体」点 <Ui>接入智能体</Ui>，先选平台。不同平台需要的凭据不同，表单会跟着切换。</> },
              { title: "填写接入凭据", text: <>按表单填写 Bot ID、访问令牌、App ID 等。密钥加密保存在教师电脑上，不需要也不应该告诉任何人。</> },
              {
                title: "选择用途（关键的一步）",
                text: (
                  <>
                    表单里有一条横贯整行的 <Ui>用途</Ui>，两枚胶囊：<Ui>学伴</Ui> 与 <Ui>分析</Ui>。
                    <br />· <Ui>学伴</Ui> —— 学生可以选它聊天，出现在课堂的「智能学伴」里。
                    <br />· <Ui>分析</Ui> —— 不作为聊天学伴，用于班级作答分析和学生提交作品后的个人评价，<strong>不会出现在学生的学伴列表里</strong>。
                    <br />选错了不会报错，只会表现为「新建课堂的下拉里少一个」或「学习单里选不到分析智能体」。
                  </>
                ),
              },
              { title: "补充展示资料", text: <>填写学生在课堂中看到的名称、头像和开场白。Coze 低代码可以在凭据完整后点 <Ui>从 Coze 获取资料</Ui> 自动拉取，再由你确认或修改。</> },
              { title: "保存并检测", text: <>保存后执行连通性检测。只有显示「连接健康」的智能体，才建议用于正式课堂。</> },
            ]} />
            <div className={styles.capabilityGrid}>
              {[
                ["卡片上的小字", "学伴型卡片标题旁是一枚青色的「学」，分析型是紫色的「析」。"],
                ["关联对象不同", "学伴型显示「关联课堂 / 未关联课堂」；分析型显示「关联学习单」。"],
                ["底部说明不同", "学伴型写「可在课堂配置中选用」；分析型不作为聊天学伴；启用学生自主评价后，由系统调用它评价作品。"],
                ["筛选下拉", "工具条上的用途筛选叫「学习类 / 分析类」—— 与胶囊的「学伴 / 分析」是同一件事的两种叫法。"],
                ["只有学伴能进课堂", "新建课堂的智能体下拉只列学伴型。"],
                ["分析型只能在学习单里用", "入口在学习单编辑器 → 设置 → 分析智能体。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>
            <Note>
              <strong>分析智能体先配置提示词，再关联学习单。</strong>进入 <a href="/teacher/agents/templates/">作答分析提示词模板库</a>，按小学或初中、学科选择模板，点 <Ui>一键复制完整提示词</Ui>，粘贴到外部 Coze 分析智能体的系统提示词中并保存发布，再回到支点课堂接入。
              平时通过学习单的参考作答、评价标准和当前任务分析重点说明具体要求，无需逐项修改模板。模板更新后仍需手动复制到外部平台，系统不会自动替换已有配置。
            </Note>
            <PlatformComparison />
            <Note tone="amber">
              <strong>做学习单 AI 分析，必须用 Coze 平台的分析型智能体。</strong>
              本系统当前仅支持用 Coze 分析型智能体接收学习单分析材料，包括文字、手写、绘图与照片；其他平台支持图片聊天，不代表可以用于这条分析流程。
              用别的平台配了分析智能体，点分析时会明确告诉你去换一个，不会外发。
            </Note>
            <Note>
              <strong>扣子访问令牌可以集中管理。</strong>点页头的 <Ui>扣子访问令牌</Ui> 统一维护令牌与有效期。
              填了有效期，到期前系统会提醒你 —— 令牌过期后智能体会连不上，而学生看到的只是「没有回复」。
            </Note>
            <Screenshot id="agent-form" />
            <Screenshot id="agent-list" />
          </GuideSection>

          <GuideSection id="roster">
            <SectionHeading icon="users" eyebrow="步骤 3" title="准备班级：名单、学号与分组" intro="班级是长期基础数据。一次整理好，之后创建不同主题的课堂都能直接复用。" />
            <Steps items={[
              { title: "创建班级", text: <>在「班级管理」点 <Ui>创建班级</Ui>，填写名称并选一个班级图标。</> },
              { title: "导入学生", text: <>人数少时用 <Ui>逐个添加</Ui>；已有名单时用 <Ui>粘贴名单</Ui> —— 每行一个姓名，可附带性别（如 <Ui>张三 男</Ui>），粘贴后会先预览「共识别 N 名学生」再确认。</> },
              { title: "检查重名", text: <>开课前检查重名学生，用学号区分。学号不填会自动生成，学生认领身份时按学号顺序显示。</> },
              { title: "建好分组（分组 / 高级模式必需）", text: <>切到「分组管理」页签，输入组名回车添加，再把学生从「未分配学生」拖进组里。分组模式与高级模式都要求班级已经分好组，否则新建课堂时这个班级会被禁用。</> },
            ]} />
            <Note><strong>分组可以在课堂进行中同步。</strong>课堂开始后如果班级名单或分组有变，看板上的 <Ui>同步分组</Ui> 会把最新的分组名称和成员推送到正在进行的课堂。</Note>
            <Screenshot id="class-roster" />
          </GuideSection>

          <GuideSection id="worksheet">
            <SectionHeading icon="clipboard" eyebrow="步骤 4" title="制作学习单：围绕主题设计任务" intro="学习单按“主题—任务”组织学习内容，可用于知识运用、调查、观点表达和开放探究。学生逐项作答、逐项提交，作答过程实时汇总到课堂看板。" />
            <Steps items={[
              { title: "新建学习单", text: <>「学习单」页点 <Ui>新建学习单</Ui> 进入编辑器。左上角填标题，标题下方的 <Ui>使用说明</Ui> 只给教师看，不会出现在学生端。</> },
              { title: "填写年级与学科", text: <>点顶栏 <Ui>设置</Ui>，填写 <Ui>适用年级</Ui> 和 <Ui>学科</Ui>。学段由年级确定，AI 分析会使用这两项信息；旧学习单需要手动补填。</> },
              { title: "先组织主题", text: <>点 <Ui>＋ 添加主题</Ui>，用主题组织相关任务。一份学习单可包含多个主题，每个主题围绕明确的学习目标设计。</> },
              { title: "再添加任务", text: <>点 <Ui>＋ 添加任务</Ui> 选作答形式。左侧「学习单结构」里可以拖动把手调整主题与任务的顺序。</> },
              { title: "设置作答方式", text: <>表达题支持 <Ui>键盘输入</Ui>、<Ui>手写</Ui> 或 <Ui>照片上传</Ui>；绘图题可选择画板工具或上传照片。客观题使用所选作答形式的作答控件。</> },
              { title: "设置评分与奖励", text: <>有标准答案的客观题可设置自动评分与部分给分规则；不设答案时用于信息收集。表达题、绘图题按需开启 AI 评分。选择奖励形式后，学生成绩会以对应图标或分数呈现；不评分的任务不发放评分奖励。</> },
              { title: "预览后保存", text: <>顶栏 <Ui>预览</Ui> 会按 iPad 竖屏 / 横屏显示学生端界面，可以临时输入、绘图或选择照片试填；不保存正式作答、不提交评分、不调用 AI，关闭后清空试填内容。确认无误再 <Ui>保存</Ui>。</> },
            ]} />

            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>十种作答形式</caption>
                <thead><tr><th>作答形式</th><th>怎么用</th></tr></thead>
                <tbody>
                  {[
                    ["选择题", "添加时叫「选择题」，题内右上角有「多选」开关 —— 打开就变多选题。多选题可选「全对才得分」或「漏选可得部分分」。"],
                    ["判断题", "正确答案固定为对 / 错两项。"],
                    ["填空题", "每个空可设置手工填写或选词作答，开启自动评分后按答案键本地判分；当前不提供逐空 AI 评分。整题关闭自动评分时只收集作答，不判对错、不计分。"],
                    ["选择填空", "共用一套选词，学生点词作答；可选「按空给分」或「整题给分」。"],
                    ["排序题", "正确顺序与条目两栏并排，学生拖动排序。"],
                    ["连线题", "左项与右项配对，可设「连错不超过 N 条」作为部分得分条件。"],
                    ["归类题", "条目拖进不同的分类框。"],
                    ["表达题", "适合简答、说明、论述和小习作；支持键盘输入、手写或照片上传。参考作答、评价标准均可选填；不评分时适合收集理由、观点和开放答案，也可按需开启 AI 评分与学生自主评价。"],
                    ["绘图题", "见下方「四档画板」。"],
                  ].map(([name, desc]) => (
                    <tr key={name}><th scope="row">{name}</th><td>{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>绘图题的四档画板</caption>
                <thead><tr><th>画板</th><th>学生能画什么</th></tr></thead>
                <tbody>
                  {[
                    ["基础绘图", "自由书写、圈画和标注，适合绝大多数开放作图题。"],
                    ["数学作图", "直线、箭头、圆和常用几何图形，支持网格吸附。工具按「基础 / 多边形 / 坐标 / 其他」分组，另有放大、缩小、适应画布与撤销、清空。"],
                    ["思维导图", "用主题框、文字和分支连线整理想法。"],
                    ["流程图", "用开始 / 结束、过程、判断和箭头表达步骤。"],
                  ].map(([name, desc]) => (
                    <tr key={name}><th scope="row">{name}</th><td>{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.capabilityGrid}>
              {[
                ["图片底图", "只有「数学作图」档有。上传一张材料图片作为不可修改的底层，学生只能在图片上方作答。"],
                ["初始图", "让学生从一张教师画好的图开始画。数学作图、思维导图、流程图三档支持；基础绘图不支持结构化初始图。"],
                ["点阵背景", "画布默认的浅色点阵只是背景，不影响作答，也不需要配置。"],
                ["AI 评分", "表达题与绘图题支持整题 AI 评分，可按评分标准提供评价和修改建议。填空题使用答案键评分，需要自由表达时请选择表达题。"],
                ["参考作答", "提供一种或几种合理作答示例，帮助 AI 理解任务，不作为唯一答案。关闭 AI 评分时仍可填写。"],
                ["评价标准", "说明看重哪些表现、怎样达到要求；可写文字或上传量表图片。关闭评分时用于定性分析，开启 AI 评分时必须提供文字或图片标准，并写清给分条件。"],
                ["当前任务分析重点", "说明这次重点关注什么、哪些方面暂不重点分析。可用于所有作答形式；它不改变评分标准和给分条件，不填时按任务要求与评价依据分析。"],
                ["奖励形式", "十二档可选（支点博士、璀璨星星、缤纷花朵……以及「分数 ＋」）。奖励只改变学生端的呈现，不影响看板统计。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>

            <Note>
              <strong>做问卷或收集观点，不必为每项任务编一个正确答案。</strong>选择题、判断题、排序、连线、归类等客观题，在 <Ui>作答用途</Ui> 中选择 <Ui>无标准答案，收集信息</Ui>；填空题关闭 <Ui>自动评分</Ui>。表达题关闭 <Ui>AI 评分</Ui> 即可用于开放表达，参考作答和评价标准可留空。信息收集不判对错、不计分，报告围绕回答分布、共性诉求、差异及行动建议展开，不套用知识讲评结构。分类需列明人数及对应名单；点击人数标签可浮窗查看完整名单，不挤动正文。
            </Note>
            <Note>
              <strong>学生自主评价需要单独开启。</strong>在表达题或绘图题的评价设置中开启 <Ui>AI 评分</Ui>，填写评价标准，再开启 <Ui>学生自主评价</Ui>，设置每人每项任务评价次数（1—20 次）。学生提交后获得评分与建议，成功评价才扣次，失败可重试；次数用完后作品定稿，教师增加次数可解锁。学生可查看评价历史，最新有效评分替换旧分，奖励不累计。使用前需配置分析智能体及对应提示词。
            </Note>
            <div className={styles.modeGrid}>
              <div><span>一次放开</span><strong>开放式</strong><p>全部任务一次放开，学生自己安排节奏。默认就是这一档。</p></div>
              <div><span>学生推进</span><strong>按主题开放 / 按任务开放</strong><p>按主题开放时，完成当前主题中的全部任务后解锁下一主题；按任务开放时，提交当前任务后解锁下一项任务。</p></div>
              <div><span>教师推进</span><strong>手动逐项开放</strong><p>由你在看板上逐项开 —— 开放一项、完成一项，适合当堂讲评。</p></div>
            </div>

            <Note tone="amber">
              <strong>顶栏的「保存」和设置弹窗里的「保存设置」是两个按钮。</strong>
              顶栏保存整份（标题、任务、设置、使用说明）；弹窗里的只保存设置那一半。改完设置记得点弹窗里的 <Ui>保存设置</Ui>。
            </Note>
            <Note>
              <strong>要给学生做 AI 分析，先在设置里指定分析型智能体。</strong>
              学习单编辑器 → 设置 → <Ui>分析智能体</Ui>。不指定的话，看板上的分析按钮会告诉你去哪儿配，不会外发数据。
            </Note>
            <Screenshot id="worksheet-list" />
            <Screenshot id="worksheet-editor" />
            <Screenshot id="worksheet-types" />
            <Screenshot id="worksheet-drawing" />
            <Screenshot id="worksheet-settings" />
            <Screenshot id="worksheet-reward" />
            <Screenshot id="worksheet-ai" />
            <Screenshot id="worksheet-collection" />
          </GuideSection>

          <GuideSection id="webapp">
            <SectionHeading icon="compass" eyebrow="步骤 5" title="准备探究空间：把你做的网页带进课堂" intro="教师上传自己做好的交互式网页，学生在隔离的沙箱里打开、动手操作，不用离开课堂去访问外网。" />
            <Steps items={[
              { title: "上传网页", text: <>「探究空间」页点 <Ui>添加网页</Ui>。两种上传方式：<Ui>单个 HTML 文件</Ui>（推荐）或 <Ui>上传压缩包</Ui>（支持 ZIP / RAR / 7Z）。</> },
              { title: "确认入口页面", text: <>上传后系统会告诉你入口是什么，例如「入口是 index.html」。压缩包里若有多个页面，可以手动指定入口文件。</> },
              { title: "预览检查依赖", text: <>点卡片上的 <Ui>预览</Ui> 亲眼看看。如果网页引用了包外的资源，预览框会提示「这个网页疑似引用了 N 个不在包里的文件」—— 那些文件在学生的设备上打不开。</> },
              { title: "在课堂里关联", text: <>网页本身不需要「发布」。它只能在<strong>创建课堂时</strong>被勾选进课堂 —— 所以先建好网页，再去创建课堂。</> },
            ]} />
            <Note tone="amber">
              <strong>「探究空间」和页面里的「探究网页」是同一个东西。</strong>
              侧栏、页标题与新建课堂的说明用「探究空间」，这一页内其余的文案（空态、删除提示、表单标题）仍写「探究网页」。
              这不影响使用，是同一份资源的两种叫法。
            </Note>
            <Note>
              <strong>课堂上看到的是学生设备的真实画面。</strong>每个学生的格子里显示的是他那个网页的<strong>定时截图</strong>，
              所以能看到他停在哪一步、滚到了百分之几。设备跑不动时，可以在看板上把画面采集整个关掉。
            </Note>
            <Screenshot id="webapp-list" />
            <Screenshot id="webapp-form" />
          </GuideSection>

          <GuideSection id="create">
            <SectionHeading icon="book" eyebrow="步骤 6" title="创建课堂：选模式，配置学习模块" intro="创建课堂时有两个决定：学生以什么身份进入（模式），以及这个课堂里能用到哪些学习模块。" />
            <div className={styles.modeGrid}>
              <div><span>个人练习 · 推荐</span><strong>标准模式</strong><p>学生选择姓名加入，以个人身份与 AI 互动。适合写作反馈、语言练习和个别化问答。</p></div>
              <div><span>协作探究</span><strong>分组模式</strong><p>学生选择小组加入，同组共享一个对话窗口。适合讨论、项目学习和小组共创。</p></div>
              <div><span>分层任务</span><strong>高级模式</strong><p>每个小组各自选 AI 智能体、探究网页与学习单，分组独立对话。适合差异化任务与多角色探究。</p></div>
            </div>
            <Steps items={[
              { title: "填写课堂信息", text: <>起一个学生容易识别的课堂名称，并选择班级。切到分组 / 高级模式时，班级列表只显示<strong>已经分好组</strong>的班级。</> },
              { title: "选择参与模式", text: <>按教学活动选标准、分组或高级。注意这决定的是学生的身份形态，与用不用学习单无关。</> },
              { title: "挂上学习模块", text: <>标准与分组模式下，<Ui>AI 智能体</Ui>、<Ui>关联探究网页</Ui>、<Ui>关联学习单</Ui> 各只能选一个，<strong>三者任选其一即可开课</strong>。</> },
              { title: "高级模式：每组一格", text: <>高级模式下不出现课堂级的学习模块，而是「为每个小组选择课堂内容」—— 每组三个下拉各自独立，互不影响，也<strong>不会</strong>回落到课堂级配置。</> },
              { title: "创建后先检查", text: <>回到「课堂管理」，确认状态、互动码与学习模块的物料行，再向学生发码。</> },
            ]} />
            <Note tone="amber">
              <strong>学习单创建后不可更换。</strong>课堂设置中可修改名称、更换探究网页和智能学伴，高级模式按小组更换。
              更换网页会丢失原网页未保存的状态；更换学伴会开始新的对话上下文，旧记录保留。回答生成中暂不能更换学伴。
            </Note>
            <Screenshot id="create-classroom" />
          </GuideSection>

          <GuideSection id="join">
            <SectionHeading icon="phone" eyebrow="步骤 7" title="学生加入：用互动码把每个人带进课堂" intro="学生无需注册任何平台账号。教师发出互动码，学生打开页面、认领身份，就可以开始。" />
            <Steps items={[
              { title: "展示互动码", text: <>在课堂卡片点 <Ui>互动码</Ui>，或进课堂后点 <Ui>投屏发码</Ui>，把二维码或 4 位数字投到大屏。多网卡时请选择与学生设备同一网段的地址。</> },
              { title: "学生打开入口", text: <>学生用平板或手机<strong>自带的相机</strong>扫码（微信、支付宝等扫码可能出现功能异常），也可以在浏览器打开学生端地址后手工输入互动码。</> },
              { title: "认领姓名或小组", text: <>标准模式选自己的姓名；分组与高级模式选所在小组。已经登录的身份会显示为不可重复选择。</> },
              { title: "确认进入", text: <>学生看到首页「今天的学习」—— 三个学习模块卡按你开放的状态显示。学生看到智能体名称和开场白后即可提问。</> },
            ]} />
            <Note>
              <strong>学生可以用语音提问。</strong>对话页的输入区有语音按钮，说普通话、识别成文字、确认后再发送。
            </Note>
            <Note tone="amber"><strong>学生打不开页面时：</strong>先确认两台设备在同一局域网，再看「课堂管理」页顶部的局域网开关是否开放，最后检查系统防火墙是否允许支点课堂（ClassNode）/ Node.js 通信。</Note>
            <Screenshot id="student-join" />
            <Screenshot id="student-home" />
          </GuideSection>

          <GuideSection id="live">
            <SectionHeading icon="monitor" eyebrow="步骤 8" title="课堂进行中：先开放学习模块，再观察与介入" intro="课堂看板不是聊天记录的堆叠，而是教师决定「此刻学生能用什么」并掌握全班进度的控制台。" />
            <Note tone="amber">
              <strong>三个学习模块的默认状态是「暂停」。</strong>没有单独配置过的课堂，学习单、探究空间、智能学伴在学生端都<strong>看得见但用不了</strong>。
              进课堂后的第一件事，是打开「学习模块」把它们调到你想要的状态。
            </Note>
            <div className={styles.modeGrid}>
              <div><span>学生可直接使用</span><strong>开放</strong><p>学习模块正常可用。上课时通常只开放当下要用的那一个。</p></div>
              <div><span>学生看得见，但暂时用不了</span><strong>暂停</strong><p>卡片还在，点进去用不了。适合「讲完再开放」。</p></div>
              <div><span>学生端不显示</span><strong>隐藏</strong><p>卡片整个不出现。注意只有「隐藏」的学习模块，看板上对应的统计视图才不渲染。</p></div>
            </div>
            <div className={styles.capabilityGrid}>
              {[
                ["课堂状态", "暂停课堂 / 恢复课堂（暂停后学生无法使用学习模块中的任何功能）、锁定作答 / 解锁作答（停笔：学生不能再改答案，但仍可交卷）。"],
                ["对全班", "全体消息（发给全班、某一组或某个人）、全屏（把学生面板铺满大屏）、同步分组、学习模块。"],
                ["三个学习模块入口", "学习单、探究空间、智能学伴各自的设置与统计入口，就在工具条右侧。"],
                ["看板模式", "跟随：每格显示该学生此刻在用哪个学习模块；指定：全班格子统一显示你选定的那一个。"],
                ["学生筛选", "全部 / 需关注 / 离线，以及按三个学习模块筛选。学习模块数字是在线口径，行末那句「另有 N 人在首页或位置未定」用来对账。"],
                ["格子里的操作", "打开对话、发消息、黑屏与解除、奖励一次头像更换权限、清除对话或清除该生在这份学习单上的作答。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>

            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>看板上的三个下拉，各管什么</caption>
                <thead><tr><th>入口</th><th>里面有什么</th></tr></thead>
                <tbody>
                  {[
                    ["学习单", "学习单矩阵用矩阵掌握全班进度；按学生查看整份作答；按任务查看全班统计。三个入口共用同一个工作区。逐项开放用于控制学生此刻能完成哪些任务。"],
                    ["探究空间", "画面采集设置：显示学生网页画面的开关、分辨率与更新频率。设备跑不动时整个关掉。"],
                    ["智能学伴", "对话分析（高频词云与活跃学生 TOP 10）、设置（学生端的四项能力开关：允许中断回答、允许导出对话、允许学生提问、显示追问建议）。"],
                  ].map(([name, desc]) => (
                    <tr key={name}><th scope="row">{name}</th><td>{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Note tone="amber">
              <strong>看板上没有「结束课堂」。</strong>结束课堂在「课堂管理」页的课堂卡片上（红色按钮），或在桌面端控制面板。
              点下去会提示「结束后学生端将停止互动，数据自动保存至历史记录」。结束之后互动码失效，不要提前结束。
            </Note>
            <Note>
              <strong>右侧窄条是 <Ui>开放进度</Ui>。</strong>点击展开完整面板，右上角箭头向右收起，滚动看板时位置保持固定。多份学习单可切换；点任务名称只查看作答，点每项任务旁的 <Ui>开放</Ui> 或底部的 <Ui>开放下一项任务</Ui> 才改变开放状态。
              手动模式可逐项开放、收回；收回只隐藏任务，不删除已交作答。右侧「开放进度」仅显示手动开放的学习单；分步模式由学生提交后自动解锁。
            </Note>
            <Note tone="amber">
              <strong>已有模拟作答时，分步模式不等于重新锁题。</strong>已完成学习单的学生可能已经解锁全部内容。保留作答并测试教师逐项发布时，请改用手动开放；测试提交后自动解锁时，请用尚未作答的测试学生。
            </Note>
            <Screenshot id="live-board" />
            <Screenshot id="live-modules" />
            <Screenshot id="worksheet-release" />
            <Screenshot id="live-worksheet" />
          </GuideSection>

          <GuideSection id="review">
            <SectionHeading icon="chart" eyebrow="步骤 9" title="分析与复盘：让课堂里的思考留下来" intro="先看实际作答与本地统计，再按需要生成 AI 班级分析或个人评价，最后导出课堂记录。个人评分和班级分析是两类独立结果。" />
            <Steps items={[
              { title: "先看对话分析", text: <>看板 → 智能学伴 → <Ui>对话分析</Ui>。高频词云能看出全班在聊什么（可切换学生提问 / AI 回答），活跃学生 TOP 10 用轮次排出参与度。</> },
              { title: "再看学习单作答情况", text: <>看板 → 学习单 → <Ui>学习单矩阵</Ui>。矩阵按“任务纵向、学生横向”呈现；点学生进入整份作答，点任务进入全班统计，点交叉格直接查看这个学生的这项任务。也可以从顶部直接切换到 <Ui>按学生查看</Ui> 或 <Ui>按任务查看</Ui>。</> },
              { title: "请智能体解读", text: <>进入 <Ui>按任务查看</Ui>，在任务详情的 <Ui>AI 分析</Ui> 区选择操作。未生成报告时按钮显示「生成」，已有报告时显示「更新」；未开启 AI 评分的任务只分析作答，不自动给分。系统会提供任务材料、所属主题、年级学科、评价依据、分析重点和学生作答；手写、绘图、照片按实际内容作为附件发送。</> },
              { title: "导出需要的材料", text: <>在「数据管理」里：<Ui>导出对话</Ui> 保留完整问答；<Ui>导出学习单与探究空间</Ui> 导出作答明细（含笔迹）与使用汇总。导出前请再次确认隐私使用范围。</> },
              { title: "形成下一次调整", text: <>关注高频问题、沉默学生和误解集中的环节，把数据转化为下一堂课的教学决策。</> },
            ]} />
            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>补评、重评和班级分析分别做什么</caption>
                <thead><tr><th>操作</th><th>结果</th></tr></thead>
                <tbody>
                  <tr><th scope="row">补评未评学生</th><td>只补齐尚未取得有效 AI 评分的已提交作答，保留已有评分，不生成或更新班级分析。</td></tr>
                  <tr><th scope="row">补评并生成／更新班级分析</th><td>先分批补评并核对结果，再使用全班作答生成或更新分析。</td></tr>
                  <tr><th scope="row">生成／更新班级分析</th><td>保留已有个人评分，只生成或更新班级总结；不评分任务的按钮显示为「生成／更新全班分析」。</td></tr>
                  <tr><th scope="row">重评并生成／更新班级分析</th><td>重新评价全班已提交作品，再生成或更新分析。需要重新给分时才使用。</td></tr>
                </tbody>
              </table>
            </div>
            <Note>
              <strong>按钮随当前评分设置和已有结果变化。</strong>没有可补评学生时不显示仅补评按钮；开启学生自主评价时，班级分析只汇总全班情况，不替换个人评分。名单标签可点击展开完整姓名，再点姓名查看该学生当前任务作答。
            </Note>
            <Note>
              <strong>分析在当前教师页面后台继续运行。</strong>可以关闭分析工作区继续查看看板；需要取消时点 <Ui>停止</Ui>，已保存的评分保留。关闭整个教师浏览器页面不能保证任务继续。生成报告需要等待智能体返回，耗时取决于作品数量、附件和平台响应。
            </Note>
            <Note tone="amber">
              <strong><Ui>清除数据</Ui> 只操作当前题，保留学生作答。</strong><Ui>清除全班 AI 评分</Ui> 和 <Ui>选择学生清除 AI 评分</Ui> 用于主观题 AI 评分，后者通过浮窗选择学生；客观题的直接打分不能清除。<Ui>清除班级分析结果</Ui> 只清除报告及关联反馈，保留个人评分；清除后任务状态变为「未分析」。重新生成报告后再查看新结果。
            </Note>
            <Note tone="amber">
              <strong>发给分析智能体的材料里含学生姓名与学号。</strong>联系表上的标签是「姓名#学号」。
              请确认你使用的第三方平台、账号权限和数据处理方式符合学校要求。
            </Note>
            <Screenshot id="live-analysis" />
            <Screenshot id="analysis-clear" />
            <Screenshot id="history" />
          </GuideSection>

          <GuideSection id="manage">
            <SectionHeading icon="settings" eyebrow="长期使用" title="日常管理：把安全、数据和课堂体验照顾好" intro="下面这些不一定每堂课都用，但它们决定系统能否长期、安心地运行。" />
            <div className={styles.managementGrid}>
              <article><strong>仪表盘</strong><p>一屏汇总系统的资源量与运行状态：智能体连接健康度、课堂运行、学习单与探究空间的使用情况、存储占用与备份状态，以及一栏「需要关注」。它不是课堂实时数据 —— 实时数据在课堂看板上。</p></article>
              <article><strong>安全管理</strong><p>针对学生与智能学伴的对话。对话敏感词用于管理自定义词和系统词库；安全提醒记录按课堂查看触发敏感词的消息；对话管控可设置自动黑屏次数和每分钟的消息发送上限。两项设为 0 时不限制。</p></article>
              <article><strong>头像管理</strong><p>学生头像与班级图标两个库，支持随机生成、SVG 代码或上传图片。学生获得奖励后可从教师头像库选择。学生自己上传的头像单独成区，可在这里管理删除。</p></article>
              <article><strong>数据备份与迁移</strong><p>“数据管理”页的备份卡：<Ui>立即备份</Ui> 生成包含数据库、API 凭据密钥、附件和教学网页的完整备份；旧版备份可能缺少附件或网页。换电脑时先在旧设备备份并下载，再在新设备 <Ui>上传备份</Ui> 后恢复。新备份名称如 <Ui>支点课堂备份_2026-10-18_09-02-57.classbak</Ui>，使用本地时间；同一秒内重复备份会加 _02、_03。生成、导入和下载名称一致，旧名称备份仍可恢复。恢复前会自动保存当前数据，列表标注为“恢复前备份”，恢复成功后只保留最近一份，手动和导入的备份不受影响；需要找回覆盖前的数据时，可恢复这份备份。完整备份含 API 凭据密钥，请妥善保存。</p></article>
              <article><strong>版本更新</strong><p>有新版本时侧栏「关于」图标上会出现小红点，「关于」页里可以看更新日志。升级前建议先备份；安装后确认班级、智能体、学习单与历史数据均正常。</p></article>
              <article><strong>系统初始化</strong><p>会清空业务数据、共享凭据、附件和教学网页，保留管理员密码和系统内置屏蔽词。需要手工输入确认词；系统会自动保留操作前完整备份。只在确定要重来时使用。</p></article>
            </div>
            <Note tone="green"><strong>推荐习惯：</strong>每周备份一次；重要公开课前额外备份一次；每学期结束后导出需要留存的资料，再整理历史数据。</Note>
            <Screenshot id="dashboard" />
            <Screenshot id="shield" />
          </GuideSection>

          <div className={styles.finish}>
            <span><Icon name="check" /></span>
            <div><strong>现在，你已经了解了支点课堂的完整工作流</strong><p>下一步不必追求复杂：用 2—3 名测试学生、一份最简单的学习单，先完成一堂十分钟的测试课。</p></div>
          </div>

        </main>
      </div>
    </div>
  );
}
