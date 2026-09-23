'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WebappEvent } from '@/lib/socket-events';

/**
 * iframe 与父页面之间的 postMessage 桥（P2 规格 §5.4 / §5.5）。
 *
 * ══ 两个方向，各有各的准入判据 ═════════════════════════════════════════════
 *   子 → 父：`{ source:'classnode-sdk',    type:'ready'|'event'|'frame'|'report', payload }`
 *   父 → 子：`{ source:'classnode-parent', type:'demand', level:'off'|'wall'|'detail' }`
 *
 * ⚠️ `event` 通道（P2.2 的 T5）只承载**文字档**：`visibility` 与 `scroll` 两种，
 * 载荷**恒为四个字段**（kind / to / depth / at），**没有任何自由文本字段**。
 * 点击 / 输入 / 页面内跳转**不采集、也不在这条通道上**（用户裁定），
 * 而且它们**不许回来**：`toWebappEvent` 下面那张白名单是这条线的执行点。
 * 两边都**必须**校验 `e.source`，因为消息的目标源只能是 `'*'`（父页面来自另一个源，
 * 双方都无法预先知道对方的 origin）—— 也就是说，任何能拿到本窗口引用的页面都能来敲一下。
 *
 *   · 子侧（SDK，T4 已实现）：只认 `e.source === parent`。第三方把教师网页嵌进自己的站时，
 *     嵌入者驱动不了那个 SDK。
 *   · 父侧（本文件）：只认 `e.source === frameRef.current?.contentWindow`。
 *     **这是本文件最要紧的一行**：`e.data.source === 'classnode-sdk'` 只是对方自己写的一个
 *     字符串，任何人都会写；唯一不可伪造的判据是「这条消息来自我们刚挂载的那个 iframe」。
 */

/** 子 → 父的标记，与 SDK 里的 `SDK_TAG` 是同一个字面量（`server/src/services/webapp-sdk.ts`）。 */
const SDK_TAG = 'classnode-sdk';
/** 父 → 子的标记，与 SDK 里的 `PARENT_TAG` 是同一个字面量。 */
const PARENT_TAG = 'classnode-parent';

/**
 * 截图档位。三档各自的**间隔**写在 SDK 的 `FRAME_INTERVAL_BASE` 那边（唯一定义点），
 * 这里只是同一组字面量的类型 —— 别在这边再抄一份数字。
 */
export type CaptureLevel = 'off' | 'wall' | 'detail';

/**
 * 单帧 data URL 的长度上限（UTF-16 码元），镜像服务端的 `MAX_WEBAPP_DATA_URL_CHARS`
 * （`server/src/socket/index.ts`，同为 32K）—— 超限的帧服务端**整条丢弃**。
 * 这里先挡一道只是省一次白扔的往返：SDK 的 32K 上限作用在整条消息上，
 * 所以正常路径永远不会撞到这条。
 */
const MAX_FRAME_CHARS = 32 * 1024;

/** `frame` 通道的载荷解析：只接 `data:image/` 开头的、且不超过上限的那一种。 */
function toFrameDataUrl(payload: unknown): string | null {
  /**
   * ⚠️ 这条日志是**刻意保留的诊断**（老 iPad 事故的直接产物）。
   *
   * 这一层从前把不合规的帧**静默吃掉**，于是「学生端在截图、教师看不到图」
   * 在父页面这一侧没有任何痕迹 —— 而它和「学生端根本没截图」在教师端看起来
   * 完全一样（都是空白格）。出问题时只能靠猜。
   *
   * 量级有界：帧最多每 5 秒一张，而不合规的帧本来就不该出现。
   * 前缀只印前 24 个字符 —— 完整 data URL 是一整张图，印出来只会淹掉日志。
   */
  const reject = (why: string): null => {
    console.warn(`[探究空间] 丢弃一帧：${why}`);
    return null;
  };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reject('载荷不是对象');
  const image = (payload as Record<string, unknown>).image;
  if (typeof image !== 'string') return reject('image 不是字符串');
  if (!image.startsWith('data:image/')) return reject(`image 前缀不是 data:image/（实际 ${image.slice(0, 24)}）`);
  if (image.length > MAX_FRAME_CHARS) return reject(`image 超长 ${image.length} > ${MAX_FRAME_CHARS}`);
  return image;
}

