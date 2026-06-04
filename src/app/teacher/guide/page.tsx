'use client';

const Highlight = (props: { children: React.ReactNode }) =>
  <span style={{ fontWeight: 600, color: '#2563eb' }}>{props.children}</span>;

const sections = [
  {
    title: '一、首次使用与安全设置',
    icon: 'rocket',
    items: [
      <><strong>启动应用</strong>：运行程序后，通过浏览器访问教师控制台即可进入系统。</>,
      <><strong>设置密码</strong>：首次进入系统需设置一个管理密码（至少 6 位），用于保护教师操作界面的数据安全。</>,
      <><strong>密码管理</strong>：设置完成后将自动进入控制台主页。如后续需修改密码，可前往 <Highlight>修改密码</Highlight> 进行操作。</>,
    ],
  },
  {
    title: '二、配置 AI 智能体',
    icon: 'bot',
    items: [
      <><strong>添加智能体</strong>：进入 <Highlight>AI 智能体</Highlight> 页面，点击「添加智能体」开始配置。</>,
      <><strong>选择平台</strong>：目前系统支持以下主流 AI 平台接入：</>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 14, color: '#475569' }}>
        <div>• <strong>Coze</strong>（扣子低代码接入）— 已支持</div>
        <div>• <strong>Coze Agent</strong>（扣子编程接入）— 已支持</div>
        <div>• <strong>智谱清言</strong> — 敬请期待</div>
        <div>• <strong>OpenAI 兼容接口</strong> — 敬请期待</div>
      </div>,
      <><strong>参数配置</strong>：根据所选平台填写对应的 API 信息（如 API Key、Bot ID、API URL 等），并为该智能体设置一个便于识别的「本地展示名称」。</>,
      <><strong>连通性测试</strong>：添加完成后，在列表中点击 <Highlight>测试连接</Highlight> 验证配置是否生效。</>,
      <><strong>状态管理</strong>：智能体可随时切换启用/禁用状态，禁用的智能体在创建课堂时将不会出现在候选列表中。</>,
    ],
  },
  {
    title: '三、管理班级与学生',
    icon: 'users',
    items: [
      <>进入 <Highlight>班级管理</Highlight> 页面，点击「创建班级」输入班级名称。创建完成后，左侧选中该班级，右侧即可进行学生管理。</>,
      <><strong>导入学生</strong>（支持两种方式）：</>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 14, color: '#475569' }}>
        <div>• <strong>手动添加</strong>：逐个输入姓名，系统自动生成学号，适合少量学生录入。</div>
        <div>• <strong>粘贴名单</strong>：直接粘贴学生姓名列表（每行一个姓名），系统自动生成序号作为学号，适合快速建班。</div>
      </div>,
      <>学生列表支持勾选多个学生进行<strong>批量操作</strong>：可批量修改标签或批量删除，方便快速调整班级成员。</>,
      <><strong>分组管理</strong>：切换至「分组管理」标签页，可创建多个学习小组。支持鼠标拖拽框选一次性选中多名学生，将其拖入指定小组。点击小组右上角的「全部移除」按钮，即可将该组学生退回至未分配区域。</>,
    ],
  },
  {
    title: '四、创建互动课堂',
    icon: 'classroom',
    items: [
      <>进入 <Highlight>课堂管理</Highlight> 页面，点击「创建新课堂」开始创建。</>,
      <><strong>填写基础信息</strong>：输入课堂标题，为本次课堂活动命名。</>,
      <><strong>选择课堂模式</strong>（系统提供三种高阶教学模式）：</>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 14, color: '#475569' }}>
        <div>• <strong>标准模式</strong>：每位学生拥有独立互动码，各自独立与 AI 对话，适合全员参与的通用场景。</div>
        <div>• <strong>分组模式</strong>：以小组为单位，全组共用一个互动码，组内成员共享同一个 AI 对话窗口，便于协作探究。</div>
        <div>• <strong>高级模式</strong>：支持为每个小组绑定不同的 AI 智能体（如针对不同水平的小组提供不同难度的 AI 助手），实现差异化教学。</div>
      </div>,
      <><strong>生成课堂</strong>：选择参与班级和 AI 智能体后，点击创建，系统将生成 4 位数字互动码，课堂状态变更为「进行中」。</>,
      <><strong>课堂设置</strong>：创建完成后，在活跃课堂列表中点击齿轮图标可修改<strong>课堂名称</strong>和<strong>小组绑定智能体</strong>（仅分组/高级模式），修改仅影响后续对话，已有数据不受影响。</>,
    ],
  },
  {
    title: '五、学生端加入与互动',
    icon: 'log-in',
    items: [
      <><strong>访问入口</strong>：教师在屏幕上展示互动码与访问地址。学生使用平板或电脑浏览器访问学生端页面（如 <Highlight>http://192.168.x.x:3001/classroom</Highlight>，将 IP 替换为教师电脑的实际 IP 地址）。</>,
      <><strong>身份认证</strong>：学生输入互动码后，页面顶部显示课堂名称，下方列出可选的学生姓名或小组列表（分组/高级模式下按小组名排序，普通模式按学号排序），点击即可加入课堂。</>,
      <><strong>开始互动</strong>：进入对话界面后，页面顶部显示当前绑定的 AI 智能体头像和名称，欢迎语展示该智能体设定的<strong>开场白</strong>。支持发送文字消息、上传图片附件，AI 回答过程中切换和退出按钮将被暂时禁用，防止消息串扰。所有对话记录会实时同步至教师端。</>,
    ],
  },
  {
    title: '六、课堂看板监控（核心功能）',
    icon: 'monitor',
    items: [
      <>在课堂管理页面点击进行中的课堂，进入 <Highlight>课堂看板</Highlight>。此面板是教师掌控全局的指挥中心。</>,
      <><strong>左侧 — 实时监控卡片</strong>：按学号或分组展示全班学生卡片，实时显示在线/离线状态、已对话轮数，并滚动显示最近一条学生提问及 AI 回复预览，帮助教师精准把控每位学生的学习进度。</>,
      <><strong>右侧 — 实时学情分析</strong>：</>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 14, color: '#475569' }}>
        <div>• <strong>高频词云</strong>：基于全班对话内容动态生成词云图，一秒洞察课堂讨论热点与高频主题。</div>
        <div>• <strong>活跃学生 Top 10</strong>：按对话轮数实时排行，快速发现积极分子与需要关注的学生。</div>
      </div>,
      <><strong>深度查阅与投屏</strong>：点击任意学生卡片，右侧抽屉将展示该生的完整对话记录。支持一键「清除记录」重置会话，清除后该学生端将实时同步回到欢迎界面。点击卡片右上角的「全屏」按钮，可将特定对话投屏展示，全屏模式下顶部工具栏支持调节卡片列数（2-6 列），方便大屏多维对比。</>,
      <><strong>课堂控制</strong>：顶部工具栏支持一键「暂停课堂」（冻结学生端输入）或「结束课堂」（回收互动码并生成历史档案）。活跃课堂列表中每个卡片配有齿轮图标，可随时修改课堂名称或调整小组绑定智能体。</>,
    ],
  },
  {
    title: '七、屏蔽管理',
    icon: 'shield',
    items: [
      <>进入 <Highlight>屏蔽管理</Highlight> 页面，可对学生端的对话内容进行关键词过滤与管理，营造文明健康的课堂交流环境。</>,
      <><strong>自动黑屏设置</strong>：可设定触发屏蔽词的警告次数阈值。当某位学生累计触发警告达到设定次数后，系统将自动对该学生执行黑屏处理（暂停其发送消息权限），设为 0 表示不启用自动黑屏。</>,
      <><strong>自定义屏蔽词</strong>：教师可根据教学需要，自行添加需要屏蔽的关键词。添加后的词会以标签形式展示，每个标签可单独删除，也支持一键清空所有自定义屏蔽词。</>,
      <>系统内置了屏蔽词库管理功能，支持默认屏蔽词的批量导入与恢复操作（该功能为系统预留，暂不提供样本数据）。教师可根据教学需要，在自定义屏蔽词中自行添加管理。</>,
    ],
  },
  {
    title: '八、数据管理沉淀与导出',
    icon: 'history',
    items: [
      <>课堂结束后，进入 <Highlight>数据管理</Highlight> 页面，这些数据将成为教师宝贵的教研资产。</>,
      <><strong>宏观统计</strong>：页面顶部统计卡片汇总了总课堂数、总参与人次、总交互轮数及平均时长，从全局视角了解教学活动的总体规模。</>,
      <><strong>明细列表</strong>：记录每堂课的详尽元数据，包括课堂名称、创建与结束时间、持续时长、参与人数及总交互量，方便快速检索与对比。</>,
      <><strong>一键导出</strong>（Word 格式）— 系统支持两种导出报告：</>,
      <div style={{ paddingLeft: 20, lineHeight: 2, fontSize: 14, color: '#475569' }}>
        <div>• <strong>导出对话</strong>：生成全班完整的对话实录文档，便于课后回溯学生的思维过程。</div>
        <div>• <strong>导出报表</strong>：生成结构化的学情统计报表文档，可直接用于撰写教学案例、教研论文或进行评课反思。</div>
      </div>,
    ],
  },
  {
    title: '九、数据备份与恢复',
    icon: 'shield',
    items: [
      <>系统提供完善的本地数据保障机制，位于 <Highlight>数据管理</Highlight> 页面底部。</>,
      <><strong>立即备份</strong>：点击即可将当前所有数据打包备份至本地。备份列表会按时间顺序显示历史备份的文件名、创建时间和大小。</>,
      <><strong>跨设备迁移</strong>：每项备份记录支持「下载」或「导入备份」操作。在 A 电脑上点击「下载」获取备份文件，在 B 电脑上点击「导入备份」上传该文件即可完成数据迁移，便于更换设备或跨教室共享数据。</>,
      <><strong>恢复与删除</strong>：每个备份文件右侧提供「恢复」和「删除」操作。恢复时将用该备份覆盖当前数据库（系统会弹出安全警告确认）；删除后备份文件将被移除。</>,
      <><strong>初始化清零</strong>：用于彻底清空所有业务数据。操作前需手动输入「确认清零」以防止误触。清零后仅保留管理员密码设置，适合学期更替或更换设备时的数据重置场景。</>,
      <><strong>建议</strong>：在重要操作前先创建数据库备份，以防数据丢失。</>,
    ],
  },
];

