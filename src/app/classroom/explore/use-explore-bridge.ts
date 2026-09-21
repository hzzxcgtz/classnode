'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WebappEvent } from '@/lib/socket-events';

/**
 * iframe 与父页面之间的 postMessage 桥（P2 规格 §5.4 / §5.5）。
 *
 * ══ 两个方向，各有各的准入判据 ═════════════════════════════════════════════
 *   子 → 父：`{ source:'classnode-sdk',    type:'ready'|'event'|'frame'|'report', payload }`
 *   父 → 子：`{ source:'classnode-parent', type:'pause'|'resume' }`
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
 * 单帧 data URL 的长度上限（UTF-16 码元），镜像服务端的 `MAX_WEBAPP_DATA_URL_CHARS`
 * （`server/src/socket/index.ts`，同为 32K）—— 超限的帧服务端**整条丢弃**。
 * 这里先挡一道只是省一次白扔的往返：SDK 的 32K 上限作用在整条消息上，
 * 所以正常路径永远不会撞到这条。
 */
const MAX_FRAME_CHARS = 32 * 1024;

/**
 * SDK 的 `event` 载荷 → 契约里的 `WebappEvent`（`src/lib/socket-events.ts`）。
 *
 * **逐字段白名单式重建，不是「挑几个字段改」**：这是服务端 `sanitizeWebappEvent` 的
 * 客户端对偶。两个好处，都不是洁癖：
 *   · SDK 的载荷里还有一个 `image` 字段（只有 `frame` 通道非空）。原样转发会让事件通道
 *     在结构上也能携带像素，而契约里根本没有这个位置；
 *   · 服务端反正会重建，多塞的字段一个也到不了。在这里收窄，等于把「本通道只走这七个
 *     结构字段」写成父页面这一侧也能读到的代码，而不是一句注释。
 *
 * `kind` 只放行 SDK 会发的五种：`ready` / `frame` / `report` 各有各的通道（见下面的分发），
 * 不属于这里。服务端的白名单同样是这六项（多一个 `report`）。
 */
const EVENT_KINDS = ['click', 'input', 'scroll', 'navigate', 'visibility'] as const;

function toWebappEvent(payload: unknown): WebappEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(kind)) return null;
  return {
    kind: kind as WebappEvent['kind'],
    selector: typeof raw.selector === 'string' ? raw.selector : '',
    inputType: typeof raw.inputType === 'string' ? raw.inputType : '',
    length: typeof raw.length === 'number' ? raw.length : 0,
    depth: typeof raw.depth === 'number' ? raw.depth : 0,
    to: typeof raw.to === 'string' ? raw.to : '',
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now(),
  };
}

/**
 * `ClassNode.report(payload)` 的载荷 → 一条 `kind:'report'` 事件。
 *
 * ⚠️ **教师塞进去的内容在这里就被丢掉了，而且丢掉一分也不亏**：契约里的 `WebappEvent`
 * 没有任何内容字段，服务端还会做一次白名单式重建（`sanitizeWebappEvent`）——
 * 内容根本到不了服务端，能过去的只有「发生过一次 report」这个形状（它进 `reports` 计数）。
 * 与其把一段任意长的教师数据在局域网上搬两趟再被服务端扔掉，不如在源头就收缩成形状。
 */
function toReportEvent(): WebappEvent {
  return { kind: 'report', selector: '', inputType: '', length: 0, depth: 0, to: '', at: Date.now() };
}

/** `frame` 通道的载荷解析：只接 `data:image/` 开头的、且不超过上限的那一种。 */
function toFrameDataUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const image = (payload as Record<string, unknown>).image;
  if (typeof image !== 'string') return null;
  if (!image.startsWith('data:image/')) return null;
  if (image.length > MAX_FRAME_CHARS) return null;
  return image;
}

export interface ExploreBridgeOptions {
  /** 探究助手 iframe 的 ref。父侧的准入判据就是它的 `contentWindow`。 */
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** SDK 采集到的结构事件（一次一条，因为 SDK 每条事件发一条消息）。 */
  onEvents: (events: WebappEvent[]) => void;
  /** 缩略图帧的 data URL。 */
  onFrame: (dataUrl: string) => void;
  /** 握手达成（SDK 在 `<head>` 里执行的瞬间就喊了这一声，**每个 document 恰好一次**）。 */
  onReady: () => void;
  /** 父页面此刻是否应该挂起这个 iframe（= 它不在前台）。 */
  suspended: boolean;
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
  const { frameRef, onEvents, onFrame, onReady, suspended } = options;
  // 事件回调每次渲染都可能变（它们是调用方的 useCallback / 内联函数），而监听只挂一次 ——
  // 用 ref 转发，处理函数读到的永远是最新一批（与 use-chat-socket.ts 的 optionsRef 同款）。
  const handlersRef = useRef({ onEvents, onFrame, onReady });
  useEffect(() => { handlersRef.current = { onEvents, onFrame, onReady }; });
  // 握手时要补发一次当前挂起态，所以处理函数也得读到最新的 `suspended`。
  const suspendedRef = useRef(suspended);
  useEffect(() => { suspendedRef.current = suspended; }, [suspended]);

  const [armed, setArmed] = useState(false);

  useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      // ⚠️ 唯一的准入判据：消息必须来自我们刚挂载的那个 iframe 的 contentWindow。
      //    比 e.source 更弱的判据（`e.data.source === 'classnode-sdk'`、`e.origin`）都不算数：
      //    前者是对方自己写的字符串，后者在托管服务与学生端同主机不同端口时只能比到主机名。
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
        if (frameWindow && suspendedRef.current) {
          frameWindow.postMessage({ source: PARENT_TAG, type: 'pause' }, '*');
        }
        handlersRef.current.onReady();
        return;
      }

      if (data.type === 'event') {
        const event = toWebappEvent(data.payload);
        if (event) handlersRef.current.onEvents([event]);
        return;
      }

      if (data.type === 'report') {
        handlersRef.current.onEvents([toReportEvent()]);
        return;
      }

      if (data.type === 'frame') {
        const dataUrl = toFrameDataUrl(data.payload);
        if (dataUrl) handlersRef.current.onFrame(dataUrl);
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
      { source: PARENT_TAG, type: suspended ? 'pause' : 'resume' },
      // 目标源是独立源，父页面无法预先知道它的 origin（见文件头），
      // 安全性由子页面侧的 e.source 校验保证。
      '*',
    );
  }, [suspended, frameRef]);

  return { armed };
}
