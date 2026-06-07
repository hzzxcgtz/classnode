'use client';
import { useState, useEffect } from 'react';

const Highlight = (props: { children: React.ReactNode }) =>
  <span style={{ fontWeight: 600, color: '#2563eb' }}>{props.children}</span>;

const SectionIcon = ({ name }: { name: string }) => {
  const icons: Record<string, React.ReactNode> = {
    rocket: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></svg>,
    bot: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /><path d="M8 4V2" /><path d="M16 4V2" /><path d="M8 20v2" /><path d="M16 20v2" /></svg>,
    users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    classroom: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
    'log-in': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>,
    monitor: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
    shield: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    history: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
    gift: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>,
  };
  return <>{icons[name] ?? null}</>;
};

const sectionList = [
  { id: 'getting-started', mainLabel: '启程', subLabel: '首次见面与安全锁' },
  { id: 'ai-agents', mainLabel: '招募', subLabel: '配置 AI 助教团队' },
  { id: 'classes', mainLabel: '组局', subLabel: '班级与学生管理' },
  { id: 'classroom', mainLabel: '备课', subLabel: '创建互动课堂' },
  { id: 'student-join', mainLabel: '上课', subLabel: '学生端接入与互动' },
  { id: 'dashboard', mainLabel: '掌控', subLabel: '课堂看板与监控' },
  { id: 'shield', mainLabel: '净化', subLabel: '屏蔽词管理' },
  { id: 'data', mainLabel: '丰收', subLabel: '数据管理与导出' },
  { id: 'backup', mainLabel: '保障', subLabel: '数据备份与恢复' },
];

