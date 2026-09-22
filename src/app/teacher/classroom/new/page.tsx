'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { TeacherPageHeader } from '@/lib/components';
import type { AgentSummary, ClassGroup, ClassSummary, WebappSummary } from '@/lib/types';

type CreateMode = 'standard' | 'group' | 'advanced';

export default function NewClassroomPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  /**
   * 可关联的探究网页。**单选**（`string`，P2.3 起）—— 一个课堂只关联一个网页。
   *
   * 从前这里是 `Set<string>`（多选），但学生端一直只加载 `webapps[0]`，第二个及以后
   * **从未生效过**（勾了 A、B、C，学生拿到哪个是随机的）。单选是把界面与实际行为对齐。
   */
  const [webapps, setWebapps] = useState<WebappSummary[]>([]);
  const [selectedWebappId, setSelectedWebappId] = useState('');
  /**
   * 网页列表自身的加载结果。它**不阻断创建**（网页是可选配置），但要在界面上说出来：
   * 「没勾」与「加载失败导致没得勾」在提交流程里长得一模一样，而后者建出来的课堂
   * 会在课堂里显示「老师还没有添加探究网页」—— 教师找不到原因。
   */
  const [webappLoadError, setWebappLoadError] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [mode, setMode] = useState<CreateMode>('standard');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [groupAgentIds, setGroupAgentIds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [openDropdownGroupId, setOpenDropdownGroupId] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const groupRequestRef = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const classSectionRef = useRef<HTMLDivElement>(null);
  const agentSectionRef = useRef<HTMLDivElement>(null);
  /** `agentSectionRef` 的兄弟：网页列表加载失败时，提交后要滚到这里（原因写在这一块里）。 */
  const webappSectionRef = useRef<HTMLDivElement>(null);
  /** 三件套「至少一项」没满足时的那条横幅：它挂在操作按钮正上方，滚到它就能同时看到按钮。 */
  const materialErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    // 网页列表**单独一条**：它挂了不该让「智能体 / 班级」也一起判失败 ——
    // 后者是必填项，前者是可选配置，两者的失败后果完全不同。
    void api.getWebapps()
      .then(list => { if (mountedRef.current) setWebapps(list); })
      .catch(error => {
        if (mountedRef.current) setWebappLoadError(error instanceof Error ? error.message : '请求异常');
      });
    Promise.all([api.getAgents(), api.getClasses()]).then(([a, c]) => {
      if (!mountedRef.current) return;
      setAgents(a.filter((agent) => agent.enabled !== false));
      setClasses(c);
    }).catch(error => {
      if (mountedRef.current) setFieldErrors({ submit: `课堂配置加载失败：${error instanceof Error ? error.message : '请求异常'}` });
    }).finally(() => {
      if (mountedRef.current) setLoadingOptions(false);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const clearError = (field: string) => {
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const selectClass = (id: string) => {
    const requestId = ++groupRequestRef.current;
    setSelectedClassId(id);
    clearError('class');
    clearError('submit');
    setClassGroups([]);
    setGroupAgentIds({});
    setLoadingGroups(true);
    api.getGroups(id).then(groups => {
      if (!mountedRef.current || requestId !== groupRequestRef.current) return;
      setClassGroups(groups || []);
    }).catch(() => {
      if (!mountedRef.current || requestId !== groupRequestRef.current) return;
      setClassGroups([]);
      setFieldErrors(prev => ({ ...prev, submit: '班级分组加载失败，请重新选择班级后再试' }));
    }).finally(() => {
      if (mountedRef.current && requestId === groupRequestRef.current) setLoadingGroups(false);
    });
  };

  const handleModeChange = (newMode: CreateMode) => {
    setMode(newMode);
    clearError('mode');
    // 切换到分组/高级模式时，若当前选中的班级无分组则取消选中
    if ((newMode === 'group' || newMode === 'advanced') && selectedClassId) {
      const cls = classes.find(c => c.id === selectedClassId);
      if (!cls || (cls._count?.groups || 0) === 0) {
        groupRequestRef.current += 1;
        setSelectedClassId('');
        setClassGroups([]);
        setGroupAgentIds({});
        setLoadingGroups(false);
      }
    }
  };

  const handleCreate = async () => {
    if (savingRef.current) return;
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = '请输入课堂标题';
    // 参与班级与三件套是**两件事**（班级是学生名册的来源，必填；三件套至少选一项），
    // 所以这里也是两条独立的判据 —— 报错文案要能告诉教师该去哪一栏动手。
    if (!selectedClassId) errors.class = '请选择班级';
    if (mode === 'advanced') {
      const allAssigned = classGroups.every(g => groupAgentIds[g.id]);
      if (loadingGroups) errors.groupAgents = '班级分组仍在加载，请稍候';
      else if (classGroups.length === 0) errors.groupAgents = '当前班级没有可用分组，请重新选择班级';
      else if (!allAssigned) errors.groupAgents = '请为每个小组分配智能体';
    } else if (!selectedAgentId && !selectedWebappId) {
      // 三件套「至少一项」：AI 智能体 / 探究网页 / 学习单。
      // ⚠️ 这条**只是即时反馈**，服务端 `classroomMaterialError` 才是权威（前端能被绕过）。
      // 两边的判据必须一致 —— 只选网页不选智能体是**合法**的，别在这里拦住提交。
      // 将来做学习单：把学习单那一项并进这个条件即可（`|| Boolean(selectedWorksheetId)`），
      // 结构不用动。
      errors.material = '请至少选择一项课堂内容：AI 智能体 / 探究网页（学习单即将支持）';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      window.setTimeout(() => {
        // ⚠️ `agentSectionRef` 只在**非高级模式**下挂着（那一块用 `mode !== 'advanced'` 包着）。
        // 高级模式里分组配置是另一个 DOM 节点，ref 是 null ⇒ 原来的写法在高级模式下
        // 「按了发起课堂但屏幕没动」。加 `?.` 之外的判空是必要的：`null?.scrollIntoView()`
        // 本来就安全，真正的问题是**没有备选目标**，所以补上网页区那一支。
        if (errors.title) titleInputRef.current?.focus();
        else if (errors.class) classSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 三件套的错误挂在按钮正上方，滚到它时按钮还在视野里（`block: 'center'`）。
        else if (errors.material) materialErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else if (agentSectionRef.current) agentSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 网页列表加载失败**不阻断创建**（它是可选配置），但提交时必须把教师送到那一块 ——
        // 否则他会在课堂里看到「老师还没有添加探究网页」，而原因写在另一个屏幕外的地方。
        else if (webappLoadError && webappSectionRef.current) webappSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    // 探究网页**单选**：数组里最多一个元素（或空数组）。字段名仍是复数 ——
    // 服务端要兼容旧前端发来的多元素数组（按「取第一个」处理，见 resolveSingleWebappId）。
    const webappIds = selectedWebappId ? [selectedWebappId] : [];
    try {
      if (mode === 'advanced') {
        const groups = classGroups.map(g => ({
          name: g.name,
          agentId: groupAgentIds[g.id],
          studentIds: g.studentIds || [],
        }));
        const result = await api.createAdvancedClassroom({
          title: title || undefined,
          classId: selectedClassId,
          groups,
          webappIds,
        });
        router.push(`/teacher/classroom?id=${result.id}`);
      } else {
        const result = await api.createClassroom({
          title: title || undefined,
          classIds: [selectedClassId],
          // 智能体是**选填**（三件套之一）⇒ 没选就发空数组，**不要发 `['']`**：
          // 那会让「没选」在服务端表现为「给了一个空 id」，虽然两边都会过滤掉，
          // 但它把「空数组 = 没选」这条明确语义弄脏了（也让人以为智能体是必填的）。
          agentIds: selectedAgentId ? [selectedAgentId] : [],
          mode: mode === 'group' ? 'group' : 'standard',
          webappIds,
        });
        router.push(`/teacher/classroom?id=${result.id}`);
      }
    } catch (e: unknown) {
      if (mountedRef.current) setFieldErrors({ submit: e instanceof Error ? e.message : '创建课堂失败' });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const selectedClass = classes.find((classItem) => classItem.id === selectedClassId);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedWebapp = webapps.find((webapp) => webapp.id === selectedWebappId);
  const configuredGroupCount = classGroups.filter((group) => groupAgentIds[group.id]).length;
  const modeLabel = mode === 'standard' ? '标准模式' : mode === 'group' ? '分组模式' : '高级模式';
  const steps = [
    { label: '课堂信息', complete: Boolean(title.trim()) },
    { label: '参与班级', complete: Boolean(selectedClassId) },
    {
      // 「课堂内容」= 三件套（AI 智能体 / 探究网页 / 学习单），并入这一步、**不加第 4 格**。
      //
      // 🔴 完成度判据是「**任一项已选**」，不是「智能体已选」（P2.3 之前是后者）。
      //    改这一处是有原因的：那条旧判据会把「只选了探究网页」显示成这一步没完成，
      //    而服务端和提交逻辑都允许这么建 —— 进度条会说谎，教师会以为自己没弄完。
      //    将来做学习单：把学习单那一项并进 `Boolean(...) ||` 这一串即可。
      label: '课堂内容',
      complete: mode === 'advanced'
        ? classGroups.length > 0 && configuredGroupCount === classGroups.length
        : Boolean(selectedAgentId) || Boolean(selectedWebappId),
    },
  ];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <TeacherPageHeader title="创建新课堂" description="选好模式与班级，再从 AI 智能体 / 探究网页里挑至少一项，即可发起课堂。" />

      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24 }}>
        <div className="new-classroom-steps" aria-label="课堂创建进度">
          {steps.map((step, index) => (
            <div key={step.label} className={step.complete ? 'is-complete' : ''}>
              <span>{step.complete ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : index + 1}</span>
              <strong>{step.label}</strong>
            </div>
          ))}
        </div>

        {/* 课堂标题 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <label htmlFor="classroom-title" style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            课堂标题
            <span className="required-field-mark">必填</span>
          </label>
          <input ref={titleInputRef} id="classroom-title" className="input" value={title} onChange={e => { setTitle(e.target.value); clearError('title'); }}
            placeholder="如：第三单元英语对话练习"
            aria-invalid={Boolean(fieldErrors.title)}
            aria-describedby={fieldErrors.title ? 'classroom-title-error' : undefined}
            style={{ borderColor: fieldErrors.title ? '#ef4444' : undefined }} />
          {fieldErrors.title && <div id="classroom-title-error" role="alert" style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.title}
          </div>}
        </div>

        {/* 选择参与模式 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            选择参与模式
          </div>
          <div className="new-classroom-mode-grid" role="group" aria-label="课堂参与模式">
            {[
              {
                id: 'standard' as CreateMode,
                label: '标准模式',
                desc: '学生选择姓名加入，以个人身份与AI互动',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  </svg>
                ),
              },
              {
                id: 'group' as CreateMode,
                label: '分组模式',
                desc: '学生选择小组加入，同组共享一个对话窗口',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" />
                  </svg>
                ),
              },
              {
                id: 'advanced' as CreateMode,
                label: '高级模式',
                desc: '每个小组绑定不同的AI智能体，分组独立对话',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                ),
              },
            ].map(m => (
              <button type="button" key={m.id} onClick={() => handleModeChange(m.id)} aria-pressed={mode === m.id}
                className="new-classroom-mode-card"
                style={{
                  flex: 1, padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                  border: `2px solid ${mode === m.id ? '#2563eb' : '#e2e8f0'}`,
                  background: mode === m.id ? '#eef2ff' : 'white',
                  transition: 'all 0.12s',
                  display: 'flex', flexDirection: 'column', textAlign: 'left', font: 'inherit',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: `2px solid ${mode === m.id ? '#2563eb' : '#cbd5e1'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {mode === m.id && (
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb' }} />
                    )}
                  </div>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{m.label}</span>
                  {m.id === 'standard' && <span className="recommended-mode-tag">推荐</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: '#64748b', lineHeight: 1.4, marginLeft: 24, display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1 }}>
                  <span style={{ flexShrink: 0, marginTop: 2, color: mode === m.id ? '#2563eb' : '#94a3b8' }}>{m.icon}</span>
                  <span>{m.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 选择班级 */}
        <div ref={classSectionRef} style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
            选择班级
            <span className="required-field-mark">必填</span>
            {mode !== 'standard' && (
              <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>（仅显示已分组的班级）</span>
            )}
          </div>
          {loadingOptions ? (
            <div className="new-classroom-loading" role="status">正在加载班级与智能体...</div>
          ) : classes.length === 0 ? (
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
              暂无可选班级，请先在「班级管理」中创建班级
            </div>
          ) : (
            <div className="new-classroom-class-grid">
              {classes.map(c => {
                const hasGroups = (c._count?.groups || 0) > 0;
                const isSelected = selectedClassId === c.id;
                const isDisabled = (mode === 'group' || mode === 'advanced') && !hasGroups;
                return (
                  <button type="button" key={c.id} onClick={() => selectClass(c.id)} disabled={isDisabled}
                    aria-pressed={isSelected}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 10, userSelect: 'none',
                      border: `1.5px solid ${fieldErrors.class ? '#ef4444' : isSelected ? '#2563eb' : '#e2e8f0'}`,
                      background: isSelected ? '#eef2ff' : 'white',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                      fontSize: "0.875rem",
                      transition: 'all 0.12s', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: isSelected ? '#2563eb' : '#f1f5f9', color: isSelected ? 'white' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: "0.75rem", color: '#94a3b8', marginTop: 1 }}>
                        <span>{c._count?.students || 0} 名学生</span>
                        {hasGroups && (
                          <>
                            <span>·</span>
                            <span style={{ color: '#7c3aed' }}>{c._count.groups} 个小组</span>
                          </>
                        )}
                      </div>
                    </div>
                    {isDisabled ? (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#fef3c7', color: '#b45309', fontWeight: 500, flexShrink: 0 }}>仅限标准模式</span>
                    ) : hasGroups ? (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#f5f3ff', color: '#7c3aed', fontWeight: 500, flexShrink: 0 }}>已分组</span>
                    ) : (
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#f1f5f9', color: '#94a3b8', fontWeight: 500, flexShrink: 0 }}>无分组</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {selectedClassId && loadingGroups && <div className="new-classroom-inline-status" role="status">正在读取班级分组...</div>}
          {fieldErrors.class && <div role="alert" style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.class}
          </div>}
        </div>

        {/* 高级模式：每个组分配智能体 */}
        {selectedClassId && mode === 'advanced' && classGroups.length > 0 && (
          <div ref={agentSectionRef} style={{
            background: '#fafbfc', borderRadius: 10,
            border: `1px solid ${fieldErrors.groupAgents ? '#ef4444' : '#eef2f6'}`,
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
              为每个小组分配AI智能体
              <span className="required-field-mark">必填</span>
            </div>
            {classGroups.map((g, i) => (
              <div key={g.id} className="new-classroom-group-row" style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
                marginBottom: 8, background: 'white',
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: '#2563eb', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500, color: '#0f172a' }}>{g.name}</div>
                  <div style={{ fontSize: "0.688rem", color: '#94a3b8' }}>{(g.studentIds?.length || 0)} 名学生</div>
                </div>
                <div className="new-classroom-group-agent" style={{ position: 'relative', width: 200, flexShrink: 0 }}>
                  <button type="button"
                    onClick={() => setOpenDropdownGroupId(openDropdownGroupId === g.id ? null : g.id)}
                    aria-expanded={openDropdownGroupId === g.id}
                    style={{
                      width: '100%', fontFamily: 'inherit',
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 10px', borderRadius: 6, fontSize: "0.813rem",
                      border: '1px solid #e2e8f0', cursor: 'pointer',
                      background: 'white', minHeight: 32,
                    }}>
                    {groupAgentIds[g.id] ? (() => {
                      const agent = agents.find(a => a.id === groupAgentIds[g.id]);
                      const logoUrl = agent?.logo ? (agent.logo.startsWith('/') ? `${getApiBaseUrl()}${agent.logo}` : agent.logo) : null;
                      return <>
                        {logoUrl ? (
                          <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", fontWeight: 700 }}>{agent?.name?.[0] || '?'}</div>
                        )}
                        <span style={{ color: '#0f172a' }}>{agent?.name || ''}</span>
                      </>;
                    })() : (
                      <span style={{ color: '#94a3b8' }}>选择AI智能体</span>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ marginLeft: 'auto' }}><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                  {openDropdownGroupId === g.id && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                      marginTop: 4, background: 'white', borderRadius: 8,
                      border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      maxHeight: 200, overflowY: 'auto',
                    }}>
                      {agents.map(a => {
                        const logoUrl = a.logo ? (a.logo.startsWith('/') ? `${getApiBaseUrl()}${a.logo}` : a.logo) : null;
                        return (
                          <button type="button" key={a.id} onClick={() => {
                            setGroupAgentIds(prev => ({ ...prev, [g.id]: a.id }));
                            clearError('groupAgents');
                            setOpenDropdownGroupId(null);
                          }}
                          style={{
                            width: '100%', border: 0, fontFamily: 'inherit', textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', cursor: 'pointer', fontSize: "0.813rem",
                            background: groupAgentIds[g.id] === a.id ? '#eef2ff' : 'white',
                            transition: 'background 0.1s',
                          }}>
                            {logoUrl ? (
                              <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.625rem", fontWeight: 700 }}>{a.name[0]}</div>
                            )}
                            <span>{a.name}</span>
                            {groupAgentIds[g.id] === a.id && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563eb" stroke="white" strokeWidth="3" style={{ marginLeft: 'auto' }}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {classGroups.length > 0 && fieldErrors.groupAgents && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.groupAgents}
            </div>}
          </div>
        )}

        {openDropdownGroupId && (
          <div onClick={() => setOpenDropdownGroupId(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} />
        )}

        {/* 标准/分组模式：选择AI智能体 */}
        {mode !== 'advanced' && (
          <div ref={agentSectionRef} style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '16px 20px', marginBottom: 20,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>
              选择AI智能体
              {/* 三件套（AI 智能体 / 探究网页 / 学习单）每一项都是选填，至少一项即可 ——
                  这里从前写的是「必填」，与实际规则不符：只挂一个探究网页也能建课堂。 */}
              <span style={{ fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8' }}>选填 · 三件套任选其一</span>
            </div>
            {loadingOptions ? (
              <div className="new-classroom-loading" role="status">正在加载智能体...</div>
            ) : agents.length === 0 ? (
              <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
                暂无可选智能体，请先在「AI智能体」中接入
              </div>
            ) : (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8,
                padding: 8, borderRadius: 8,
                border: `1.5px solid ${fieldErrors.agent ? '#ef4444' : 'transparent'}`,
                transition: 'border-color 0.15s',
              }}>
                {agents.map(a => {
                  const logoUrl = a.logo ? (a.logo.startsWith('/') ? `${getApiBaseUrl()}${a.logo}` : a.logo) : null;
                  return (
                    <button type="button" key={a.id}
                      // 单选：点中的那个成为唯一选择，**再点一次取消**（它是选填项，必须能取消）。
                      // ⚠️ 与下面探究网页那一块同一套语义。从前这里是一次性写入
                      //    （`setSelectedAgentId(a.id)`），于是选中之后再也回不到未选状态。
                      onClick={() => { setSelectedAgentId(prev => (prev === a.id ? '' : a.id)); clearError('agent'); clearError('material'); }}
                      aria-pressed={selectedAgentId === a.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                        borderRadius: 8, userSelect: 'none',
                        border: `1.5px solid ${selectedAgentId === a.id ? '#2563eb' : '#e2e8f0'}`,
                        background: selectedAgentId === a.id ? '#eef2ff' : 'white',
                        cursor: 'pointer', fontSize: "0.875rem", fontWeight: selectedAgentId === a.id ? 500 : 400,
                        transition: 'all 0.12s', fontFamily: 'inherit',
                      }}>
                      {logoUrl ? (
                        <img src={logoUrl} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{
                          width: 22, height: 22, borderRadius: 5,
                          background: 'linear-gradient(135deg, #667eea, #764ba2)',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: "0.688rem", fontWeight: 700, flexShrink: 0,
                        }}>
                          {a.name[0]}
                        </div>
                      )}
                      <span style={{ color: '#0f172a' }}>{a.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {fieldErrors.agent && <div style={{ fontSize: "0.75rem", color: '#ef4444', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.agent}
            </div>}
          </div>
        )}

        {/* 关联探究网页（可选）—— 与「AI 配置」同属进度条的第 3 步。
            ⚠️ 三种模式下都渲染：网页与「选哪个智能体」无关，只被 `mode !== 'advanced'`
            包起来会让高级模式永远关联不上网页，而且不报任何错。 */}
        <div ref={webappSectionRef} style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '16px 20px', marginBottom: 20,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>
            关联探究网页
            <span style={{ fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8' }}>选填 · 只能选一个 · 三件套任选其一</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 12 }}>
            学生在「探究助手」里会打开这个网页。<strong style={{ fontWeight: 600 }}>一个课堂只关联一个网页</strong>；
            不选也可以 —— 那就记得至少选一个 AI 智能体。
          </div>
          {webappLoadError ? (
            <div role="alert" style={{ padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: "0.813rem", color: '#92400e', lineHeight: 1.7 }}>
              探究网页列表没有加载成功（{webappLoadError}）。
              这次创建的课堂**不会带任何网页**；网页本身没丢，可以去「探究网页」页确认后再发一次课堂。
            </div>
          ) : webapps.length === 0 ? (
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
              还没有探究网页，可以先在「探究网页」里添加
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {webapps.map(w => {
                const selected = selectedWebappId === w.id;
                return (
                  <button type="button" key={w.id} aria-pressed={selected}
                    // 单选：点中的那个成为唯一选择，再点一次取消（它是选填项，必须能取消）。
                    // ⚠️ 不要写回 `Set` 那套 add/delete —— 那正是要改掉的旧语义。
                    onClick={() => {
                      setSelectedWebappId(prev => (prev === w.id ? '' : w.id));
                      clearError('material');
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                      padding: '8px 14px', borderRadius: 8, userSelect: 'none', textAlign: 'left',
                      border: `1.5px solid ${selected ? '#2563eb' : '#e2e8f0'}`,
                      background: selected ? '#eef2ff' : 'white',
                      cursor: 'pointer', fontSize: "0.875rem", fontWeight: selected ? 500 : 400,
                      transition: 'all 0.12s', fontFamily: 'inherit', maxWidth: 260,
                    }}>
                    <span style={{ color: '#0f172a', wordBreak: 'break-all' }}>{w.name}</span>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8', wordBreak: 'break-all' }}>入口 {w.entryPath}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 三件套「至少一项」的横幅。
            它跨了「AI 智能体」与「探究网页」两块，所以不能挂在其中任何一块的错误位上
            —— 挂在智能体那块会让「只选了网页」的教师以为问题出在网页那一栏。
            位置紧贴操作按钮：教师点「发起课堂」时它就在眼前，不需要往上翻。 */}
        {fieldErrors.material && <div ref={materialErrorRef} role="alert" style={{
          fontSize: "0.813rem", color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16, marginTop: -4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {fieldErrors.material}
        </div>}

        {fieldErrors.submit && <div role="alert" style={{ fontSize: "0.75rem", color: '#ef4444', marginBottom: 16, marginTop: -4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {fieldErrors.submit}
        </div>}

        {/* 操作按钮 */}
        <div className="new-classroom-actions">
          <div className="new-classroom-summary" aria-live="polite">
            <strong>{title.trim() || '尚未填写课堂标题'}</strong>
            <span>
              {modeLabel} · {selectedClass?.name || '未选班级'} · {mode === 'advanced'
                ? `${configuredGroupCount}/${classGroups.length} 个小组已配置`
                : selectedAgent?.name || '未选智能体'}
              {selectedWebapp ? ` · 探究网页：${selectedWebapp.name}` : ''}
            </span>
          </div>
          <div className="new-classroom-action-buttons">
            <button className="btn btn-secondary" onClick={() => router.push('/teacher')}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
              取消
            </button>
            <button className="btn btn-primary btn-lg" onClick={handleCreate}
              disabled={saving || loadingOptions || (mode === 'advanced' && loadingGroups)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {saving ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                  </svg>
                  创建中...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  {mode === 'group' ? '发起课堂（分组模式）' : mode === 'advanced' ? '发起课堂（高级模式）' : '发起课堂'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
