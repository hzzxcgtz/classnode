# `server/vendor/` —— 供应商化的第三方产物

本目录下的文件**不是我们写的**，也没有经过构建流程处理（`tsc` 只编译 `src/`）。
它们由 `webapp-host.ts` 在运行期直接读出来发给浏览器。

⚠️ **新增任何文件都必须同时改两处**，否则打包版会缺文件：

1. `scripts/package-server.mjs` —— 加一行 `copy('server/vendor', 'vendor')`
   （该脚本只复制 `server/dist` / `prisma/schema.prisma` / `changelogs` / `package.json` / `out`）。
   目前已经有了 `vendor` 那一行；本目录再新增文件时不需要重复加，但**必须确认它在 `copy` 清单里**。
2. `scripts/check-classroom-browser-compat.mjs` 的 `SCAN_ROOTS` —— 把新文件加进 Safari 15 的扫描根。
   **供应商文件是学生端真正会执行的代码，不能因为它「不是我们写的」就跳过兼容闸门。**

---

## `snapdom.js`

| | |
|---|---|
| 包 | **`@zumer/snapdom`** |
| 版本 | **3.0.0** |
| 许可 | MIT（原文见 `snapdom.LICENSE`） |
| 来源 | `https://registry.npmjs.org/@zumer/snapdom/-/zumer-snapdom-3.0.0.tgz` → `package/dist/snapdom.js` |
| sha256 | `ba55f81bc40aec7b624b76f13b484e222b3d364e40033643577c2e0930f62c70` |
| 大小 | 247,291 B 原始 / 82,953 B gzip |
| 形态 | IIFE，挂 `window.snapdom` |

### ⚠️ 装的时候别装错包

npm 上**另有一个**叫 `snapdom` 的包，描述是 "A state management library."（作者 `mcneissue`），
与本站要的东西**毫无关系**。必须用带作用域的 **`@zumer/snapdom`**。

### 用途

学生端探究空间里，教师上传的网页**没有大 `<canvas>`** 时（纯 DOM 网页），
用它把页面按缩略图尺寸光栅化成一张图，供教师看板显示。

这是规格 §5.4 的**第二档**：「优先直读 `<canvas>`（快）；页面无大 canvas 时**按需加载**截图库」。
有大 canvas 的网页走第一档直读，**永远不下载这个文件**。

### 🔴 用的时候必须 `cache: 'disabled'`，这是必选项不是调优项

实测（桌面 Chrome，20 次连拍，逐次记堆，末尾 `HeapProfiler.collectGarbage` 强制 GC）：

| 配置 | 堆走向 | 强制 GC 后 | 每次耗时 |
|---|---|---|---|
| 默认（缓存开） | `15→28→38→45→51` **单调爬升** | **51MB，不下降** | 15~19ms |
| `cache:'disabled'` | `15→45→21→45→21` **锯齿** | **22MB** | 53~68ms |

⇒ 默认缓存**每次截图滞留约 1.8MB 且强制 GC 不回收**（与 320×1378 的 canvas 底存
`320×1378×4 = 1.76MB` 量级吻合）。按 10 秒一截算 ≈ **10MB/分钟单向累积** ——
在老 iPad 上就是「打开一会儿页面被系统杀掉」。

⇒ **这与项目早期误判过的那个「canvas 逐帧新建导致泄漏」是同一个形态。换个默认配置，
它就会从误判变成事实。**

代价是慢 3 倍（55ms vs 16ms），而 `56ms / 10s = 0.55%` 占用，老 iPad 慢 10 倍也是 5.5%，可接受。

### 静态兼容性（按项目自己的规则扫过，不是查文档）

| 闸门 | 结果 |
|---|---|
| `Object.hasOwn` / `structuredClone` / `findLast` / `.at(` / `:has(` / `@container` / `content-visibility` | **7 条全 0 命中** |
| lookbehind `(?<=` / `(?<!`（P0 红线） | **0 命中** |
| 唯一的 `hasOwn` 命中 | `Object.prototype.hasOwnProperty.call(...)` —— Safari 15 安全 |

⚠️ 这是**静态**结论。**真机（老 iPad Safari 15）的实际耗时与内存只能实测**，
桌面 Chrome 的数字只回答「量级对不对」。

### 🔴 真机上出问题时，日志分两处 —— 别找错地方

2026-09-22 排查「老 iPad 有浏览位置、没有图片」时踩过这个：**服务端日志里只有四项**，
而 SDK 自己那些最有价值的报错**只在设备上**。

| 看哪里 | 有什么 |
|---|---|
| **服务端日志**（`server/logs/`） | `webapp-host` 的 `sdk.js` / `shot.js` 请求（**带 UA，用来分辨设备与截图档位**）、`webapp-frame-first`、`webapp-frameless`、`webapp-frame 被拒`（含拒因） |
| **只在学生设备上** | `[SDK] 缩略图光栅化失败：<错误>`、`[SDK] 光栅化超过 …ms 没有结果`、`[SDK] 上报超限被丢弃`、父页面的 `[探究空间] 丢弃一帧：<原因>` |

⇒ 想知道**截图库为什么失败**（而不是「失败了」），必须看设备上的 console：
iPad 用数据线连 Mac，Safari → 开发 → 选中该 iPad → 打开学生页 → Console。
服务端日志**永远**不会有那几条 —— 它们产生在学生的浏览器里。