const sectionIcons: Record<string, React.ReactNode> = {
  rocket: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></svg>,
  bot: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /><path d="M8 4V2" /><path d="M16 4V2" /><path d="M8 20v2" /><path d="M16 20v2" /></svg>,
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  classroom: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
  'log-in': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>,
  monitor: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
  history: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  shield: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
};

export default function GuidePage() {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', color: '#0f172a' }}>使用指南</h1>
        <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
          了解 AI 互动课堂系统的完整使用流程与功能说明，快速上手各项教学操作。
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sections.map((section, i) => (
          <div key={i} style={{
            background: 'white', borderRadius: 12,
            border: '1px solid #e2e8f0', overflow: 'hidden',
          }}>
            {/* 标题栏 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '16px 24px',
              borderBottom: '1px solid #f1f5f9',
              background: '#fafbfc',
            }}>
              <span style={{ flexShrink: 0, display: 'flex' }}>
                {section.icon && sectionIcons[section.icon]}
              </span>
              <h2 style={{
                fontSize: 15, fontWeight: 600, margin: 0,
                color: '#0f172a',
              }}>{section.title}</h2>
            </div>

            {/* 内容 */}
            <div style={{ padding: '18px 24px', lineHeight: 2, fontSize: 14, color: '#475569' }}>
              {section.items.map((item, j) => (
                <div key={j} style={{ marginBottom: j < section.items.length - 1 ? 10 : 0 }}>{item}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
