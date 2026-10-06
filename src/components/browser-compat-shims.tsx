'use client';

/**
 * 老 iPad 的**兜底**：Safari 15.0–15.3 没有 `structuredClone`（15.4 才有）。
 *
 * 🔴 为什么现在要它：绘图题接上第三方组件之后，`@xyflow/react`（流程图那一档）的 chunk 里
 *    有一处**裸调** —— `Handle` 的「点击连线」那条路写着 `y = structuredClone(f)`
 *    （产物里能 grep 到，见 `out/_next/static/chunks/c958ce59*.js`）。目标设备正好是
 *    「学校手里的老 iPad，Safari 卡在 15」⇒ 15.0–15.3 上学生一点连接点就
 *    `ReferenceError`（拖拽连线不走那一支，所以只在点击时现形）。
 * ⚠️ 它**不是**只为了这一处：这一族 API 从依赖里进来的路我们控制不了，
 *    所以闸门的**产物级**扫描（`scripts/check-classroom-browser-compat.mjs` 的 Part A2）
 *    认这份兜底 —— 有它，产物里出现 `structuredClone` 只提示不失败；**删了它，那些裸用立刻让构建变红**。
 *
 * ⚠️ 这份兜底**只对纯数据成立**：真正的结构化克隆能带 `Date`/`Map`/`Set`/循环引用，
 *    这里退到 JSON 深拷贝 —— 够用，因为库拿它克隆的是自己的连接状态对象（纯数据）。
 *    **别**把它当通用实现去克隆别的东西；真需要时请在那个调用点上做特性检测。
 * ⚠️ 装在最外层（根布局，与 `OverscrollGuard` 同一个位置）是有意的：所有绘图画板都是
 *    `next/dynamic` 懒加载的，谁先加载不确定，**兜底必须先于它们**跑完。
 */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = function structuredClone<T>(value: T): T {
    // 与真实现一致的两处边界：`undefined` 原样返回；函数克隆不了（真实现抛 DataCloneError，
    // 这里只能返回一个 JSON 能表达的等价物 —— 明确记在注释里，别让人以为它语义完整）。
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
  };
}

/** 什么都不渲染：它存在的意义是上面那段副作用（与 `OverscrollGuard` 同一种安装器）。 */
export function BrowserCompatShims() {
  return null;
}