**判据要成对看**：`webapp-frameless` 单独出现说明不了失败（首帧本身有 0~3 秒的随机抖动，
告警可能早于截图档启动）。**「有 `frameless`、却始终没有 `frame-first`」**才是一帧都没成功过的确证。

### 已知：它是新的、且真机没验过

`toCanvas` 那条路径在两台机器上表现不同（桌面 Chrome 成功、iPad Safari 15.6.8 从未出过一帧），
而本目录的静态检查是干净的 ⇒ **属于行为差异，不是 API 缺口**。`webapp-sdk.ts` 已针对它加了
看门狗与同步 try/catch（防「一次挂死 = 整节课沉默」），但**看门狗不能修「每一轮都失败」**。

## 🔴 本地补丁（**升级时必须重新打**）

本仓库对 `snapdom.js` 打了 **5 处**补丁。它们**不在上游版本里**。

| | |
|---|---|
| 补丁前 sha256 | `ba55f81bc40aec7b624b76f13b484e222b3d364e40033643577c2e0930f62c70`（= 上面的上游值） |
| 补丁后 sha256 | `9527e88f62de227a34e3d83c342006d19b857477a9063681f5be10014bbf29e0` |

### 补的是什么：5 处**裸奔的 `img.decode()`**

snapdom 有 10 处 `decode()`，其中 **5 处没有兜底**。而 `HTMLImageElement.decode()` 在解码失败时 **reject 一个 `EncodingError`**——没有任何 catch 接住它，于是**整条 `toCanvas()` 的 Promise 被拒**，截图一帧都出不来。

**第 5 处最隐蔽**，它的形状与另外四处不同：辅助函数

```js
function Aa(t, e) { ...; t.decode() }          // 裸奔的 decode 写在函数体里
```

而它的**调用方重试一次、再失败就重抛**：

```js
try { await Aa(h, l) }
catch (d) {
  if (!h.__snapdomDecodeFrame) throw d;                     // ← 重抛
  h = Ca(l);
  try { await Aa(h, l) } catch (m) { throw To(h), m }        // ← 重试再失败，又重抛，无人接
}
```

⇒ 只按 `await X.decode()` 这个形状去找会**漏掉它**。补丁必须打进 `Aa` 的函数体里。
（这条是 2026-09-22 真机第二轮才发现的：只补了前 4 处、重测后错误**一模一样**。）

**为什么只有 Safari 中招**：其中一处（`toImg`）是

```js
s.src = o, Y() ? await s.decode() : await new Promise((a, c) => { if (s.complete && s.naturalWidth) return a(); s.onload = a, s.onerror = c })
```

`Y()` 是 snapdom 自己的 **Safari 探测器**。**Safari 走 `decode()` 分支，其它浏览器走 `onload` 分支** —— 所以 Chrome 根本碰不到这个 reject，而 Safari 每次都撞上。

**真机实测**（iPad Air 2 / iPadOS 15.8.8 / Safari 15.6.8，2026-09-22）：诊断通道报出 `code=capture-error n≈200-250 h=30 w=1014` ⇒ 错误名 `EncodingError`、消息 14 字符。桌面 Chrome 同一网页、同一参数**正常出图**。

### 补法

把每一处 `await X.decode()` 换成「decode 失败就退回 `onload` 那条路径」（**不是吞掉**）：

```js
await X.decode().catch(function () {
  return new Promise(function (a, b) {
    if (X.complete) return X.naturalWidth ? a() : b();   // 已经完成：按结果立即兑现
    X.onload = a, X.onerror = b;
  });
})
```

⚠️ `if (X.complete)` 那一条**不是可省的**：图片可能在 decode 之前就已经完成加载。少了它，一个**已经失败的**图片会挂在那里永远不 settle（`onload`/`onerror` 都不会再触发）—— 症状从「报错」变成「看门狗超时」，更难查。

### 升级时必须做的两件事

1. **重新打这 5 处补丁**（`grep -o 'decode().catch(function' server/vendor/snapdom.js | wc -l` 应为 **5**）。
   ⚠️ 用 `grep -o | wc -l` 数**出现次数**，不要用 `grep -c` —— 后者数的是**行数**，而这是个压缩成一行的文件（会把 5 报成 1 或 2）。
2. **更新上面的「补丁后 sha256」**，并更新 `webapp-vendor.test.ts` 里那条断言（它会**红**，这正是它存在的意义 —— 别把红改成绿了事，要真的把补丁重打上）。

### 升级步骤

```bash
cd /tmp && npm pack @zumer/snapdom            # 或指定版本 @zumer/snapdom@3.x.y
tar xzf zumer-snapdom-*.tgz
cp package/dist/snapdom.js  <repo>/server/vendor/snapdom.js
cp package/LICENSE          <repo>/server/vendor/snapdom.LICENSE
shasum -a 256 <repo>/server/vendor/snapdom.js  # 更新上表
```

升级后**必须重跑**：`pnpm build`（兼容闸门）+ `pnpm test`，并重新核对上面的静态兼容性表与
`cache` 那条实测 —— **不要假设新版本的行为与旧版本一致。**
