import type { ClassroomModuleKey, ClassroomModuleSetting, ClassroomModuleState } from './types';

/**
 * 课堂模块三态在前端的运行时词汇表 —— 取值域与顺序对齐后端
 * server/src/services/classroom-module-state.ts 的 MODULE_KEYS / MODULE_STATES /
 * DEFAULT_MODULE_STATE。类型在 src/lib/types.ts，两份都必须一起改。
 *
 * 存在的理由：教师端（改态与回显）与学生端（socket 回显）都要把「一个模块的新态」
 * 合并进三元素数组，逻辑只有这一份；各写一遍必然出现其中一处漏掉兜底。
 */

/**
 * 学生端外壳用的模块语义名。**只在前端存在** —— 后端（含 lib/types 的
 * ClassroomModuleKey）一律用 'learning-sheet' / 'explorer' / 'companion'。
 *
 * 之所以不复用后端那套名字：学生端 UI 的文案是「学习单 / 探究空间 / 学伴」，
 * 组件与 Tab 栏按语义名分支比按 'learning-sheet' 分支好读；代价就是下面那两张表。
 */
export type ModuleId = 'worksheet' | 'explore' | 'companion';

/**
 * 外壳语义下的三态名。取值与后端是同一组，所以**直接别名**而不是再写一份
 * 联合类型字面量 —— 写第二份就是给自己留一个会漂移的副本。
 */
export type ModuleState = ClassroomModuleState;

/**
 * 编译期断言：`T` 必须是 `true`，否则**本行**编译失败。
 *
 * 为什么必须有这一层：`type X = <条件> ? true : false` 这种别名**永远不会报错** ——
 * 条件为假时它只是求值成 `false`，别名本身依旧合法。断言要有牙齿，就得让结果落进
 * 「必须满足 `T extends true`」的位置。
 */
type AssertTrue<T extends true> = T;

/** 「`Listed` 是否覆盖 `All` 全集」：漏一个成员即求值为 `false`。 */
type CoversAll<All extends string, Listed extends string> = Exclude<All, Listed> extends never ? true : false;

/**
 * 展示顺序，与后端 MODULE_KEYS 一致。
 *
 * `as const satisfies readonly ClassroomModuleKey[]` 而不是 `: readonly ClassroomModuleKey[]`：
 * 后者会把类型**宽化成数组**，元组里的字面量全丢，下面那条全集断言就无从下手（`[number]`
 * 会退化成整个联合类型，断言恒真）。
 *
 * ⚠️ 但**只做这一步挡不住删项** —— 删掉一项后剩下的元组仍然满足 `readonly ClassroomModuleKey[]`，
 * 编译照过（本任务实测）。真正拦得住的是下面每条常量后面那条 `CoversAll` 断言，两者缺一不可：
 * `as const` 保住字面量，`CoversAll` 用它去比全集。
 */
export const MODULE_KEYS = ['learning-sheet', 'explorer', 'companion'] as const satisfies readonly ClassroomModuleKey[];

/**
 * `MODULE_KEYS` 覆盖 `ClassroomModuleKey` 全集的编译期门。
 *
 * 为什么值得专门设一道门：学生端首页（`classroom/home/`）与教师端的模块菜单都**遍历
 * `MODULE_KEYS` 生成卡片**，而不是按 `classroom.modules` 的数组下标（§4.11 B6：数组下标
 * 会漂移）。收益是顺序稳定、卡片不会凭空消失；代价是**从这里删掉一项 = 学生端少一张
 * 卡片，且没有任何运行时错误**。所以「不许静默少一张卡片」只能由编译器把守。
 *
 * 导出是**必需的**，不是 API：不导出的话 `@typescript-eslint/no-unused-vars` 会把只用于
 * 编译期的别名判成未使用变量，门禁就多一条警告。
 */
export type _ModuleKeysCoverAll = AssertTrue<CoversAll<ClassroomModuleKey, (typeof MODULE_KEYS)[number]>>;

