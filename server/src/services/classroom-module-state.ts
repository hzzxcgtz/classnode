export type ModuleKey = 'learning-sheet' | 'explorer' | 'companion';
export type ModuleState = 'open' | 'preview' | 'hidden';

export const MODULE_KEYS: readonly ModuleKey[] = ['learning-sheet', 'explorer', 'companion'] as const;
export const MODULE_STATES: readonly ModuleState[] = ['open', 'preview', 'hidden'] as const;

/**
 * ★ 2026-09-29（教师）：「这三个模块在**创建后默认是开放**」。
 *
 * 🔴 它与下面的 `DEFAULT_MODULE_STATE` **不是一回事，拆开是这一节的要点**：
 *   · 本常量 = **新建课堂写进库里的初始态** —— 教师这次的要求是「开箱即可用」；
 *   · `DEFAULT_MODULE_STATE` = **读不到行 / 行是脏数据时的兜底** —— 那一侧必须是保守的
 *     （一次读失败不该把模块开给学生）。
 * 两者共用一个常量时，取值只能二选一，于是「新建要宽松」与「兜底要保守」里必有一个是错的。
 */
export const INITIAL_MODULE_STATE: ModuleState = 'open';

/**
 * 新建课堂要写下去的三行（`POST /create` 与 `POST /create-advanced` 共用）。
 *
 * ⚠️ 两条创建路径**都要种**：只种一条的话，另一条建出来的课堂落在
 * `DEFAULT_MODULE_STATE` 上（= 三个模块全「暂停」），而**屏幕上没有任何异常** ——
 * 教师只会觉得「刚建的课堂怎么三个模块都点不进去」。
 */
export function initialModuleRows(): Array<{ moduleKey: ModuleKey; state: ModuleState }> {
  return MODULE_KEYS.map((moduleKey) => ({ moduleKey, state: INITIAL_MODULE_STATE }));
}

/**
 * 老课堂没有 ClassroomModule 行时的兜底态。教学上最保守：可见但锁定。
 *
 * ⚠️ 2026-09-29 之后它**只剩兜底这一个角色**（新建课堂由 `INITIAL_MODULE_STATE` 种下去）。
 * 别把这一行改成 `'open'` 来「顺手统一」：它同时兜着「行缺失」与「行里的值认不出」
 * 两种情况，而后者是一次**读失败**，不该有任何宽松的后果。
 */
export const DEFAULT_MODULE_STATE: ModuleState = 'preview';

export function isValidModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

export function isValidModuleState(value: unknown): value is ModuleState {
  return typeof value === 'string' && (MODULE_STATES as readonly string[]).includes(value);
}

/** 数据库里读出的模块行；state 是 String 列，未经校验前不能当作 ModuleState。 */
export interface ClassroomModuleRecord {
  moduleKey: string;
  state: string;
}

/**
 * 把数据库里可能不完整的模块行补齐成完整的三个模块。
 *
 * 写入端点（PUT /:id/modules/:moduleKey）只为「刚被设置的那个模块」建行，
 * 所以任何课堂都可能只有 0~3 行；本功能上线前创建的老课堂更是一行都没有。
 * 因此必须按 MODULE_KEYS 遍历补齐，直接返回查到的数组会让前端少拿到模块。
 *
 * 学生端 GET /code/:code 与教师端 GET /:id 共用此函数 —— 补齐规则只有这一处，
 * 避免两边各写一遍导致其中一条路径漏掉老课堂兜底。
 */
export function mergeModuleStates(
  records: readonly ClassroomModuleRecord[],
): Array<{ moduleKey: ModuleKey; state: ModuleState }> {
  return MODULE_KEYS.map((moduleKey) => {
    const record = records.find(row => row.moduleKey === moduleKey);
    // 缺失或脏数据（例如手工改库写坏的态）一律退回默认态，前端拿到的永远是三个合法态。
    return {
      moduleKey,
      state: record && isValidModuleState(record.state) ? record.state : DEFAULT_MODULE_STATE,
    };
  });
}
