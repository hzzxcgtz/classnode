'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getApiBaseUrl } from '@/lib/api-base';
import { TeacherPageHeader } from '@/lib/components';
import type { AgentSummary, ClassGroup, ClassSummary, WebappSummary, WorksheetSummary } from '@/lib/types';

type CreateMode = 'standard' | 'group' | 'advanced';

/** 高级模式里每一格材料的 kind —— 三件套各一格。与 `AdvancedClassroomGroupInput` 的字段一一对应。 */
type GroupMaterialKind = 'agent' | 'webapp' | 'worksheet';

/** 「哪个小组的哪一种材料」—— 展开状态用的键。格式只在这里拼，别在 JSX 里手写。 */
const pickerKey = (groupId: string, kind: GroupMaterialKind) => `${groupId}:${kind}`;

/**
 * 课堂级学习单那一个下拉的展开键。
 *
 * ⚠️ 也走 `pickerKey` 拼（伪 groupId `'classroom'`），**不要在 JSX 里写字符串字面量**：
 * 展开状态是「同时只有一个下拉开着」的依据，键的格式一旦在两处各写一遍，
 * 迟早分叉成两个不同的命名空间，表现是「两个下拉同时打开」。
 */
const CLASSROOM_WORKSHEET_KEY = pickerKey('classroom', 'worksheet');
// ★ 2026-09-25：三件套统一成下拉之后，另外两格也要各自的键（同一条纪律：别在 JSX 里写字面量）。
const CLASSROOM_AGENT_KEY = pickerKey('classroom', 'agent');

/**
 * 下拉里那个地球（`GroupMaterialPicker` 的 `logo` 走 `<img src>`，喂不了内联 SVG）。
 * ⚠️ 路径与**本块标题**「关联探究网页」那一行的地球**逐字相同** ——
 * 同一页上两个不同的地球会让下一个人以为它们是两回事（2026-09-25 已立过这条）。
 */