/**
 * `event` 通道**允许的 kind** —— 与 SDK 的 buildEvent 调用点一一对应，只有这两种。
 *
 * ⚠️ 这是一张**白名单**，不是「不在黑名单里就放行」：将来 SDK 加通道必须显式改这里。
 * 旧的 click / input / navigate / report 四项**不在**表里，而且不该被加回来。
 */
const EVENT_KINDS = ['visibility', 'scroll'] as const;

/** `depth` 的合法取值是 0 / 10 / … / 100（十分位）。越界的一律夹回来。 */
function clampDecileDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value / 10) * 10;
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

/**
 * SDK 的 `event` 载荷 → 契约里的 `WebappEvent`（`src/lib/socket-events.ts`）。
 *
 * 🔴 **逐字段白名单重建，不是「校验一下就转发」。** 这是**纵深防御**：SDK 是跑在
 * 学生 iframe 里的代码，它被改坏（或被人替换）时，父页面这一层仍然只放行这四个字段
 * —— 一份多带了 `selector` / `inputType` / `length` / 任意自由文本的载荷，到这里会被
 * **重建掉**，而不是原样往 socket 上传。服务端还有一层同款的重建（sanitizeWebappEvent），
 * 两层是刻意的：每一层都假定上一层可能已经坏了。
 *
 * 重建后的形状恰好四项：
 *   kind  —— 'visibility' | 'scroll'（白名单）
 *   to    —— visibility 时必须是 'visible' | 'hidden'；scroll 时恒为 ''
 *   depth —— scroll 时是 0/10/…/100；visibility 时恒为 0
 *   at    —— 数字时间戳（认不出就用当下）
 */
function toWebappEvent(payload: unknown): WebappEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;

  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) return null;

  let to = '';
  let depth = 0;
  if (kind === 'visibility') {
    if (raw.to !== 'visible' && raw.to !== 'hidden') return null;
    to = raw.to;
  } else {
    depth = clampDecileDepth(raw.depth);
  }

  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now();
  return { kind: kind as WebappEvent['kind'], to, depth, at };
}

/**
 * `diag` 通道**允许的 code** —— 与 SDK 里 `DIAG_CODES` 一一对应。
 *
 * ⚠️ **这是一张白名单**，与 `EVENT_KINDS` 同款：不在表里的一律丢，而不是「没在黑名单里就放行」。
 * 两边必须同时改，改一边的后果是那条诊断静默消失（不报错，只是永远看不到）。
 */
const DIAG_CODES = [
  'dom-tier-gave-up',
  'lib-ready',
  'lib-load-failed',
  'viewport-zero',
  'sync-throw',
  'not-promise',
  'capture-error',
  'empty-canvas',
  'canvas-empty',
  'timeout',
  'over-budget',
] as const;

/** 一条诊断。**每个字段都是枚举码或整数**，见 `diag` 通道的说明。 */
export interface WebappDiag {
  code: string;
  /** 含义随 code 而定（耗时 / 字符数），恒为非负整数。 */
  n: number;
  w: number;
  h: number;
}

/** 非负整数，认不出就 0 —— 与 SDK 那侧同一个口径，宁可丢一个数也不放 NaN 过去。 */
function toDiagInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 100000000);
}

/**
 * SDK 的 `diag` 载荷 → 契约形状。
 *
 * 🔴 **逐字段白名单重建，不是「校验一下就转发」** —— 与 `toWebappEvent` 完全同款，
 * 理由也一样：SDK 是跑在学生 iframe 里的代码，它被改坏或被人替换时，
 * 父页面这一层仍然只放行这四个字段。**这条通道的存在不能变成一个后门**。
 */
