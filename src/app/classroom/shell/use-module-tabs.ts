import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { MODULE_ID_BY_KEY, MODULE_KEY_BY_ID, moduleStateOf } from '@/lib/classroom-modules';
import { visibleModules } from '@/lib/classroom-material';
import type { ClassroomModuleKey, ClassroomModuleSetting } from '@/lib/types';
import type { ChatToast, ClassroomInfo, ModuleId, ModuleState, StudentSession } from '../classroom-types';

/** Tab 栏的一项：前端语义名 + 线缆上的 moduleKey + 此刻的三态。 */
export interface ModuleTabEntry {
  id: ModuleId;
  moduleKey: ClassroomModuleKey;
  state: ModuleState;
}

export interface UseModuleTabsOptions {
  classroom: ClassroomInfo | null;
  /**
   * ★ 2026-09-27：当前身份。`visibleModules` 要用它判「**这个学生**有没有材料」——
   * 高级模式下材料是按组分的，同一个课堂里两组学生看到的 Tab 可以不一样。
   */
  selectedStudent: StudentSession | null;
  /**
   * 与首页、学伴面板共用的**同一个** `setToast`（会话级状态由 page.tsx 持有）。
   * 外壳的提示（模块被暂停、点开暂停的 Tab）走这里，渲染则交给当前可见的那一层 ——
   * 见 classroom-shell.tsx 里「只有可见层渲染 Toast」那条规则。
   */
  setToast: Dispatch<SetStateAction<ChatToast | null>>;
  /**
   * ★ 2026-09-25：课堂是否处于**暂停**（`Classroom.status === 'paused'`，教师端「暂停课堂」）。
   *
   * 🔴 暂停 = 三件套**整体**不可用（学习单 / 探究空间 / 智能学伴都进不去），
   * 与「某个模块被教师设成 preview」不是一回事：后者只锁那一件。
   *
   * ⊘ **2026-09-25 二次修订：暂停**不**切走学生**。第一版在这里加过一条
   *   「暂停 ⇒ `setActiveModuleId(null)`」的 effect，教师真机一试就否掉了：
   *   学生被丢回首页、解除后还停在首页，得自己再点回去 —— 而**他刚才就在那儿**。
   *   ⇒ 现在暂停由**覆盖层**表达（`classroom-shell.tsx` 的 `.pauseCover`），
   *   学生的位置**一个字节都不动**，解除时原地继续。
   *   ⚠️ 所以 `paused` 在这里只剩下**一道闸门**的作用：`openModule` 里拦住新进入
   *   （覆盖层挡得住鼠标/手指，挡不住将来的程序化入口 —— 那道闸门本来就是为它们留的）。
   */
  paused: boolean;
}

/**
 * 读某个模块此刻的三态。外壳渲染占位面板时也要用，所以导出而不是塞在 hook 里
 * （两处各写一遍 `moduleStateOf(modules, MODULE_KEY_BY_ID[id])` 就会有两份口径）。
 * 收 `modules` 而不是整个 `classroom`：effect 的依赖要写成 `classroom?.modules`，
 * 传整个对象会让 eslint 认为依赖不全。
 */
export function moduleStateFor(modules: readonly ClassroomModuleSetting[] | undefined, id: ModuleId): ModuleState {
  return moduleStateOf(modules, MODULE_KEY_BY_ID[id]);
}

