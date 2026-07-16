"use client";

import { useEffect, useState } from "react";
import styles from "./guide.module.css";

type GuideSectionId =
  | "overview"
  | "setup"
  | "agents"
  | "roster"
  | "create"
  | "join"
  | "live"
  | "review"
  | "manage";

type ScreenshotId =
  | "agent-form"
  | "class-roster"
  | "create-classroom"
  | "student-join"
  | "live-board"
  | "history-export";

const sections: Array<{ id: GuideSectionId; label: string; desc: string }> = [
  { id: "overview", label: "先看这里", desc: "一堂课的完整路径" },
  { id: "setup", label: "首次设置", desc: "登录与安全准备" },
  { id: "agents", label: "接入智能体", desc: "把 AI 助教带进系统" },
  { id: "roster", label: "准备班级", desc: "学生名单与分组" },
  { id: "create", label: "创建课堂", desc: "选择模式与智能体" },
  { id: "join", label: "学生加入", desc: "互动码与身份选择" },
  { id: "live", label: "课堂进行中", desc: "观察、引导与控制" },
  { id: "review", label: "课后复盘", desc: "历史记录与导出" },
  { id: "manage", label: "日常管理", desc: "安全、头像与备份" },
];

/** 收到脱敏截图后，把对应占位路径替换为 /images/guide/xxx.png 即可，无需调整页面结构。 */
const screenshotSources: Record<ScreenshotId, string | null> = {
  "agent-form": "/images/guide/agent-form.png",
  "class-roster": "/images/guide/class-roster.png",
  "create-classroom": "/images/guide/create-classroom.png",
  "student-join": "/images/guide/student-join.png",
  "live-board": "/images/guide/live-board.png",
  "history-export": "/images/guide/history-export.png",
};

