/**
 * 探究网页 iframe 的 sandbox 集合（规格 §5.1 / Ruling 13）。**照抄，不要增减。**
 *
 * 为什么它住在 `src/lib/` 而不是某个页面里：**学生端面板与教师端预览必须用同一套**。
 * 教师端预览曾经差点裸挂（「是教师自己传的网页」听起来无害）—— 那等于给教师的浏览器
 * 一个任意页面执行面，而这个页面还能读到同源的教师会话。两份常量复制粘贴迟早会漂移，
 * 所以只有这一份。
 *
 * 为什么是这一组：
 *   · `allow-scripts` 与 `allow-same-origin` 同时给，在**同源**时是危险的组合
 *     （iframe 可以自己把 sandbox 属性摘掉）；这里安全的前提是 iframe 来自**独立源**
 *     （另一个端口），它够不到父页面，也够不到教师会话。
 *   · `allow-forms` / `allow-pointer-lock` / `allow-downloads` 是教学网页的常见需要。
 *   · ⚠️ **故意不给** `allow-top-navigation`（网页不能把整个 ClassNode 页面导走，
 *     那会让学生丢掉课堂，也会把教师从管理页导走）与 `allow-modals`（`alert` 会把
 *     老 iPad 卡死）。
 *   · ⚠️ **`allow` 属性不加**：不申请任何权限（摄像头 / 麦克风 / 地理位置），
 *     与主服务 `Permissions-Policy` 的收紧方向一致。
 */
export const WEBAPP_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads';
