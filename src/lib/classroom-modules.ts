import type { ClassroomModuleKey, ClassroomModuleSetting, ClassroomModuleState } from './types';

/**
 * 课堂模块三态在前端的运行时词汇表 —— 取值域与顺序对齐后端
 * server/src/services/classroom-module-state.ts 的 MODULE_KEYS / MODULE_STATES /
 * DEFAULT_MODULE_STATE。类型在 src/lib/types.ts，两份都必须一起改。
 *
 * 存在的理由：教师端（改态与回显）与学生端（socket 回显）都要把「一个模块的新态」
 * 合并进三元素数组，逻辑只有这一份；各写一遍必然出现其中一处漏掉兜底。
 */

/** 展示顺序，与后端 MODULE_KEYS 一致。 */
export const MODULE_KEYS: readonly ClassroomModuleKey[] = ['learning-sheet', 'explorer', 'companion'];

/** 三态的展示顺序，与后端 MODULE_STATES 一致。 */
export const MODULE_STATES: readonly ClassroomModuleState[] = ['open', 'preview', 'hidden'];

/** 老课堂没有模块行时的兜底态，与后端 DEFAULT_MODULE_STATE 一致。 */
export const DEFAULT_MODULE_STATE: ClassroomModuleState = 'preview';

/** 三态取值来自 socket 事件，未经校验前是 string —— 不信任线缆上的值。 */
export function isClassroomModuleKey(value: unknown): value is ClassroomModuleKey {
  return typeof value === 'string' && (MODULE_KEYS as readonly string[]).includes(value);
}

export function isClassroomModuleState(value: unknown): value is ClassroomModuleState {
  return typeof value === 'string' && (MODULE_STATES as readonly string[]).includes(value);
}

/**
 * 读某个模块的当前态。参数收 undefined：类型上 modules 恒存在，但服务端版本不匹配时
 * 可能真的没有这个字段，读路径不能因此崩掉。
 */
export function moduleStateOf(
  modules: readonly ClassroomModuleSetting[] | undefined,
  moduleKey: ClassroomModuleKey,
): ClassroomModuleState {
  const found = modules?.find((item) => item.moduleKey === moduleKey);
  return found ? found.state : DEFAULT_MODULE_STATE;
}

/**
 * 把一个模块的新态合并进数组，其余模块保持不动（乐观更新与 socket 回显共用）。
 * 命中即替换；数组里没有这个 key 时追加，避免旧数据下改态后 UI 毫无反应。
 */
export function applyModuleState(
  modules: readonly ClassroomModuleSetting[] | undefined,
  moduleKey: ClassroomModuleKey,
  state: ClassroomModuleState,
): ClassroomModuleSetting[] {
  const next = (modules ?? []).map((item) => (item.moduleKey === moduleKey ? { ...item, state } : item));
  return next.some((item) => item.moduleKey === moduleKey) ? next : [...next, { moduleKey, state }];
}