function Icon({ name }: { name: "route" | "lock" | "bot" | "users" | "book" | "phone" | "monitor" | "chart" | "settings" | "camera" | "check" | "arrow" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    route: <><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M8.6 17.5 15.4 6.5"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    bot: <><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M9 10h.01M15 10h.01M8 15h8M12 5V2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
    camera: <><path d="M14.5 4 16 7h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4l1.5-3z"/><circle cx="12" cy="13" r="3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg {...common} aria-hidden="true">{paths[name]}</svg>;
}

function SectionHeading({ icon, eyebrow, title, intro }: { icon: Parameters<typeof Icon>[0]["name"]; eyebrow: string; title: string; intro: string }) {
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

const platformCapabilities = [
  {
    name: "Coze 低代码",
    provider: "字节扣子",
    tone: "blue",
    recommended: true,
    capabilities: [true, true, true, true, true],
    url: "https://www.coze.cn/",
    summary: "能力覆盖最完整，适合需要图片理解、追问引导或深度思考的课堂。",
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
    capabilities: [true, true, false, false, false],
    url: "https://agents.baidu.com/center",
    summary: "满足日常文字问答，适合已经在文心平台建设智能体的教师。",
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
          <p>先看课堂需要哪些能力，再选择你熟悉的平台。功能会随平台接口调整，以实际连通性检测结果为准。</p>
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

function Screenshot({ id, title, instruction, avoid }: { id: ScreenshotId; title: string; instruction: string; avoid?: string }) {
  const src = screenshotSources[id];
  return (
    <figure className={styles.screenshot}>
      <figcaption>
        <span>界面示例</span>
        <strong>{title}</strong>
        {src && <small>点击图片查看原图</small>}
      </figcaption>
      {src ? (
        <a className={styles.screenshotPreview} href={src} target="_blank" rel="noreferrer" aria-label={`查看${title}原图`}>
          <img src={src} alt={title} />
        </a>
      ) : (
        <div className={styles.screenshotPlaceholder}>
          <span className={styles.screenshotBadge}><Icon name="camera" /> 截图待补充</span>
          <strong>{title}</strong>
          <p>{instruction}</p>
          {avoid && <small>注意：{avoid}</small>}
        </div>
      )}
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
          <span className={styles.heroEyebrow}>CLASSNODE 新手指南</span>
          <h1>从第一次打开，到完成一堂 AI 互动课</h1>
          <p>这份指南按照真实使用顺序编排。第一次使用时顺着阅读即可；熟悉之后，也可以从左侧目录直接查找某项功能。</p>
        </div>
        <div className={styles.heroPromise}>
          <strong>建议先完成一条最小路径</strong>
          <span>接入 1 个智能体 · 建立 1 个班级 · 开启 1 堂测试课</span>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="操作指南目录">
          <div className={styles.sidebarTitle}>上手路线 <span>{sections.length}</span></div>
          <nav>
            {sections.map((section, index) => (
              <button key={section.id} type="button" onClick={() => goTo(section.id)} className={activeSection === section.id ? styles.navActive : ""}>
                <span>{index + 1}</span>
                <div><strong>{section.label}</strong><small>{section.desc}</small></div>
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.content}>
          <GuideSection id="overview">
            <SectionHeading icon="route" eyebrow="先建立全局认识" title="一堂课，会经过哪些步骤？" intro="ClassNode 把课堂前、中、后的工作连在一起。你不需要一次学会所有功能，先走通下面这条主线。" />
            <div className={styles.journey}>
              {[
                ["接入", "连接一个已有的 AI 智能体"],
                ["建班", "导入学生并按需分组"],
                ["备课", "选择模式、班级和智能体"],
                ["开课", "展示互动码，学生选择身份"],
                ["引导", "观察全班对话并控制节奏"],
                ["复盘", "结束课堂，查看与导出记录"],
              ].map(([title, text], index) => (
                <div key={title} className={styles.journeyItem}>
                  <span>{index + 1}</span><strong>{title}</strong><small>{text}</small>
                  {index < 5 && <i><Icon name="arrow" /></i>}
                </div>
              ))}
            </div>
            <Note tone="green"><strong>第一次体验建议：</strong>先用 2—3 名测试学生开一堂标准模式课堂，确认智能体回复、学生加入和教师看板都正常，再用于正式班级。</Note>
          </GuideSection>

          <GuideSection id="setup">
            <SectionHeading icon="lock" eyebrow="步骤 1" title="首次设置：先把教师控制台保护好" intro="教师端保存着学生名单、课堂记录和智能体凭据。第一次打开时，先完成管理密码与网络检查。" />
            <Steps items={[
              { title: "设置管理密码", text: <>首次进入教师端时设置至少 8 位的管理密码。它只用于保护本机控制台，请不要与学生分享。</> },
              { title: "确认学生访问方式", text: <>学生设备需要和教师电脑处在同一局域网。课堂开始前，可在课堂管理页确认“局域网访问”已经开启。</> },
              { title: "记住恢复入口", text: <>忘记密码时，可在桌面端控制面板重置。重置后应立即登录并修改为自己的密码。</> },
            ]} />
            <Note tone="amber"><strong>课堂前 3 分钟检查：</strong>教师电脑能访问 AI 平台、学生设备能打开 ClassNode 学生端、投屏设备能看清互动码。</Note>
          </GuideSection>

          <GuideSection id="agents">
            <SectionHeading icon="bot" eyebrow="步骤 2" title="接入智能体：把你已经做好的 AI 助教带进来" intro="ClassNode 不负责替你创作智能体，而是把各平台上的智能体安全、可控地接入真实课堂。" />
            <Steps items={[
              { title: "选择平台", text: <>在“智能体管理”点击接入，先选择智能体所在的平台。不同平台需要的凭据会随标签切换。</> },
              { title: "填写接入凭据", text: <>按表单填写 Bot ID、API Token、App ID 等信息。密钥会加密保存在教师电脑上，不需要也不应该告诉任何人。</> },
              { title: "补充展示资料", text: <>填写学生在课堂中看到的名称、头像和开场白。Coze 低代码可以在凭据完整后自动获取，再由你确认或修改。</> },
              { title: "保存并检测", text: <>保存后执行连通性检测。只有能够正常回复的智能体，才建议用于正式课堂。</> },
            ]} />
            <PlatformComparison />
            <Screenshot id="agent-form" title="截图 1：接入 / 编辑智能体弹窗" instruction="请选择 Coze 低代码标签，完整显示顶部平台标签、左侧接入凭据、右侧智能体资料和底部操作区。建议窗口宽度 1400px 左右。" avoid="请使用演示 Bot ID；API Token 必须保持掩码状态，不要出现真实密钥。" />
          </GuideSection>

          <GuideSection id="roster">
            <SectionHeading icon="users" eyebrow="步骤 3" title="准备班级：让名单、学号和小组先就位" intro="班级是课堂的长期基础数据。一次整理好，之后创建不同主题的课堂都可以直接复用。" />
            <Steps items={[
              { title: "创建班级", text: <>进入“班级管理”，填写班级名称，并按需选择一个班级图标。</> },
              { title: "导入学生", text: <>人数少时可以逐个添加；已有 Excel 名单时，可批量粘贴学生信息。建议同时保留学号，学生选择姓名时会按学号顺序显示。</> },
              { title: "检查重名", text: <>正式开课前检查重名学生，并用学号加以区分，避免学生认领错误身份。</> },
              { title: "按需分组", text: <>准备开展小组探究时，提前建立小组并分配成员。标准模式不需要分组。</> },
            ]} />
            <Screenshot id="class-roster" title="截图 2：班级详情与学生名单" instruction="进入一个演示班级，画面同时包含班级名称、学生列表、学号和分组入口；名单保留 6—8 名虚拟学生即可。" avoid="不要出现真实学生姓名、学校、手机号或其他个人信息。" />
          </GuideSection>

          <GuideSection id="create">
            <SectionHeading icon="book" eyebrow="步骤 4" title="创建课堂：把教学设计变成可进入的课堂" intro="创建课堂时，最重要的决定是互动模式。模式决定学生以个人还是小组身份进入，也决定智能体如何分配。" />
            <div className={styles.modeGrid}>
              <div><span>个人练习</span><strong>标准模式</strong><p>每名学生独立与同一个智能体对话，适合写作反馈、语言练习和个别化问答。</p></div>
              <div><span>协作探究</span><strong>分组模式</strong><p>学生以小组身份共同对话，适合讨论、项目学习和小组共创。</p></div>
              <div><span>分层任务</span><strong>高级模式</strong><p>不同小组可以使用不同智能体，适合差异化任务与多角色探究。</p></div>
            </div>
            <Steps items={[
              { title: "填写课堂信息", text: <>设置一个学生容易识别的课堂名称，并选择刚才准备好的班级。</> },
              { title: "选择互动模式", text: <>根据教学活动选择标准、分组或高级模式；分组相关模式需要班级已经完成分组。</> },
              { title: "绑定智能体", text: <>标准模式通常选择一个智能体；高级模式可以为不同小组分别配置。</> },
              { title: "创建后先检查", text: <>回到课堂管理页，确认课堂状态、互动码、智能体和学生权限，再向学生发码。</> },
            ]} />
            <Screenshot id="create-classroom" title="截图 3：创建新课堂页面" instruction="完整显示课堂名称、班级选择、三种互动模式和智能体选择区域，建议选中“标准模式”作为示例。" avoid="使用演示班级和演示智能体名称。" />
          </GuideSection>

          <GuideSection id="join">
            <SectionHeading icon="phone" eyebrow="步骤 5" title="学生加入：用互动码把每个人带进课堂" intro="学生无需注册平台账号。教师发出互动码，学生打开页面、认领身份，就可以开始与 AI 对话。" />
            <Steps items={[
              { title: "展示互动码", text: <>在课堂卡片点击“互动码”，将二维码或 4 位数字投到大屏。若教师电脑有多个网络地址，请选择与学生设备同一网段的地址。</> },
              { title: "学生打开入口", text: <>学生扫码进入，或在浏览器打开教师提供的学生端地址，再输入互动码。</> },
              { title: "认领姓名或小组", text: <>标准模式选择自己的姓名；分组模式选择所在小组。已经登录的身份会显示为不可重复选择。</> },
              { title: "确认进入对话", text: <>学生看到智能体名称和开场白后即可提问。教师端会实时看到上线状态与对话进展。</> },
            ]} />
            <Screenshot id="student-join" title="截图 4：学生加入与选择身份" instruction="建议制作一张左右拼图：左侧为输入互动码页面，右侧为选择姓名页面；保留搜索框、头像和确认按钮。" avoid="姓名请全部使用虚拟数据，互动码也请使用演示号码。" />
            <Note tone="amber"><strong>学生打不开页面时：</strong>先确认两台设备在同一局域网，再检查教师端“局域网访问”开关和系统防火墙是否允许 ClassNode / Node.js 通信。</Note>
          </GuideSection>

          <GuideSection id="live">
            <SectionHeading icon="monitor" eyebrow="步骤 6" title="课堂进行中：教师既能看见，也能及时介入" intro="课堂看板不是聊天记录的堆叠，而是教师掌握参与度、发现问题和调节课堂节奏的工作台。" />
            <div className={styles.capabilityGrid}>
              {[
                ["学生卡片", "查看在线状态、对话轮数和最近问答，点击可打开完整对话。"],
                ["课堂权限", "快速控制提问、中断、导出与追问建议，状态会同步到学生端。"],
                ["消息引导", "向全班发送通知，或单独提醒某一名学生。"],
                ["课堂分析", "通过词云、参与人数和活跃学生排行观察课堂整体趋势。"],
                ["暂停提问", "讲解或集中讨论时临时冻结学生输入，之后可以恢复。"],
                ["头像奖励", "奖励学生一次更换头像的机会，作为轻量课堂激励。"],
              ].map(([name, desc]) => <div key={name}><strong>{name}</strong><p>{desc}</p></div>)}
            </div>
            <Screenshot id="live-board" title="截图 5：课堂看板全景" instruction="使用演示课堂，画面包含顶部课堂控制、学生卡片、状态筛选和课堂分析区域；至少准备 4 名学生，其中 2 名有对话记录。" avoid="所有学生姓名与对话内容必须是虚构示例，不要出现真实学情。" />
            <Note><strong>课堂结束前：</strong>确认学生不再发送内容，再点击“结束课堂”。结束后互动码失效，记录会进入数据管理页面。</Note>
          </GuideSection>

          <GuideSection id="review">
            <SectionHeading icon="chart" eyebrow="步骤 7" title="课后复盘：把课堂里的思考真正留下来" intro="结束课堂不是数据的终点。历史记录可以帮助教师回看个体思路，也可以沉淀为教学案例与研究材料。" />
            <Steps items={[
              { title: "找到历史课堂", text: <>进入“数据管理”，按日期、班级或课堂名称找到刚刚结束的课堂。</> },
              { title: "查看课堂概览", text: <>先看参与人数、互动轮数和课堂时长，再进入学生对话理解具体学习过程。</> },
              { title: "导出需要的材料", text: <>“导出对话”适合保留完整问答；“导出报表”适合形成结构化学情材料。导出前请再次确认隐私使用范围。</> },
              { title: "形成下一次调整", text: <>关注高频问题、沉默学生和误解集中的环节，把数据转化为下一堂课的教学决策。</> },
            ]} />
            <Screenshot id="history-export" title="截图 6：历史课堂与导出入口" instruction="显示数据管理中的一条演示课堂记录，以及查看详情、导出对话、导出报表等操作入口。" avoid="截图中的班级、学生和课堂内容全部使用虚拟数据。" />
          </GuideSection>

          <GuideSection id="manage">
            <SectionHeading icon="settings" eyebrow="长期使用" title="日常管理：把安全、数据和课堂体验照顾好" intro="下面这些功能不一定每堂课都用，但它们决定了系统能否长期、安心地运行。" />
            <div className={styles.managementGrid}>
              <article><strong>屏蔽管理</strong><p>维护系统词库与自定义屏蔽词，设置提问频率和自动黑屏阈值，并在拦截记录中追溯课堂情况。</p></article>
              <article><strong>头像管理</strong><p>维护学生头像和班级图标。学生获得奖励后，可从教师头像库选择、上传图片或使用安全的自定义 SVG。</p></article>
              <article><strong>数据备份</strong><p>定期备份数据库与附件。更换电脑时先在旧设备下载备份，再在新设备恢复，完成整体迁移。</p></article>
              <article><strong>版本更新</strong><p>在“关于”页面检查版本。升级前建议先备份；安装新版本后确认班级、智能体和历史数据均正常。</p></article>
            </div>
            <Note tone="green"><strong>推荐习惯：</strong>每周备份一次；重要公开课前额外备份一次；每学期结束后导出需要留存的资料，再整理历史数据。</Note>
          </GuideSection>

          <div className={styles.finish}>
            <span><Icon name="check" /></span>
            <div><strong>现在，你已经了解了 ClassNode 的完整工作流</strong><p>下一步不必追求复杂：用一个熟悉的智能体、几名测试学生，先完成一堂十分钟的测试课。</p></div>
          </div>
        </main>
      </div>
    </div>
  );
}
