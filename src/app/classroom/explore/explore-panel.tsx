'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClassroomWebappSummary } from '@/lib/types';
import type { WebappDemand, WebappEvent } from '@/lib/socket-events';
import { effectiveGroupWebapp } from '@/lib/classroom-material';
import { WEBAPP_IFRAME_SANDBOX } from '@/lib/webapp-sandbox';
import { MODULE_META } from '../module-meta';
import type { ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { useExploreBridge, type CaptureLevel, type WebappDiag } from './use-explore-bridge';
import styles from './explore.module.css';

/**
 * iframe 的 sandbox 集合。**定义已移到 `@/lib/webapp-sandbox.ts`** —— 教师端的在线预览
 * 必须与学生端用**同一份**，两份复制粘贴迟早漂移。语义与取舍（为什么是这一组、
 * 为什么故意不给 `allow-top-navigation` / `allow-modals`）都在那个文件里。
 */
const SANDBOX = WEBAPP_IFRAME_SANDBOX;

/**
 * 白屏兜底（规格 §12：iframe 失败 → 友好提示 + 重试，不让白屏把学生卡住）。
 *
 * 判据是**握手**而不是 iframe 的 `load` / `error` 事件。实测（见下面 iframe 那段注释）：
 * 404 与「端口不通」两种失败下 `load` **照样触发**、`error` **一次都不触发** —— 也就是说
 * 这两个事件都区分不了「加载完了」与「这个网页真的能用」。跨源 iframe 里父页面读不到 DOM，
 * 唯一能远程确认「托管服务真的把这个网页送出来了、SDK 真的跑起来了」的信号就是那一次 `ready`。
 *
 * ⚠️ 边界（说窄）：它判的是「网页没能带着 SDK 起来」。**一个能正常加载、只是内容空白的
 * 网页会正常握手，因此不会走到这里** —— 这条超时不是「页面看起来是空的」的检测器。
 */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * 文字档事件攒多久发一次。
 *
 * ⚠️ **必须有这一层。** 学生在网页上一下滚好几下是**突发**：SDK 一条事件发一条
 * postMessage，逐条 socket 上行会碎成一地小包，而「滚到第几档」这件事本来就允许
 * 几百毫秒的延迟。400ms 是旧实现留下的那个数，它同时压住了突发与延迟。
 */
const EVENT_BATCH_MS = 400;

/**
 * 单条 `webapp-event` 里最多几条事件 —— **等于服务端的 `MAX_WEBAPP_EVENTS_PER_MESSAGE`**
 * （`server/src/socket/index.ts`，50）。不是拍脑袋的上限：超了服务端**整条丢弃**，
 * 所以攒批必须在到达这个数时就立刻发出去，而不是等定时器。
 */
const MAX_EVENTS_PER_MESSAGE = 50;

/**
 * 拼接网页地址。
 *
 * 形状由 T1/T3 定死：`http://${location.hostname}:${webappPort}/webapps/${id}/${entryPath}`。
 * 用的是**端口**而不是服务端拼好的 URL —— 学生本来就知道自己是从哪个 IP / 域名进来的，
 * 所以自己拼出来的源永远和他此刻用的入口一致（服务端挑的绑定 IP 不一定就是它）。
 * 协议写 `http://` 不是偷懒：主服务与托管服务都是 `http.createServer`（`server/src/index.ts`
 * 里没有 TLS 分支，`/api/server-info` 自己也是这么拼 `webappOrigin` 的）。
 *
 * `entryPath` 按段编码：它是教师上传时的文件名，可能带空格、`#`、中文。
 * `#` 尤其致命 —— 不编码的话浏览器会把它当成片段，请求的是另一个文件。
 * 服务端那侧（`webapp-host.ts`）对路径做 `decodeURIComponent` 之后再解析，正好对上。
 */
function buildWebappSrc(webapp: ClassroomWebappSummary, port: number): string {
  const segments = webapp.entryPath.split('/').map((segment) => encodeURIComponent(segment));
  return `http://${window.location.hostname}:${port}/webapps/${encodeURIComponent(webapp.id)}/${segments.join('/')}`;
}

/**
 * 探究助手面板的 props。
 *
 * `extends ModulePanelProps` 是刻意的（Ruling 10 之外的新增部分走这条路，与占位面板同款）：
 * 契约（§4.3）要求每个模块都接住 `active` / `state` / `classroom` / `session` / Toast 两项，
 * 而本面板这几项的名字与契约完全一致，用 `extends` 就能让「契约加一项时这里编译失败」，
 * 而不是悄悄少接一个 prop。
 *
 * `wsRef` 与 `watching` 是**本面板自己的** props，不进契约（契约是共同的下限，不是完整清单）：
 *   · `wsRef`：缩略图帧经**已有的那条** socket 上报。⚠️ **绝不新建第二条连接** ——
 *     那会给学生端多一条常驻连接（违背 §4.8 的内存门槛），服务端还要处理重复连接。
 *   · `watching`：本课堂此刻有没有教师在看探究助手视图。**由会话层持有、外壳传下来**，
 *     面板自己不订阅 —— 初值只在 `join-classroom` 成功后下发一次，而本面板是惰性挂载的，
 *     自己订阅必然漏掉那一次（详见 `classroom-types.ts` 里那个字段的注释）。
 */
export interface ExplorePanelProps extends ModulePanelProps {
  wsRef: { current: Socket | null };
  /**
   * 服务端**逐学生**下发的推流档位（`{ watching, detail }`）。
   *
   * `watching` 有教师在看本课堂的探究助手视图；`detail` 表示教师**点开了这个学生**的
   * 详情。两者都不成立时学生端在**源头**就不截图（Ruling 9）—— 注意这里管的是
   * 「画不画」，与父页面那条管「发不发」的闸门是两道独立的闸。
   */
  demand: WebappDemand;
}

/**
 * 学生端的探究助手面板：一个跨源 iframe（托管服务）+ postMessage 桥 +
 * 上行两条链路（缩略图帧、文字档事件）。
 * （点击 / 输入 / 页面内跳转**不采集、不上报** —— 详见 `use-explore-bridge.ts` 的文件头。）
 *
 * 三条不变量，都在下面的代码里各有对应的一处：
 *   1. **一旦挂载永不卸载**（§4.5）：切走只是挂起（`active` 变假 ⇒ 发 `pause`），
 *      iframe 留在 DOM 里 ⇒ 滚动位置、输入框草稿、网页自身的状态原样保留。
 *      这也是为什么「加载失败」的提示卡是**盖上去**的，而不是把 iframe 换成卡片 ——
 *      卸载即丢状态，一次网络抖动不该让学生丢掉整段作答。
 *   2. **没人看时不推**（Ruling 9）：教师没打开探究助手视图时，服务端会下发
 *      `webapp-monitor-demand { watching:false }`，学生端在**源头**就不发 ——
 *      这与服务端「不转发」是两道独立的闸，学生端这道决定的是「根本不产生流量」。
 *   3. **提交顺序**：`armed` 为真（= postMessage 监听已挂好）之前不创建 iframe，
 *      见 `use-explore-bridge.ts` 的预审 6a 注释。
 */
export function ExplorePanel({ active, classroom, session, toast, setToast, wsRef, demand }: ExplorePanelProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** 第几次加载。重试按钮 +1 ⇒ iframe 换 key 重挂（监听不受影响，它挂在 window 上）。 */
  const [reloadKey, setReloadKey] = useState(0);
  /** 握手完成在第几次加载上；`null` = 还没成功过。用「第几次」而不是布尔量，重试后自动回到未就绪。 */
  const [readyKey, setReadyKey] = useState<number | null>(null);
  /** 判为失败的是第几次加载。理由同上。 */
  const [failedKey, setFailedKey] = useState<number | null>(null);

  // 🔴 网页来自**学生自己的组**，不是课堂级那个（`classroom.webapps`）。
  // 改动前这里写的是 `classroom?.webapps?.[0] ?? null` —— 高级模式下课堂级的那一行
  // （`ClassroomWebapp` 只有教师给「分组/标准模式」配的那一个；按组迁移**有意没删**老课堂
  // 残留的那一行）会让**没配网页的组**照样打开一个网页：学生静默地在用别的组的材料，
  // 而画面看起来完全正常（spec §1.2 ① / §4.6）。解析口径统一在 `@/lib/classroom-material`，
  // 高级模式下它**不回落**。
  const webapp: ClassroomWebappSummary | null = effectiveGroupWebapp(classroom, session);
  const port = typeof classroom?.webappPort === 'number' ? classroom.webappPort : null;
  const classroomId = classroom?.id ?? null;
  const webappId = webapp?.id ?? null;
  // `classroom` 为空时 `webapp` 必然是 null，所以这里不会在预渲染（无 window）时读 location。
  const src = webapp && port ? buildWebappSrc(webapp, port) : null;

  const phase: 'loading' | 'ready' | 'failed' =
    readyKey === reloadKey ? 'ready' : failedKey === reloadKey ? 'failed' : 'loading';

  // ── 上报：事件攒批、帧立即发 ────────────────────────────────────────────
  //
  // ⚠️ 两条链路的**闸门条件不同**，这是刻意的：
  //   · 帧：要求 watching **且** captureEnabled（由 SDK 在源头就不截，
  //     `captureLevel === 'off'` / `captureEnabled === false` 两道都在 SDK 里）；
  //   · 事件：**只要求 watching**。captureEnabled 为 false 时**照样要发** ——
  //     那正是文字档的用武之地（教师关掉了画面，但仍然要知道「这个学生有没有在用」）。
  // 共同的那一条是 watching（Ruling 9）：**没人在看就一条都不发**，
  // 学生端的开销是零，而不是「推了再说」。
  const pendingRef = useRef<WebappEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  /**
   * `watching` 的 ref 镜像：上报的三个回调**都不是**每次渲染重建的（`useCallback` 的依赖
   * 里没有 `watching`），它们读到的必须是**当下**的值，所以经 ref 读，不经闭包。
   */
  const watchingRef = useRef(demand.watching);
  useEffect(() => { watchingRef.current = demand.watching; }, [demand.watching]);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const events = pendingRef.current;
    pendingRef.current = [];
    if (events.length === 0) return;
    const socket = wsRef.current;
    // ⚠️ 没人看就**丢掉**而不是留着：攒下来的那几条在教师重新打开看板时已经没有意义了
    // （用户看的是「现在」），而留着会让下一次 flush 发一批陈旧的事件。
    if (!watchingRef.current || !socket || !classroomId || !webappId) return;
    socket.emit('webapp-event', { classroomId, webappId, events: events.slice(0, MAX_EVENTS_PER_MESSAGE) });
  }, [classroomId, webappId, wsRef]);

  const handleEvents = useCallback((incoming: WebappEvent[]) => {
    // 源头闸门（Ruling 9）：没人看就不攒也不发。
    if (!watchingRef.current) return;
    pendingRef.current.push(...incoming);
    if (pendingRef.current.length >= MAX_EVENTS_PER_MESSAGE) {
      flush();
      return;
    }
    if (flushTimerRef.current === null) flushTimerRef.current = window.setTimeout(flush, EVENT_BATCH_MS);
  }, [flush]);

  const handleFrame = useCallback((dataUrl: string) => {
    if (!watchingRef.current) return;
    const socket = wsRef.current;
    if (!socket || !classroomId || !webappId) {
      return;
    }
    socket.emit('webapp-frame', { classroomId, webappId, dataUrl });
  }, [classroomId, webappId, wsRef]);

  const handleReady = useCallback(() => { setReadyKey(reloadKey); }, [reloadKey]);

  /**
   * 诊断（`diag` 通道）。
   *
   * 🔴 **两条去向，都不是可选的**：
   *   · 本机 console —— 方便在桌面机上直接看（桌面 Chrome 的跨源 iframe 是能检查的）；
   *   · 服务端日志 —— **这才是关键那条**：Safari 在 iOS 上不把跨源 iframe 单列成
   *     可检查目标（实测：Mac 的「开发」菜单下那台 iPad 只有父页面一个目标），
   *     所以 iPad 上的失败只能靠服务端日志才看得见。
   *
   * ⚠️ 与帧同理，**不检查 `watchingRef`**：诊断本身就是「为什么没有帧」的答案，
   * 而它出现时 `watching` 恰恰可能已经翻了。少发一条诊断的代价远大于多发一条。
   * ⚠️ 但**必须检查 socket**：没连上就没处送，这时本机 console 那条仍然生效。
   */
  const handleDiag = useCallback((diag: WebappDiag) => {
    console.warn('[探究助手] SDK 诊断：' + diag.code + ' n=' + diag.n + ' w=' + diag.w + ' h=' + diag.h);
    const socket = wsRef.current;
    if (!socket || !classroomId || !webappId) return;
    socket.emit('webapp-diag', { classroomId, webappId, ...diag });
  }, [classroomId, webappId, wsRef]);

  /**
   * 截图档位。
   *
   * ⚠️ **两个条件是「与」的关系，任一不成立就是 `'off'`（= SDK 根本不截）**：
   *   · `active`：模块在不在前台。不在前台就没有「当前画面」可言。
   *   · `watching`：有没有教师在看（Ruling 9 的按需推流）。
   *
   * 这里与父页面那条 `watchingRef` 闸门是**两道独立的闸**，不是重复：
   * 那条管「发不发」，这条管「**画不画**」。对 canvas 直读，「画了但不发」只是白费
   * 几毫秒；对纯 DOM 光栅化，那是每 10 秒白烤一遍整页 —— 学生停在探究助手页面上
   * 而教师没在看时，老 iPad 会一直这么烧下去。**Ruling 9 说的「学生端开销是零」，
   * 只有加上这道闸才真的成立。**
   *
   * `'detail'` 由服务端**逐学生**下发（`broadcastWebappDemand`）：整间教室里只有被
   * 教师点开详情的那一个学生的 `demand.detail` 为真 —— 若做成整班一起升，40 人的班
   * 会让 40 台老 iPad 同时从 10 秒一帧变成 2 秒一帧。
   */
  const level: CaptureLevel = !active || !demand.watching ? 'off' : demand.detail ? 'detail' : 'wall';

  const { armed } = useExploreBridge({
    frameRef,
    level,
    // 服务端按课堂下发的采集参数，**原样转发**：学生端不推导、不改写、不兜默认值
    // （归一化与兜底都在服务端做过一遍，这里再猜一次只会多一种漂移）。
    captureEnabled: demand.captureEnabled,
    captureWidth: demand.width,
    captureIntervalMs: demand.frameIntervalMs,
    onFrame: handleFrame,
    onEvents: handleEvents,
    onReady: handleReady,
    onDiag: handleDiag,
  });

  // ── 加载超时（规格 §12）─────────────────────────────────────────────────
  useEffect(() => {
    if (!src || readyKey === reloadKey) return;
    const timer = window.setTimeout(() => setFailedKey(reloadKey), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey, readyKey]);

  const overlayPortal = useOverlayPortal(active);
  const accent = MODULE_META.explore.accent;
  const label = MODULE_META.explore.label;

  // 卡片态的三种成因：**本组**没配网页、课堂没配网页、配了但网页打不开（网络 / 托管服务问题）。
  // 文案分开写，学生与老师看到的都是「该找谁」。
  const noWebapp = !webapp || !port;
  /**
   * 网页是不是「按组」的（高级模式）。
   *
   * ⚠️ 这里**只决定空状态怎么说**，不参与「用哪一个网页」的判断 —— 那个判断在
   * `effectiveGroupWebapp` 里，且已经返回过了（它不回落）。两处读到的是同一个
   * `mode === 'advanced'`；若将来「按组」的判据变了，这段文案会跟着说谎，而它俩在同一个
   * 文件里、`webapp` 就在上面几行，改的时候看得见。
   *
   * 为什么必须区分：「老师还没有添加探究网页」在高级模式下是**错的** —— 老师可能给别的组
   * 配了，只是没给这一组配。说错成「整间课堂都没有」会把学生引向「等老师加」，而正确的话
   * 是「问老师要你们组的那一个」。
   */
  const groupScoped = classroom?.mode === 'advanced';
  const emptyTitle = webapp
    ? '探究网页服务暂时不可用'
    : groupScoped ? '本组未配置探究网页' : '老师还没有添加探究网页';
  const emptyNote = webapp
    ? '网页服务没有就绪，稍后再试一次；还不行就告诉老师。'
    : groupScoped
      ? '你们这一组没有安排探究网页，先和小组同伴一起讨论，或者问问老师。'
      : '等老师把网页放进来，这里就能直接打开。';

  return (
    <div
      className={styles.panel}
      // 两个排障用的观测点。它们记的都是**界面上看不见、错了也不报错**的状态：
      //   · data-sdk：握手成败。失败时 iframe 照样显示网页，只是父页面永远以为没就绪。
      //   · data-watching：本面板以为「有没有教师在看」。它错了的表现是「教师图墙一直是空的」
      //     或者「没人看时学生仍在推」—— 两种都不会有任何报错。
      data-sdk={phase}
      data-watching={demand.watching ? '1' : '0'}
      data-level={level}
    >
      {src && armed ? (
        <iframe
          ref={frameRef}
          key={reloadKey}
          src={src}
          title={webapp?.name || '探究助手'}
          className={styles.frame}
          sandbox={SANDBOX}
          referrerPolicy="no-referrer"
          // ⚠️ **故意既不挂 onLoad 也不挂 onError。** 说窄一点，下面每条后面都是实测，
          //    而不是「按理说」：
          //   · `onLoad` 在**测过的那两种失败上照样触发**（404：load 触发 1 次；端口不通：
          //     load 也触发 1 次 —— 浏览器把它的错误页当成一次成功加载）。⇒ 拿它当就绪信号，
          //     会把「网页根本没送出来」判成已就绪，学生盯着一张错误页、永远等不到重试按钮。
          //   · `onError` 在**同两种失败上一次都没触发**（两次都是 error=0，而同一支探针在
          //     同一个元素上数到了 load=1 ⇒ 探针确实挂上了，这个 0 不是「根本没挂」）。
          //     ⇒ 它挡不住这里最现实的失败，留着只会让人以为有两条兜底。
          //   · **没有穷举其它失败形态**（例如托管源返回 200 但页面是白的、CSP 拒绝嵌入）：
          //     前者会正常握手（SDK 注入在 `</head>`，白屏也会 ready），**超时判据覆盖不到它** ——
          //     这是本面板已知的边界，不是遗漏。
          // ⇒ 失败判据只有一条：**15 秒内没等到握手**（见 LOAD_TIMEOUT_MS）。它管的是
          //    「网页没能带着 SDK 起来」，不是「网页看起来是空的」。
        />
      ) : null}

      {noWebapp || phase === 'failed' ? (
        <div className={styles.overlay}>
          <div className={styles.card} style={{ '--module-accent': accent } as CSSProperties}>
            <span className={styles.badge}>{label}</span>
            {noWebapp ? (
              <>
                <p className={styles.title}>{emptyTitle}</p>
                <p className={styles.note}>{emptyNote}</p>
              </>
            ) : (
              <>
                <p className={styles.title}>网页没能打开</p>
                <p className={styles.note}>可能是网络或网页服务的问题。点一下重试，不用退出重来。</p>
                <button type="button" className={styles.retry} onClick={() => setReloadKey((prev) => prev + 1)}>
                  重试
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {overlayPortal(toast ? <ClassroomToast toast={toast} setToast={setToast} /> : null)}
    </div>
  );
}
