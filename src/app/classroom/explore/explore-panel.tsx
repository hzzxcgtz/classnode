'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Socket } from 'socket.io-client';
import type { WebappEvent } from '@/lib/socket-events';
import type { ClassroomWebappSummary } from '@/lib/types';
import { MODULE_META } from '../module-meta';
import type { ModulePanelProps } from '../classroom-types';
import { ClassroomToast, useOverlayPortal } from '../layer-overlays';
import { useExploreBridge } from './use-explore-bridge';
import styles from './explore.module.css';

/**
 * iframe 的 sandbox 集合（规格 §5.1 / Ruling 13）。**照抄，不要增减。**
 *
 * 为什么是这一组：
 *   · `allow-scripts` 与 `allow-same-origin` 同时给，在**同源**时是危险的组合
 *     （iframe 可以自己把 sandbox 属性摘掉）；这里安全的前提是 iframe 来自**独立源**
 *     （另一个端口），它够不到父页面，也够不到教师会话。
 *   · `allow-forms` / `allow-pointer-lock` / `allow-downloads` 是教学网页的常见需要。
 *   · ⚠️ **故意不给** `allow-top-navigation`（网页不能把整个 ClassNode 页面导走，
 *     那会让学生丢掉课堂）与 `allow-modals`（`alert` 会把老 iPad 卡死）。
 *   · ⚠️ **`allow` 属性不加**：不申请任何权限（摄像头 / 麦克风 / 地理位置），
 *     与主服务 `Permissions-Policy` 的收紧方向一致。
 */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads';

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

/** 事件攒多久发一次。SDK 一条事件发一条 postMessage，逐条 socket 上行会碎成一地小包。 */
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
 *   · `wsRef`：事件与帧经**已有的那条** socket 上报。⚠️ **绝不新建第二条连接** ——
 *     那会给学生端多一条常驻连接（违背 §4.8 的内存门槛），服务端还要处理重复连接。
 *   · `watching`：本课堂此刻有没有教师在看探究助手视图。**由会话层持有、外壳传下来**，
 *     面板自己不订阅 —— 初值只在 `join-classroom` 成功后下发一次，而本面板是惰性挂载的，
 *     自己订阅必然漏掉那一次（详见 `classroom-types.ts` 里那个字段的注释）。
 */
export interface ExplorePanelProps extends ModulePanelProps {
  wsRef: { current: Socket | null };
  /** 有教师在看探究助手视图 ⇒ 才值得推。没人看时学生端在源头就不发（Ruling 9）。 */
  watching: boolean;
}

/**
 * 学生端的探究助手面板：一个跨源 iframe（托管服务）+ postMessage 桥 + 事件上报。
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
export function ExplorePanel({ active, classroom, toast, setToast, wsRef, watching }: ExplorePanelProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** 第几次加载。重试按钮 +1 ⇒ iframe 换 key 重挂（监听不受影响，它挂在 window 上）。 */
  const [reloadKey, setReloadKey] = useState(0);
  /** 握手完成在第几次加载上；`null` = 还没成功过。用「第几次」而不是布尔量，重试后自动回到未就绪。 */
  const [readyKey, setReadyKey] = useState<number | null>(null);
  /** 判为失败的是第几次加载。理由同上。 */
  const [failedKey, setFailedKey] = useState<number | null>(null);

  const webapp: ClassroomWebappSummary | null = classroom?.webapps?.[0] ?? null;
  const port = typeof classroom?.webappPort === 'number' ? classroom.webappPort : null;
  const classroomId = classroom?.id ?? null;
  const webappId = webapp?.id ?? null;
  // `classroom` 为空时 `webapp` 必然是 null，所以这里不会在预渲染（无 window）时读 location。
  const src = webapp && port ? buildWebappSrc(webapp, port) : null;

  const phase: 'loading' | 'ready' | 'failed' =
    readyKey === reloadKey ? 'ready' : failedKey === reloadKey ? 'failed' : 'loading';

  // ── 上报：事件攒批、帧立即发 ────────────────────────────────────────────
  const pendingRef = useRef<WebappEvent[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  /**
   * `watching` 的 ref 镜像：上报的三个回调**都不是**每次渲染重建的（`useCallback` 的依赖
   * 里没有 `watching`），它们读到的必须是**当下**的值，所以经 ref 读，不经闭包。
   */
  const watchingRef = useRef(watching);
  useEffect(() => { watchingRef.current = watching; }, [watching]);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const events = pendingRef.current;
    pendingRef.current = [];
    if (events.length === 0) return;
    const socket = wsRef.current;
    if (!watchingRef.current || !socket || !classroomId || !webappId) return;
    socket.emit('webapp-event', { classroomId, webappId, events: events.slice(0, MAX_EVENTS_PER_MESSAGE) });
  }, [classroomId, webappId, wsRef]);

  const handleEvents = useCallback((incoming: WebappEvent[]) => {
    // 源头闸门（Ruling 9）：没人看就不攒也不发，学生端的开销是零而不是「推了再说」。
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
    if (!socket || !classroomId || !webappId) return;
    socket.emit('webapp-frame', { classroomId, webappId, dataUrl });
  }, [classroomId, webappId, wsRef]);

  const handleReady = useCallback(() => { setReadyKey(reloadKey); }, [reloadKey]);

  const { armed } = useExploreBridge({
    frameRef,
    suspended: !active,
    onEvents: handleEvents,
    onFrame: handleFrame,
    onReady: handleReady,
  });

  // ── 加载超时（规格 §12）─────────────────────────────────────────────────
  useEffect(() => {
    if (!src || readyKey === reloadKey) return;
    const timer = window.setTimeout(() => setFailedKey(reloadKey), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey, readyKey]);

  // 卸载时清掉攒批定时器：组件没了，pending 队列也不会再有人消费，直接丢。
  useEffect(() => () => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    pendingRef.current = [];
  }, []);

  const overlayPortal = useOverlayPortal(active);
  const accent = MODULE_META.explore.accent;
  const label = MODULE_META.explore.label;

  // 卡片态的两种成因：没关联网页（老师的配置问题）与网页打不开（网络 / 托管服务问题）。
  // 文案分开写，学生与老师看到的都是「该找谁」。
  const noWebapp = !webapp || !port;

  return (
    <div
      className={styles.panel}
      // 两个排障用的观测点。它们记的都是**界面上看不见、错了也不报错**的状态：
      //   · data-sdk：握手成败。失败时 iframe 照样显示网页，只是父页面永远以为没就绪。
      //   · data-watching：本面板以为「有没有教师在看」。它错了的表现是「教师图墙一直是空的」
      //     或者「没人看时学生仍在推」—— 两种都不会有任何报错。
      data-sdk={phase}
      data-watching={watching ? '1' : '0'}
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
                <p className={styles.title}>{webapp ? '探究网页服务暂时不可用' : '老师还没有添加探究网页'}</p>
                <p className={styles.note}>
                  {webapp
                    ? '网页服务没有就绪，稍后再试一次；还不行就告诉老师。'
                    : '等老师把网页放进来，这里就能直接打开。'}
                </p>
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
