/**
 * 排序 / 连线 / 归类三个题型共用的**点选态**与**落位操作** —— 纯逻辑，没有 React、没有 DOM。
 *
 * 🔴 这个文件存在的理由只有一个，但它很硬：**本批唯一能被自动化钉住的那一半。**
 * 拖拽的 pointer 那一半（`use-pointer-drag.ts`）在这台机器上没有任何办法验证
 * —— 本仓没有 jsdom、没有 testing-library，触摸与滚动冲突只能真机验（F1 清单）。
 * 所以「同一个右项只能被一个左项占用」「第一项上移是空操作」这类判据全部下沉到这里，
 * 由 `node --test` 逐条钉住（`worksheet-drag.test.ts`），组件只负责把事件接上来。
 *
 * ── 裁定（规格 §12 的 M4a 裁定 1）─────────────────────────────────────────
 * **点选为主 + 真拖拽增强**：排序 / 连线 / 归类共用一套「选中态」（点条目 → 点目标，
 * 零滚动冲突），真拖拽（pointer 跟手）**叠在它上面**。所以三个题型的交互都可以用
 * 「先点源、再点目标」走完 —— 拖拽挂了（老 Safari、滚动被系统抢走、手势被中断），
 * 学生仍然做得完这道题。组件里拖拽那一层出任何问题都**不能让点选失效**。
 *
 * ⚠️ 本文件在 `scripts/check-classroom-browser-compat.mjs` 的扫描根（`src/lib`）内：
 * 不得出现 `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` /
 * `@container` / `content-visibility` / `color-mix(`（学生端跑在 Safari 15 的老 iPad 上）。
 *
 * ⚠️ **所有函数都不改入参**，一律返回新数组 / 新对象。界面把它们的结果直接交给
 * `setState`，就地改会让 React 拿同一个身份，屏幕不重画 —— 而那正是「拖了但没动」
 * 这个症状里最难查的一种（数据其实变了）。
 *
 * ⚠️ 「什么都没变」时**返回原数组本身**（不是一份拷贝）：`setState` 拿到同一个身份会
 * 跳过这次重渲染，那是我们要的（第一项上移 → 屏幕上本来就不该有任何变化）。
 */

/** 点选态：什么都没选，或选中了某一个条目（`id` 由各题型自己解释）。 */
export type DragSelection = { kind: 'none' } | { kind: 'item'; id: string };

/** 一条连线（学生侧的键名是 `links`；教师那侧的正确答案叫 `pairs`，刻意不同名）。 */
export interface DragLink {
  leftId: string;
  rightId: string;
}

/** 没选中任何条目。⚠️ 是函数而不是常量：常量会被调用方无意间共享出去。 */
export function clearSelection(): DragSelection {
  return { kind: 'none' };
}

/**
 * 点了一下某个**源**条目（排序的条目 / 连线的左项 / 归类池里的条目）。
 *
 * 三条都是产品裁定，每一条都会被一条用例钉住：
 *   · 点同一个 ⇒ **取消**（学生点错了要有退路，且这是唯一的退路）；
 *   · 点另一个 ⇒ **改选**（不是「两个都选」—— 落位只能落一个）；
 *   · **不落位**。落位是「点目标」那一下的事，落在组件里（它才知道目标是哪个）。
 *
 * ⚠️ 落位之后组件必须调 `clearSelection()`，**不能**靠再点一次源来清 ——
 * 落位那一下点的**不是**源，`tapSource` 永远走不到。
 */
export function tapSource(selection: DragSelection, id: string): DragSelection {
  if (selection.kind === 'item' && selection.id === id) return clearSelection();
  return { kind: 'item', id };
}

/**
 * 把 `from` 位置的元素搬到 `to` 位置（**下标语义**，与「上移一位」分开写）。
 *
 * 越界（`from` / `to` 不在 0..length-1）⇒ 返回**原数组**，不抛：调用方是从 DOM 事件里
 * 算下标的，一次手指乱动就能算出越界值，而抛出去的代价是整个面板白屏。
 */
export function reorder(order: string[], from: number, to: number): string[] {
  if (!Array.isArray(order)) return order;
  if (from === to) return order;
  if (from < 0 || from >= order.length) return order;
  if (to < 0 || to >= order.length) return order;
  const next = order.slice();
  const moved = next.splice(from, 1)[0];
  next.splice(to, 0, moved);
  return next;
}

/**
 * 把某个条目上移 / 下移**一位**（排序题的 ▲▼ 按钮）。
 *
 * ⚠️ 边界与未知 id 都是**返回原数组**（不是抛、也不是「回到另一端」）：
 * 第一项上移是空操作 —— 回到末尾才是那个「按了反而跳到最后」的经典缺陷，
 * 而它看起来像功能，不像故障。
 */
