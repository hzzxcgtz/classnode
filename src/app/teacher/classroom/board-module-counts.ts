// ⚠️ 类型走联名路径（`@/…`）、值走相对路径 + `.ts` —— `import type` 会被类型擦除整段删掉，
// 所以联名路径不影响 `node --test`；而任何**值**的 import 都必须相对且带后缀。
// 与 `worksheet-matrix.ts` 同一条写法。
import type { ModuleId } from '@/lib/classroom-modules';

/**
 * 看板顶部那一行「学习单 N 人 / 探究空间 N 人 / 智能学伴 N 人」的**判据层**
 *（教师 2026-09-29 批注 ③）。
 *
 * 教师原话：「这里显示的人数应该是指**当前正处在这个页面中的在线人数**」。
 * 截图里的症状：全班 40 人、离线 38 人，而「学习单」写着 8 人。
 *
 * 🔴 **存在的理由**：本仓没有 jsdom ⇒ 判据一旦写进 `page.tsx` 的 JSX 就没有任何回归网。
 * 而这条判据错了**不报错**：屏幕上只是一个偏大的数字，教师按它做判断
 *（「还有 8 个人在写学习单，再等一会儿」），而实际只有 2 个人在线。
 *
 * 🔴 **数字与筛选必须同源**（教师选定「一起改」）：点「学习单」筛出来的格子
 * 与那一格的数字走**同一套判据**。分家的表现是「数字写 2 人、点开 8 格」，
 * 而两处都不报错 —— 与本仓 `rowTally` 那条纪律（屏幕必须走用例断言的那个函数）同源。
 *
 * ⚠️ 单位是**参与者**，不是格子：`page.tsx` 逐 `students` 计数，而分组 / 高级模式下
 * 参与者就是组（量词由 `moduleCountUnit` 给）。小组卡那一条（`cardInOnlineModule` 收成员数组）
 * 是**筛选**那一侧的口径 —— 一个组是一个格子，任一成员命中即命中。
 */

/**
 * 参与者此刻待在哪 —— 三个模块之一，或「首页」/「不知道」。
 *
 * ⚠️ 它与 `page.tsx` 的 `TileModule` 是**同一个类型**（那里写的是别名，不是第二份定义）：
 * 两个结构相同但各自声明的联合类型不会互相报错，却会在加第四个模块时**只改一处**。
 */
export type FocusModule = ModuleId | 'home' | 'unknown';

/**
 * 这条状态算不算「在线」。
 *
 * 🔴 `thinking` **算在线** —— 它答的是「这个人在不在」，不是「他有没有在打字」。
 * 学生正在等智能体回话时人不该从模块人数里消失（看板格子也是这么算的：
 * `getDisplayCardStatus` 把两者都当「非离线」）。
 *
 * ⚠️ 认不出的值（`undefined` = 从没收到过；拼错的串）= **不算在线**。
 * 反过来的方向（认不出就算在线）会把**没来上课**的人算进模块人数里。
 */
export function isOnlineStatus(status: string | undefined): boolean {
  return status === 'online' || status === 'thinking';
}

/**
 * 一个参与者**实际**所在的模块（与看板模式无关）。
 *
 * 🔴 `hasOwnProperty` 而不是 `focusMap[studentId] ?? 'unknown'`：后者的查表在类型上
 * 永远「有值」，而原型链上的 `toString` / `constructor` 会被 `in` 或裸查表算成命中 ——
 * 线缆值不设防时那是一次**静默的错配**（那一格显示成一个模块名）。
 * 与 `isModuleId` 里那句 `hasOwnProperty` 同一条理由。
 *
 * ⚠️ 键**不在** = 「从没收到过」（`unknown`），与「收到了 null = 他在首页」是两件不同的事 ——
 * 合并成一件就会把「不知道」说成「在首页」，而那是**编造**出来的一条事实。
 */
export function resolveFocus(
  focusMap: Readonly<Record<string, ModuleId | null>>,
  studentId: string,
): FocusModule {
  if (!Object.prototype.hasOwnProperty.call(focusMap, studentId)) return 'unknown';
  const focus = focusMap[studentId];
  return focus === null ? 'home' : focus;
}

const FOCUS_MODULES: readonly FocusModule[] = ['worksheet', 'explore', 'companion', 'home', 'unknown'];

function emptyDistribution(): Record<FocusModule, number> {
  return { worksheet: 0, explore: 0, companion: 0, home: 0, unknown: 0 };
}

/**
 * 此刻**在线**的参与者各在哪个模块（三件套 + 首页 + 不知道，五个键恒在）。
 *
 * 🔴 只有**在线**（`online` / `thinking`）的人进这个分布。离线的人仍带着「最后停在哪」
 * 的记录，而教师读这一行问的是「现在有几个人在哪儿」—— 离线的人不在任何页面里。
 *
 * ⚠️ 返回的五个数相加 = **此刻在线人数**（不是参与者总数）。这是自洽的：
 * 界面那一行上「在线 + 离线 = 全部」，所以三个模块格相加不该等于「全部」。
 */
export function onlineModuleDistribution(
  studentIds: readonly string[],
  focusMap: Readonly<Record<string, ModuleId | null>>,
  statuses: Readonly<Record<string, string>>,
): Record<FocusModule, number> {
  const counts = emptyDistribution();
  for (const studentId of studentIds) {
    if (!isOnlineStatus(statuses[studentId])) continue;
    const focus = resolveFocus(focusMap, studentId);
    // ⚠️ 不写 `counts[focus] = (counts[focus] ?? 0) + 1`：`resolveFocus` 的返回类型
    // 保证了五个键齐，兜底值只会掩盖「它返回了一个表外的串」这件事。
    counts[focus] += 1;
  }
  return counts;
}

/**
 * 一个格子（学生卡或小组卡）在某个模块筛选下**是否出现**。
 *
 * 🔴 与 `onlineModuleDistribution` 的**同一条口径**：成员里有人**此刻在线**、
 * 且正待在这个模块里。教师选定的就是「数字和筛选一起改」——
 * 只改数字会留下「写 2 人、点开 8 格」，那比原来的错更糟（原来至少两处一致地错）。
 *
 * ⚠️ 收的是**成员 id 数组**而不是 `ClassroomDisplayCard`：小组卡与单人格在这里是
 * 同一个问题（「这一格里有这样的人吗」），而卡片的形状留在 `page.tsx` 那一侧 ——
 * 本文件因此可以零 import 被 `node --test` 跑。
 */
export function cardInOnlineModule(
  memberIds: readonly string[],
  module: FocusModule,
  focusMap: Readonly<Record<string, ModuleId | null>>,
  statuses: Readonly<Record<string, string>>,
): boolean {
  return memberIds.some(
    (memberId) => isOnlineStatus(statuses[memberId]) && resolveFocus(focusMap, memberId) === module,
  );
}

/** `FOCUS_MODULES` 的只读视图（给调用方遍历用；顺序与界面那一行一致）。 */
export { FOCUS_MODULES };
