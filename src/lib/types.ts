// 奖励形式的取值域与取值规则都在那个文件里（规格 §9）—— 本文件只转出它的类型。
// ⚠️ 必须是 `import type`：`worksheet-reward.ts` 要能被 `node --test` 直接跑，
// 而类型在 Node 的类型擦除里整段消失，所以这条 import 不会把它拖进任何运行期依赖。
import type { RewardStyle } from './worksheet-reward';

export interface InitStatus {
  initialized: boolean;
  authenticated: boolean;
  hasAgents: boolean;
  hasClasses: boolean;
}

/**
 * ★ 2026-09-25：**共享 API Token**（Coze 低代码）。
 *
 * Coze 的 Token 属于**扣子账号**、不属于 Bot —— 同一个号做出来的多个智能体共用一份。
 * 教师在这里维护若干份（可命名「张老师的号」），建/改智能体时选一份。
 *
 * 🔴 **明文 Token 永远不在这个类型里**：服务端出去的方向一律掩码（`maskedToken`）。
 * 界面上那个输入框是「要么留空 = 不改，要么填一个新的」——**不是**回显明文再提交。
 */
export interface PlatformTokenSummary {
  id: string;
  platform: string;
  /** 备注：这是谁的账号。 */
  label: string;
  /** 掩码（首尾各 4 个字符），**只用于回显**「你填的是不是这个」。 */
  maskedToken: string;
  /** `null` = **未设置有效期**（迁移来的记录就是这一档）⇒ 界面要**催促去填**，不是沉默。 */
  expiresAt: string | null;
  createdAt: string;
  /** 几个智能体正在用它（删除守卫与「改值的影响面」共用）。 */
  agentCount: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  logo: string | null;
  platform: string;
  apiUrl: string | null;
  apiKey: string;
  hasApiKey: boolean;
  botId: string | null;
  extra: string | null;
  enabled: boolean;
  greeting: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
  /**
   * 关联到的**去重后**的课堂数。
   *
   * ⚠️ **只有管理页的列表接口（`GET /api/agents`）会填它**，所以是可选的 ——
   * 这个类型是复用类型：课堂详情里下发的 `agents[]`（`GET /api/classroom/code/:code`
   * 等）走的是同一条类型，那些端点不算这个数。声明成必填会逼那些构造点塞假值。
   */
  classroomCount?: number;
  /**
   * ★ 2026-10-08（教师）：「这个数据取不到吗？」——分析型那张卡上的条数。
   *
   * 有多少份学习单把它指定为分析型智能体（`Worksheet.settings.analysisAgentId`）。
   * 🔴 与 `classroomCount` **是两条不同的关系**，不要混：一个走 `ClassroomAgent` /
   *   组级材料，一个走学习单里的 JSON 字段。卡片上按 `purpose` 各显示各的。
   * ⚠️ 同 `classroomCount?`：**只有 `GET /api/agents` 会填** ⇒ 可选；学伴型恒为 0。
   */
  worksheetCount?: number;
  /**
   * ★ M7b：用途。`'tutoring'`（学伴，学生可见）| `'analysis'`（分析型，**学生绝不可见**）。
   *
   * ⚠️ **可选** —— 这个类型是**复用类型**：学生端下发的 `agents[]` 也走它，
   * 而那些构造点（`studentAgentView`）本来就把分析型滤掉了，不必再填一遍。
   * （与 `classroomCount?` 同一条理由，见它上面的注释。）
   */
  purpose?: string;
  /**
   * ★ 2026-09-25：这个智能体用的**共享 API Token**（`PlatformToken.id`）。
   * `null` / 缺字段 = 用自带的 `apiKey`（老数据全是这一档）。
   * ⚠️ 服务端的 `toPublicAgent` 是 `{ ...agent }` 展开，所以这一格**本来就在响应里**，
   * 这里只是把类型补上。
   */
  credentialId?: string | null;
}

/**
 * 一个「关联到的课堂」—— 智能体 / 探究网页的卡片上「关联课堂」入口与
 * 「无法删除」弹窗共用同一份形状。
 *
 * `mode` 是可选：网页侧的两条查询都带了它，但界面不依赖它存在。
 */
export interface RelatedClassroom {
  id: string;
  /** 服务端已经回退过：标题为空时是 `'未命名课堂'`。 */
  title: string;
  /** `'active' | 'paused' | 'ended'`。 */
  status: string;
  mode?: string;
}

/**
 * ★ 2026-10-08（教师）：「（分析型智能体那张卡上）这里应该是**查看关联的学习单**。」
 *
 * 🔴 智能体 ↔ 学习单**没有关联表**（全仓无 `WorksheetAgent`）—— 这一份来自
 * `Worksheet.settings.analysisAgentId`：学习单里指定"用哪个分析型智能体做分析"。
 * 所以它只会对**分析型**智能体非空；学伴型恒为空数组。
 * ⚠️ 服务端那边用的是与**删除守卫**逐字相同的比较（`settings.analysisAgentId === id`），
 * 两处分家会出现「能删却说有引用」这种自相矛盾，而两边都不报错。
 */