/** 三态的展示顺序，与后端 MODULE_STATES 一致。理由同 `MODULE_KEYS`。 */
export const MODULE_STATES = ['open', 'preview', 'hidden'] as const satisfies readonly ClassroomModuleState[];

/** `MODULE_STATES` 覆盖 `ClassroomModuleState` 全集的编译期门（教师端菜单遍历它渲染三个选项）。 */
export type _ModuleStatesCoverAll = AssertTrue<CoversAll<ClassroomModuleState, (typeof MODULE_STATES)[number]>>;

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

/* ————————————————— ModuleId ⇄ ClassroomModuleKey 的双向映射 ————————————————— */

/**
 * ModuleId → 后端 moduleKey。
 *
 * `satisfies Record<ModuleId, ClassroomModuleKey>` 不是装饰：它让「漏写一个模块」与
 * 「多写一个不存在的模块」都变成**编译错误**。漏写一个的后果是那个模块永远读不到教师
 * 设定的态（`moduleStateOf` 找不到 key，静默退回默认态），线上不报错、只表现为「教师
 * 开放了学生却进不去」——所以这道门必须由编译器把守，不能靠人眼核对。
 */
export const MODULE_KEY_BY_ID = {
  worksheet: 'learning-sheet',
  explore: 'explorer',
  companion: 'companion',
} as const satisfies Record<ModuleId, ClassroomModuleKey>;

/**
 * `ModuleId` 的类型守卫（P2.3：教师看板「跟随」模式要读 `student-module-focus` 的
 * 线缆值 `moduleId: string | null`）。
 *
 * 为什么要有它：`Record<string, ModuleId | null>` 的查表在类型上永远「有值」，
 * 线缆上真来了一个拼错的 key（'explore ' / 'explorer' / ''），不挡的话会被原样存进状态、
 * 再原样拿去渲染分支 —— 结果是那一格空白且不报错。
 *
 * 用 `hasOwnProperty` 而不是 `value in MODULE_KEY_BY_ID`：`in` 会把原型链上的
 * `toString` / `constructor` 也算命中（线缆值不设防时那是一条静默的错配）。
 */
export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MODULE_KEY_BY_ID, value);
}

/**
 * 由正向表推出反向表的类型：每个 moduleKey 只允许对应「唯一那个映射到它的」ModuleId。
 *
 * 外层刻意映射 `ClassroomModuleKey` 全集而不是 `T[keyof T]`（即正向表的值集合）：
 * 若正向表有两个 ModuleId 撞到同一个 key，撞掉的那个 key 就不在 `T[keyof T]` 里了，
 * 映射出来的类型会**少一个键**，配上 Record 只会补一个「什么值都行」的占位 ——
 * 错配就从这道门底下溜过去。映射全集之后，撞掉的 key 其允许值是 `never`，
 * 反向表写任何值都不满足，错配立刻现形。
 */
type InverseOf<T extends Record<ModuleId, ClassroomModuleKey>> = {
  [K in ClassroomModuleKey]: { [I in ModuleId]: T[I] extends K ? I : never }[ModuleId];
};

/**
 * 反向：后端 moduleKey → ModuleId。
 *
 * 两个方向都必须是全的，缺哪一边都是同一种静默失败，所以同样是 `Record` 约束；
 * 但 `Record` 只保证「键齐、值的类型对」，**查不出错配**（例如正向表把 worksheet
 * 写成 'explorer' —— 两张表各自都还是完整的，可「学习单」会一直读到「探究空间」的
 * 态，依旧不报错）。所以再并上 `InverseOf<typeof MODULE_KEY_BY_ID>`：反向表必须是
 * 正向表的逆，错配即编译失败。`Record` 那半保留着，作为 `InverseOf` 万一被削弱时的
 * 兜底。
 */
export const MODULE_ID_BY_KEY = {
  'learning-sheet': 'worksheet',
  explorer: 'explore',
  companion: 'companion',
} as const satisfies Record<ClassroomModuleKey, ModuleId> & InverseOf<typeof MODULE_KEY_BY_ID>;
