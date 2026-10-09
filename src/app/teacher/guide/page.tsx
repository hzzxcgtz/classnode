"use client";

import { useEffect, useState } from "react";
import styles from "./guide.module.css";

/**
 * 使用指南（★ 2026-10-09 按 2.0 改版）。
 *
 * 🔴 **这一页的每一条界面文案都是从代码里逐字核过的**，不凭印象。理由：指南写错一个字，
 *    教师就会在界面上找一个不存在的按钮 —— 而他会以为是自己的版本不对，不是指南错了。
 *    本页第二轮改版时抓到 5 处与实现不符（写在下面 `README` 里），全是被时间甩下的旧文案。
 *
 * ── 改版记录（2026-10-09）────────────────────────────────────────────────
 *
 * **2.0 起课堂由三个模块组成**（`server/changelogs/v2.0.0.md`）：学习单 / 探究空间 / 智能学伴。
 * 旧指南（1.X 时代）只讲「学生和 AI 对话」，三件套一条都没有 ⇒ 本轮新增两整章
 * （`worksheet` / `webapp`），并重写了 `overview` / `create` / `live` / `review`。
 *
 * **本轮修掉的 5 处错误**（改版前逐条核过，都已在下面改对）：
 *   ① 管理密码写「至少 8 位」—— 实际**不限长度、但非空**（`teacher/layout.tsx:276-281`）。
 *   ② 「导出报表」—— **界面上没有这个按钮**；真实按钮是 `导出学习单与探究空间`
 *      （`history/page.tsx:406`）。
 *   ③ 「屏蔽管理」—— 侧栏与页标题**都叫 `课堂安全`**（`teacher/layout.tsx:38`）。
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
  "agent-form": { title: "接入 / 编辑智能体弹窗", where: "AI智能体 → 接入智能体" },
  "agent-list": { title: "智能体列表与用途分档", where: "AI智能体" },
  "class-roster": { title: "班级管理 · 学生列表", where: "班级管理 → 学生列表" },
  "dashboard": { title: "仪表盘", where: "仪表盘" },
  "worksheet-list": { title: "学习单列表", where: "学习单" },
  "worksheet-editor": { title: "学习单编辑器", where: "学习单 → 编辑" },
  "worksheet-types": { title: "添加题目：题型选择", where: "学习单 → 编辑 → 添加题目" },
  "worksheet-drawing": { title: "绘图题设置", where: "学习单 → 编辑 → 一道绘图题" },
  "worksheet-settings": { title: "学习单设置弹窗", where: "学习单 → 编辑 → 设置" },
  "worksheet-reward": { title: "学习单设置 · 学生奖励", where: "学习单 → 编辑 → 设置" },
  "worksheet-ai": { title: "题目里的 AI 评分", where: "学习单 → 编辑 → 一道问答题或绘图题" },
  "webapp-list": { title: "探究空间 · 网页库", where: "探究空间" },
  "webapp-form": { title: "添加探究网页", where: "探究空间 → 添加网页" },
  "create-classroom": { title: "创建新课堂", where: "课堂管理 → 创建新课堂" },
  "student-join": { title: "学生加入与选择身份", where: "学生端" },
  "student-home": { title: "学生端首页：三个模块", where: "学生端" },
  "live-board": { title: "课堂看板全景", where: "课堂管理 → 进入课堂" },
  "live-modules": { title: "课堂模块：开放 / 暂停 / 隐藏", where: "课堂看板 → 模块状态" },
  "live-worksheet": { title: "看板上的学习单：答题情况", where: "课堂看板 → 学习单 → 学习单总览" },
  "live-analysis": { title: "AI 分析结果", where: "课堂看板 → 学习单 → 按题目查看 → 某题的 AI 分析" },
  "history": { title: "数据管理 · 历史课堂与导出", where: "数据管理" },
  "shield": { title: "课堂安全", where: "课堂安全" },
} as const;

/** 图片路径由 id 推得 —— 全仓只此一处拼这个路径。 */
const shotSrc = (id: keyof typeof SHOTS) => `/images/guide/${id}.png`;

type ShotId = keyof typeof SHOTS;