/**
 * 三件套的挂载管理（§4.5）。三件事，缺一条都会静默毁掉「切换保留内容」：
 *
 *   1. **惰性挂载**：模块第一次被打开才挂载 —— 从没访问过的模块零成本（§4.8 的内存门槛）。
 *   2. **一旦挂载，永不卸载**（直到课堂结束）：`mountedIds` 只增不减。这是「切换保留内容」
 *      的实现方式 —— 不卸载就不存在状态丢失，不需要任何序列化/恢复代码。
 *   3. **被教师关闭 = 隐藏并挂起，而不是销毁**：`tabs` 里不再出现它、`activeModuleId`
 *      被送回首页，但 `mountedIds` 仍留着它。教师误操作后改回 `open`，学生切回去时
 *      之前的内容原样还在（§4.4：零成本恢复）。
 *
 * 「课堂结束」的边界不是这个 hook 管的：课堂结束时 page.tsx 会整页回 `/`，外壳随之卸载，
 * 这些状态一起消失。换身份同理（回到身份页 ⇒ 外壳卸载），所以不存在「上一个学生的模块
 * 还留在 DOM 里」的窗口。
 */
/**
 * 「上次停在哪个模块」的存储键（P2.3）。
 *
 * ⚠️ 存在 **localStorage** 而不是服务端：模块状态本来就是**客户端状态**
 * （`activeModuleId` 从来没有上报过），为了它去动会话与服务端存储，收益不明显。
 * 代价是换设备就没了 —— 学生本来也是「这台 iPad 进这个课堂」，可以接受。
 */
const LAST_MODULE_KEY = 'classnode:last-module';

function readStoredModule(): ModuleId | null {
  try {
    const raw = window.localStorage.getItem(LAST_MODULE_KEY);
    return raw === 'worksheet' || raw === 'explore' || raw === 'companion' ? raw : null;
  } catch {
    // 隐私模式 / 存储被禁用时访问会抛。**静默回首页**是这里正确的降级：
    // 记不住上次的模块不该让学生进不来。
    return null;
  }
}

function writeStoredModule(id: ModuleId | null): void {
  try {
    if (id === null) window.localStorage.removeItem(LAST_MODULE_KEY);
    else window.localStorage.setItem(LAST_MODULE_KEY, id);
  } catch {}
}

/**
 * ★ 2026-09-25：丢掉「上次停在哪个模块」这条存档。
 *
 * 🔴 谁该调它、谁**不该**调它，是这个函数存在的全部理由：
 *   · **该**：学生**选姓名进入**那一下（`use-classroom-session.ts` 的
 *     `handleIdentityConfirm`）。共用 iPad 上，上一个学生留在探究空间 ⇒ 下一个学生
 *     一进来就在探究空间，**而他什么都没点**；教师看板跟着 `module-focus` 走，
 *     于是监测到的也是错的模块。
 *   · **不该**：刷新。刷新走的是 `chat_session_<code>` 那条自动重连
 *     （`identity/use-student-session.ts:70`），**根本不过身份页** ——
 *     所以恢复存档那条路（本文件上面那个 effect）照旧管刷新，见 P2.3。
 *
 * ⚠️ 导出它而不是让调用方自己 `removeItem`：键名必须只有**一个**所有者
 * （用例 `shell/last-module-storage.test.ts` 钉着这一点）——三个字面量各写一份的话，
 * 表现是「清档清了个空气」，而 `removeItem` 传错键名**不会抛**，没有任何东西会红。
 */
export function clearStoredModule(): void {
  writeStoredModule(null);
}