const GLOBE_LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#4d7889" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>',
)}`;
const CLASSROOM_WEBAPP_KEY = pickerKey('classroom', 'webapp');

interface GroupMaterialOption {
  id: string;
  name: string;
  logo?: string | null;
}

/**
 * 一格材料（智能体 / 探究网页 / 学习单）的单选下拉。
 *
 * 它有两种用法，靠 `allowUnspecified` 区分：
 * · **高级模式的每组一格**（默认，`allowUnspecified = true`）：值多一种状态。
 *   `value` 的三种取值（`undefined` 还没选 / `null` 不指定 / `string` 选了哪个）在
 *   **外观上必须能区分**，否则教师分不清「我这组是决定了不要网页，还是我忘了选」——
 *   而这两种状态一个能提交、一个会被拦住，看起来却一模一样。
 * · **标准 / 分组模式的课堂级一格**（`allowUnspecified = false`）：那一格**不需要**
 *   做出决定（三件套任选其一即可），所以没有「不指定」这个选项 —— 不选就是没配。
 *   多给一个与「没选」等价的选项只会让教师以为两者不同。
 *   ⚠️ 但「没有『不指定』」**不等于**「不能清空」：`allowUnspecified = false` 只是把列表里
 *   那一项拿掉了，若不配 `clearOnReselect`，这个下拉就**没有任何清空路径** ——
 *   选错一份只能刷新整个页面，而「先选了、又想改成不关联」这个**表单本身支持**的状态
 *   （`worksheetIds: []`）在界面上不可达。所以课堂级那一格必须带 `clearOnReselect`。
 *
 * `clearOnReselect` 让「点已选中的那一项」变成取消选择 —— 与上面两张卡片
 * （智能体、探究网页）的「再点一次取消」**同一套语义**，只是载体从卡片换成了列表项。
 */
function GroupMaterialPicker({ label, placeholder, value, options, emptyHint, open, onToggle, onPick, allowUnspecified = true, clearOnReselect = false }: {
  label: string;
  placeholder: string;
  value: string | null | undefined;
  options: GroupMaterialOption[];
  emptyHint: string;
  open: boolean;
  onToggle: () => void;
  onPick: (id: string | null) => void;
  /**
   * 是否提供「不指定」这一项。**默认 true**（高级模式那三格都要它）。
   * 为 false 时 `value` 只该是 `undefined`（没选）或 `string`（选了）——
   * 传 `null` 进去会渲染成占位文字，与服务端语义对不上。
   */
  allowUnspecified?: boolean;
  /**
   * 点**已选中**的那一项时是否取消选择（回调收到 `null`）。
   *
   * **默认 false** —— 高级模式那三格不要它：那里的「取消」由列表第一项「不指定」承担，
   * 而且「不指定」是一个**与「还没选」不同的、有意义的状态**，让它同时承担「再点一次取消」
   * 会让两种语义挤在同一个手势上。
   *
   * `allowUnspecified = false` 的格子（课堂级学习单）**需要**它，理由见上面的组件注释。
   */
  clearOnReselect?: boolean;
}) {
  const selected = typeof value === 'string' ? options.find(option => option.id === value) : undefined;
  const selectedLogo = selected?.logo
    ? (selected.logo.startsWith('/') ? `${getApiBaseUrl()}${selected.logo}` : selected.logo)
    : null;
  // 无障碍名字要**自带材料名与当前值**：两个下拉的可见内容（「不指定」/「选择AI智能体」）
  // 单独看分不出是智能体还是网页那一格，屏幕阅读器只念可见内容时会指错。
  // ⚠️ 不用 `aria-labelledby` 指到上面那行小标题：`label` 是中文（且「AI 智能体」含空格），
  // 拿它拼 HTML `id` 会产出 `id="group-AI 智能体-caption"` —— 空格会把一个 id 切成两个词，
  // `aria-labelledby` 于是指向不存在的元素，读出来是空的（比不加更糟）。
  const currentLabel = selected ? selected.name : (allowUnspecified && value === null) ? '不指定' : '尚未选择';
  // ⚠️ 这里**不再**自带宽度：宽度由外层的**网格轨道**（`minmax(min(150px, 100%), 1fr)`）决定。
  // 从前写的是 `flex: '1 1 160px', minWidth: 150` —— 那是给「会自己换行的 flex 容器」用的。
  // 进了 grid 之后 `flex` 完全失效，而 `minWidth: 150` 会变成一条**只会往外顶**的地板：
  // 容器窄于 150 时它撑破网格而不是让位。`minWidth: 0` 把宽度决定权交回轨道。
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <div style={{ fontSize: '0.688rem', color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        aria-label={`${label}：${currentLabel}`}
        style={{
          width: '100%', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', borderRadius: 6, fontSize: '0.813rem',
          border: '1px solid #e2e8f0', cursor: 'pointer',
          background: 'white', minHeight: 32,
        }}>
        {selected ? (
          <>
            {selectedLogo ? (
              <img src={selectedLogo} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: 20, height: 20, borderRadius: 4,
                background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.625rem', fontWeight: 700, flexShrink: 0,
              }}>{selected.name[0] || '?'}</div>
            )}
            <span style={{ color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
          </>
        ) : (allowUnspecified && value === null) ? (
          // 「不指定」：给一个**实底色的小标签**。它是「已经做过决定」的样子，
          // 与下面那种纯灰占位文字从颜色到形状都不同 —— 这两者必须一眼分得开。
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1px 7px', borderRadius: 4,
            background: '#e2e8f0', color: '#475569',
            fontSize: '0.75rem', fontWeight: 500,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            不指定
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>{placeholder}</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ marginLeft: 'auto', flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          marginTop: 4, background: 'white', borderRadius: 8,
          border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          maxHeight: 200, overflowY: 'auto', overscrollBehavior: 'contain',
        }}>
          {/* 「不指定」是列表的**第一项**（不是「清空」按钮）：它是一种与其他选项并列的
              合法选择，不是撤销操作。用下边框与真选项分开，免得被当成其中一个智能体。
              ⚠️ 课堂级那一格（`allowUnspecified = false`）**整项不渲染** —— 那里不选就是没配。 */}
          {allowUnspecified && <button type="button" onClick={() => onPick(null)}
            style={{
              width: '100%', border: 0, borderBottom: '1px solid #f1f5f9', fontFamily: 'inherit', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer',
              fontSize: '0.813rem', background: value === null ? 'var(--primary-tint)' : 'white',
            }}>
            <span style={{ width: 20, height: 20, borderRadius: 4, background: '#e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </span>
            <span style={{ color: '#0f172a' }}>不指定</span>
            {value === null && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--primary)" stroke="white" strokeWidth="3" style={{ marginLeft: 'auto' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>}
          {options.map(option => {
            const logoUrl = option.logo
              ? (option.logo.startsWith('/') ? `${getApiBaseUrl()}${option.logo}` : option.logo)
              : null;
            return (
              <button type="button" key={option.id}
                // 单选的两半：点没选中的 ⇒ 选它；点已选中的 ⇒ 在 `clearOnReselect` 的格子里
                // 取消（`null`），否则是空操作（幂等重选）。见这两个 prop 的注释。
                onClick={() => onPick(clearOnReselect && value === option.id ? null : option.id)}
                style={{
                  width: '100%', border: 0, fontFamily: 'inherit', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', cursor: 'pointer', fontSize: '0.813rem',
                  background: value === option.id ? 'var(--primary-tint)' : 'white',
                  transition: 'background 0.1s',
                }}>
                {logoUrl ? (
                  <img src={logoUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 700 }}>{option.name[0]}</div>
                )}
                <span>{option.name}</span>
                {value === option.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--primary)" stroke="white" strokeWidth="3" style={{ marginLeft: 'auto' }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
          {options.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: '#94a3b8' }}>{emptyHint}</div>
          )}
        </div>
      )}
    </div>
  );
}

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
  /**
   * 可关联的学习单。**与探究网页同构**：课堂级、**单选**（`string`，`''` = 没选）。
   *
   * ⚠️ 与下面那两个 `groupWorksheetIds` 的 `null` 语义**不是一回事**：课堂级这一格
   * **不需要**做出决定（三件套任选其一即可），所以「不选」就是没配，没有「不指定」这一态。
   * 服务端 `resolveSingleMaterialId` 也是这么读的（空数组 / 空串 ⇒ `null` ⇒ 不落库）。
   */
  const [selectedWorksheetId, setSelectedWorksheetId] = useState('');
  const [worksheets, setWorksheets] = useState<WorksheetSummary[]>([]);
  /**
   * 与 `webappLoadError` 逐条同构：学习单列表加载失败**不阻断创建**，但必须说出来 ——
   * 「没勾」与「加载失败导致没得勾」在提交流程里长得一模一样，后者会让教师以为
   * 自己已经配了学习单。
   */
  const [worksheetLoadError, setWorksheetLoadError] = useState('');
  /**
   * 学习单**全库总数**（`GET /api/worksheets` 的 `total`，不是 `items.length`）。
   * 本仓唯一分页的列表接口，一次最多取 100 份 ⇒ 超过时要如实说「这里没显示全」，
   * 否则界面会把一小截当成全部（同 `WorksheetListResponse.total` 那条注释的告诫）。
   */
  const [worksheetTotal, setWorksheetTotal] = useState(0);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [mode, setMode] = useState<CreateMode>('standard');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  /**
   * 高级模式：每个小组各自的两份材料，键是 `ClassGroup.id`。
   *
   * 🔴 **值的三种状态是这一格的全部要点**（两个记录语义相同）：
   *   · 键**不存在** = 教师还没做出决定（初始态，会拦住提交）；
   *   · `null`      = 显式「不指定」这种材料（合法决定，允许提交）；
   *   · `string`    = 选了哪一个。
   *
   * ⚠️ 「不指定」**不能用 `''` 表达** —— `g.id in ids` 会把 `''` 判成「已决定」而放行，
   * 但服务端的 `toId` 又把它归一成 `null`，两边对「教师到底选了什么」的理解就此分叉。
   * 用 `null` 表达时，「不指定」与「还没选」在**这个页面上**也是两件不同的事。
   */
  const [groupAgentIds, setGroupAgentIds] = useState<Record<string, string | null>>({});
  /** 与 `groupAgentIds` 同形状、同语义，只是另一种材料（探究网页）。 */
  const [groupWebappIds, setGroupWebappIds] = useState<Record<string, string | null>>({});
  /** 与 `groupAgentIds` 同形状、同语义的第三种材料（学习单）。 */
  const [groupWorksheetIds, setGroupWorksheetIds] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * 当前展开的下拉，键是 `${groupId}:${kind}`。
   *
   * ⚠️ 从前这里只存 `groupId` —— 每组只有一个下拉时才够用。现在每组有三个，
   * 只存 id 会让「点开智能体」把同组的另外两个下拉**一起**打开（三个都渲染在同一个
   * `open === true` 下），而且关不掉其中一个。
   */
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const groupRequestRef = useRef(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const classSectionRef = useRef<HTMLDivElement>(null);
  const agentSectionRef = useRef<HTMLDivElement>(null);
  /**
   * `agentSectionRef` 的兄弟：网页列表加载失败时，提交后要滚到这里（原因写在这一块里）。
   * ⚠️ 它今天**没被任何地方真正用到**（见 `handleCreate` 里那条注释的推导）——
   * 留着是为了让那段「本该生效却到不了」的代码可读，别顺手删掉当成已修好。
   */
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
    // 学习单同样**单独一条**，理由与上面那段逐字相同（可选配置，挂了不该牵连必填项）。
    // ⚠️ `pageSize: 100` 是服务端的上限（`routes/worksheets.ts` 里 `Math.min(100, …)`）——
    // 这里是「一次性把能拿的都拿来给下拉用」，不分页；拿不全时靠 `worksheetTotal` 如实说明。
    void api.getWorksheets({ pageSize: 100 })
      .then(res => {
        if (!mountedRef.current) return;
        setWorksheets(res.items);
        setWorksheetTotal(res.total);
      })
      .catch(error => {
        if (mountedRef.current) setWorksheetLoadError(error instanceof Error ? error.message : '请求异常');
      });
    // ★ M7b：**只列「学伴」**（独立审查 C2 的根因修法）。这个选择器建的是一条**发给学生**的
    // 关联（课堂级 `ClassroomAgent` 或组级 `ClassroomGroupMaterial`）—— 让分析型 bot 进来，
    // 下游三条路径就都得各自记着「别忘了筛」（而那正是 C2 漏掉第三处的原因）。
    // ⇒ **挡在上游**：过滤器由服务端做（`?purpose=tutoring`），前端不复述那条规则。
    Promise.all([api.getAgents('tutoring'), api.getClasses()]).then(([a, c]) => {
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
    setGroupWebappIds({});
    setGroupWorksheetIds({});
    setOpenDropdownKey(null);
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
        setGroupWebappIds({});
        setGroupWorksheetIds({});
        setOpenDropdownKey(null);
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
      // 🔴 判据是「**每种材料**都做过决定」，不是「选了智能体」。
      // ⚠️ 用 `in` 而不是取值判真：`null`（显式「不指定」）要算**已决定**，
      //    而 `groupAgentIds[g.id]` 为 `null` 时是假 —— 那样会把「不指定」判成
      //    「没配置」而拦住提交，整个「每组可以不指定」的功能等于没做。
      const allDecided = classGroups.every(
        g => g.id in groupAgentIds && g.id in groupWebappIds && g.id in groupWorksheetIds,
      );
      if (loadingGroups) errors.groupAgents = '班级分组仍在加载，请稍候';
      else if (classGroups.length === 0) errors.groupAgents = '当前班级没有可用分组，请重新选择班级';
      else if (!allDecided) errors.groupAgents = '请为每个小组选择智能体、探究网页与学习单，或都选「不指定」';
    } else if (!selectedAgentId && !selectedWebappId && !selectedWorksheetId) {
      // 三件套「至少一项」：AI 智能体 / 探究网页 / 学习单。
      // ⚠️ 这条**只是即时反馈**，服务端 `classroomMaterialError` 才是权威（前端能被绕过）。
      // 两边的判据必须一致 —— 只选网页不选智能体是**合法**的，别在这里拦住提交。
      errors.material = '请至少选择一项课堂内容：AI 智能体 / 探究网页 / 学习单';
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
        //
        // 🔴 **这条（以及它本该有的学习单孪生兄弟）今天到不了**，如实记下，别当成已生效的保障：
        //    整个 `setTimeout` 块的门禁是「`errors` 非空」，而 `errors` 只可能是
        //    title / class / groupAgents / material 四者之一（本文件里只有那四处赋值）；
        //    前三个在上面已经 `return` 掉，只剩 groupAgents —— 它只在**高级模式**下产生，
        //    而高级模式下 `webappSectionRef` 恒为 null（那一块用 `mode !== 'advanced'` 包着）。
        //    ⇒ 两个条件互斥，这条永不执行。
        //    ⚠️ 学习单那一块**没有**自己的 ref（本轮未加）：上面这句从前把它和网页那块的 ref
        //    并列写成「恒为 null」，而 `worksheetSectionRef` 这个符号**从未存在过** ——
        //    一个指向幽灵符号的注释会让下一个人去找一个找不到的东西。
        //    真要让「点发起课堂时把教师送到失败的那一块」生效，得把这一段挪出校验分支，
        //    那会改动既有行为（且创建成功就跳走了，留在原地也没意义）—— 属于另一个决定，
        //    本次不做。学习单那一块因此**不加**一条同样到不了的兄弟分支。
        else if (webappLoadError && webappSectionRef.current) webappSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    // **课堂级**探究网页，只属于标准 / 分组模式。单选：数组里最多一个元素（或空数组）。
    // 字段名仍是复数 —— 服务端要兼容旧前端发来的多元素数组（按「取第一个」处理，
    // 见 resolveSingleWebappId）。
    const webappIds = selectedWebappId ? [selectedWebappId] : [];
    // 课堂级学习单，与 `webappIds` 逐条同构（单选 ⇒ 数组里最多一个元素，或空数组）。
    const worksheetIds = selectedWorksheetId ? [selectedWorksheetId] : [];
    try {
      if (mode === 'advanced') {
        // ⚠️ **不要在这里发课堂级的 `webappIds`**：高级模式下服务端不写课堂级网页
        // （权威来源是每组一份），发过去只会被校验通过后**丢掉** —— 教师看到「创建成功」，
        // 而自己勾的网页不见了。那种状态已经从 `createAdvancedClassroom` 的参数类型里删掉。
        const groups = classGroups.map(g => ({
          name: g.name,
          // 值只在 `string` 时是选中的 id；`null`（不指定）与键不存在（还没选）都发 `null`，
          // 两者在服务端归一成同一件事（`toId` 把空值一律变成 null ⇒ 不落库）。
          agentId: groupAgentIds[g.id] ?? null,
          webappId: groupWebappIds[g.id] ?? null,
          worksheetId: groupWorksheetIds[g.id] ?? null,
          studentIds: g.studentIds || [],
        }));
        const result = await api.createAdvancedClassroom({
          title: title || undefined,
          classId: selectedClassId,
          groups,
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
          worksheetIds,
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
  const selectedWorksheet = worksheets.find((worksheet) => worksheet.id === selectedWorksheetId);
  /**
   * 已经「三种材料都做过决定」的小组数。
   *
   * ⚠️ 判据必须与提交校验（`allDecided`）**逐字一致**，否则进度条与摘要会说谎：
   * 用取值判真会把「不指定」算成没配置 ⇒ 明明所有组都决定了，摘要却显示 0/N。
   */
  const hasDecided = (groupId: string) =>
    groupId in groupAgentIds && groupId in groupWebappIds && groupId in groupWorksheetIds;
  const configuredGroupCount = classGroups.filter((group) => hasDecided(group.id)).length;
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
      //
      // 高级模式的口径不同：那里不是「任一项」而是「**每组每种材料都做过决定**」
      //   （`configuredGroupCount` 的判据与提交校验一致）。所以「不指定」也算完成 ——
      //   每个组都选了「不指定」是**合法**的配置，只要整间课堂还有别的材料。
      label: '课堂内容',
      complete: mode === 'advanced'
        ? classGroups.length > 0 && configuredGroupCount === classGroups.length
        : Boolean(selectedAgentId) || Boolean(selectedWebappId) || Boolean(selectedWorksheetId),
    },
  ];

  /**
   * 「学习单只拿到了一部分」的如实告知。
   *
   * 定义在这里、而不是直接写在课堂级那一块里，是因为**同一个被截断的 `worksheets`
   * 也在高级模式下喂给每组的学习单下拉**（服务端 `pageSize` 上限 100，
   * 拉取处写死了 `pageSize: 100`）。只把提示挂在课堂级那一块里，超过 100 份时
   * 高级模式的教师看到的就是**被截断的列表且没有任何提示** —— 正是「把一小截当成全部」
   * 那种假信号，而它恰好是本块最想避免的东西。两处都渲染这一份。
   */
  const worksheetTruncationHint = !worksheetLoadError && worksheetTotal > worksheets.length ? (
    <div style={{ marginTop: 8, fontSize: "0.75rem", color: '#92400e', lineHeight: 1.7 }}>
      共 {worksheetTotal} 份学习单，下拉里只列出了前 {worksheets.length} 份（按更新时间倒序）。
      其余的到「学习单」页搜索确认。
    </div>
  ) : null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <TeacherPageHeader title="创建新课堂" description="选好模式与班级，再从 AI 智能体 / 探究网页 / 学习单里挑至少一项，即可发起课堂。" />

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
          padding: '12px 16px', marginBottom: 12,
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
            style={{ borderColor: fieldErrors.title ? '#a85d5d' : undefined }} />
          {fieldErrors.title && <div id="classroom-title-error" role="alert" style={{ fontSize: "0.75rem", color: '#a85d5d', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.title}
          </div>}
        </div>

        {/* 选择参与模式 */}
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '12px 16px', marginBottom: 12,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
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
                desc: '每个小组各自选AI智能体、探究网页与学习单，分组独立对话',
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
                  border: `2px solid ${mode === m.id ? 'var(--primary)' : '#e2e8f0'}`,
                  background: mode === m.id ? 'var(--primary-tint)' : 'white',
                  transition: 'all 0.12s',
                  display: 'flex', flexDirection: 'column', textAlign: 'left', font: 'inherit',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: `2px solid ${mode === m.id ? 'var(--primary)' : '#cbd5e1'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {mode === m.id && (
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)' }} />
                    )}
                  </div>
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: '#0f172a' }}>{m.label}</span>
                  {m.id === 'standard' && <span className="recommended-mode-tag">推荐</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: '#64748b', lineHeight: 1.4, marginLeft: 24, display: 'flex', alignItems: 'flex-start', gap: 5, flex: 1 }}>
                  <span style={{ flexShrink: 0, marginTop: 2, color: mode === m.id ? 'var(--primary)' : '#94a3b8' }}>{m.icon}</span>
                  <span>{m.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 选择班级 */}
        <div ref={classSectionRef} style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '12px 16px', marginBottom: 12,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
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
                      border: `1.5px solid ${fieldErrors.class ? '#a85d5d' : isSelected ? 'var(--primary)' : '#e2e8f0'}`,
                      background: isSelected ? 'var(--primary-tint)' : 'white',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                      fontSize: "0.875rem",
                      transition: 'all 0.12s', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: isSelected ? 'var(--primary)' : '#f1f5f9', color: isSelected ? 'white' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
                      <span style={{ fontSize: "0.625rem", padding: '1px 8px', borderRadius: 8, background: '#f5ecdd', color: '#b45309', fontWeight: 500, flexShrink: 0 }}>仅限标准模式</span>
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
          {fieldErrors.class && <div role="alert" style={{ fontSize: "0.75rem", color: '#a85d5d', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            {fieldErrors.class}
          </div>}
        </div>

        {/* 高级模式：每个小组各自选三件套（智能体 / 探究网页 / 学习单，每种材料各一格）。
            ⚠️ 这一块**替代了**下面那两块课堂级的「关联探究网页」「关联学习单」——
            高级模式下它们的权威来源是每组一份，见 `mode !== 'advanced'` 那个条件上的注释。 */}
        {selectedClassId && mode === 'advanced' && classGroups.length > 0 && (
          <div ref={agentSectionRef} style={{
            background: '#fafbfc', borderRadius: 10,
            border: `1px solid ${fieldErrors.groupAgents ? '#a85d5d' : '#eef2f6'}`,
            padding: '12px 16px', marginBottom: 12,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
              为每个小组选择课堂内容
              {/* 「必填」在这里的意思是**每组都要做出决定**，不是「每组都要选智能体」：
                  每个下拉都可以选「不指定」，那也是一个决定。 */}
              <span className="required-field-mark">必填</span>
            </div>
            {/* ⚠️ 进度一定发生在「还没有任何一组配了材料」的那条路径上（全局三件套全空的课堂
                是服务端 400 拦下的），所以这句得说清楚「不指定」也是选项 —— 否则教师会以为
                留着不选和选「不指定」是同一件事，而它们一个能提交、一个不能。 */}
            <div style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 12 }}>
              每个小组的智能体、探究网页与学习单**各自独立**，互不影响，也**不会**回落到课堂级的配置。
              某种材料这一组不需要，就在那个下拉里选「<strong style={{ fontWeight: 600 }}>不指定</strong>」（留空不选会拦住提交）。
            </div>
            {classGroups.map((g, i) => {
                const agentKey = pickerKey(g.id, 'agent');
                const webappKey = pickerKey(g.id, 'webapp');
                const worksheetKey = pickerKey(g.id, 'worksheet');
                return (
                /* 每组一块，**两行**：
                     第一行 = 编号 + 组名 + 人数（「这组是谁」）；
                     第二行 = 三件套三个下拉，等宽三列（「这组配了什么」）。
                   ⚠️ 排布是**重新设计过的**，不是把第三个下拉塞进原来那一行 —— 见下面
                      网格容器上的注释（规格 §4.8「排布要重新设计」）。 */
                <div key={g.id} className="new-classroom-group-row" style={{
                  display: 'flex', flexDirection: 'column', gap: 10,
                  padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
                  marginBottom: 8, background: 'white',
                }}>
                  {/* 第一行：身份。从前组名与人数是上下两小行、和两个下拉挤在**同一条** flex 行里，
                      于是「组名让位给下拉」——组名会被压到 120px 以下、长名字直接省略号。
                      拆成独立一行之后组名拿到整行宽度，也给下面那三格腾出了全部横向空间。 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6,
                      background: 'var(--primary)', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 500, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{g.name}</div>
                    <div style={{ fontSize: "0.688rem", color: '#94a3b8', flexShrink: 0 }}>{(g.studentIds?.length || 0)} 名学生</div>
                  </div>
                  {/* 第二行：三件套**等宽三列**的网格。
                      ⚠️ 为什么不是「三个下拉并排塞进一条 flex」：三个下拉各需 ≥150px + 两个 8px 间隙
                        = 466px，而原来那条 flex 行里组名还要占 120px ⇒ 卡片宽度（710px）下只剩
                        498px，勉强够；再窄一点第三个就换行，**每组变成高低不一的两截**，
                        而这块的核心诉求正好是「一眼看出哪组还没决定」—— 参差不齐就看不出来了。
                      ⇒ `repeat(auto-fit, minmax(min(150px, 100%), 1fr))`：
                        容器够宽 ⇒ 三等分；不够 ⇒ 自动降为两列、再降为一列，**每列都均分整行**，
                        于是所有小组的行高**永远一致**，网格也不会溢出（`min(150px, 100%)`
                        保证容器本身窄于 150px 时轨道跟着缩，而不是往外顶）。
                      ⇒ 为什么不做成「每组一个折叠区」：那会让「这一组配全了没有」在折叠状态下
                        看不出来。
                      ⚠️ 每个下拉**带小标签**（「AI 智能体」/「探究网页」/「学习单」）—— 三个下拉
                        长得一模一样，没有标签就分不清哪个是哪个。 */}
                  <div className="new-classroom-group-material" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))',
                    gap: 8, minWidth: 0,
                  }}>
                    <GroupMaterialPicker
                      label="AI 智能体"
                      placeholder="选择AI智能体"
                      value={groupAgentIds[g.id]}
                      options={agents.map(a => ({ id: a.id, name: a.name, logo: a.logo }))}
                      emptyHint="还没有可用的智能体，请先在「AI智能体」里接入"
                      open={openDropdownKey === agentKey}
                      onToggle={() => setOpenDropdownKey(openDropdownKey === agentKey ? null : agentKey)}
                      onPick={(id) => {
                        setGroupAgentIds(prev => ({ ...prev, [g.id]: id }));
                        clearError('groupAgents');
                        setOpenDropdownKey(null);
                      }}
                    />
                    <GroupMaterialPicker
                      label="探究网页"
                      placeholder="选择探究网页"
                      value={groupWebappIds[g.id]}
                      options={webapps.map(w => ({ id: w.id, name: w.name }))}
                      emptyHint="还没有探究网页，可以先在「探究网页」里添加"
                      open={openDropdownKey === webappKey}
                      onToggle={() => setOpenDropdownKey(openDropdownKey === webappKey ? null : webappKey)}
                      onPick={(id) => {
                        setGroupWebappIds(prev => ({ ...prev, [g.id]: id }));
                        clearError('groupAgents');
                        setOpenDropdownKey(null);
                      }}
                    />
                    <GroupMaterialPicker
                      label="学习单"
                      placeholder="选择学习单"
                      value={groupWorksheetIds[g.id]}
                      options={worksheets.map(w => ({ id: w.id, name: w.title }))}
                      emptyHint="还没有学习单，可以先在「学习单」里创建"
                      open={openDropdownKey === worksheetKey}
                      onToggle={() => setOpenDropdownKey(openDropdownKey === worksheetKey ? null : worksheetKey)}
                      onPick={(id) => {
                        setGroupWorksheetIds(prev => ({ ...prev, [g.id]: id }));
                        clearError('groupAgents');
                        setOpenDropdownKey(null);
                      }}
                    />
                  </div>
                </div>
                );
              })}
            {/* 网页列表加载失败时，组级那个下拉会**空着**。不在这里说出来，「没勾」与
                「加载失败导致没得勾」在界面上长得一模一样（同课堂级那一块的告诫）。 */}
            {webappLoadError && (
              <div role="alert" style={{ marginTop: 8, padding: '10px 12px', background: '#faf4eb', border: '1px solid #fde68a', borderRadius: 8, fontSize: "0.75rem", color: '#92400e', lineHeight: 1.7 }}>
                探究网页列表没有加载成功（{webappLoadError}），所以上面的「探究网页」下拉里没有可选项。
                智能体那一栏不受影响；也可以去「探究网页」页确认后再发一次课堂。
              </div>
            )}
            {/* 同上一段，学习单那一格。 */}
            {worksheetLoadError && (
              <div role="alert" style={{ marginTop: 8, padding: '10px 12px', background: '#faf4eb', border: '1px solid #fde68a', borderRadius: 8, fontSize: "0.75rem", color: '#92400e', lineHeight: 1.7 }}>
                学习单列表没有加载成功（{worksheetLoadError}），所以上面的「学习单」下拉里没有可选项。
                另外两栏不受影响；也可以去「学习单」页确认后再发一次课堂。
              </div>
            )}
            {/* 同课堂级那一块的截断告知 —— 每组的「学习单」下拉吃的是**同一份**被截断的列表，
                高级模式不说不等于没发生。见变量定义处的注释。 */}
            {worksheetTruncationHint}
            {classGroups.length > 0 && fieldErrors.groupAgents && <div style={{ fontSize: "0.75rem", color: '#a85d5d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.groupAgents}
            </div>}
          </div>
        )}

        {/* 点在下拉外面收起它。键在 `openDropdownKey` 里跟着三组下拉一起变了（见其注释）。 */}
        {openDropdownKey && (
          <div onClick={() => setOpenDropdownKey(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }} />
        )}

        {/* 标准/分组模式：选择AI智能体。
            ★ 2026-09-25（教师）：「三件套的选择都改成下拉列表，这样在内容多的情况下就可以
            完美显示了」。原来是**平铺的胶囊**，十来个还凑合、几十个就把这一块撑成一堵墙
            （而它旁边那两块早就因为同一个理由改成了下拉 —— 见下面「关联学习单」的注释）。
            ⇒ 三块现在是**同一个控件**（`GroupMaterialPicker`：扁平下拉 + 自绘箭头 +
              点已选中项取消），语义也一致（都是单选、都能取消）。 */}
        {mode !== 'advanced' && (
          <div ref={agentSectionRef} style={{
            background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
            padding: '12px 16px', marginBottom: 12,
          }}>
            <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>
              选择AI智能体
              {/* 三件套（AI 智能体 / 探究网页 / 学习单）每一项都是选填，至少一项即可 ——
                  这里从前写的是「必填」，与实际规则不符：只挂一个探究网页也能建课堂。 */}
              <span style={{ fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8' }}>选填 · 三件套任选其一</span>
            </div>
            <GroupMaterialPicker
              label="AI 智能体"
              placeholder="选择AI智能体"
              value={selectedAgentId || undefined}
              options={agents.map(a => ({ id: a.id, name: a.name, logo: a.logo }))}
              emptyHint={loadingOptions ? '正在加载智能体…' : '暂无可选智能体，请先在「AI智能体」中接入'}
              open={openDropdownKey === CLASSROOM_AGENT_KEY}
              onToggle={() => setOpenDropdownKey(openDropdownKey === CLASSROOM_AGENT_KEY ? null : CLASSROOM_AGENT_KEY)}
              onPick={(id) => { setSelectedAgentId(id ?? ''); clearError('agent'); clearError('material'); }}
              // 与学习单那一格同款：**不给「不指定」项**（三件套任选其一，不该有第三个状态），
              // 但要保留「点已选中项取消」的能力，否则选错一次只能刷新整个页面。
              allowUnspecified={false}
              clearOnReselect
            />
            {fieldErrors.agent && <div style={{ fontSize: "0.75rem", color: '#a85d5d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {fieldErrors.agent}
            </div>}
          </div>
        )}

        {/* 关联探究网页（可选）—— **课堂级**的网页，只属于标准 / 分组模式。
            🔴 高级模式**不再渲染这一块**，这不是漏了：那个模式下网页的权威来源是**每组一份**
            （上面每个小组的「探究网页」下拉），服务端也**不写**课堂级那一行。从前两边都渲染，
            于是教师在这里勾的网页会被服务端校验通过后**丢掉** —— 界面显示「创建成功」，
            网页却不见了，而且没有任何地方报错。
            ⚠️ 历史上这里写过「三种模式下都渲染」并把 `mode !== 'advanced'` 说成 bug，
            那是**当时**的口径（高级模式没有别的地方能挂网页）。口径变了，注释也跟着变 ——
            留着旧注释会让下一个人把这段代码「修」回去。
            ⚠️ `webappSectionRef` 因此只在非高级模式下存在：高级模式下提交校验里那条
            滚动兜底会落到 `agentSectionRef`（那个模式里挂的是每组材料那一块）。 */}
        {mode !== 'advanced' && (
        <div ref={webappSectionRef} style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '12px 16px', marginBottom: 12,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></svg>
            关联探究网页
            <span style={{ fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8' }}>选填 · 只能选一个 · 三件套任选其一</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 12 }}>
            学生在「探究空间」里会打开这个网页。<strong style={{ fontWeight: 600 }}>一个课堂只关联一个网页</strong>；
            不选也可以 —— 那就记得至少选一个 AI 智能体。
          </div>
          {webappLoadError ? (
            <div role="alert" style={{ padding: '12px 14px', background: '#faf4eb', border: '1px solid #fde68a', borderRadius: 8, fontSize: "0.813rem", color: '#92400e', lineHeight: 1.7 }}>
              探究网页列表没有加载成功（{webappLoadError}）。
              这次创建的课堂**不会带任何网页**；网页本身没丢，可以去「探究网页」页确认后再发一次课堂。
            </div>
          ) : webapps.length === 0 ? (
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
              还没有探究网页，可以先在「探究网页」里添加
            </div>
          ) : (
            /* ★ 2026-09-25（教师）：「三件套的选择都改成下拉列表，这样在内容多的情况下就可以
               完美显示了」。原来是**平铺的卡片**（每张还带一行入口文件名），十几个就把这一块
               撑得很高；而学习单那一格早就因为同一个理由改成了下拉。
               ⇒ 现在三块是**同一个控件**、同一套语义（单选 + 点已选中项取消）。
               ⚠️ 网页在列表里用**地球图标**（`GroupMaterialPicker` 的 logo 走 `<img>`，
               而地球是内联 SVG ⇒ 这里给它一个 data URI，让下拉里那份与标题那一行**同一个地球**）。
               ⚠️ 入口文件名不再逐张列出：它与名字几乎总是重复（名字就是文件名去扩展名），
               而它正是把卡片撑高的那一行 —— 要看全文可以去「探究网页」页。 */
            <GroupMaterialPicker
              label="探究网页"
              placeholder="选择探究网页"
              value={selectedWebappId || undefined}
              options={webapps.map(w => ({ id: w.id, name: w.name, logo: GLOBE_LOGO_DATA_URI }))}
              emptyHint="还没有探究网页，可以先在「探究网页」里添加"
              open={openDropdownKey === CLASSROOM_WEBAPP_KEY}
              onToggle={() => setOpenDropdownKey(openDropdownKey === CLASSROOM_WEBAPP_KEY ? null : CLASSROOM_WEBAPP_KEY)}
              onPick={(id) => { setSelectedWebappId(id ?? ''); clearError('material'); }}
              allowUnspecified={false}
              clearOnReselect
            />
          )}
        </div>
        )}

        {/* 关联学习单（可选）—— **课堂级**的学习单，只属于标准 / 分组模式。
            与上一块「关联探究网页」逐条同构，包括 `mode !== 'advanced'` 那条：高级模式下
            学习单的权威来源是**每组一份**，服务端在那个分支里同样不写课堂级这一行
            （见 `createClassroom` 的 `worksheetIds` 注释）。

            ⚠️ 两块长得不一样是**刻意的**（不是没对齐）：网页那边是平铺的卡片，学习单这边是
            **下拉**。理由是列表规模 —— 一个教师配的网页通常只有几个，而学习单是内容、
            可以有很多份（它也是本仓唯一分页的列表接口，服务端 pageSize 上限 100）。
            平铺几十份会把这一块撑成一堵墙；下拉的列表自身 `maxHeight: 200` 滚动，
            与高级模式里那三格用的是**同一个** `GroupMaterialPicker`。
            `allowUnspecified={false}`：课堂级这一格**不需要**做出决定（三件套任选其一即可），
            所以没有「不指定」这一项 —— 多给一个与「没选」等价的选项只会让教师以为两者不同。
            ⚠️ 但必须同时给 `clearOnReselect`：`allowUnspecified={false}` 拿掉的是列表里那一项，
            不是清空能力。少写它，这个下拉就成了**单向门** —— 选错一份只能刷新整个页面，
            而「先选了、又想改成不关联」（`worksheetIds: []`）这个表单本身支持的状态在界面上
            不可达。上面那两张卡片早就是「再点一次取消」，这一格是同一套语义的第三个载体。 */}
        {mode !== 'advanced' && (
        <div style={{
          background: '#fafbfc', borderRadius: 10, border: '1px solid #eef2f6',
          padding: '12px 16px', marginBottom: 12,
        }}>
          <div style={{ fontSize: "0.813rem", fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            关联学习单
            <span style={{ fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8' }}>选填 · 只能选一份 · 三件套任选其一</span>
          </div>
          {/* ★ 2026-09-25：三句话收成一句 —— 教师说「整个页面高度有点大」，
              而「只关联一份」已经由**下拉是单选的**这件事本身说清楚了。 */}
          <div style={{ fontSize: "0.75rem", color: '#64748b', marginBottom: 8 }}>
            学生在课堂里会填写它。一个课堂只关联一份，也可以不关联。
          </div>
          {worksheetLoadError ? (
            <div role="alert" style={{ padding: '12px 14px', background: '#faf4eb', border: '1px solid #fde68a', borderRadius: 8, fontSize: "0.813rem", color: '#92400e', lineHeight: 1.7 }}>
              学习单列表没有加载成功（{worksheetLoadError}）。
              这次创建的课堂**不会带学习单**；学习单本身没丢，可以去「学习单」页确认后再发一次课堂。
            </div>
          ) : worksheets.length === 0 ? (
            // 空态**不给一个点开才发现是空的下拉** —— 直接把原因说出来，并指到该去哪建。
            <div style={{ padding: '14px 16px', background: '#f1f5f9', borderRadius: 8, fontSize: "0.813rem", color: '#94a3b8', textAlign: 'center' }}>
              还没有学习单，可以先在「学习单」里创建
            </div>
          ) : (
            // 限宽：下拉铺满整块会显得像个输入框而不是一个选择项。
            <div style={{ maxWidth: 320 }}>
              <GroupMaterialPicker
                label="学习单"
                placeholder="选择学习单"
                value={selectedWorksheetId || undefined}
                options={worksheets.map(w => ({ id: w.id, name: w.title }))}
                emptyHint="还没有学习单，可以先在「学习单」里创建"
                allowUnspecified={false}
                // 再点一次已选中的那份 = 取消关联（`onPick(null)` ⇒ `''`）。见上面那段注释：
                // 没有它，这一格没有任何清空路径。
                clearOnReselect
                open={openDropdownKey === CLASSROOM_WORKSHEET_KEY}
                onToggle={() => setOpenDropdownKey(openDropdownKey === CLASSROOM_WORKSHEET_KEY ? null : CLASSROOM_WORKSHEET_KEY)}
                onPick={(id) => {
                  // `allowUnspecified={false}` ⇒ 列表里没有「不指定」，`id` 要么是 string（选了），
                  // 要么是 `null`（`clearOnReselect` 取消）。写 `?? ''` 把两者收窄成 `string`，
                  // 语义上「没选」就是 `''`。
                  setSelectedWorksheetId(id ?? '');
                  clearError('material');
                  setOpenDropdownKey(null);
                }}
              />
            </div>
          )}
          {/* 拿不全时如实说。`pageSize: 100` 是服务端上限 ⇒ 超过 100 份时下拉里只有前 100 份，
              不写这一句，「这里就是全部」这个假信号会让教师找不到自己刚建的那一份。
              ⚠️ 这一份提示**同时**渲染在高级模式那一块里（同一个变量），原因见它的定义。 */}
          {worksheetTruncationHint}
        </div>
        )}

        {/* 三件套「至少一项」的横幅。
            它跨了「AI 智能体」「探究网页」「学习单」三块，所以不能挂在其中任何一块的错误位上
            —— 挂在智能体那块会让「只选了网页」的教师以为问题出在网页那一栏。
            位置紧贴操作按钮：教师点「发起课堂」时它就在眼前，不需要往上翻。 */}
        {fieldErrors.material && <div ref={materialErrorRef} role="alert" style={{
          fontSize: "0.813rem", color: '#92400e', background: '#faf4eb', border: '1px solid #fde68a',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16, marginTop: -4,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {fieldErrors.material}
        </div>}

        {fieldErrors.submit && <div role="alert" style={{ fontSize: "0.75rem", color: '#a85d5d', marginBottom: 16, marginTop: -4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {fieldErrors.submit}
        </div>}

        {/* 操作按钮 */}
        <div className="new-classroom-actions">
          <div className="new-classroom-summary" aria-live="polite">
            <strong>{title.trim() || '尚未填写课堂标题'}</strong>
            <span>
              {modeLabel} · {selectedClass?.name || '未选班级'} · {mode === 'advanced'
                ? `${configuredGroupCount}/${classGroups.length} 个小组已决定`
                : selectedAgent?.name || '未选智能体'}
              {/* 高级模式的三件套都是**每组一份**，汇总在每行自己的三个下拉里（以及上面那句
                  「N/M 个小组已决定」）。这里只报课堂级那两个 —— 否则摘要会把 `selectedWebapp`
                  / `selectedWorksheet` 说成「这个课堂用的」，而它们在高级模式下**根本不生效**。
                  文案用「已决定」而不是「已配置」：选了「不指定」也是决定，也是完成。
                  ⚠️ 顺带记下一条**既有**的小别扭（本次不动它）：标准 / 分组模式下若只选了网页或
                  学习单，前半句仍会显示「未选智能体」——它字面为真，且后面两截会把真实选择补齐，
                  所以整句读完不会误导；改它属于改这一段既有文案，不在本任务范围内。 */}
              {mode !== 'advanced' && selectedWebapp ? ` · 探究网页：${selectedWebapp.name}` : ''}
              {mode !== 'advanced' && selectedWorksheet ? ` · 学习单：${selectedWorksheet.title}` : ''}
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
