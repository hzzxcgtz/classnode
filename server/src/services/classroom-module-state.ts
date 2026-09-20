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