export function useModuleTabs({ classroom, selectedStudent, setToast, paused }: UseModuleTabsOptions) {
  /** 前台是哪个模块；`null` = 首页在前台（首页也是这个外壳的一层）。 */
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  /** 挂载集合，按「第一次进入」的顺序（层是绝对定位的，顺序不影响显示）。 */
  const [mountedIds, setMountedIds] = useState<ModuleId[]>([]);

  /**
   * 刷新后**停在上次的模块**（P2.3）。
   *
   * ⚠️ 恢复必须等 `classroom.modules` 到位才能判「那个模块现在还开着吗」—— 模块状态是
   * 异步来的，早于它恢复会把一切都判成"没开放"而全部丢掉。
   * `restoredRef` 保证**只恢复一次**：否则教师每改一次模块状态，都会把学生从他自己刚切到
   * 的地方**拽回**上次那个模块。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    // ⚠️ `selectedStudent` 也必须是到位的那一份：`visibleModules` 在高级模式下按**组**判，
    // 拿着 null 判会把一切都判成「没有材料」。它和 `classroom` 同一条会话链路来，所以这里
    // 只是把「等到齐」写明确，不是新增一次等待。
    if (!classroom?.modules || !selectedStudent) return;
    restoredRef.current = true;
    const saved = readStoredModule();
    if (!saved) return;
    // ★ 2026-09-27：判据从「那个模块还开着吗」扩成「它**此刻真的看得见**吗」。
    // 🔴 存档是**上一次**留下的：上节课停在探究空间、而这节课老师没配网页 —— 旧判据
    //    （只看三态）会把学生**直接送进一个什么都没有的模块**，而 Tab 栏上还找不到它
    //    （`visibleModules` 已经把它藏了）⇒ 学生被困在一个没有出口的层里。
    const entry = visibleModules(classroom, selectedStudent)
      .find((item) => MODULE_ID_BY_KEY[item.moduleKey] === saved);
    if (!entry || entry.state !== 'open') return;
    setMountedIds((prev) => (prev.indexOf(saved) === -1 ? [...prev, saved] : prev));
    setActiveModuleId(saved);
  }, [classroom, selectedStudent]);

  /**
   * 变化时记住。**首页也记**（即清掉存档）—— 学生主动回首页是一个明确的选择，
   * 刷新后该回首页，而不是被拽回他刚离开的那个模块。
   *
   * ⚠️ **恢复之前不许写**：挂载时 `activeModuleId` 还是 null，先写就把存档覆盖掉了，
   * 恢复再也读不到东西。这条不写清楚，症状是"记忆功能时灵时不灵"。
   */
  useEffect(() => {
    if (!restoredRef.current) return;
    writeStoredModule(activeModuleId);
  }, [activeModuleId]);

  // Tab 栏的内容。★ 2026-09-27：**判据搬进了 `visibleModules`**（`@/lib/classroom-material`），
  // 因为首页那几张卡片写着**同一份拷贝**，而这条判据现在要加第二个条件了
  //（见下）—— 再抄一遍就等于给「顶栏藏了、首页还摆着一张点进去什么都没有的卡」留了地方。
  //
  // 🔴 那一条的是教师 2026-09-27 的原话：「顶部的导航栏，如果三件套中有没有关联的内容，
  //    则相应图标也不要显示出来。」⇒ 除了 `hidden`（§4.4：教师没安排这个环节），
  //    「这节课根本没有对应材料」的模块也不出现。判据全在 `visibleModules` 的注释里，
  //    包括**为什么学伴恒真**、以及**为什么必须按学生自己的组判**（高级模式不许回落课堂级）。
  //    ⚠️ 所以它要 `selectedStudent` —— 同一个课堂里两组学生的 Tab 可以不一样。
  //
  // ⚠️ 顺序仍是**词汇表** `MODULE_KEYS`（§4.11 B6：不按 `classroom.modules` 的数组下标，
  //    `applyModuleState` 在键缺失时会追加元素、下标会漂移 ⇒ 教师改一次态就可能让 Tab 换位）。
  //    这一条也由 `visibleModules` 保证。
  const tabs: ModuleTabEntry[] = visibleModules(classroom, selectedStudent)
    .map((entry) => ({ ...entry, id: MODULE_ID_BY_KEY[entry.moduleKey] }));

  /**
   * 进入一个模块。**唯一的入口闸门在这里**，不在调用点：首页卡片与 Tab 栏都会自己提示一次，
   * 但闸门只有一处，将来多一个入口（教师推送、深链）也绕不过它。
   */
  const openModule = (id: ModuleId) => {
    // 🔴 暂停优先于模块三态：暂停期间**任何**模块都进不去，哪怕它是 `open`。
    // 文案要**温馨**（教师要求）：这是一句安抚，不是一条错误。
    if (paused) {
      setToast({ msg: '课堂正在休息，等老师继续吧', type: 'info' });
      return;
    }
    if (moduleStateFor(classroom?.modules, id) !== 'open') {
      // ★ 2026-09-29（教师）：「暂停状态主要是提醒学生，这个模块**是有的**，但是目前暂时
      // 不能用。提醒的时候**温馨一点**。」⇒ 这句话要同时照顾 `preview` 的两种来意：
      // 课前挂着的「即将开放」，与课中被收起来的「暂停」。所以**不能**写「即将开放」
      //（对一个刚被暂停的模块那是一句假话），也不能写「已关闭」（那听上去像没有了）。
      // 🔴 同一个事实在**三处**（本文件两处 + `student-home.tsx` 两处），改的时候 grep
      // 这句话本身，别只改一个文件。
      setToast({ msg: '这个模块还在的，老师先收起来啦，等一下再来看看～', type: 'info' });
      return;
    }
    setMountedIds((prev) => (prev.indexOf(id) === -1 ? [...prev, id] : prev));
    setActiveModuleId(id);
  };

  const goHome = () => setActiveModuleId(null);

  // §4.11 B4：学生正在用的模块被教师改成非 `open`（`preview` 或 `hidden`）时，必须**能**
  // 把视图强制切走 —— 否则学生会继续待在一个已经关掉的模块里。
  // 「不丢已作答内容」由第 2 条挂载策略保证：视图切走，模块仍挂在 DOM 里（草稿、附件、
  // 滚动位置都在），教师改回来后切进去内容原样。
  //
  // **流式中被隐藏是否停掉生成：决定是「不停」**（Task 5 的显式裁定）。三条理由，都是代码里
  // 能核对的事实，不是口味：
  //   1. 服务端**无法**「暂停」：`stop-generation` 走的是 `activeStreams.get(socket.id).abort()`，
  //      而服务端在 `result.aborted` 分支上是「不保存、不推送任何内容，直接丢弃」
  //      （server/src/socket/index.ts）。也就是说自动停 = **整条回答被丢掉**，学生回来只看到
  //      自己的问题孤零零挂着。这与 §4.4 的「不丢已作答内容」直接冲突。
  //   2. 停与不停都不由学生决定：服务端还要看课堂的 `allowStudentStop`，同一个动作在不同课堂
  //      里行为不同（有的课堂会自动丢弃、有的照常流完），学生会遇到无法解释的不一致。
  //   3. 流本身不需要可见性：socket 归会话层（`use-chat-socket`），所以回答照常送达、照常落库。
  //      「切走看一眼学习单再切回来」是 §4.5 的核心承诺，截断回答恰好背叛它。
  // 代价与边界：被隐藏的模块会继续跑完这一次请求（一个在途请求，受既有 30s 首字节超时约束）；
  // 学生回来后停止按钮照旧可用，教师侧的 `allowStudentStop` 语义一条没变。
  //
  // 依赖只有 `classroom?.modules`：三态的真源。M1b-1 已经把 socket 的 `module-state-changed`
  // 合并进 `classroom.modules`（use-chat-socket.ts 的 `applyModuleState` 那一处），所以这条
  // effect **今天就是活的**，教师改态即刻把学生送回首页 —— Task 6 不需要在这里补实时。
  useEffect(() => {
    if (activeModuleId === null) return;
    if (moduleStateFor(classroom?.modules, activeModuleId) === 'open') return;
    setActiveModuleId(null);
    // ★ 2026-09-29：与上面那条同一个事实（`preview` 的措辞），换成「我们」——
    // 这一句是**已经用着、被收走**的那一刻说的，比点一个锁着的图标更该像在安慰。
    setToast({ msg: '老师先把这个模块收起来了，我们待会儿再来～', type: 'info' });
  }, [activeModuleId, classroom?.modules, setToast]);

  return { activeModuleId, mountedIds, tabs, openModule, goHome };
}