function toWebappDiag(payload: unknown): WebappDiag | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const code = raw.code;
  if (typeof code !== 'string') return null;
  if (!(DIAG_CODES as readonly string[]).includes(code)) return null;
  return { code, n: toDiagInt(raw.n), w: toDiagInt(raw.w), h: toDiagInt(raw.h) };
}

export interface ExploreBridgeOptions {
  /** 探究空间 iframe 的 ref。父侧的准入判据就是它的 `contentWindow`。 */
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** 缩略图帧的 data URL。 */
  onFrame: (dataUrl: string) => void;
  /**
   * 文字档事件（`visibility` / `scroll`）。
   *
   * 一次一条：SDK 一条事件发一条 postMessage。攒批是**面板**的事（`explore-panel.tsx`
   * 的 400ms 窗口）—— 桥这一层只管把形状收干净，不管节奏。
   */
  onEvents: (events: WebappEvent[]) => void;
  /** 握手达成（SDK 在 `<head>` 里执行的瞬间就喊了这一声，**每个 document 恰好一次**）。 */
  onReady: () => void;
  /**
   * 诊断（`diag` 通道，第 5 条）。
   *
   * 🔴 存在的理由：Safari 在 iOS 上**不把跨源 iframe 单列成可检查的目标**（实测：
   * Mac 的「开发」菜单下那台 iPad 只有父页面一个目标），于是 SDK 在 iframe 里的
   * console 日志**结构上取不到** —— 老 iPad「有浏览位置、没有图片」的失败原因
   * 因此一直不可见。这条通道把「哪一类失败」送出来。
   *
   * ⚠️ **载荷只有一个封闭枚举码 + 三个整数，没有任何自由字符串** ——
   * 它装不下页面内容，不放松原来那条「SDK 里装不下任何页面内容」的保证。
   */
  onDiag: (diag: WebappDiag) => void;
  /**
   * 父页面要 SDK 用的截图档位。
   *
   * 由**两件事共同**决定，都在 `explore-panel.tsx` 里算：
   *   · 这个模块在不在前台（不在就没有画面可言）；
   *   · 有没有教师在看、看的是不是**这个学生**（Ruling 9 的按需推流）。
   * 两者任一不成立就是 `'off'` —— 那时 SDK **根本不截图**，而不是「截了但不发」。
   */
  level: CaptureLevel;
  /**
   * 服务端按课堂下发的**采集参数**，原样转发给 SDK。
   *
   * ⚠️ 拆成三个原始值而不是传一个对象：下面那条 effect 的依赖里要放它们 ——
   * 传对象的话每次渲染都是新引用，effect 会**每渲染一次就重发一条 demand**，
   * 而 SDK 每次收到 demand 都会重建定时器（连带重置首帧抖动）。
   */
  captureEnabled: boolean;
  captureWidth: number;
  captureIntervalMs: number;
}

export interface ExploreBridge {
  /**
   * `message` 监听是否**已经**挂好。
   *
   * ⚠️ **调用方在此之前不得把 iframe 放进 DOM。** 见下面 `useLayoutEffect` 的注释 ——
   * 这不是「建议的时序」而是握手协议的唯一一次机会。
   */
  armed: boolean;
}