const sections: Array<{ id: GuideSectionId; label: string; desc: string; tag?: string }> = [
  { id: "overview", label: "先看这里", desc: "课堂的三个模块" },
  { id: "setup", label: "首次设置", desc: "密码与网络准备" },
  { id: "ai-agents", label: "接入 AI 智能体", desc: "学伴型与分析型" },
  { id: "roster", label: "准备班级", desc: "名单与分组" },
  { id: "worksheet", label: "制作学习单", desc: "十种题型与评分", tag: "2.0 新增" },
  { id: "webapp", label: "准备探究空间", desc: "上传交互网页", tag: "2.0 新增" },
  { id: "create", label: "创建课堂", desc: "模式与三件套" },
  { id: "join", label: "学生加入", desc: "互动码与身份" },
  { id: "live", label: "课堂进行中", desc: "开放模块与控制" },
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
        <span>界面示例</span>
        <strong>{shot.title}</strong>
      </figcaption>
      {/* `loading="lazy"`：22 张合计 7MB，一次性拉太浪费；浏览器不支持时只是退回立即加载。 */}
      <div className={styles.screenshotPreview}>
        <img src={shotSrc(id)} alt={shot.title} loading="lazy" />
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
          <span className={styles.heroEyebrow}>CLASSNODE 使用指南</span>
          <h1>从第一次打开，到完成一堂 AI 互动课</h1>
          <p>
            2.0 起，一堂课由三个模块组成：<strong>学习单</strong>当堂练习、<strong>探究空间</strong>动手体验、
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
              title="一堂课，由三个模块组成"
              intro="2.0 之前，课堂里只有一件事：学生和 AI 对话。现在教师在同一块看板上决定三个模块各自什么时候开放 —— 这才是 2.0 与旧版最大的不同。"
            />
            <div className={styles.modeGrid}>
              <div><span>当堂练习</span><strong>学习单</strong><p>像出卷子一样编辑，学生逐题作答、逐题提交。教师在教室大屏上看到的不再只是「谁交了」，而是每个人此刻正在写什么。</p></div>
              <div><span>动手体验</span><strong>探究空间</strong><p>学生打开你上传的交互网页，在沙箱里动手操作，不用离开课堂去访问外网。教师能看到每台设备正停在哪一步。</p></div>
              <div><span>对话思考</span><strong>智能学伴</strong><p>学生与 AI 一对一对话。原样保留，并新增了对话分析与按题统计两处面向教师的分析入口。</p></div>
            </div>
            <div className={styles.journey}>
              {[
                ["接入", "连接已有的 AI 智能体"],
                ["建班", "导入学生并按需分组"],
                ["备课", "做学习单、传探究网页"],
                ["开课", "选模式与三件套，发码"],
                ["引导", "开放模块、观察、介入"],
                ["复盘", "AI 分析与导出记录"],
              ].map(([title, text], index) => (
                <div key={title} className={styles.journeyItem}>
                  <span>{index + 1}</span><strong>{title}</strong><small>{text}</small>
                  {index < 5 && <i><Icon name="arrow" /></i>}
                </div>
              ))}
            </div>
            <Note tone="green">
              <strong>三件套不必都配。</strong>创建课堂时，<Ui>AI 智能体</Ui>、<Ui>探究网页</Ui>、<Ui>学习单</Ui> 任选其一即可开课 ——
              只挂一份学习单也能发起课堂。第一次体验建议用 2—3 名测试学生、标准模式，确认三个模块都正常再用于正式班级。
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
                    <br />· <Ui>分析</Ui> —— 只给教师用，专门分析全班作答，<strong>绝不会出现在学生的学伴列表里</strong>。
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
                ["底部说明不同", "学伴型写「可在课堂配置中选用」；分析型写「仅教师端可使用」。"],
                ["筛选下拉", "工具条上的用途筛选叫「学习类 / 分析类」—— 与胶囊的「学伴 / 分析」是同一件事的两种叫法。"],
                ["只有学伴能进课堂", "新建课堂的智能体下拉只列学伴型。"],
                ["分析型只能在学习单里用", "入口在学习单编辑器 → 设置 → 课堂分析 → 分析型智能体。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>
            <PlatformComparison />
            <Note tone="amber">
              <strong>做学习单 AI 分析，必须用 Coze 平台的分析型智能体。</strong>
              本版的分析链路只接了 Coze —— 因为发给模型的材料里有手写、绘图与照片，只有 Coze 收得了图。
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
            <SectionHeading icon="clipboard" eyebrow="步骤 4 · 2.0 新增" title="制作学习单：像出卷子一样编辑" intro="学习单是 2.0 最大的新增件。教师编辑题目与评分，学生逐题作答、逐题提交，作答过程实时汇总到课堂看板。" />
            <Steps items={[
              { title: "新建学习单", text: <>「学习单」页点 <Ui>新建学习单</Ui> 进入编辑器。左上角填标题，标题下方的 <Ui>使用说明</Ui> 只给教师看，不会出现在学生端。</> },
              { title: "先加分任务", text: <>点 <Ui>＋ 添加任务</Ui>。任务用来组织一组相关题目，学生会按任务顺序完成 —— 一份真实的学习单通常有 2—4 个任务。</> },
              { title: "再逐题添加", text: <>点 <Ui>＋ 添加题目</Ui> 选题型。左侧「学习单结构」里可以拖动把手调整题目与任务的顺序。</> },
              { title: "设置作答方式", text: <>每道题可以选 <Ui>键盘输入</Ui>、<Ui>手写</Ui>（绘图题这一档显示为 <Ui>画板绘制</Ui>）或 <Ui>照片上传</Ui>。照片档适合纸笔作答的题。</> },
              { title: "设置评分与奖励", text: <>判分型题目可以设「完全正确」与「部分答对」的分值，以及部分得分的条件。累积的分数会按你选的奖励形式显示给学生。</> },
              { title: "预览后保存", text: <>顶栏 <Ui>预览</Ui> 会按 iPad 竖屏 / 横屏渲染学生端的真实组件（只读、不含正确答案）。确认无误再 <Ui>保存</Ui>。</> },
            ]} />

            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>十种题型</caption>
                <thead><tr><th>题型</th><th>怎么用</th></tr></thead>
                <tbody>
                  {[
                    ["选择题", "添加时叫「选择题」，题内右上角有「多选」开关 —— 打开就变多选题。多选题可选「全对才得分」或「漏选可得部分分」。"],
                    ["判断题", "正确答案固定为对 / 错两项。"],
                    ["填空题", "每个空可以分别设「作答方式」（手工填写 / 右侧选词 / 下方选词）与「评分方式」（本地评分 / AI 评分 / 不评分）。"],
                    ["选择填空", "共用一套选词，学生点词作答；可选「按空给分」或「整题给分」。"],
                    ["排序题", "正确顺序与条目两栏并排，学生拖动排序。"],
                    ["连线题", "左项与右项配对，可设「连错不超过 N 条」作为部分得分条件。"],
                    ["归类题", "条目拖进不同的分类框。"],
                    ["问答题", "写出参考答案。可以开启 AI 评分，让智能体按评分标准逐生打分并给出建议。"],
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
                ["图片底图", "只有「数学作图」档有。上传一张题图作为不可修改的底层，学生只能在图片上方作答。"],
                ["初始图", "让学生从一张教师画好的图开始画。数学作图、思维导图、流程图三档支持；基础绘图不支持结构化初始图。"],
                ["点阵背景", "画布默认的浅色点阵只是背景，不影响作答，也不需要配置。"],
                ["AI 评分", "只有问答题与绘图题有整题的 AI 评分块。填空题的 AI 评分下沉到每一个空上。"],
                ["评分标准", "可以写文字，也可以上传一张评分量表图片 —— 两者都会随作答一起发给分析智能体。"],
                ["奖励形式", "十二档可选（支点博士、璀璨星星、缤纷花朵……以及「分数 ＋」）。奖励只改变学生端的呈现，不影响看板统计。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>

            <div className={styles.modeGrid}>
              <div><span>一次放开</span><strong>开放式</strong><p>全部题目一次放开，学生自己安排节奏。默认就是这一档。</p></div>
              <div><span>学生推进</span><strong>按任务分步 / 按小题分步</strong><p>做完上一个才开下一个。分步模式只提示「后面还有内容」，不会提前显示后续题目。</p></div>
              <div><span>教师推进</span><strong>手动逐题开放</strong><p>由你在看板上逐题开 —— 讲一题、做一题，适合当堂讲评。</p></div>
            </div>

            <Note tone="amber">
              <strong>顶栏的「保存」和设置弹窗里的「保存设置」是两个按钮。</strong>
              顶栏保存整份（标题、题目、设置、使用说明）；弹窗里的只保存设置那一半。改完设置记得点弹窗里的 <Ui>保存设置</Ui>。
            </Note>
            <Note>
              <strong>要给学生做 AI 分析，先在设置里指定分析型智能体。</strong>
              学习单编辑器 → 设置 → <Ui>课堂分析</Ui> → <Ui>分析型智能体</Ui>。不指定的话，看板上的分析按钮会告诉你去哪儿配，不会外发数据。
            </Note>
            <Screenshot id="worksheet-list" />
            <Screenshot id="worksheet-editor" />
            <Screenshot id="worksheet-types" />
            <Screenshot id="worksheet-drawing" />
            <Screenshot id="worksheet-settings" />
            <Screenshot id="worksheet-reward" />
            <Screenshot id="worksheet-ai" />
          </GuideSection>

          <GuideSection id="webapp">
            <SectionHeading icon="compass" eyebrow="步骤 5 · 2.0 新增" title="准备探究空间：把你做的网页带进课堂" intro="教师上传自己做好的交互式网页，学生在隔离的沙箱里打开、动手操作，不用离开课堂去访问外网。" />
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
            <SectionHeading icon="book" eyebrow="步骤 6" title="创建课堂：选模式，挂三件套" intro="创建课堂时有两个决定：学生以什么身份进入（模式），以及这个课堂里能用到哪些模块（三件套）。" />
            <div className={styles.modeGrid}>
              <div><span>个人练习 · 推荐</span><strong>标准模式</strong><p>学生选择姓名加入，以个人身份与 AI 互动。适合写作反馈、语言练习和个别化问答。</p></div>
              <div><span>协作探究</span><strong>分组模式</strong><p>学生选择小组加入，同组共享一个对话窗口。适合讨论、项目学习和小组共创。</p></div>
              <div><span>分层任务</span><strong>高级模式</strong><p>每个小组各自选 AI 智能体、探究网页与学习单，分组独立对话。适合差异化任务与多角色探究。</p></div>
            </div>
            <Steps items={[
              { title: "填写课堂信息", text: <>起一个学生容易识别的课堂名称，并选择班级。切到分组 / 高级模式时，班级列表只显示<strong>已经分好组</strong>的班级。</> },
              { title: "选择参与模式", text: <>按教学活动选标准、分组或高级。注意这决定的是学生的身份形态，与用不用学习单无关。</> },
              { title: "挂上三件套", text: <>标准与分组模式下，<Ui>AI 智能体</Ui>、<Ui>关联探究网页</Ui>、<Ui>关联学习单</Ui> 各只能选一个，<strong>三者任选其一即可开课</strong>。</> },
              { title: "高级模式：每组一格", text: <>高级模式下不出现课堂级的三件套，而是「为每个小组选择课堂内容」—— 每组三个下拉各自独立，互不影响，也<strong>不会</strong>回落到课堂级配置。</> },
              { title: "创建后先检查", text: <>回到「课堂管理」，确认状态、互动码与三件套的物料行，再向学生发码。</> },
            ]} />
            <Note tone="amber">
              <strong>创建之后只有课堂名称能改。</strong>课堂设置弹窗里写着「可修改课堂名称，其余内容创建后不可更改」——
              智能体、网页、学习单配错了只能重建课堂。所以发起课堂前，多看一眼底部那行摘要。
            </Note>
            <Screenshot id="create-classroom" />
          </GuideSection>

          <GuideSection id="join">
            <SectionHeading icon="phone" eyebrow="步骤 7" title="学生加入：用互动码把每个人带进课堂" intro="学生无需注册任何平台账号。教师发出互动码，学生打开页面、认领身份，就可以开始。" />
            <Steps items={[
              { title: "展示互动码", text: <>在课堂卡片点 <Ui>互动码</Ui>，或进课堂后点 <Ui>投屏发码</Ui>，把二维码或 4 位数字投到大屏。多网卡时请选择与学生设备同一网段的地址。</> },
              { title: "学生打开入口", text: <>学生用平板或手机<strong>自带的相机</strong>扫码（微信、支付宝等扫码可能出现功能异常），也可以在浏览器打开学生端地址后手工输入互动码。</> },
              { title: "认领姓名或小组", text: <>标准模式选自己的姓名；分组与高级模式选所在小组。已经登录的身份会显示为不可重复选择。</> },
              { title: "确认进入", text: <>学生看到首页「今天的学习」—— 三个模块卡按你开放的状态显示。学生看到智能体名称和开场白后即可提问。</> },
            ]} />
            <Note>
              <strong>学生可以用语音提问。</strong>对话页的输入区有语音按钮，说普通话、识别成文字、确认后再发送。
            </Note>
            <Note tone="amber"><strong>学生打不开页面时：</strong>先确认两台设备在同一局域网，再看「课堂管理」页顶部的局域网开关是否开放，最后检查系统防火墙是否允许支点课堂（ClassNode）/ Node.js 通信。</Note>
            <Screenshot id="student-join" />
            <Screenshot id="student-home" />
          </GuideSection>

          <GuideSection id="live">
            <SectionHeading icon="monitor" eyebrow="步骤 8" title="课堂进行中：先开放模块，再观察与介入" intro="课堂看板不是聊天记录的堆叠，而是教师决定「此刻学生能用什么」并掌握全班进度的控制台。" />
            <Note tone="amber">
              <strong>三个模块的默认状态是「暂停」。</strong>没有单独配置过的课堂，学习单、探究空间、智能学伴在学生端都<strong>看得见但用不了</strong>。
              进课堂后的第一件事，是打开「模块状态」把它们调到你想要的状态。
            </Note>
            <div className={styles.modeGrid}>
              <div><span>学生可直接使用</span><strong>开放</strong><p>模块正常可用。上课时通常只开放当下要用的那一个。</p></div>
              <div><span>学生看得见，但暂时用不了</span><strong>暂停</strong><p>卡片还在，点进去用不了。适合「讲完再开放」。</p></div>
              <div><span>学生端不显示</span><strong>隐藏</strong><p>卡片整个不出现。注意只有「隐藏」的模块，看板上对应的统计视图才不渲染。</p></div>
            </div>
            <div className={styles.capabilityGrid}>
              {[
                ["课堂状态", "暂停课堂 / 恢复课堂（暂停后学生无法使用三件套中的任何功能）、锁定作答 / 解锁作答（停笔：学生不能再改答案，但仍可交卷）。"],
                ["对全班", "全体消息（发给全班、某一组或某个人）、全屏（把学生面板铺满大屏）、同步分组、模块状态。"],
                ["三个模块入口", "学习单、探究空间、智能学伴各自的设置与统计入口，就在工具条右侧。"],
                ["看板模式", "跟随：每格显示该学生此刻在用哪个模块；指定：全班格子统一显示你选定的那一个。"],
                ["学生筛选", "全部 / 需关注 / 离线，以及按三个模块筛选。模块数字是在线口径，行末那句「另有 N 人在首页或位置未定」用来对账。"],
                ["格子里的操作", "打开对话、发消息、黑屏与解除、奖励一次头像更换权限、清除对话或清除该生在这份学习单上的作答。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>

            <div className={styles.termTableWrap}>
              <table className={styles.termTable}>
                <caption>看板上的三个下拉，各管什么</caption>
                <thead><tr><th>入口</th><th>里面有什么</th></tr></thead>
                <tbody>
                  {[
                    ["学习单", "学习单总览用矩阵掌握全班进度；按学生查看整份作答；按题目查看全班统计。三个入口共用同一个工作区。逐题开放用于控制学生此刻能做哪些题。"],
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
            <Screenshot id="live-board" />
            <Screenshot id="live-modules" />
            <Screenshot id="live-worksheet" />
          </GuideSection>

          <GuideSection id="review">
            <SectionHeading icon="chart" eyebrow="步骤 9" title="分析与复盘：让课堂里的思考留下来" intro="2.0 新增了两处面向教师的分析入口，以及把学习单与探究空间的记录一起导出的能力。" />
            <Steps items={[
              { title: "先看对话分析", text: <>看板 → 智能学伴 → <Ui>对话分析</Ui>。高频词云能看出全班在聊什么（可切换学生提问 / AI 回答），活跃学生 TOP 10 用轮次排出参与度。</> },
              { title: "再看学习单答题情况", text: <>看板 → 学习单 → <Ui>学习单总览</Ui>。矩阵按“学生纵向、题目横向”呈现；点学生进入整份作答，点题目进入全班统计，点交叉格直接查看这个学生的这道题。也可以从顶部直接切换到 <Ui>按学生查看</Ui> 或 <Ui>按题目查看</Ui>。</> },
              { title: "请智能体解读", text: <>在题目的统计浮层或作答结果里点 <Ui>生成 AI 分析</Ui>。它会把题面、评分标准、全班作答与一张「联系表」位图发给分析型智能体，返回共同困难、思维差异与讲评建议。开过 AI 评分的题还会逐生给分。</> },
              { title: "导出需要的材料", text: <>在「数据管理」里：<Ui>导出对话</Ui> 保留完整问答；<Ui>导出学习单与探究空间</Ui> 导出作答明细（含笔迹）与使用汇总。导出前请再次确认隐私使用范围。</> },
              { title: "形成下一次调整", text: <>关注高频问题、沉默学生和误解集中的环节，把数据转化为下一堂课的教学决策。</> },
            ]} />
            <Note>
              <strong>AI 分析是异步的，可以关掉窗口。</strong>点下去之后任务在后台跑，一般 1—3 分钟；关掉窗口按钮会变成「关闭（后台继续）」。
              如果这一次只拿到部分学生的评分，结果窗里会给一个 <Ui>只补这 N 人</Ui> 的按钮，不会重算整体。
            </Note>
            <Note tone="amber">
              <strong>发给分析智能体的材料里含学生姓名与学号。</strong>联系表上的标签是「姓名#学号」。
              请确认你使用的第三方平台、账号权限和数据处理方式符合学校要求。
            </Note>
            <Screenshot id="live-analysis" />
            <Screenshot id="history" />
          </GuideSection>

          <GuideSection id="manage">
            <SectionHeading icon="settings" eyebrow="长期使用" title="日常管理：把安全、数据和课堂体验照顾好" intro="下面这些不一定每堂课都用，但它们决定系统能否长期、安心地运行。" />
            <div className={styles.managementGrid}>
              <article><strong>仪表盘</strong><p>一屏汇总系统的资源量与运行状态：智能体连接健康度、课堂运行、学习单与探究空间的使用情况、存储占用与备份状态，以及一栏「需要关注」。它不是课堂实时数据 —— 实时数据在课堂看板上。</p></article>
              <article><strong>课堂安全</strong><p>三个页签：词库管理（自定义屏蔽词的增删与启停）、拦截记录（按课堂汇总的触发记录）、管控设置（触发多少次后自动黑屏、每位学生每分钟的提问次数上限）。系统词库可以整体暂停。</p></article>
              <article><strong>头像管理</strong><p>学生头像与班级图标两个库，支持随机生成、SVG 代码或上传图片。学生获得奖励后可从教师头像库选择。学生自己上传的头像单独成区，可在这里管理删除。</p></article>
              <article><strong>数据备份与迁移</strong><p>“数据管理”页的备份卡：<Ui>立即备份</Ui> 生成一份含全部数据与附件的备份；换电脑时先在旧设备备份并下载，再在新设备 <Ui>上传备份</Ui> 后恢复。</p></article>
              <article><strong>版本更新</strong><p>有新版本时侧栏「关于」图标上会出现小红点，「关于」页里可以看更新日志。升级前建议先备份；安装后确认班级、智能体、学习单与历史数据均正常。</p></article>
              <article><strong>系统初始化</strong><p>会清空所有数据并恢复到初始状态（管理员密码保留），需要手工输入确认词。这是不可撤销的操作 —— 只在确定要重来时使用，动手前务必备份。</p></article>
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