const sections = [
  {
    id: 'getting-started', title: '一、启程：首次见面与安全锁', icon: 'rocket',
    items: [
      <><strong>唤醒系统</strong>：双击启动程序，打开浏览器访问教师控制台，开始使用。</>,
      <><strong>给您的讲台上一道锁</strong>：首次使用会要求设置管理密码（至少 6 位）。这里存放着全班的学情数据和 AI 配置，须防止学生误入。</>,
      <><strong>修改密码</strong>：如需更换密码，在控制台主页找到「<Highlight>修改密码</Highlight>」即可。</>,
    ],
  },
  {
    id: 'ai-agents', title: '二、招募：配置您的 AI 助教团队', icon: 'bot',
    items: [
      <div>想要课堂出彩，先要有好的 AI 帮手。进入「<Highlight>AI 智能体</Highlight>」页面开始招募：</div>,
      <><strong>多平台兼容</strong>：目前已支持 <Highlight>Coze Bot</Highlight>（低代码）和 <Highlight>Coze Agent</Highlight>（编程接入）。<strong>其它接入方式</strong>陆续上线中。</>,
      <><strong>配置更直观</strong>：填入平台提供的 API Key 和 Bot ID 等信息，可自定义本地名称（如"李白学长"）。支持一键从 Coze 拉取头像和开场白。</>,
      <div>
        <div><strong>连通性检测</strong>：系统启动时自动检测 AI 智能体在线状态。</div>
        <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 15, color: '#475569' }}>
          <div>• 卡片底部指示灯：<span style={{ color: '#22c55e', fontWeight: 600 }}>绿色</span> 代表在线，<span style={{ color: '#ef4444', fontWeight: 600 }}>红色</span> 代表离线。</div>
          <div>• <strong>实时告警</strong>：课堂上 AI 连接异常时，左侧导航栏自动弹出通知。</div>
          <div>• 也可手动点击智能体的「检测」按钮进行排查。</div>
        </div>
      </div>,
      <><strong>智能体状态</strong>：不使用的 AI 可随时禁用，创建课堂时列表更清爽。</>,
    ],
  },
  {
    id: 'classes', title: '三、组局：班级与学生管理', icon: 'users',
    items: [
      <div>进入「<Highlight>班级管理</Highlight>」，建好班级后准备迎接学生：</div>,
      <div>
        <div><strong>极速导入学生</strong></div>
        <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 15, color: '#475569' }}>
          <div>• <strong>慢工出细活</strong>：人数较少时，手动逐个输入姓名即可。</div>
          <div>• <strong>魔法一键导入</strong>：将 Excel 学生名单复制粘贴（一行一个姓名），系统自动生成学号，3 秒完成建班。</div>
        </div>
      </div>,
      <><strong>灵活分组</strong>：切换到「分组管理」，像框选桌面图标一样拖拽学生进不同小组。点击小组右上角的「全部移除」即可重置。</>,
    ],
  },
  {
    id: 'classroom', title: '四、备课：创建互动课堂', icon: 'classroom',
    items: [
      <div>在「<Highlight>课堂管理</Highlight>」中点击「创建新课堂」，为课堂命名并选择合适的<strong>教学模式</strong>：</div>,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 20, lineHeight: 1.8, fontSize: 15, color: '#475569' }}>
        <div>
          <span style={{ background: '#eef2ff', color: '#2563eb', fontWeight: 600, fontSize: 13, padding: '2px 10px', borderRadius: 4, marginRight: 6 }}>标准模式</span>
          <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 8 }}>Standard Mode</span>
          —— 每人一个独立账号，各自与 AI 对话，适合普适性练习。
        </div>
        <div>
          <span style={{ background: '#f5f3ff', color: '#7c3aed', fontWeight: 600, fontSize: 13, padding: '2px 10px', borderRadius: 4, marginRight: 6 }}>分组模式</span>
          <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 8 }}>Group Mode</span>
          —— 全组共用一个账号，同屏与 AI 讨论，适合协作探究。
        </div>
        <div>
          <span style={{ background: '#fef3c7', color: '#d97706', fontWeight: 600, fontSize: 13, padding: '2px 10px', borderRadius: 4, marginRight: 6 }}>高级模式</span>
          <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 8 }}>Advanced Mode</span>
          —— 可为不同小组绑定不同的 AI 智能体，真正实现分层教学。
        </div>
      </div>,
      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
        padding: '12px 16px', fontSize: 14, color: '#92400e', lineHeight: 1.7,
      }}>
        <strong style={{ color: '#b45309' }}>小贴士</strong>：课上到一半发现 AI 不太合适？在活跃课堂列表点击齿轮图标可中途更换 AI，已有聊天记录不会丢失。
      </div>,
    ],
  },
  {
    id: 'student-join', title: '五、上课：学生端接入与互动', icon: 'log-in',
    items: [
      <><strong>扫码即入</strong>：大屏点击「投屏发码」，学生扫码或在浏览器输入 <Highlight>http://192.168.x.x:3001/classroom</Highlight> 及 4 位互动码即可加入。</>,
      <><strong>认领身份</strong>：输入互动码后，点选自己的姓名或小组进入对话界面。</>,
      <><strong>专注学习</strong>：页面顶部展示 AI 开场白。AI 回复时输入框暂时冻结，防止学生连击导致消息错乱。所有对话实时同步至教师控制台。</>,
    ],
  },
  {
    id: 'dashboard', title: '六、掌控：课堂看板与监控', icon: 'monitor',
    items: [
      <div>点击进行中的课堂，进入「<Highlight>课堂看板</Highlight>」：</div>,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.8, fontSize: 15, color: '#475569' }}>
        <div><strong>全景监控</strong>：主区域展示全班卡片，在线状态与对话轮次一目了然。卡片滚动显示学生最新问答。</div>
        <div>
          <strong>实时学情雷达</strong>
          <div style={{ paddingLeft: 20, marginTop: 2, lineHeight: 2, fontSize: 15, color: '#475569' }}>
            <div>• <strong>高频词云</strong>：抓取学生提问热点词，辅助调整讲课方向。</div>
            <div>• <strong>活跃榜 Top 10</strong>：展示提问达人与沉默学员，掌握参与度。</div>
          </div>
        </div>
        <div><strong>深度查阅与投屏</strong>：点开学生卡片查看完整对话记录，点击「全屏投屏」将精彩问答展示在大屏上供全班观摩。</div>
        <div><strong>课堂节奏控制</strong>：讲解时「暂停课堂」冻结所有学生端输入；下课「结束课堂」自动打包数据并回收互动码。</div>
      </div>,
    ],
  },
  {
    id: 'shield', title: '七、净化：维持课堂秩序', icon: 'shield',
    items: [
      <div>进入「<Highlight>屏蔽管理</Highlight>」，营造绿色课堂环境：</div>,
      <><strong>小黑屋机制</strong>：设定警告阈值（如触发 3 次违禁词），学生屏幕自动锁定黑屏，强制冷静。</>,
      <><strong>违禁词库</strong>：内置脏话辱骂、色情低俗、暴力威胁、自残自杀四大词库。系统词和自定义词可分别一键开启或禁用，灵活调控课堂过滤范围。</>,
      <><strong>自定义规则</strong>：添加自定义屏蔽词，支持一键清空，灵活掌控课堂言论。</>,
    ],
  },
  {
    id: 'data', title: '八、丰收：数据管理与导出', icon: 'history',
    items: [
      <div>下课铃响，课堂的价值刚刚开始释放。前往「<Highlight>数据管理</Highlight>」：</div>,
      <><strong>宏观仪表盘</strong>：总课堂数、总参与人次、总交互轮数、平均时长——这些数据是 AI 教学成效的最佳证明。</>,
      <div><strong>一键生成 Word 报告</strong></div>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 15, color: '#475569' }}>
        <div>• <strong>导出对话</strong>：全班聊天实录一键导出，复盘学生思维走向。</div>
        <div>• <strong>导出报表</strong>：自动生成学情统计文档，适合教学案例、课题研究等场景。</div>
      </div>,
    ],
  },
  {
    id: 'backup', title: '九、保障：数据备份与恢复', icon: 'gift',
    items: [
      <div>在「<Highlight>数据管理</Highlight>」底部，我们为您准备了数据保障功能：</div>,
      <><strong>一键备份</strong>：点击「立即备份」，系统自动打包数据库和所有附件文件。</>,
      <><strong>历史管理</strong>：每次备份记录在列表中，可随时下载或恢复到任意历史版本。</>,
      <><strong>跨设备迁移</strong>：A 电脑下载备份文件 → B 电脑上传备份 → 恢复，完整迁移所有数据。</>,
      <><strong>学期重置</strong>：新学期开始？输入"确认清零"清空旧业务数据（保留密码），轻装迎接新生。</>,
    ],
  },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
          break;
        }
      }
    }, { rootMargin: '-80px 0px -60% 0px' });
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', color: '#0f172a' }}>使用指南</h1>
        <p style={{ fontSize: 15, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
          欢迎来到 ClassNode！这份指南将像一位贴心的助教，陪您走完从"系统开机"到"打磨出一堂完美 AI 课"的全过程。
        </p>
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        {/* 左侧目录 */}
        <div style={{
          position: 'sticky', top: 24, width: 210, flexShrink: 0,
          background: 'linear-gradient(180deg, #fafbfc 0%, #ffffff 100%)',
          borderRadius: 14, border: '1px solid #e8ecf0',
          padding: 0, overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* 头部 */}
          <div style={{
            padding: '16px 20px 12px',
            borderBottom: '1px solid #f1f4f7',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569', letterSpacing: 1 }}>
                目 录
              </span>
              <span style={{
                fontSize: 10, color: '#94a3b8', fontWeight: 500, marginLeft: 'auto',
                background: '#f1f4f7', padding: '1px 7px', borderRadius: 6,
              }}>
                {sectionList.length}
              </span>
            </div>
          </div>

          {/* 列表 */}
          <div style={{
            flex: 1, overflow: 'auto', padding: '4px 0',
            display: 'flex', flexDirection: 'column', gap: 0,
          }}>
            {sectionList.map((item, idx) => {
              const isActive = activeSection === item.id;
              return (
                <a key={item.id} href={`#${item.id}`} onClick={e => {
                  e.preventDefault();
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                  setActiveSection(item.id);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 16px 8px 16px',
                  textDecoration: 'none',
                  transition: 'all 0.18s',
                  position: 'relative',
                  background: isActive
                    ? 'linear-gradient(90deg, #eff6ff 0%, #ffffff 100%)'
                    : 'transparent',
                  borderLeft: `3px solid ${isActive ? '#3b82f6' : 'transparent'}`,
                }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
                  {/* 编号 */}
                  <div style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: isActive ? '#3b82f6' : '#f1f4f9',
                    color: isActive ? '#ffffff' : '#94a3b8',
                    transition: 'all 0.18s',
                  }}>
                    {idx + 1}
                  </div>

                  {/* 两行标题 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#1e3a5f' : '#334155',
                      lineHeight: 1.4,
                    }}>
                      {item.mainLabel}
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 400,
                      color: isActive ? '#64748b' : '#94a3b8',
                      lineHeight: 1.3, marginTop: 1,
                    }}>
                      {item.subLabel}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>

        {/* 右侧内容 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map(section => (
            <div key={section.id} id={section.id} style={{
              background: 'white', borderRadius: 12,
              border: '1px solid #eef2f6', overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              scrollMarginTop: 80,
            }}>
              {/* 标题栏 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '14px 20px',
                borderBottom: '1px solid #f1f5f9',
                background: '#fafbfc',
              }}>
                <span style={{ flexShrink: 0, display: 'flex' }}>
                  <SectionIcon name={section.icon} />
                </span>
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#0f172a' }}>
                  {section.title}
                </h2>
              </div>

              {/* 内容 */}
              <div style={{ padding: '16px 20px', lineHeight: 2, fontSize: 15, color: '#475569' }}>
                {section.items.map((item, j) => (
                  <div key={j} style={{ marginBottom: j < section.items.length - 1 ? 12 : 0 }}>{item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