/**
 * 挂上 postMessage 桥。返回的 `armed` 是**插入 iframe 的前置条件**。
 *
 * ══ 为什么需要 `armed` 这道闸（预审 6a）════════════════════════════════════
 * SDK 在 `<head>` 里一执行就 `parent.postMessage({type:'ready'})`，**只发这一次**
 * （`webapp-sdk.ts` 的 `post('ready', …)`；T4 刻意没有改成发两次，那会给父页面一条
 * 没有预期的重复消息）。如果监听挂得比 iframe 的**创建**还晚，这一条就丢了，
 * 而且没有第二次机会。
 *
 * 症状极难归因：iframe 正常加载、学生看得见网页、控制台一片安静，但父页面永远认为它没就绪
 * —— 挂起信号发不出去、事件也不上报。
 *
 * 所以顺序必须是「先挂监听、后创建 iframe」，而 React 的提交顺序恰好**相反**：
 * 把 `<iframe>` 写在 JSX 里，元素是在 commit 期插进 DOM 的，而 `useEffect`（被动效果）
 * 要等调度器回调，可能落在 iframe 子文档开始执行脚本**之后**。
 * 这里的做法是：`useEffect` 里挂监听**不可能**保证顺序，所以改用 `useLayoutEffect` 并把
 * 「已挂好」写成一个 state —— 面板只有在它为 `true` 时才渲染 iframe，中间隔着一次重新渲染。
 * `useLayoutEffect` 在提交期同步执行（浏览器还没机会跑 iframe 的任何任务），
 * state 更新带来的那次渲染必然在它之后 ⇒ **「监听先于 iframe 存在」是构造出来的，
 * 不依赖任何时序假设**。
 */
