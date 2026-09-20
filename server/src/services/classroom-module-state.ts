export type ModuleKey = 'learning-sheet' | 'explorer' | 'companion';
export type ModuleState = 'open' | 'preview' | 'hidden';

export const MODULE_KEYS: readonly ModuleKey[] = ['learning-sheet', 'explorer', 'companion'] as const;
export const MODULE_STATES: readonly ModuleState[] = ['open', 'preview', 'hidden'] as const;

/** 老课堂没有 ClassroomModule 行时的兜底态。教学上最保守：可见但锁定。 */
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