export function moveInOrder(order: string[], id: string, delta: -1 | 1): string[] {
  if (!Array.isArray(order)) return order;
  const index = order.indexOf(id);
  if (index < 0) return order;
  return reorder(order, index, index + delta);
}

/**
 * 排序题：拖动时**手指底下是第几个槽位**。
 *
 * ★ 2026-09-26（教师第 3 条「排序题的拖动动画也要优化」）。`centers` 是每一项**中线**
 * 的客户端 y 坐标 —— 拖动开始时量一次（`order-body.tsx`），之后每帧只做这一下比较。
 *
 * 🔴 **为什么不问 DOM**（`elementFromPoint` / 再量一次 `getBoundingClientRect`）：
 * 其余项这时候**正在让位**（它们的 `transform` 每帧在变），而 transform 会一并改变
 * 命中测试的位置 ⇒ 「谁在手指底下」与「谁该让位」互为因果，会**来回抖**。
 * 拿一开始那份**静止**布局做判据，这条回路就断了。
 *
 * ⚠️ 等距时取**更靠前**的那一个（严格小于才换）：手指停在两格正中间时不许来回跳。
 * ⚠️ 空表 ⇒ `-1`（「一个槽位都没有」），调用方按「没有落点」处置。
 */
export function slotIndexAt(centers: number[], y: number): number {
  if (!Array.isArray(centers) || centers.length === 0) return -1;
  let best = 0;
  let bestDistance = Math.abs(y - centers[0]);
  for (let i = 1; i < centers.length; i += 1) {
    const distance = Math.abs(y - centers[i]);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 排序题：拖动中的**让位** —— 返回每一项应当平移多少像素（下标与 `centers` 对齐）。
 *
 * `from` 是拖起来那一项的位置，`to` 是它此刻要落到的槽位。规则是**轮转一格**：
 * 夹在中间的每一项各往 `from` 原来的方向挪**一格**。
 *
 * 🔴 **一格是多少，由 `centers` 决定**（`centers[index + shift] - centers[index]`），
 * 不是「一个固定高度」—— 排序题的条目会折行，长句子那一格就是更高。
 * 写成固定高度会让长条目那一带的让位**差半个条目**，而它看起来只是「有点飘」。
 *
 * ⚠️ 被拖的那一项返回 `0`：它的位置由**跟手**那一份 `transform` 负责，不是让位。
 * ⚠️ 越界 / 空表一律返回**全 0 的数组**（长度对齐 `centers`），不抛 ——
 * 下标是从 DOM 事件里算出来的，一次手指乱动就能算出越界值。
 */
export function dragShifts(centers: number[], from: number, to: number): number[] {
  if (!Array.isArray(centers)) return [];
  const still = centers.map(() => 0);
  if (from < 0 || from >= centers.length) return still;
  if (to < 0 || to >= centers.length) return still;
  if (from === to) return still;
  return centers.map((center, index) => {
    if (index === from) return 0;
    const shift = from < to
      ? (index > from && index <= to ? -1 : 0)
      : (index >= to && index < from ? 1 : 0);
    if (shift === 0) return 0;
    const target = centers[index + shift];
    // 理论上到不了（`to` 已在界内），但 `centers` 是从 DOM 量回来的 ——
    // 量少了一个就宁可不动，也不抛（抛出去是整个作答面板白屏）。
    if (typeof target !== 'number') return 0;
    return target - center;
  });
}

/**
 * 连线：把左项 `leftId` 连到右项 `rightId`。
 *
 * 🔴 **两条不变量，方向都是「顶掉」而不是「并存」**：
 *   · 一个左项**只能有一条**线 —— 两条会让判分器读到一份自相矛盾的作答；
 *   · **一个右项也只能被一个左项占用** —— 少了后半条，`[{l1,r1},{l2,r1}]` 会存下来，
 *     而服务端 `judgeMatch` 对「同一端点被用到两次」的处置是**用到它的那些线一条都不算对**：
 *     学生看着自己连上了，拿到的却是 0 分（§14.4 那一类「教师/学生都查不出来」）。
 *
 * ⚠️ 顶掉旧的那条（而不是拒绝新的那一条）：学生的意图是「改连到这个」，拒绝会表现为
 * 「点了没反应」。
 *
 * 🔴 **形参叫 `links` 不叫 `pairs`**：本文件正是执行「学生侧改名」那条裁定的地方，
 * 而 `pairs` / `placement` 是**教师侧答案键**的名字（在服务端的 `ANSWER_KEYS` 里、
 * 必须被 `stripAnswers` 剥掉）。在本文件里留着教师侧的名字，将来会有人顺手写成
 * `{ pairs }` 简写 —— 而本仓「响应里不得出现答案键」那条红线是**原文扫描**的，
 * 它不会区分「学生的作答」与「教师的答案」。两个名字只差一个词，代价却是一次静默的泄漏。
 */
export function setPair(links: DragLink[], leftId: string, rightId: string): DragLink[] {
  if (!Array.isArray(links)) return links;
  if (!leftId || !rightId) return links;
  const kept = links.filter((link) => link.leftId !== leftId && link.rightId !== rightId);
  return [...kept, { leftId, rightId }];
}

/** 连线：拆掉左项 `leftId` 的那条线（它本来就没连 ⇒ 返回原数组）。 */
export function clearPair(links: DragLink[], leftId: string): DragLink[] {
  if (!Array.isArray(links)) return links;
  if (!links.some((link) => link.leftId === leftId)) return links;
  return links.filter((link) => link.leftId !== leftId);
}

/**
 * 连线：点了一下**右项**（落点），返回新的 `links`。
 *
 * ★ 2026-09-26（教师第 2 条「连线题的线**在提交上要可以删除**」）。
 *
 * ── 为什么这一条要单独成一个函数 ────────────────────────────────────────────
 * 「点右项」这一下的含义**取决于选没选左项**，而这是三条产品规则的交叉口：
 *
 *   · **没选左项**（`leftId === null`）：这是一个**纯粹的删除手势** ——
 *     点已连的右项 ⇒ 断开它；点没连的 ⇒ 什么都不做（左项才是「源」，
 *     ⚠️ 且必须**返回原数组本身**，否则会白写一条上传队列）。
 *   · **选着左项**：这是**落位**手势 —— 连的正是这一对 ⇒ 拆掉（学生的退路）；
 *     否则连上（`setPair`，右项被占时**顶掉**旧的，不是并存）。
 *
 * 🔴 没选左项那一条是**加法**：那条路径在 2026-09-26 之前是**死路**（`onTap` 直接
 * `return`），所以它不可能碰到任何既有流程；而它正是教师说的「很不起眼」的解药 ——
 * 在此之前要删一条线得「先点左项 → 再点右项」**两步**，而屏幕上没有任何东西
 * 告诉学生第一步该点哪儿。现在一步，且右项上有一个看得见的叉（见 `match-body.tsx`）。
 *
 * ⚠️ 本函数**只算新的 `links`**，不碰点选态：清不清空选择由组件决定
 *（它才知道那一下点的到底是源还是落点）。
 */
export function tapTarget(links: DragLink[], leftId: string | null, rightId: string): DragLink[] {
  if (!Array.isArray(links)) return links;
  if (!rightId) return links;
  if (!leftId) {
    const owner = links.filter((link) => link.rightId === rightId)[0];
    return owner ? clearPair(links, owner.leftId) : links;
  }
  const already = links.some((link) => link.leftId === leftId && link.rightId === rightId);
  return already ? clearPair(links, leftId) : setPair(links, leftId, rightId);
}

/**
 * 归类：把条目 `itemId` 放进框 `zoneId`。
 *
 * ⚠️ 一个条目**只能在一个框里**（判分器按 `assignment[id]` 取值），所以这是覆盖而不是追加 ——
 * 追加会让一个条目同时落在两个框里，而判分只认其中一个、界面却画两个。
 * 与 `setPair` 不同，这里**没有**「一个框只能放一个条目」的限制：框是能装很多个的。
 *
 * 🔴 形参叫 `assignment` 不叫 `placement` —— 与 `setPair` 上面那段同一个理由。
 */
export function setPlacement(
  assignment: Record<string, string>,
  itemId: string,
  zoneId: string,
): Record<string, string> {
  if (!assignment || typeof assignment !== 'object') return assignment;
  if (!itemId || !zoneId) return assignment;
  return { ...assignment, [itemId]: zoneId };
}

/** 归类：把条目 `itemId` 取回条目池（它本来就不在任何框里 ⇒ 返回原对象）。 */
export function unplace(assignment: Record<string, string>, itemId: string): Record<string, string> {
  if (!assignment || typeof assignment !== 'object') return assignment;
  if (!Object.prototype.hasOwnProperty.call(assignment, itemId)) return assignment;
  const next: Record<string, string> = {};
  Object.keys(assignment).forEach((key) => {
    if (key !== itemId) next[key] = assignment[key];
  });
  return next;
}