export function useExploreBridge(options: ExploreBridgeOptions): ExploreBridge {
  const { frameRef, onFrame, onEvents, onReady, onDiag, level, captureEnabled, captureWidth, captureIntervalMs } = options;
  // 回调每次渲染都可能变（它们是调用方的 useCallback / 内联函数），而监听只挂一次 ——
  // 用 ref 转发，处理函数读到的永远是最新一批（与 use-chat-socket.ts 的 optionsRef 同款）。
  const handlersRef = useRef({ onFrame, onEvents, onReady, onDiag });
  useEffect(() => { handlersRef.current = { onFrame, onEvents, onReady, onDiag }; });
  // 握手时要补发一次当前状态，所以处理函数也得读到**最新的一整份** demand。
  // 用「每次渲染都刷新」的 latest-ref 模式（不带依赖数组），它读到的永远是最新值。
  const demandRef = useRef({ level, captureEnabled, captureWidth, captureIntervalMs });
  useEffect(() => { demandRef.current = { level, captureEnabled, captureWidth, captureIntervalMs }; });

  const [armed, setArmed] = useState(false);

  useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      // ⚠️ 唯一的准入判据：消息必须来自我们刚挂载的那个 iframe 的 contentWindow。
      //
      //    ── 为什么不用 `e.origin`（它看起来更自然，务必读完再改）──────────────────
      //    `e.origin` 是 `scheme://host:port`，**它比得到端口**。所以「比到主机名」不是
      //    不用它的理由（这句话本文件早前写错过，已改正）。真正的理由是：
      //    **这里要挡的冒充者与面板 iframe 是同一个源** —— 托管服务的 origin 对所有学生
      //    都一样，任何同源的兄弟 iframe（学生页里随便插一个指向同一网页的 iframe）发来的
      //    消息，`e.origin` 与真 iframe **逐字相同** ⇒ 基于 `e.origin` 的判据会把冒充者
      //    一个不漏地放进来。能区分的只有「这条消息出自哪个窗口对象」。
      //    同理 `e.data.source === 'classnode-sdk'` 只是对方自己写的字符串，谁都会写。
      //    ⇒ 唯一不可伪造的判据是 `e.source === frameRef.current.contentWindow`。
      //
      //    iframe 还没创建时 `frameRef.current` 是 null —— 此时任何消息都不认，正确。
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;

      const data = e.data as { source?: unknown; type?: unknown; payload?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== SDK_TAG) return;

      if (data.type === 'ready') {
        // 握手。**不要**在这里把 iframe 当成「已就绪」之外的事：事件通道不依赖它，
        // 但挂起通道依赖 —— SDK 默认是「未挂起」的，而父页面可能在 iframe 还没加载完
        // 就已经切走了（那一次的 pause 打在空处，SDK 那时还没装上监听）。
        // 所以握手完成的这一刻补发一次当前状态：这是**唯一**能补上那次丢失的时机。
        const frameWindow = frame.contentWindow;
        // ⚠️ **无条件补发**（原来是「只在 suspended 时补发」）。SDK 的默认档是
        // 'wall'（见它那边的注释：默认档让父页面坏掉时仍能低频出图），所以父页面
        // 必须把自己的真实档位说出去 —— 尤其是 'off'，那正是「没人看就别截」。
        if (frameWindow) {
          const d = demandRef.current;
          frameWindow.postMessage(
            {
              source: PARENT_TAG,
              type: 'demand',
              level: d.level,
              captureEnabled: d.captureEnabled,
              width: d.captureWidth,
              frameIntervalMs: d.captureIntervalMs,
            },
            '*',
          );
        }
        handlersRef.current.onReady();
        return;
      }

      // ⚠️ `report` 通道：**刻意收下但不做任何事**，不要把它读成遗漏。
      //
      // SDK 那边的 ClassNode.report() 仍然保留（它是接口契约的一部分，见
      // server/src/services/webapp-sdk.ts 的文件头），教师网页调用它时这条消息
      // 也确实会到达这里 —— 但它**没有下游**，而且这一点在 T5 恢复了 event 通道
      // 之后**依然成立**：文字档走的是上面那条 `event` 通道（kind 白名单里只有
      // visibility / scroll），而 report 塞什么 kind 都进不去。**不要**把两者合并：
      // report 的载荷由教师网页决定内容，event 的载荷由 SDK 的 buildEvent 定死形状。
      // 显式吃掉这一条（而不是落到下面的「未知 type」兜底），是为了把
      // 「我们知道它存在、并且**故意**不处理」写在代码里。
      // 谁要把它接上，必须显式地接一条新通道，那是一次刻意的改动。

      if (data.type === 'report') return;

      if (data.type === 'event') {
        // ⚠️ 只认 `toWebappEvent` **重建**出来的那四个字段 —— 不把 payload 原样转出去。
        // 见该函数的注释：这是纵深防御的那一层。
        const event = toWebappEvent(data.payload);
        if (event) handlersRef.current.onEvents([event]);
        return;
      }

      if (data.type === 'frame') {
        const dataUrl = toFrameDataUrl(data.payload);
        if (dataUrl) handlersRef.current.onFrame(dataUrl);
        return;
      }

      if (data.type === 'diag') {
        // ⚠️ 与 `event` / `frame` 同款：只认 `toWebappDiag` **重建**出来的四个字段。
        // 这条通道**不允许**变成把任意 payload 转出去的后门。
        const diag = toWebappDiag(data.payload);
        if (diag) handlersRef.current.onDiag(diag);
        return;
      }
      // 其余 type 一律不认（白名单）。将来 SDK 加通道必须显式改这里。
    };

    window.addEventListener('message', handler);
    // 置位之后面板才会渲染 iframe —— 本行的位置就是「监听先于 iframe」这句话的实现。
    setArmed(true);
    return () => {
      window.removeEventListener('message', handler);
      setArmed(false);
    };
    // 依赖为空是刻意的：监听只挂一次，`frameRef` 是稳定的 ref 对象、回调走 handlersRef。
  }, [frameRef]);

  // 挂起 / 恢复：由 `active` 的**边沿**驱动（切走的当场挂起、切回并滑到位后恢复）。
  //
  // ⚠️ 这一条**必然**会在 iframe 还没加载完时先空放一次（面板挂载时模块还在后台，
  //    那一条 `pause` 打在空处）。补的办法在 `ready` 的分支里：握手完成的瞬间再发一次。
  //    所以这里不去猜「iframe 加载好了没有」——猜不出来，也不该猜。
  useEffect(() => {
    const frame = frameRef.current;
    const frameWindow = frame?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      { source: PARENT_TAG, type: 'demand', level, captureEnabled, width: captureWidth, frameIntervalMs: captureIntervalMs },
      // 目标源是独立源，父页面无法预先知道它的 origin（见文件头），
      // 安全性由子页面侧的 e.source 校验保证。
      '*',
    );
  }, [level, captureEnabled, captureWidth, captureIntervalMs, frameRef]);

  return { armed };
}