export interface RelatedWorksheet {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ClassroomSummary {
  id: string;
  code: string | null;
  title: string | null;
  mode: 'standard' | 'group' | 'advanced';
  status: 'active' | 'paused' | 'ended';
  allowStudentStop: boolean;
  /**
   * ★ 2026-09-25：是否允许学生**提问**（智能学伴的输入）。
   *
   * 🔴 与 `status === 'paused'`（「暂停课堂」）**不是一件事**：那个封住三件套整体，
   * 这个只关掉「问问题」；学生仍能看学习单、看探究网页。
   *
   * ⚠️ 可选，且判据必须是 `!== false`（**认不出就当允许**）：老服务端的响应里没有这一格。
   * 写成 `!allowStudentAsk` 会让「不知道」渲染成「老师禁止提问」，
   * 而学生那边输入框会**静默地打不了字**。
   */
  allowStudentAsk?: boolean;
  allowStudentExport: boolean;
  allowFollowUps: boolean;
  /**
   * ★ M5a：课堂级「锁定作答」。`true` = 停笔（保存被 409 拒），但**交卷仍然放行**。
   *
   * ⚠️ **可选**：更老的版本根本不发这个字段 ⇒ 读的地方必须按「未锁定」处理
   * （`classroom.answersLocked === true`），不能把它当成必填。
   * `StudentClassroom` 与 `ClassroomDetail` 都继承本接口，所以这一处两端都生效。
   */
  answersLocked?: boolean;
  /**
   * ★ 2026-09-30：课堂级「逐题开放」—— `{ [学习单 id]: [已开放的题 id…] }`。
   *
   * 教师看板用它画「逐题开放」那个浮层（刷新页面之后仍然要对）；学生端的读路径不看它
   * （那边读 `GET /api/worksheets/:id/student-view` 的 `openQuestions`，只发自己那一份单）。
   *
   * ⚠️ **可选**：更老的版本不发这个字段 ⇒ 读的地方必须收成 `{}`（= 一份单都没开放），
   * 不能当成必填、也不能当成「全部开放」（那会把一份设了手动静止的卷子整个放开）。
   */
  worksheetOpen?: Record<string, string[]>;
  createdAt?: string;
  endedAt?: string | null;
  agents?: AgentSummary[];
  /**
   * 各组的材料。⚠️ **`agentId` 已随 P2 的 `ClassroomGroupMaterial` 一并消失**
   * （`ClassroomGroup.agentId` 那一列被删掉了），而且 `agent` / `webapp` **都可以是 `null`**
   * ——「这组没配这种材料」是合法状态，高级模式下**不回落**到课堂级数组。
   * 学生端取材料一律走 `@/lib/classroom-material` 的两个解析函数，不要在这里自己找组。
   */
  groups?: Array<{
    id: string;
    name: string;
    groupId?: string;
    agent?: AgentSummary | null;
    webapp?: ClassroomWebappSummary | null;
    [key: string]: unknown;
  }>;
  students?: unknown[];
  agentIds?: string[];
}

/**
 * 课堂三个模块的标识与三态取值。与后端 server/src/services/classroom-module-state.ts
 * 的 ModuleKey / ModuleState 逐字对齐 —— 两边各写一份就会漂移，改这里必须同步改那边。
 */
export type ClassroomModuleKey = 'learning-sheet' | 'explorer' | 'companion';
export type ClassroomModuleState = 'open' | 'preview' | 'hidden';

/** 单个模块的态。读端点 GET /code/:code 与 GET /:id 恒返回三个（缺失按默认态补齐）。 */
export interface ClassroomModuleSetting {
  moduleKey: ClassroomModuleKey;
  state: ClassroomModuleState;
}

/**
 * 探究空间「关联网页」的对外形状（`loadClassroomWebapps`，`server/src/routes/webapps.ts`）。
 *
 * **只有这三个字段**：`id` 与 `entryPath` 够学生端拼出
 * `http://${location.hostname}:${webappPort}/webapps/${id}/${entryPath}`，`name` 是显示名。
 * `Webapp` 表里任何指向文件系统的字段（绝对路径、`webappsRoot()` 之下的相对路径）
 * **一律不进响应** —— 多一个字段就是把服务端的目录结构告诉客户端。
 */
export interface ClassroomWebappSummary {
  id: string;
  name: string;
  entryPath: string;
}

/**
 * 课堂材料里那一份**学习单**的最小读形状。
 *
 * **服务端确实下发它**（2026-09-23 合并 P1 学习单的服务端实现之后 —— 本注释的上一版写在
 * 那条分支合并**之前**，当时「表不存在、没人写 `kind='worksheet'`、接口不下发」三句都是真的，
 * 合并后三句全部失效；本次改写成当前成立的版本，别再照着旧话说「还没做」）：
 *   · 组级 —— `groups[].worksheet`，`{ id, title } | null`（高级模式下「本组没配」是 `null`）；
 *     由 `resolveGroupMaterialViews` 拼出（`server/src/services/group-material-resolve.ts:188`），
 *     `GET /code/:code`、`GET /:id`、`GET /active`、`join-classroom` 都走它。
 *   · 课堂级 —— 顶层 `worksheets`，`{ id, title }[]`，来自 `loadClassroomWorksheets`
 *     （`server/src/routes/classroom.ts:217`，调用点 `:700` / `:882` / `:1005`）。
 * 读它的地方（`@/lib/classroom-material` 的 `classroomMaterialsInUse`）因此**今天就有货**，
 * 不需要再等谁「接上服务端」。
 *
 * ⚠️ 形状**只有** `id` 与 `title`：题目结构（`content`）与答案都不进这两个载荷，
 * 学生端按 id 单独拉取（服务端剥掉答案字段）。**别照着网页那套扩字段** ——
 * 想加字段先看服务端的 `select`，它不加，这里加了就是一份凭空来的字面量。
 *
 * ⚠️ 字段名是 `title` 不是 `name`（`Worksheet` 模型就是这么定的），别顺手对齐成网页那套。
 */
export interface WorksheetMaterialSummary {
  id: string;
  title: string;
}

/**
 * 管理页（`/teacher/webapps/`）看到的网页形状 —— 与 `ClassroomWebappSummary` 同样是
 * `PUBLIC_WEBAPP_SELECT` 的子集，**没有任何磁盘路径字段**。
 */
export interface WebappSummary {
  id: string;
  name: string;
  entryPath: string;
  createdAt: string;
  updatedAt: string;
  /**
   * 被多少个课堂关联。管理页的概览条（已关联 / 未关联）、「按关联状态筛选」与
   * 卡片左边那条色条都读它。
   *
   * ⚠️ 与 `AgentSummary.classroomCount` 不同，这里是**必填**：网页只有一个来源
   * （`GET /api/webapps`），而这个类型不被任何别的端点复用，没有「某些构造点不填」
   * 的问题。缺失就是 bug，让它编译期暴露比留个可选字段好。
   */
  classroomCount: number;
}

/**
 * 上传响应。
 *
 * ⚠️ `externalDeps` **只有数量与文件名，没有 URL** —— 这是服务端的结构性约束
 * （见 `routes/webapps.ts` 的 `scanExternalDepsSafe`），不是 UI 约定。
 * 界面上因此也只能说「本网页依赖 N 个外部资源」，不能列出具体地址。
 */
export interface WebappUploadResult extends WebappSummary {
  externalDeps: { count: number; files: string[] };
  /**
   * 网页里引用了、但**包里没有**的本地文件（`style.css` 这类）。
   * ⚠️ 与 `externalDeps` 是两件事：那个数的是 `https://…`（环境问题），
   * 这个数的是包内缺失的文件（**上传的内容本身不全**）—— 教师要做的事完全不同。
   */
  missingRefs: { count: number; refs: string[] };
}

/**
 * 学习单列表项（`GET /api/worksheets` 的 `items[]`）。
 *
 * 🔴 **刻意没有 `content`**（题目树）。服务端读它但不发它 —— 一页 20 份、每份几十 KB，
 * 列表页根本用不到；要题目结构得走详情 `GET /api/worksheets/:id`。所以别把
 * `WorksheetMaterialSummary` 那套（`{ id, title }`）当成这个类型：那是**课堂材料槽**的
 * 最小形状，与「管理页列表项」是两件事。
 *
 * ⚠️ 字段名一律 `title` / `description`（`Worksheet` 模型如此），不要顺手对齐成网页那套 `name`。
 */
export interface WorksheetSummary {
  id: string;
  title: string;
  description: string | null;
  /** `content.schemaVersion` 的冗余，题型演进时迁移的依据。 */
  schemaVersion: number;
  /** 题数 —— 唯一从 `content` 算出来、但**值得进列表**的一列。 */
  questionCount: number;
  /**
   * 被多少个课堂关联。与网页同口径：**课堂级（`ClassroomWorksheet`）与组级
   * （`ClassroomGroupMaterial(kind='worksheet')`）按课堂去重后的并集** ——
   * 只数课堂级会让高级模式的课堂整个从计数里消失。
   */
  classroomCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 列表响应。**本仓唯一一个服务端分页的接口**（B1 定的形状），其余列表都是一次给全。
 *
 * ⚠️ `total` 是**全库匹配数**，不是 `items.length` —— 分页控件必须读它。反过来，
 * 「已关联 / 未被使用」这种按 `classroomCount` 的计数**不能在这一页上算**：
 * 那只会统计当前这一页，教师读到的是一个假数字。列表页因此不做那个筛选（见 `page.tsx`）。
 */
export interface WorksheetListResponse {
  items: WorksheetSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 删除守卫要讲清的三样引用（规格 §5.5）—— `GET /api/worksheets/:id/usage`。
 *
 * 🔴 `responseCount`（历史作答）不是可选的第三项：Prisma 对必填关系默认 `ON DELETE RESTRICT`，
 * 删一份有作答的学习单会被**数据库直接拒绝**。少了它，界面会给出「没人用、可以删」的
 * 假信号，然后删除失败 —— 一个说谎的文案。
 *
 * `used` 是服务端算好的「三样里是否有一样非零」，界面直接读它，不要在前端重新拼这个判据
 * （拼错了就是一个与删除守卫不一致的判据）。
 */
export interface WorksheetUsage {
  used: boolean;
  /** 课堂级 + 组级按课堂去重后的数量，`classrooms.length` 与它相等。 */
  classroomCount: number;
  /** 上面那些课堂里已结束的个数。**已结束的课堂同样占着引用**，所以它只是解释性的。 */
  endedClassroomCount: number;
  /** 组级材料行数（`ClassroomGroupMaterial(kind='worksheet')`）。 */
  groupCount: number;
  /** 历史作答（`WorksheetResponse`）份数。 */
  responseCount: number;
  classrooms: RelatedClassroom[];
  /**
   * 服务端拼好的整句中文。⚠️ **弹窗不直接用这句**：它是一段给一行字用的整段话，
   * 把三样引用压成一个逗号串，而弹窗要列清单、要点名是哪几间课堂。
   * （历史：它曾经含「请先从这些课堂或小组中移除后再试」，而本仓**没有「移除」这个端点**
   * ——课堂设置只有标题可改。那句误导已从 `routes/worksheets.ts` 的 `describeUsage` 里删掉。）
   */
  message: string;
}

/**
 * ★ M4a：逐题分值的**编辑期**形状 —— 与服务端 `QuestionPoints`（`{ full: number; half: number }`，
 * 两端必填）**刻意不同名**，因为它确实不是同一个东西。
 *
 * 服务端那一个描述的是**落库后**的形状：`normalizePoints` 要么给出完整的两端，要么整个
 * 取值不存在（= 继承学习单级）。而这一份描述的是**编辑器里**的形状 —— 教师可以在一个框里
 * 输入、另一个框还空着，那一刻 `{ full: 7 }` 必须在状态里存在（受控输入框的值从它算出来）。
 *
 * ⚠️ 两者的「半填」含义**不相同**，所以不要把一个当成另一个的别名：
 *   · 编辑期的半填 = 「还没填完」，编辑器会拦住保存（`findPartialPoints`）；
 *   · 服务端若收到半填（`{ full: 7 }`），`normalizePoints` 会补成 `{ full: 7, half: 0 }`
 *     —— **部分给分变成 0 分**，而教师以为它继承了学习单级的档。这正是要拦住的原因。
 *
 * `undefined` 在两边同义且有意义：**留空 = 继承学习单级**（规格 §12 裁定 4）。
 */
export type QuestionPointsDraft = { full?: number; half?: number };

/**
 * 题目节点的**读形状**。
 *
 * ⚠️ 题型注册表与判分**只在服务端**（`server/src/services/worksheet-questions.ts`，09-19 §13
 * 「不引入前端测试框架，重逻辑全部放服务端」）。这里只有结构，没有「一道填空题的
 * `data` 里该有哪些键」——那是编辑器（C2）与服务端要共同遵守的东西，前端不该自作主张
 * 再定义一份。`data` 因此是 `Record<string, unknown>`。
 */
export interface WorksheetQuestionNode {
  id: string;
  /**
   * 题型串，取值域是服务端的 `QUESTION_TYPES`（**不由前端复述** —— 复述一遍就是第二份
   * 真源，而它漂了不会红）。窄写在这里只会让「界面上不认识的题型」变成类型错误，
   * 而库里手工改过的行本来就可能有任何字符串，所以这里如实写 `string`。
   */
  type: string;
  prompt: string;
  inputMode: 'keyboard' | 'handwriting' | 'photo';
  /**
   * ★ M4a：**逐题分值**。与服务端的 `QuestionNode.points` 对应（规格 §12 裁定 5：落在
   * 题目节点上，**不进 `data`** —— 它是题型无关的）。
   *
   * ⚠️ **`undefined` 是一个有意义的取值**：留空 = 继承学习单级（裁定 4）。
   * UI 读它时不要写 `?? { full: 1, half: 0 }` —— 那会把「跟随学习单级」变成
   * 「钉死在默认档」，教师改学习单级的档时这道题不跟随，而他看不到任何提示。
   *
   * 🔴 **它比服务端那个 `QuestionPoints` 松一档：两个字段都是可选的。** 那不是笔误 ——
   * 「教师在一端输入、另一端还空着」是屏幕上真实存在的一瞬间状态，而编辑器的两个输入框
   * 是**受控**的（显示值从 `node.points` 算出来）⇒ 表达不了它，就等于把教师刚打的字吞掉。
   *
   * ⇒ 半填（`{ full: 7 }`）是**编辑期**的合法状态，但**不是一个能保存的状态**：
   * 服务端的 `normalizePoints` 会把缺的那一端补成 `DEFAULT_POINTS`（全对 1 / 部分给分 0），
   * 而**不是**补成学习单级的档 —— 于是教师填了「全对 7」、部分给分留空，**部分给分静默变成 0 分**，
   * 而他以为它跟随学习单级的 2（2026-09-24 A2 审查实测）。所以编辑器在保存前用
   * `findPartialPoints` 把它拦下，要求两端都填、或者两端都清空（= 跟随学习单）。
   */
  points?: QuestionPointsDraft;
  data: Record<string, unknown>;
  /**
   * ★ 2026-09-25（教师裁定）：**是否允许自动评分**。缺省 = 允许；`false` = 不判分。
   *
   * 🔴 与 `points` 同一条理由放在**顶层**：它**题型无关**（九个可判分的题型都要回答这一格）。
   * ⚠️ 判分器以**开关**为准，不以「有没有答案」推断 —— 关掉时答案**保留在库里**，
   * 所以「有答案却不判分」是正常状态。
   */
  autoGrade?: boolean;
  /**
   * ★ 2026-09-25（教师裁定）：**部分给分的容错档** —— 「错不超过 N 处 ⇒ 部分给分」。
   * 缺省（`undefined`）= **旧规则**「只要有一部分对就给分」。
   * ⚠️ 只有 `>= 1` 的整数算设过；其余值一律当缺省（与 `toleranceOf` 同一把尺子）。
   */
  partialTolerance?: number;
  children: WorksheetQuestionNode[];
}

export interface WorksheetContent {
  schemaVersion: number;
  nodes: WorksheetQuestionNode[];
}

/**
 * ★ 2026-09-27（教师）：学生端**卡片透度**的取值域。
 *
 * 「让漂亮的背景图片更明显一些」—— 取值范围、选项表与那两个 alpha 在
 * `src/lib/worksheet-surface.ts`（**唯一真源**），这里只放类型，与
 * `WorksheetBackgroundTheme` 同一种分工。
 *
 * ⚠️ 加一档要同时改三处：本联合、`WORKSHEET_SURFACE_OPTIONS`、`surfaceAlphas`。
 *    只加前两处的后果是那一档**静默落到默认数值**（`surfaceAlphas` 的最后一个 `return`），
 *    教师选了「极透」而屏幕上一点变化都没有。
 */
export type WorksheetSurfaceOpacity = 'opaque' | 'soft' | 'clear';

export type WorksheetBackgroundTheme =
  | 'none'
  | 'cloud-playground'
  | 'forest-explorer'
  | 'space-discovery'
  | 'ocean-observation'
  | 'creative-notebook'
  | 'dinosaur-archaeology'
  | 'invention-workshop'
  | 'music-rhythm'
  | 'chinese-study'
  | 'active-sports'
  | 'custom';

/**
 * 题目开放方式（四档）。★ 2026-09-30 加了第四档 `'manual'`。
 *
 *   · `open`          —— 一打开就全部可作答；
 *   · `task-step`     —— **学生**推进：交了当前任务，下一个任务才出现；
 *   · `question-step` —— **学生**推进：交了当前小题，下一小题才出现；
 *   · `manual`        —— **教师**推进：只有他在看板「逐题开放」里开过的那几道是可作答的
 *                        （清单存 `Classroom.worksheetOpen`，见 `services/worksheet-open.ts`）。
 *
 * 🔴 取值域与归一化**只有一份**：`src/lib/worksheet-answer-mode.ts` 的
 * `WORKSHEET_ANSWER_MODES` / `normalizeAnswerMode`（服务端 `routes/worksheets.ts` 有一份
 * 同名的字符串数组，两份必须同值）。⚠️ 别在别处再写一遍 `=== 'task-step' || …` 那种内联
 * 判断：本次加第四档时仓里正好有三份，**每一份漏改都会把一个 `manual` 的学习单静默降级
 * 成 `open`**（学生看到全部题目，而老师以为卷子是锁着的）。
 */
export type WorksheetAnswerMode = 'open' | 'task-step' | 'question-step' | 'manual';

/**
 * 设置。各项都**由服务端 `normalizeSettings` 补齐**（`routes/worksheets.ts`），
 * 落库的 JSON 里这些键一定都在，所以这里全是必填 —— 客户端不必再写 `?? 默认值`。
 *
 * ⚠️ `rewardStyle` / `rewardStep` / `halfStep` 是**学生端奖励形式**的配置（规格 §9.2，
 * 学习单级）。它们只影响**画法**，与 `isCorrect` 那个布尔值是两回事：星星、花朵、分数
 * **不落库**（规格 §9.1）。取值规则与可选项在 `src/lib/worksheet-reward.ts`，别在这里再定义一遍。
 */
export interface WorksheetSettings {
  allowResubmit: boolean;
  autoGrade: boolean;
  /** 学生的答题开放方式：全部开放、按任务解锁、按小题解锁。 */
  answerMode: WorksheetAnswerMode;
  defaultInputMode: 'keyboard' | 'handwriting';
  /**
   * 奖励形式的取值域只有一份，在 `worksheet-reward.ts`（那里还有标签、符号、量词与
   * 取值函数）。这里**转出**同一个类型而不是再写一遍字面量联合 —— 两处各写一份，
   * 加了第五档时必然只改一处。
   */
  rewardStyle: RewardStyle;
  /** 全对一题的步长，取值域 `1 | 2 | 3 | 5`。 */
  rewardStep: number;
  /**
   * ★ M4a：部分给分一题的步长，取值域 `0 | 1 | 2 | 3 | 5` —— 🔴 **比 `rewardStep` 多一个 `0`**
   * （`0` = 这单不给部分分，也是新单的默认值，规格 §12 裁定 3）。归一化函数是
   * `worksheet-reward.ts` 的 `normalizeHalfStep`，**不是** `normalizeRewardStep`（它的域不含 0）。
   */
  halfStep: number;
  /**
   * ★ M7b：这道题的分析用哪个智能体（`Agent.id`）。`null` = 没指定 ⇒ 分析按钮禁用。
   *
   * 🔴 它是**学习单级**而不是全局：提示词写在平台上那个 bot 里，而一份数学单与一份
   * 语文作文单该用不同的提示词 ⇒ 「用哪个分析 bot」天然是**学习单的属性**，不是全局偏好。
   * ⚠️ **没有默认值**是刻意的：默认指定一个等于「默认把全班作业发出去」。
   */
  analysisAgentId: string | null;
  /** 学生端学习单的背景主题。`custom` 时读取下面的横、竖两张上传图。 */
  backgroundTheme: WorksheetBackgroundTheme;
  /** 自定义背景只允许站内上传地址；预设主题时保留但不读取。 */
  backgroundImageUrl: string | null;
  /** 自定义竖屏背景；可选。缺省时学生端完整显示横图而不裁切。 */
  backgroundPortraitImageUrl: string | null;
  /**
   * ★ 2026-09-27（教师）：学生端**卡片透度**（题目卡片 + 任务容器两个面）。
   *
   * 档位与数值在 `src/lib/worksheet-surface.ts`；认不出的值一律回 `opaque`
   *（= 本次改动之前的样子，见那个归一化函数的注释）。
   */
  surfaceOpacity: WorksheetSurfaceOpacity;
}

/**
 * 详情（`GET /api/worksheets/:id`）。新建 / 更新 / 复制三个端点回的也是它（写完全量读回）。
 *
 * 🔴 **不是 `WorksheetSummary` 的超集，别让它们互相 `extends`**：这一份是 `Worksheet` 表的
 * 原始行，**没有** `questionCount` 与 `classroomCount` —— 那两个是列表端点从 `content`
 * 算出来、再查一次关联表才拼上的投影字段，详情端点根本不产出它们。写成继承会让
 * 类型说谎，编辑器照着读就会在运行期拿到 `undefined`。
 */
export interface WorksheetDetail {
  id: string;
  title: string;
  description: string | null;
  schemaVersion: number;
  content: WorksheetContent;
  settings: WorksheetSettings;
  createdAt: string;
  updatedAt: string;
}

/**
 * ★ M4a：一道题的**判分结论三态**（规格 §12「得分与正确率的口径」）。
 *
 * 取值域与**服务端** `server/src/services/worksheet-questions.ts` 的 `GradeState` 逐字相同，
 * 也就是 `grade()` 的返回值域（它为 `null` = 该题型不参与判分，与 `'incorrect'` 是两件事）。
 *
 * 🔴 **`isCorrect: boolean` 表达不了它**（`false` 同时覆盖 `'incorrect'` 与 `'partial'`），
 * 所以 M4a 在 `WorksheetAnswer` 上加了 `gradeState` 列，并把 `isCorrect` 的语义**收窄为「全对」**、
 * 由 `gradeState` 派生写入 —— `isCorrect` 因此**不再是第二真相源**。
 *
 * ⚠️ 「这一行没判分」= `gradeState === null`（主观题 / 关掉自动判分 / 还没提交），
 * 那是 `null` 而不是这个联合里的一员 —— 别为了省一个 `??` 给它加一个 `'none'` 成员，
 * 那会让「没判」与「判错」在类型上长得一样。
 */
export type WorksheetGradeState = 'correct' | 'partial' | 'incorrect';

/**
 * ★ M7a：一道题的**聚合载荷**（分析预览用）。
 *
 * ⚠️ 图**不在**里面 —— 它走 `…/sheet/:index` 单独取（库里只存结构化快照，图是按需重渲的
 * 派生物，见规格 §3.1 决定 1）。所以这个类型里只有 `sheetLayouts`（每张的尺寸与格数）。
 */
export interface WorksheetAnalysisPayload {
  // ⚠️ **没有 `worksheetId` / `computedAt`** —— 服务端的 `payloadResponse` 回的是
  // `{ ...buildAnalysisPayload(...), labeled, stale }`，而那两个字段不在里面（独立审查 M1）。
  // 类型上写着它们，读的人会以为拿得到，而 `payload.computedAt` 会**静默是 `undefined`**。
  questionId: string;
  /** 「第 N 题」（服务端按拍平题序算好，1-based）。 */
  questionLabel: string;
  typeLabel: string;
  prompt: string;
  /** 选项、排序条目、连线两栏、分类框等题干之外的可读题面材料。 */
  questionDetails: string;
  /** 本地按题型翻译后的参考答案或评价要点。 */
  referenceAnswer: string;
  /** 服务端已有的判分结果汇总；智能体直接使用，不重新判分或计数。 */
  localStats: { correct: number; partial: number; incorrect: number; ungraded: number };
  payloadKind: 'text' | 'image' | 'mixed';
  /** 已提交该题的**参与者**数。单位（人 / 组）由界面按课堂 mode 定，见 `moduleCountUnit`。 */
  covered: number;
  /** **该题应作答的**参与者数（高级模式下**不是**全班人数）。 */
  total: number;
  /** 格序（与联系表上的格、编号对照表一一对应）。 */
  entries: Array<{ studentId: string; anonLabel: string }>;
  /** 文字类（或 mixed）的聚合文档；纯绘图题是 `null`。 */
  text: string | null;
  sheetLayouts: Array<{ sheetIndex: number; width: number; height: number; cells: unknown[] }>;
  knobs: { cellWidth: number; cellHeight: number; columns: number; maxCellsPerSheet: number };
  /**
   * 标签**这一次**能不能渲染出来。`false` = 图上没有标签（本机渲染不出文字），
   * 界面**必须**给出编号对照表，否则教师与模型都认不出哪一格是谁。
   */
  labeled: boolean;
  /** 「算完之后又有人交了这道题」—— 服务端算的，界面必须显眼说出来。 */
  stale: boolean;
  /** ★ M7b：AI 写的解读。`null` = 还没分析过（按钮没点过，或点了但失败了）。 */
  narrative: string | null;
  /** ★ M7b：写这段解读的智能体与平台（审计用）。 */
  agentId: string | null;
  model: string | null;
  /** 主观题的 AI 评分设置。关闭时不会要求智能体返回逐生分数。 */
  aiScoring: { enabled: boolean; maxScore: number; unit: string; criteria: string; parts?: Array<{ index: number; maxScore: number }> };
  /** AI 返回并由服务端校验过的逐生评分；与正式自动判分字段完全分开。 */
  perStudent: {
    maxScore: number;
    unit: string;
    criteria: string;
    scores: Array<{ studentId: string; score: number | null; reason: string; advice: string }>;
    /**
     * ★ 2026-10-07：**还没有分的学生**（模型漏了 / 分数越界 / 缺评价或建议）。
     * 面板据此显示「本次只拿到 X/Y，缺：…」—— 40 人班上模型几乎不会一次评全。
     */
    missing?: string[];
  } | null;
  /** 只返回教师端，用于把评分中的参与者 ID 显示为姓名；不会进入远端智能体载荷。 */
  participantNames: Record<string, string>;
  /** ★ 2026-10-07：**真的可以评分**的那些代号（评分那一段只点这些人的名）。 */
  scorableLabels: string[];
  /** ★ 2026-10-07：**这一版读不出作答**、因而评不了的人（图没抓到 / 形状认不出）。 */
  unscorableIds: string[];
  /**
   * ★ M7b：学习单上指定的那个分析智能体（`null` = 没指定）。
   * 只给界面**显示**用 —— 能不能发的判断在服务端（见 `canSend`）。
   */
  analysisAgent: { name: string; platform: string } | null;
  /**
   * ★ M7b：现在能不能发。`ok: false` 时 `reason` **逐字**说明为什么（界面直接显示它）。
   *
   * 🔴 判断在服务端 —— 它需要三件事，而那三件的数据都在那一侧：有没有指定智能体 ·
   * 那个智能体启没启用 · 平台收不收得了这份载荷的形态。前端**不复述**这些规则。
   */
  canSend: { ok: true } | { ok: false; reason: string };
}

/**
 * 教师看板的**逐题作答行**（`GET /api/worksheets/classroom/:classroomId/answers`）。
 *
 * 🔴 这个端点是 D4 补的，它存在的理由是 D3 实测出来的一个洞：看板格子完全由
 * `worksheet-answer-updated` 广播驱动 ⇒ **教师刷新一次页面，早做完的学生就掉回
 * 「还没收到作答」态**（看板失忆，且不报错）。抽屉的两种形态本来也要同一份数据。
 *
 * `value` 是**学生自己写的**那个作答值，不是正确答案 —— 正确答案
 * （`data.correctKeys` / `data.answers`）住在 `Worksheet.content` 里，
 * 服务端**从不**把它放进这个响应（规格 §5.4 红线）。
 */
export interface WorksheetBoardAnswerRow {
  questionId: string;
  /** `'unanswered' | 'draft' | 'submitted'`（服务端 DDL 的取值域）。 */
  status: string;
  /**
   * 只有「已提交」且服务端判过分时才有值；主观题与关闭自动判分时是 `null`。
   *
   * ⚠️ 语义已**收窄为「全对」**（规格 §12「得分与正确率的口径」）：`false` **同时**覆盖
   * `incorrect` 与 `partial`，所以**抽屉里**要画「½ 部分给分」时**不能**靠它，得看 `gradeState`（对错标记在抽屉里、不在看板格子上，规格 §7.2）。
   * 🔴 字段名只增不改（协议字段）。
   */
  isCorrect: boolean | null;
  /**
   * ★ M4a：三态（`correct` / `partial` / `incorrect`），`null` = 没判分。
   * ⚠️ 旧行（M3 落的）已由启动期回填补齐；**回填没跑到**时它是 `null`，`isCorrect` 才是兜底
   * （读的一侧 —— `worksheet-drawer-state.ts` 的 `rowVerdict` —— 里那条兜底还留着）。
   */
  gradeState: WorksheetGradeState | null;
  /**
   * ★ M4a：这道题拿到的**绝对数**（教师逐题填的两个档之一），`null` = 没判分**或旧行**。
   * ⚠️ 旧行**永远是 `null`**（A1 刻意不回填：那时没有逐题分值，写死一个 1 是编的），
   * 读的一侧按 `gradeState` 兜底推导。
   */
  score: number | null;
  /** 教师的「已查看」时间；`null` = 还没看过（规格 §7.4 的「已看 N/M」数据源）。 */
  reviewedAt: string | null;
  /** 学生原答案。读不出来时是 `null`（旧版本 / 手改过的行）。 */
  value: unknown;
  /**
   * ★ 2026-09-28：作答活动三列（抽屉「过程区」的数据源）。
   *
   * 🔴 **三个都可能为 `null`，含义一律是「不知道」**，读的一侧不许把它当成
   * 「刚刚」或「0 次」—— 那两句都是编的。它们的 `null` 来自本列上线之前的旧行
   * （`ensureWorksheetAnswerColumns` 只加列、**刻意不回填**：旧行被保存过几次、
   * 什么时候保存的，库里从来没有记过）。缺值时那一整段**不显示**，不是显示 0。
   */
  /** 这一题**第一次**落库的时刻。 */
  createdAt: string | null;
  /**
   * **最近一次保存**的时刻。
   * ⚠️ 提交**不推进它** —— 提交不是一次内容写入（那一支的 `data` 里没有 `value`）。
   * 所以「距上次保存」在交卷之后仍然说的是他最后一次**动笔**的时刻。
   */
  savedAt: string | null;
  /** 保存过几次（**不含**提交）。`null` = 不知道。 */
  saveCount: number | null;
}

/**
 * 这一份学习单上的一个参与者。**可能是学生，也可能是小组** ——
 * 分组 / 高级模式下「一块设备 = 一个小组」，参与者就是组（规格 §1.2）。
 */
export interface WorksheetBoardParticipant {
  /** `ClassroomStudent.id` —— 与看板格子的 `cs.id` 同源，也是 `review` 端点要的 id。 */
  participantId: string;
  name: string;
  /** `'student' | 'group'`。 */
  kind: string;
  groupName: string | null;
  /**
   * 逐题作答行。⚠️ **没作答的人是空数组，不是缺字段** ——「已交 N/M」的分母是参与者数，
   * 少一个人分母就少一个，而那个数没有任何地方会报错。
   */
  answerRows: WorksheetBoardAnswerRow[];
}

export interface WorksheetBoardWorksheet {
  id: string;
  title: string;
  /** 已经成功生成并保存 AI 分析的题目 id。正文仍按需读取，不随看板大列表返回。 */
  analyzedQuestionIds: string[];
  participants: WorksheetBoardParticipant[];
}

/**
 * 整个课堂的作答行，**先按学习单分组**。
 *
 * 🔴 那第一层不是多余的：高级模式下每个组可以是**不同的学习单**（规格 §1.2），
 * 「全班共有的第 3 题」并不存在。标准 / 分组模式下这个数组只有一个元素，
 * 界面上会退化成一层（规格 §7.3）。
 */
export interface WorksheetBoard {
  classroomId: string;
  /**
   * ★ 2026-09-28：**服务端发这个响应时的时刻**（ISO）。
   *
   * 🔴 它存在的唯一理由是**跨时钟相减**：作答行上的 `savedAt` 是服务端时间，而看板判
   * 「停住了」用的是浏览器时钟。两个不同源的时钟相减，在教师那台机器的时钟偏了几分钟时
   * 会**静默**给出错误的结论。有了它，客户端做**服务端减服务端**（偏差相消），
   * 再把得到的**时长**换算回浏览器时钟 —— 见 `worksheet-board-data.ts`。
   *
   * ⚠️ 旧服务端不发这个字段（可空）：那时**不许**退化成「拿浏览器时钟去减服务端时间戳」，
   * 只能把 `lastAt` 置 `null`（=「不知道」）。判据是 `null`，不是「随便算一个」。
   */
  serverNow?: string | null;
  worksheets: WorksheetBoardWorksheet[];
}

export interface StudentSessionResponse {
  token: string;
  expiresIn: number;
}

export interface AgentInfoResponse {
  name: string | null;
  iconUrl: string | null;
  greeting: string | null;
}

export interface AgentTestResponse {
  success: boolean;
  error?: string;
}

export interface ShieldWord {
  id: string;
  word: string;
  builtin: boolean;
  enabled: boolean;
}

export interface ShieldConfig {
  autoBlackCount: number;
  rateLimit: number;
}

export interface ShieldWordCategory {
  name: string;
  count: number;
  words: Array<Pick<ShieldWord, 'id' | 'word' | 'enabled'>>;
}

export interface ClassSummary {
  id: string;
  name: string;
  avatarId: number | null;
  createdAt?: string;
  _count: { groups: number; students: number };
  maleCount: number;
  femaleCount: number;
  avatarAssignedCount: number;
  rewardedCount: number;
  totalTokens: number;
  uploadedAvatarCount: number;
}

export interface StudentSummary {
  id: string;
  classId: string;
  name: string;
  studentNo: string | null;
  gender: string | null;
  tag: string | null;
  avatarId: number | null;
  avatarChangeTokens: number;
  createdAt?: string;
}

export interface ClassGroup {
  id: string;
  classId: string;
  name: string;
  studentIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentBatchCreateResponse {
  count: number;
  students: Array<Pick<StudentSummary, 'classId' | 'name' | 'studentNo' | 'gender'>>;
}

export type AvatarCategory = 'student' | 'class';
export type AvatarGender = 'boy' | 'girl' | 'neutral';

export interface AvatarSummary {
  id: number;
  name: string;
  svgContent: string;
  category: AvatarCategory;
  gender: AvatarGender;
  sortOrder: number;
  isActive: boolean;
  source?: string;
  createdAt?: string;
}

export interface AvatarBatchResult {
  success: boolean;
  count: number;
}

export interface AvatarRandomCandidate {
  svgContent: string;
  gender: AvatarGender;
}

export interface ClassroomStudentSummary {
  id: string; // ClassroomStudent.id：稳定的课堂参与者 ID
  participantType: 'student' | 'group';
  studentId: string | null; // 仅真实学生参与者存在
  name: string;
  studentNo: string | null;
  gender: string | null;
  avatarId: number | null;
  groupId: string | null;
  groupName?: string;
  status: string;
}

export interface ClassroomCardMessage {
  id?: string;
  content: string;
  role: string;
  createdAt: string;
  roundIndex?: number | null;
  fileUrls?: string | null;
  fileNames?: string | null;
  studentName?: string;
}

export interface ClassroomCardGroup {
  id: string;
  name: string;
  agentId?: string;
  code?: string | null;
}

export interface ClassroomCardStudent {
  id: string;
  participantId?: string;
  participantType?: 'student' | 'group';
  studentId: string | null;
  groupId: string | null;
  totalRounds: number;
  warningCount: number;
  blacklisted: boolean;
  status: string;
  student: StudentSummary;
  group?: ClassroomCardGroup | null;
  messages: ClassroomCardMessage[];
}

export interface ClassroomDetail extends Omit<ClassroomSummary, 'students' | 'groups'> {
  classes: Array<{ classId: string; class: ClassSummary }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  /**
   * 各组的材料。
   *
   * ⚠️ `worksheet` 直到 P1 的 D3 才写进这个类型 —— **服务端一直在发它**
   * （`GET /:id` 的 `groups[]` 来自 `resolveGroupMaterialViews`，与 `/active`、`/code/:code`
   * 同一个解析口径），只是这个接口当初（P2.3）只补了 `agent`，读它的人当时还不存在。
   * 高级模式下 `null` 是**合法值**（本组没配学习单），**不回落**到课堂级那一份 ——
   * 取法一律走 `@/lib/classroom-material` 的 `effectiveGroupWorksheet`。
   */
  groups: Array<ClassroomCardGroup & { agent?: AgentSummary; worksheet?: WorksheetMaterialSummary | null }>;
  /**
   * 本课堂**课堂级**关联的学习单（`GET /:id` 的 `res.json`，`routes/classroom.ts:882`）。
   *
   * 与 `ActiveClassroom.worksheets` **逐字同源**（同一个 `loadClassroomWorksheets`）：
   * **标准 / 分组模式**的权威来源；高级模式下权威来源是各组（`groups[].worksheet`），
   * 这一条是空数组。可选的读法与 `webapps?` 相同（老服务端不发这个字段）。
   */
  worksheets?: WorksheetMaterialSummary[];
  students: ClassroomCardStudent[];
  groupMembersMap: Record<string, {
    groupName: string;
    members: Array<Pick<StudentSummary, 'id' | 'name' | 'studentNo'>>;
  }>;
  modules: ClassroomModuleSetting[];
  /**
   * 该课堂在 ClassroomModule 表里有没有行。
   *
   * `modules` 是补齐后的三项，「三态全是 preview」既可能是教师把三项都设成了暂停、
   * 也可能是这个课堂从未设置过（老课堂零行兜底），前端单看 `modules` 分不出来。
   *
   * 可选：服务端读取模块行失败（老库 ClassroomModule 表不存在）时**不下结论**、不发这个
   * 字段，此时它是 `undefined`。读的地方必须用 `=== false` 判断「确定没有行」，别用 `!`
   * —— 那会把「不知道」当成「没有」。
   */
  hasModuleRows?: boolean;
  /**
   * 本课堂关联的探究网页。`GET /api/classroom/:id` 与 `/code/:code` **共用**
   * `loadClassroomWebapps`（`routes/webapps.ts`），两个端点的形状逐字相同 ——
   * 教师看板的探究空间视图按它渲染格子标题。
   *
   * 可选的理由同 `StudentClassroom.webapps`：查询失败（老库缺表）时服务端降级为
   * 空数组，更老的版本则根本不发这个字段；读的地方按「没有网页」处理。
   *
   * ⚠️ 教师端这条路径**没有** `webappPort`（那个只在 `/code/:code` 下发）：
   * 教师看板不需要自己拼地址，管理页的预览走 `/api/server-info` 的 `webappOrigin`。
   */
  webapps?: ClassroomWebappSummary[];
  /**
   * 探究空间画面的采集设置（P2.2，`Classroom` 表的三个标量列；`GET /api/classroom/:id`
   * 靠 `...classroom` 原样带出，`POST /:id/webapp-capture` 则返回归一化后的全量）。
   *
   * 三个都**可选**：老库加列之前建的行、或服务端降级响应都可能没有。
   * 🔴 读的地方方向必须是「**认不出 = 开 / 用默认**」——
   * `webappCaptureEnabled !== false`、`webappThumbnailWidth ?? 320`、
   * `webappFrameIntervalMs ?? 10000`，与 `server/src/services/webapp-capture.ts`
   * 的 `normalizeCaptureConfig` 对齐。写成 `!enabled` 或 `Boolean(enabled)`
   * 会把「不知道」渲染成「已关闭」，教师看到的是一个假的关闭态，
   * 然后他会去点一次「开启」，把一个本来开着的功能关掉。
   */
  webappCaptureEnabled?: boolean;
  webappThumbnailWidth?: number;
  webappFrameIntervalMs?: number;
  /**
   * ★ 2026-09-25：**详情档**周期的教师覆盖值（毫秒）。
   *
   * 🔴 这一格与上面三个**方向相反**：`null` / 缺字段都表示「**没调过**」⇒ 按基准派生
   * （`detailIntervalFor`：基准的 1/5，夹在 1000~5000）。**不要**给它兜一个 `?? 2000` ——
   * 那会把「跟随基准」的课堂（基准 30 秒 ⇒ 详情 6 秒）静默改成固定 2 秒，
   * 而那正是教师当初把基准调大要避开的事。
   */
  webappDetailIntervalMs?: number | null;
}

export interface ClassroomHistoryItem extends ClassroomSummary {
  createdAt: string;
  endedAt: string | null;
  totalChars: number;
  totalRounds: number;
  participantCount: number;
  realStudentCount: number;
  /**
   * ★ M6c：三件套的使用痕迹（历史页那三列）。
   *
   * ⚠️ `webappUsageCount` 为 0 **有两种成因且不可区分**：这节课确实没人用探究空间 /
   * **这节课没有教师打开过看板**（学生按需推流根本没推 —— `recordWebappSummary` 的注释逐字写着）。
   * ⇒ 界面上的文案只能是「**无记录**」，**不许**写「未使用」（GC 33）。
   * ⚠️ `worksheetTotal` 是**已有作答行数**，**不是**「参与者 × 题数」⇒ 文案只能写
   * 「已交 N / M 题」，不许写「已交 N/M 人」（GC 34）。
   */
  webappUsageCount: number;
  webappDurationMs: number;
  /** ★ 服务端用 `formatDuration` 算好的时长文案（**前端不许另写一份格式化**）。 */
  webappDurationText: string;
  worksheetSubmitted: number;
  worksheetTotal: number;
  _count: { students: number; interactions: number };
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
}

export interface ActiveClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  createdAt: string;
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  /**
   * ⚠️ `agent` / `webapp` **都可能为 `null`**：P2 起材料按组走，高级模式下「这组没配」
   * 是合法状态（`group-material-resolve.ts` 条件构造）。写成非空是**陈述上的谎言**，
   * 会让读的地方少一层判空。
   */
  groups: Array<ClassroomCardGroup & {
    agent: AgentSummary | null;
    webapp: ClassroomWebappSummary | null;
    /**
     * 该组的**学习单**（本注释的上一版写在 P1 服务端合并**之前**，说的「服务端不下发」
     * 当时是真的，今天不是了 —— 见 `WorksheetMaterialSummary`）。
     *
     * 服务端**会发**：`GET /api/classroom/active` 的 `groups[]` 来自 `resolveGroupMaterialViews`
     * （`server/src/services/group-material-resolve.ts:188`），逐组给 `agent` / `webapp` /
     * `worksheet` 三个槽。高级模式下 `null` 是**合法值**（本组没配学习单），**不回落**到
     * 课堂级；组不在 `groups[]` 里、或更老的响应里没这个字段时才取到 `undefined`。
     * 两种都当 `null` 处理（该组没配），**不是**当成错误。
     */
    worksheet?: WorksheetMaterialSummary | null;
  }>;
  students: Array<{ studentId: string; totalRounds: number }>;
  _count: { students: number };
  participantCount: number;
  realStudentCount: number;
  /**
   * 本课堂关联的探究网页（`GET /api/classroom/active`，为管理页的「课堂设置」弹窗而发）。
   *
   * 单选之后**至多一条**；老数据里可能有多条，那种课堂在弹窗里会显示成
   * 「只有第一个生效，保存设置后多余的会被移除」—— 服务端确实会在保存时裁掉
   * （`trimExtraClassroomWebapps`）。
   *
   * 可选：服务端查询失败（老库缺表）时降级为空数组，更老的版本根本不发这个字段。
   * ⚠️ 因此「没发」与「空数组」在界面上都是「没有网页」—— 这与学生端 `webapps?` 同一条口径。
   */
  webapps?: ClassroomWebappSummary[];
  /**
   * 本课堂**课堂级**关联的学习单。服务端**会发**（`loadClassroomWorksheets`，
   * `server/src/routes/classroom.ts:217`；`GET /active` 在 `:700` 调用它）。
   *
   * 与 `webapps` 同构、同源、同一条口径：**标准 / 分组模式**的权威来源；高级模式下权威来源
   * 是各组（`groups[].worksheet`），这一条会是空数组（服务端在该模式下不写它）。
   *
   * 可选的理由与 `webapps?` 逐字相同：服务端读取失败（老库缺 `ClassroomWorksheet` 表）时
   * 降级为空数组，更老的版本根本不发这个字段 —— 「没发」与「空数组」在界面上都是「没有学习单」。
   */
  worksheets?: WorksheetMaterialSummary[];
}

export interface StudentClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  agents: AgentSummary[];
  /**
   * 各组的材料（`GET /code/:code` 与 `join-classroom` 的 `joined` 事件）。
   *
   * 🔴 **`agent` / `webapp` / `worksheet` 都可为 `null`，且高级模式下这是「该组没有这种材料」
   * 的唯一表达 —— 不得回落到 `agents[]` / `webapps[]` / `worksheets[]`**（那三个是课堂级
   * 数组，高级模式下曾是各组材料的并集 ⇒ 回落到它等于让学生静默地用别的组的智能体/网页/
   * 学习单）。解析一律经 `@/lib/classroom-material` 的
   * `effectiveGroupAgent` / `effectiveGroupWebapp` / `effectiveGroupWorksheet`。
   *
   * ⚠️ `agent` 的**运行时**形状是 `AgentSummary` 的子集（服务端 `GroupMaterialView`：
   * `id` / `name` / `logo` / `platform` / `enabled` / `greeting`）—— 声明按 `AgentSummary`
   * 是为了与 `agents[]` 同一个类型、读 `enabled` / `greeting` 时不必分支；但**不要**从这个
   * 对象上读 `apiUrl` / `apiKey` / `hasApiKey` 之类的管理字段，服务端在这里根本不下发。
   *
   * ⚠️ `worksheet` 与那个顶层 `worksheets` 数组是**同源**的（服务端都走
   * `resolveGroupMaterialViews` / 组材料行）：标准 / 分组模式下本字段恒为 `null`
   * （材料是课堂级的），权威来源是顶层数组 —— 这与 `webapp` 的口径逐字相同。
   *
   * 可选：更老的服务端不发这个字段；标准模式下服务端也刻意不发（`groups` 为 `undefined`）。
   */
  groups?: Array<ClassroomCardGroup & {
    agent: AgentSummary | null;
    webapp: ClassroomWebappSummary | null;
    worksheet?: WorksheetMaterialSummary | null;
  }>;
  modules: ClassroomModuleSetting[];
  /**
   * 探究空间托管服务的**端口**（P2；`GET /api/classroom/code/:code` 下发）。
   *
   * ⚠️ 是端口而**不是**拼好的 URL：学生端本来就知道自己是从哪个 IP / 域名进来的
   * （`location.hostname`），所以自己拼出来的源永远正确、无缓存、不会陈旧 ——
   * 一个由服务端拼好的绝对 URL 反而会在「服务端挑的绑定 IP 与学生实际用的入口不同」
   * 时把人送到一个打不开的地址上。服务端侧的理由见 `server/src/routes/classroom.ts`。
   *
   * 可选：托管服务起不来时服务端拿到的是 `undefined`（Ruling 1：托管服务故障不拖垮主服务），
   * 更老的版本则根本不发这个字段 —— 读的地方必须按「不可用」处理，不能当成 0。
   */
  webappPort?: number;
  /**
   * 本课堂关联的网页，按关联顺序；查询失败（老库缺表）时服务端降级为空数组。
   *
   * 可选的理由同上（旧服务端不发这个字段），与 `hasModuleRows?` 同一条口径：
   * 「没发」与「发了但是空」在 UI 上都是「老师还没添加网页」，但读路径不能因为
   * 字段缺失就崩。
   */
  webapps?: ClassroomWebappSummary[];
}

export interface ClassroomSettingsGroup {
  id: string;
  name: string;
  agentId: string;
}

export interface DashboardClassroom extends Omit<ClassroomSummary, 'groups' | 'students'> {
  classes: Array<{ classId: string; class: Pick<ClassSummary, 'id' | 'name'> }>;
  classroomAgents: Array<{ agentId: string; agent: AgentSummary }>;
  /** ⚠️ 同 `ActiveClassroom.groups`：`agent` / `webapp` 都可为 `null`（`/all` 也走 `resolveGroupMaterialViews`）。 */
  groups: Array<ClassroomCardGroup & { agent: AgentSummary | null; webapp: ClassroomWebappSummary | null }>;
  _count: { students: number; interactions: number };
  participantCount: number;
  realStudentCount: number;
}

export interface StorageStats {
  avatars: {
    teacher: { count: number; totalSize: number; totalSizeText: string };
    student: { count: number; totalSize: number; totalSizeText: string };
  };
  classIcons: { count: number; totalSize: number; totalSizeText: string };
  agentLogos: { count: number; totalSize: number; totalSizeText: string };
  classroomAttachments: {
    totalCount: number;
    totalSize: number;
    totalSizeText: string;
    classrooms: Array<{
      id: string;
      title: string | null;
      status: string;
      interactionCount: number;
      totalRounds: number;
      attachmentCount: number;
      totalSize: number;
      totalSizeText: string;
    }>;
  };
  agentUsage: Array<{ id: string; name: string; platform: string; classroomCount: number; totalCalls: number; totalChars: number }>;
}

export interface TeacherNotification {
  id: string;
  classroomId: string;
  studentId: string | null;
  content: string;
  createdAt: string;
}

/** 高级模式每个小组要提交的材料。
 *
 * 🔴 `agentId` / `webappId` 都可以是 `null`，含义是**该组显式「不指定」这种材料** ——
 * 它与「这个字段没传」在服务端归一成同一件事（都会不落库，见 `create-advanced` 的
 * `toId`）。高级模式下**不回落课堂级材料**：某组没指定智能体，那组的学生就没有智能体，
 * 不会静默拿到别的组的。
 */
export interface AdvancedClassroomGroupInput {
  name: string;
  agentId: string | null;
  webappId: string | null;
  /**
   * 学习单。与上面两个字段**逐字同语义**（都是 `toId` 归一）。
   *
   * ⚠️ 写成**必填**是刻意的：唯一调用点是创建页，而「忘了发这个字段」的后果是
   * 教师明明给每组选了学习单、课堂里却是空的 —— 让它编译期暴露，比留个可选字段好。
   */
  worksheetId: string | null;
  studentIds: string[];
}

export interface ClassroomMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  roundIndex: number | null;
  agentId: string | null;
  fileUrls?: string | null;
  fileNames?: string | null;
  followUps?: string | string[] | null;
  classroomStudent?: {
    id: string;
    student?: Pick<StudentSummary, 'id' | 'name' | 'studentNo' | 'gender' | 'avatarId'> | null;
    group?: Pick<ClassroomCardGroup, 'id' | 'name'> | null;
  };
}

export interface BackupFile {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  source: string;
}

export interface AvatarUploadResponse {
  success: boolean;
  url: string;
  svgContent: string;
  name: string;
}

export interface ClassroomWarning {
  id: string;
  classroomId: string;
  studentId: string | null;
  word: string;
  content: string;
  createdAt: string;
  studentName?: string;
}

export interface ClassroomWarningSummary {
  id: string;
  title: string;
  status: 'active' | 'paused' | 'ended';
  code: string;
  className: string;
  warningCount: number;
  createdAt: string;
}

export interface ExportConversationStudent {
  studentId?: string;
  name: string;
  studentNo?: string | null;
  gender?: string | null;
  totalRounds?: number;
  messages: Array<{
    role: string;
    content: string;
    time: string;
    roundIndex?: number | null;
    agentId?: string | null;
    agentName?: string | null;
    fileUrls?: string[];
    fileNames?: string[];
  }>;
}

export interface ConversationExportReport {
  title: string;
  code: string | null;
  mode: string;
  createdAt: string;
  endedAt: string | null;
  classes: string[];
  agents: Array<{ id: string; name: string; platform: string }>;
  teacherNotifications: Array<{ content: string; time: string; targetStudentId: string | null }>;
  students: ExportConversationStudent[];
}

export interface StatsExportReport {
  title: string;
  exportedAt: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}
