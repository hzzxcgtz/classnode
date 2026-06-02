'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AboutPage() {
  const router = useRouter();
  const [logoErr, setLogoErr] = useState(false);

  const B = (props: { children: React.ReactNode }) =>
    <strong style={{ fontWeight: 700, color: '#0f172a' }}>{props.children}</strong>;
  const K = (props: { children: React.ReactNode }) =>
    <span style={{ display: 'inline-block', background: '#eef2ff', color: '#2563eb', padding: '0 8px', borderRadius: 4, fontWeight: 600 }}>{props.children}</span>;
  const N = (props: { children: React.ReactNode }) =>
    <span style={{ color: '#2563eb', fontWeight: 700 }}>{props.children}</span>;
  const P = (props: { children: React.ReactNode }) =>
    <span style={{ display: 'inline-block', background: '#f0fdf4', color: '#16a34a', padding: '0 8px', borderRadius: 4, fontWeight: 600 }}>{props.children}</span>;

  return (
    <div style={{ padding: '32px 40px', maxWidth: 760, margin: '0 auto' }}>
      <button onClick={() => router.back()}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 20 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        返回
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        {logoErr ? (
          <div style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 22, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>C</div>
        ) : (
          <img src="/logo.png" alt="ClassNode" style={{ width: 52, height: 52, borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }} onError={() => setLogoErr(true)} />
        )}
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>ClassNode · AI 互动课堂系统</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '4px 0 0' }}>版本 1.0.5</p>
        </div>
      </div>

      {/* 1. 关于本应用 */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          关于
        </h2>
        <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0', lineHeight: 1.8, fontSize: 14, color: '#334155' }}>
          <p style={{ margin: '0 0 10px' }}>
            ClassNode 是一款专为课堂教学场景设计的 AI 互动课堂系统。教师可以快速创建课堂、导入班级学生名单，并通过配置 AI 智能体与学生进行一对一的实时对话互动。系统提供课堂看板监控、对话记录分析、学情数据导出等功能，帮助教师直观掌握每位学生的参与情况。
          </p>
          <p style={{ margin: '0 0 10px' }}>
            本应用极其轻量化，无需复杂的服务器部署和网络配置，适合教师在个人本地电脑上直接安装使用。数据存储采用 SQLite 本地数据库，所有数据保存在本机，无需依赖外部云服务。
          </p>
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #eef2f6', fontSize: 13, color: '#64748b', lineHeight: 1.8 }}>
            <div>开发者：张星昌 · 杭州市拱墅区教育研究院</div>
            <div>联系邮箱：<a href="mailto:hzzxc2012@163.com" style={{ color: '#2563eb', textDecoration: 'none' }}>hzzxc2012@163.com</a></div>
          </div>
        </div>
      </section>

      {/* 2. 详细使用指南 */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
          详细使用指南
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            {
              title: '一、首次使用',
              items: [
                '启动应用后，通过浏览器访问教师控制台。首次进入需设置管理密码（至少6位），用于保护教师操作界面。',
                '设置密码后自动进入控制台主页。如需修改密码，可在「设置」页面中操作。',
              ],
            },
            {
              title: '二、配置 AI 智能体',
              items: [
                <>进入<K>AI智能体</K>页面，点击<K>添加智能体</K>。</>,
                <>选择智能体平台：支持 <K>Coze</K>（扣子低代码接入）、<K>Coze Agent</K>（扣子编程接入）、<K>智谱清言</K>（暂未支持）、<K>OpenAI 兼容接口</K>（暂未支持）四种类型。</>,
                <>根据所选平台填写对应的 <B>API 信息</B>（API Key、Bot ID、API URL 等），给智能体设置一个本地展示名称。</>,
                <>添加后可在列表中点击<K>测试连接</K>验证配置是否正确。</>,
                <>智能体可随时启用或禁用，已禁用的智能体在创建课堂时不可选。</>,
              ],
            },
            {
              title: '三、管理班级与学生',
              items: [
                <>进入<K>班级管理</K>页面，点击<K>创建班级</K>并输入班级名称。</>,
                '创建完成后，左侧班级列表会自动选中该班级，右侧显示学生管理面板。',
                '添加学生的方式有三种：',
                <div style={{ paddingLeft: 20, color: '#64748b', lineHeight: 2 }}>
                  <div><B>(1)</B> 手动添加：点击「添加学生」，依次输入姓名、学号、标签。</div>
                  <div><B>(2)</B> 粘贴名单：点击「粘贴名单」，将学生姓名列表（每行一个姓名）粘贴后批量创建，系统自动生成序号作为学号。</div>
                  <div><B>(3)</B> 批量导入：点击「批量导入」，上传 JSON 或 CSV 文件（可从「下载模板」获取模板格式）。</div>
                </div>,
                <>学生列表支持编辑姓名、修改标签、删除单个学生等操作。</>,
                <>在<K>分组管理</K>标签页中，可以创建多个小组，将未分配的学生通过拖拽或多选的方式分配到各个小组中。</>,
                '支持鼠标拖拽框选（按下鼠标拖出矩形区域）来一次性选中多名学生，然后拖入选定的组内。',
                <>每个小组右上角的<K>全部移除</K>按钮可将该组所有学生移回未分配区。</>,
              ],
            },
            {
              title: '四、创建课堂',
              items: [
                <>进入<K>课堂管理</K>页面，点击<K>创建新课堂</K>。</>,
                '填写课堂标题，选择一种课堂模式：',
                <div style={{ paddingLeft: 20, color: '#64748b', lineHeight: 2 }}>
                  <div><B>(1)</B> 标准模式：所有学生各自独立与 AI 对话，每位学生使用一个互动码加入。</div>
                  <div><B>(2)</B> 分组模式：以小组为单位，每组一个互动码，组内共享同一个 AI 对话窗口。</div>
                  <div><B>(3)</B> 高级模式：每个小组可绑定不同的 AI 智能体，各自独立的互动码。</div>
                </div>,
                <>选择参与班级和 AI 智能体，点击<K>创建</K>即可生成课堂互动码。</>,
                '创建成功后自动返回课堂管理主页，可看到该课堂处于「进行中」状态。',
              ],
            },
            {
              title: '五、学生加入课堂',
              items: [
                <>教师在课堂上展示互动码（4位数字），学生通过浏览器访问学生端页面（其他设备将 <N>localhost</N> 换成教师 IP 即可，如 <N>http://192.168.x.x:{'3000'}/classroom</N>）。</>,
                '学生输入互动码后，从列表中选择自己的姓名（标准模式）或选择小组（分组/高级模式），即可加入课堂。',
                '加入后学生可看到 AI 智能体头像和对话界面，输入文字开始与 AI 对话。',
                '学生端支持发送文字消息、上传图片附件，对话记录实时保存。',
              ],
            },
            {
              title: '六、课堂看板监控',
              items: [
                <>在<K>课堂管理</K>页面点击<K>进入课堂</K>，打开课堂看板。</>,
                '看板左侧按学号或分组展示所有学生的卡片，每张卡片显示学生姓名、在线/离线状态、已对话轮数、最近一条对话和 AI 回复预览。',
                '右侧分析面板包含两个部分：',
                <div style={{ paddingLeft: 20, color: '#64748b', lineHeight: 2 }}>
                  <div><B>(1)</B> 高频词云：基于所有学生对话内容生成词云图，直观展示高频词汇。</div>
                  <div><B>(2)</B> 活跃学生 Top 10：按对话轮数排序，展示最活跃的 10 位学生。</div>
                </div>,
                '点击任意学生卡片，右侧弹出抽屉面板，显示该学生的完整对话记录。',
                <>在抽屉中支持<K>清除记录</K>按钮重置该学生的对话（重新开始新会话）。</>,
                <>点击学生卡片右上角的<K>全屏</K>按钮，可切换到全屏模式单独展示该学生的对话内容，适合投屏展示。</>,
                <><B>全屏模式下</B>顶部工具栏可调节卡片列数（2-6列），方便在大屏上同时查看多名学生。</>,
                <>看板顶部工具栏支持<P>暂停课堂</P>（学生端停止对话）、<P>结束课堂</P>（回收互动码，移入历史记录）。</>,
              ],
            },
            {
              title: '七、历史数据与导出',
              items: [
                <>课堂结束后，进入<K>历史数据</K>页面查看所有已结束的课堂记录。</>,
                '列表展示每堂课的名称、创建时间、结束时间、时长、参与人数和交互量。',
                <>点击<K>对话</K>按钮可导出该课堂的全班对话记录 Word 文档（.docx）。</>,
                <>点击<K>报表</K>按钮可导出该课堂的学情统计数据 Word 文档（.docx）。</>,
                '页面顶部的统计卡片汇总了历史课堂的总数、总参与学生数、总交互轮数和平均时长。',
              ],
            },
            {
              title: '八、数据备份与恢复',
              items: [
                <>在<K>历史数据</K>页面的数据备份区域，点击<K>立即备份数据库</K>可将当前所有数据备份到本地文件。</>,
                '备份文件列表显示所有历史备份的文件名、创建时间和大小。',
                '每个备份文件右侧有「恢复」和「删除」按钮：',
                <div style={{ paddingLeft: 20, color: '#64748b', lineHeight: 2 }}>
                  <div>- <B>恢复</B>：用该备份文件覆盖当前数据库（操作前会有警告提示）。</div>
                  <div>- <B>删除</B>：删除该备份文件（需二次确认）。</div>
                </div>,
                <>如需清空所有数据，点击<K>初始化清零</K>按钮，输入「确认清零」后执行。清零会删除所有课堂、班级、学生和智能体数据，但保留管理员密码设置。</>,
                <><B>建议</B>在重要操作前先创建数据库备份，以防数据丢失。</>,
              ],
            },
            {
              title: '九、设置',
              items: [
                <>在左侧导航栏底部（屏幕左下角）点击<K>设置</K>，可修改管理员密码。</>,
              ],
            },
          ].map((section, i) => (
            <div key={i} style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px', color: '#0f172a' }}>{section.title}</h3>
              <div style={{ margin: 0, lineHeight: 2, fontSize: 14, color: '#475569' }}>
                {section.items.map((item, j) => (
                  <div key={j}>{item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
