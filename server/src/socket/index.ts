import { Server, Socket } from 'socket.io';
import { PrismaClient, Prisma } from '@prisma/client';
import { proxyAIRequestStream } from '../services/ai-proxy.js';
import type { AgentConfig } from '../services/ai-proxy.js';
import { anonymizer } from '../services/anonymizer.js';
import { buildShieldFilter } from '../services/shield-filter.js';
import { decrypt } from '../services/crypto.js';
import { hasTeacherSessionCookie } from '../middleware/auth.js';
import { verifyStudentToken } from '../middleware/student-auth.js';

/** 智能体异常告警冷却（同一 agentId 2 分钟内最多推送一次） */
const agentAlertCooldown = new Map<string, number>();
const AGENT_ALERT_COOLDOWN_MS = 2 * 60 * 1000;

/** 平台对话上下文 ID 存储（key: classroomId:studentId:agentId）
 *  智谱清言用 conversationId，文心用 threadId，都是 API 返回的上下文标识 */
const platformConversations = new Map<string, { conversationId: string; lastUsedAt: number }>();
const PLATFORM_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

/** 活跃 AI 流式请求的 AbortController（key: socketId）
 *  学生端请求停止生成时，通过此 map 中断对应的 AI 请求 */
const activeStreams = new Map<string, AbortController>();

/** 教师通知缓存：key=classroomId，value=最近 N 条通知（用于 socket 重连时回放）
 *  studentId=null 表示全班广播，回放时只有目标学生或全班消息才推给当前学生 */
const teacherNotificationCache = new Map<string, { id: string; message: string; timestamp: number; studentId: string | null }[]>();
const MAX_CACHED_NOTIFICATIONS = 5;
const NOTIFICATION_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
/** 学生提问频率限制：每分钟最多 10 条（被屏蔽词拦截的不计入） */
const RATE_LIMIT_WINDOW_MS = 60_000;
const studentMsgTimestamps = new Map<string, number[]>();
/** 缓存频率限制配置，每 10 秒刷新一次 */
let cachedRateLimit = 6;
let rateLimitCacheTime = 0;
const RATE_LIMIT_CACHE_TTL = 10_000;

/** 清理仅用于实时会话的内存缓存，避免桌面端长期运行时无界累积。 */
function pruneSocketCaches(now: number = Date.now()): void {
  for (const [studentId, timestamps] of studentMsgTimestamps) {
    const recent = timestamps.filter(timestamp => timestamp > now - RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) studentMsgTimestamps.delete(studentId);
    else studentMsgTimestamps.set(studentId, recent);
  }
  for (const [classroomId, notifications] of teacherNotificationCache) {
    const recent = notifications.filter(notification => notification.timestamp > now - NOTIFICATION_CACHE_TTL);
    if (recent.length === 0) teacherNotificationCache.delete(classroomId);
    else teacherNotificationCache.set(classroomId, recent);
  }
  for (const [agentId, lastAlert] of agentAlertCooldown) {
    if (lastAlert <= now - AGENT_ALERT_COOLDOWN_MS) agentAlertCooldown.delete(agentId);
  }
  for (const [key, conversation] of platformConversations) {
    if (conversation.lastUsedAt <= now - PLATFORM_CONVERSATION_TTL_MS) platformConversations.delete(key);
  }
  pruneWebappMonitor(now);
}

async function getRateLimit(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  pruneSocketCaches(now);
  if (now - rateLimitCacheTime >= RATE_LIMIT_CACHE_TTL) {
    try {
      const config = await prisma.shieldConfig.findFirst();
      cachedRateLimit = config?.rateLimit ?? 6;
      rateLimitCacheTime = now;
    } catch {}
  }
  return cachedRateLimit;
}

async function checkRateLimit(studentId: string, prisma: PrismaClient): Promise<boolean> {
  const limit = await getRateLimit(prisma);
  if (limit <= 0) return true; // 0 = 不限制
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = studentMsgTimestamps.get(studentId) || [];
  timestamps = timestamps.filter(t => t > windowStart);
  if (timestamps.length >= limit) {
    return false;
  }
  timestamps.push(now);
  studentMsgTimestamps.set(studentId, timestamps);
  return true;
}

/** 屏蔽词过滤器缓存（预构建 AC 自动机，避免每次发消息都重建） */
let cachedFilter: ((content: string) => { filtered: string; matched: string[] }) | null = null;
let shieldWordsCacheTime = 0;
const SHIELD_WORDS_CACHE_TTL = 3_000;

/**
 * 从原文中提取屏蔽词附近的上下文（取匹配词所在的一句话范围）
 * 用于拦截记录展示，只显示屏蔽词前后 1-2 句，而非整个提问
 */
function extractContextAroundMatch(content: string, matchedWords: string[], maxChars: number = 200): string {
  if (!content || matchedWords.length === 0) return content.slice(0, maxChars);

  // 中文句子结束标点
  const sentenceEnd = /[。！？!?\n]/;

  // 对每个屏蔽词找到其在原文中的位置，以句子为单位提取窗口
  const windows: { start: number; end: number }[] = [];
  const lowerContent = content.toLowerCase();

  for (const word of matchedWords) {
    if (!word) continue;
    const idx = lowerContent.indexOf(word.toLowerCase());
    if (idx === -1) continue;

    // 向后找到句子起点（上一个句子结束符后的第一个非空字符）
    let start = idx;
    // 回退最多 50 个字符找句子边界
    for (let i = idx - 1; i >= Math.max(0, idx - 50); i--) {
      if (sentenceEnd.test(content[i])) {
        start = i + 1;
        break;
      }
    }
    if (start === idx) start = Math.max(0, idx - 20); // 没找到句子边界，回退 20 字

    // 向前找到句子终点
    let end = idx + word.length;
    for (let i = idx + word.length; i < Math.min(content.length, idx + word.length + 50); i++) {
      if (sentenceEnd.test(content[i])) {
        end = i + 1;
        break;
      }
    }
    if (end === idx + word.length) end = Math.min(content.length, idx + word.length + 30);

    windows.push({ start, end });
  }

  // 合并重叠或相邻的窗口
  const sorted = windows.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const w of sorted) {
    if (merged.length === 0 || w.start > merged[merged.length - 1].end) {
      merged.push({ start: w.start, end: w.end });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, w.end);
    }
  }

  // 拼接窗口文本
  let result = merged.map(w => content.slice(w.start, w.end)).join('…');

  // 限制总长度
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + '…';
  }

  return result || content.slice(0, maxChars);
}

async function checkWithFilter(prisma: PrismaClient, content: string): Promise<{ filtered: string; matched: string[] } | null> {
  const now = Date.now();
  if (!cachedFilter || now - shieldWordsCacheTime >= SHIELD_WORDS_CACHE_TTL) {
    const words = await prisma.shieldWord.findMany({ where: { enabled: true }, select: { word: true } });
    const wordList = words.map(w => w.word);
    cachedFilter = wordList.length > 0 ? buildShieldFilter(wordList) : null;
    shieldWordsCacheTime = now;
  }
  if (!cachedFilter) return null;
  return cachedFilter(content);
}


interface JoinRoomData {
  classroomCode: string;
  studentId: string;
  token?: string;
}

interface SendMessageData {
  classroomCode: string;
  studentId: string;
  content: string;
  fileUrl?: string;
  fileName?: string;
  fileUrls?: string[];
  fileNames?: string[];
}

const MAX_STUDENT_MESSAGE_LENGTH = 10_000;
const MAX_CHAT_ATTACHMENTS = 5;
const CHAT_UPLOAD_URL = /^\/uploads\/chat\/chat-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf|doc|docx|txt)$/i;

/**
 * Socket 事件不具备 HTTP 路由的参数校验，必须在进入 AI 代理前收紧边界。
 * 附件只接受本应用上传接口生成的聊天文件 URL，避免客户端伪造本地路径。
 */
export function validateStudentMessagePayload(value: unknown): SendMessageData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.classroomCode !== 'string' || !data.classroomCode.trim() ||
    typeof data.studentId !== 'string' || !data.studentId.trim() ||
    typeof data.content !== 'string' || !data.content.trim() ||
    data.content.length > MAX_STUDENT_MESSAGE_LENGTH
  ) return null;

  const rawUrls = Array.isArray(data.fileUrls)
    ? data.fileUrls
    : typeof data.fileUrl === 'string' ? [data.fileUrl] : [];
  if (rawUrls.length > MAX_CHAT_ATTACHMENTS || rawUrls.some(url => typeof url !== 'string' || !CHAT_UPLOAD_URL.test(url))) return null;

  const rawNames = Array.isArray(data.fileNames)
    ? data.fileNames
    : typeof data.fileName === 'string' ? [data.fileName] : [];
  if (rawNames.length > rawUrls.length || rawNames.some(name => typeof name !== 'string' || name.length > 255)) return null;

  return {
    classroomCode: data.classroomCode.trim(),
    studentId: data.studentId,
    content: data.content,
    fileUrls: rawUrls as string[],
    fileNames: rawNames as string[],
  };
}

/** 清理流式内容中的推理标签 */
function cleanStreamContent(text: string): string {
  let result = text;
  // 流式过程中可能出现的 <think> 不完整标签
  result = result.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '');
  return result;
}

/** 获取教室中已登录的学生 ID 列表 */
function getOnlineStudentIds(classroomId: string, connMap: Map<string, string>): string[] {
  const ids: string[] = [];
  for (const key of connMap.keys()) {
    const [cid, sid] = key.split(':');
    if (cid === classroomId) ids.push(sid);
  }
  return ids;
}

/**
 * 只允许当前登记的连接将学生标记为离线。
 * 新连接顶下旧连接时，旧 socket 的 disconnect 事件会随后到达；若不做此判断，会把新连接误标为离线。
 */
export function clearCurrentStudentConnection(connMap: Map<string, string>, connKey: string, socketId: string): boolean {
  if (connMap.get(connKey) !== socketId) return false;
  connMap.delete(connKey);
  return true;
}

/** 暂停或结束课堂时中止该课堂所有仍在进行的 AI 生成。 */
export function abortClassroomStreams(
  classroomId: string,
  connMap: Map<string, string>,
  streams: Map<string, AbortController>,
): number {
  let count = 0;
  for (const [key, socketId] of connMap) {
    if (!key.startsWith(`${classroomId}:`)) continue;
    const controller = streams.get(socketId);
    if (!controller) continue;
    controller.abort();
    streams.delete(socketId);
    count++;
  }
  return count;
}

/** 教师看板房间的前缀，与下面 join-teacher-board 及各处 io.to(`teacher:${id}`) 的写法一致。 */
const TEACHER_ROOM_PREFIX = 'teacher:';

/**
 * 「教师正在看探究助手视图」的房间后缀（规格 §5.5 的按需推流，Ruling 9）。
 *
 * ⚠️ **不能用 `teacher:<id>` 本身**：教师只要打开课堂看板就进了那个房间，而
 * 「在看探究助手视图」是更窄的一件事 —— 用宽的那个，会让每个只是开着看板的教师
 * 都触发全体学生推流，Ruling 9 的按需推流就白做了。
 *
 * ⚠️ **也不要换个前缀**（例如 `webapp:<id>`）来躲开 staleTeacherRooms：那个函数只清
 * `teacher:` 前缀的房间，换前缀等于让本房间**永远不被清理** —— 把一个静默的洞换成
 * 一个静默的泄漏。正确做法是让 staleTeacherRooms 认识它（这就是下面 keep 里那一行）。
 */
const WEBAPP_MONITOR_ROOM_SUFFIX = ':webapp';

/** 本课堂的探究助手监控房间名（只有 T7 的探究助手视图挂载时才 join）。 */
function webappMonitorRoom(classroomId: string): string {
  return `${TEACHER_ROOM_PREFIX}${classroomId}${WEBAPP_MONITOR_ROOM_SUFFIX}`;
}

/**
 * 该 socket 上「已经不是当前课堂」的教师看板房间 —— 换看板前要逐个 leave 掉。
 *
 * 教师的 socket 在前端是模块级单例（src/lib/socket.ts），从课堂 X 的看板导航到 Y 的看板时
 * 是**同一个 socket 再次 join**，而 Socket.IO 的 join 只加不减。不先离开旧房间的话，Y 的看板
 * 会持续收到 X 的 module-state-changed（载荷只有 moduleKey/state，没有 classroomId，
 * 客户端无从分辨是哪个课堂），表现为菜单里的三态单选按钮被另一个课堂改掉。
 * 修在服务端而不是给载荷加 classroomId：根因在这里，一次修好所有客户端，且不动协议。
 *
 * ⚠️ **保留的是当前课堂的「两种」房间**：`teacher:<id>` 与 `teacher:<id>:webapp`。
 * 两者都是「本课堂的教师房间」，本函数要清的本来就是**别的课堂**的。曾经只保留前者的
 * 写法会**每次都把探究助手监控房间也扫掉**（它以 `teacher:` 开头、又不等于 keep）：
 * 教师打开探究助手视图后，任何重新触发 join-teacher-board 的动作（effect 依赖变化、
 * 断线重连）都会把他踢出监控房间 ⇒ hasWatchers 归零 ⇒ 学生停止推流 ⇒ 教师看到
 * **一块冻住的图墙，全程没有任何报错**。回归用例见 webapp-monitor.test.ts。
 *
 * 只清 `teacher:` 前缀的房间：这个 socket 上我们只加过 `teacher:` 房间，过滤刻意保持窄 ——
 * 日后若真有客户端让同一个 socket 承担别的房间（例如学生在线列表用的 `status:<id>`，今天
 * 由教师首页自建的 socket 承担，不共用这个单例），不会被顺手清掉。
 */
export function staleTeacherRooms(rooms: Iterable<string>, currentClassroomId: string): string[] {
  const keep = new Set([
    `${TEACHER_ROOM_PREFIX}${currentClassroomId}`,
    webappMonitorRoom(currentClassroomId),
  ]);
  const stale: string[] = [];
  for (const room of rooms) {
    // keep.has：已经在当前课堂的房间里时不必先退出再进（join 本身幂等）。
    if (!keep.has(room) && room.startsWith(TEACHER_ROOM_PREFIX)) stale.push(room);
  }
  return stale;
}

// ══════════════════════════════════════════════════════════════════════════
// 探究助手实时监控的服务端内存态（规格 §5.5，Ruling 8 / Ruling 9）
//
// 链路：iframe(SDK) ──postMessage──▶ 学生端父页面 ──socket.io──▶ 这里的三个 Map
//       ──socket.io──▶ 教师看板的 teacher:<id>:webapp 房间
//
// ⚠️ **只存内存，不落盘**（规格 §5.5）。唯一的落盘项是课堂结束时的一次汇总，
// 由 drainWebappMonitor() + recordWebappSummary() 完成，见下面两个函数。
// ══════════════════════════════════════════════════════════════════════════

/** 一个学生在一个网页上的最新一帧。**覆盖式**：一个键恒为 1 条。 */
interface WebappFrameEntry {
  dataUrl: string;
  /** 服务端**收到**这一帧的时刻 —— 不用客户端时间戳，避免客户端时钟偏移污染时长。 */
  at: number;
  /** 本键**第一帧**的时刻，覆盖时保留：时长 = at - firstAt（见下）。 */
  firstAt: number;
}

/**
 * 累计计数，**不是流水账**。
 *
 * ⚠️ 存流水账（每个事件 push 进数组）会让内存随课堂时长线性增长，而教师看板上要显示的
 * 本来就是「点了多少次、滚到多深」。原始事件仍然**逐条转发**给教师房间（图墙抽屉要看
 * 事件流），但**不留存** —— 留存的是这里的计数。
 */
interface WebappCounterEntry {
  clicks: number;
  inputs: number;
  maxDepth: number;
  reports: number;
  /** 收到的帧**总数**（frames Map 里永远只有最新 1 条，这个数字是它的对照）。 */
  frames: number;
  /** 最后一次收到该学生该网页任何上报的时刻，TTL 裁剪用（见 pruneWebappMonitor）。 */
  lastAt: number;
}

const webappMonitor = {
  /**
   * key: `${classroomId}:${studentId}:${webappId}` —— 三个都是 uuid，不含冒号，
   * 所以按 `${classroomId}:` 前缀扫描既准确又便宜。
   *
   * 为什么 key 里要带 classroomId（brief 的内存模型里只写了 `${studentId}:${webappId}`）：
   * 释放是按**课堂**发生的（课堂结束 drain、TTL 裁剪），键里没有 classroomId 就只能
   * 遍历全部条目做反查，而**课堂结束释放**是规格 §5.5 的硬要求。
   */
  frames: new Map<string, WebappFrameEntry>(),
  counters: new Map<string, WebappCounterEntry>(),
  /** classroomId → 订阅了本课堂探究助手视图的 socketId 集合（Ruling 9 的记账）。 */
  watchers: new Map<string, Set<string>>(),
};

/**
 * 归零后的**防抖**窗口（Ruling 9 第 2 条）。
 *
 * 教师刷新页面会产生 0 → 1 → 0 的瞬时抖动：立刻通知学生停推，会让刚回来的教师看到
 * 一块空图墙，而且学生端也会白停一次（重新订阅后要等下一次 demand 才会恢复推流）。
 * 15 秒足够覆盖一次页面刷新的往返，又远短于「教师真的离开了」的判断尺度。
 */
const WEBAPP_DEMAND_DEBOUNCE_MS = 15_000;

/** classroomId → 待触发的「停止推流」定时器（订阅到达时取消）。 */
const pendingDemandTimers = new Map<string, NodeJS.Timeout>();

/**
 * 帧与计数的 TTL。存在的理由（预审 5）：课堂**可以不结束**（教师直接关掉浏览器），
 * 而 `index.ts` 是桌面端长期驻留的进程 —— 没有 TTL 的话那堂课的内存永不释放。
 * 与 pruneSocketCaches 的血缘见那里的注释（「避免桌面端长期运行时无界累积」）。
 *
 * 为什么是 6 小时而不是 10 分钟（NOTIFICATION_CACHE_TTL 那个量级）：通知缓存丢一条
 * 只是少显示一条提示，而这里丢一条会**让课后汇总缺数据**。6 小时覆盖任何一次真实
 * 课堂（含跨午休的连续使用）都不会被中途裁剪；而「教师关了浏览器」这个场景本来就
 * 只需要「最终会被回收」，不需要「及时回收」。
 */
const WEBAPP_MONITOR_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 帧与计数的内存边界 —— **这里的数字是实测的，不是估的**（7d）。
 *
 * 测法（`/tmp/cn-probes/canvas-frame.html`，Chrome headless 跑真实 canvas）：
 * 按本仓 SDK 的 thumbnail() 逐字同参（缩到宽 320 + `toDataURL('image/jpeg', 0.4)`），
 * 对 3 类真实教学页（图表页 / 仿真页 / 文字密集的学习单）× 4 种画布尺寸
 * （600x400 / 800x600 / 1024x768 / 1280x720）各截一帧，量 data URL 的字符数：
 *
 *   实测区间 **5299 – 15651 字符**（最小 1280x720 图表页、最大 600x400 仿真页）
 *
 * 两处换算（预审 3 点出的、计划漏算的两条）：
 *   · data URL 是 base64 ⇒ 解码后的 JPEG = 字符数 × 3/4 ≈ 4.0 – 11.7 KB
 *   · 但它**以 JS 字符串驻留内存**，V8 里是 UTF-16 ⇒ **每字符 2 字节**
 *     ⇒ 一帧常驻 ≈ **10.6 – 31.3 KB**
 *
 * ⇒ 40 人各一帧 ≈ **0.42 – 1.25 MB**。（计划里那个「≈600KB」没有任何测量依据；
 *   预审按「15KB JPEG」推算的 1.6MB 落在同一量级。两者都不该写进注释，实测的这个才该。）
 *   独立复算：把同一张缩略图的像素交给 PIL/libjpeg 重新编码 q40，得 9143 字符 vs
 *   Chrome 的 8679（+5%）—— 说明这个量级不是某一个编码器的产物。
 *   已知口径差：测的是 Chrome 的 libjpeg，学生端老 iPad 的 Safari 编码器不同，
 *   所以上面记的是**量级**而不是一个精确常量。
 *
 * 真正让它可接受的是**上界**而不是这个均值：每人每网页恒为 1 条（覆盖式），
 * 另有 6 小时 TTL 与课堂结束 drain 两重释放。
 *
 * 单帧字符数上限取 32K：与 SDK 自己的单条消息上限 MAX_PAYLOAD_CODE_UNITS
 * （`webapp-sdk.ts` 的 32 * 1024，口径同为 UTF-16 码元）**同一个数** —— SDK 能送出来的
 * 帧必然小于它，所以这条不是随手拍的上限，它是那条协议的镜像。它挡的是**恶意客户端**
 * 自己构造的超大 dataUrl（最坏 40 人 × 64KB 常驻 ≈ 2.5MB），不是正常路径。
 */
const MAX_WEBAPP_DATA_URL_CHARS = 32 * 1024;

/** 单条 webapp-event 里最多几条事件（拉长一次上报而不是高频小包是 SDK 的自由，但要有上界）。 */
const MAX_WEBAPP_EVENTS_PER_MESSAGE = 50;
/** selector 是结构定位串，正常几十字符；自由字符串必须有上界。 */
const MAX_WEBAPP_SELECTOR_CHARS = 200;
/** inputType / to 是短枚举字面量，给足余量。 */
const MAX_WEBAPP_SHORT_FIELD_CHARS = 64;
/** 只接受 data URL 形式的图片，不接 http(s) 链（那会把教师看板变成外链加载器）。 */
const WEBAPP_DATA_URL_PREFIX = 'data:image/';

/**
 * 允许的 kind 白名单 —— 与 SDK 的 buildEvent 调用点一一对应
 * （click / input / scroll / navigate / visibility），加 SDK 的 report()。
 * 不在表里的整条丢弃：**白名单**而不是黑名单，将来 SDK 加通道时要显式改这里。
 */
const WEBAPP_EVENT_KINDS = new Set(['click', 'input', 'scroll', 'navigate', 'visibility', 'report']);

/** 服务端侧的 WebappEvent —— 与 src/lib/socket-events.ts 的声明同形（两边是独立包，不互相 import）。 */
export interface WebappEvent {
  kind: string;
  selector: string;
  inputType: string;
  length: number;
  depth: number;
  to: string;
  at: number;
}

/** 课堂结束时写进 WebappUsage 的一行（谁、用了哪个网页、时长、交互次数）。 */
export interface WebappUsageRow {
  studentId: string;
  webappId: string;
  durationMs: number;
  clicks: number;
  inputs: number;
  maxDepth: number;
  reports: number;
  frameCount: number;
}

function webappKey(classroomId: string, studentId: string, webappId: string): string {
  return `${classroomId}:${studentId}:${webappId}`;
}

/** 从组合键里取回 studentId / webappId（前两段之外的都算 webappId，容错不抛错）。 */
function splitWebappKey(key: string, classroomId: string): { studentId: string; webappId: string } | null {
  const rest = key.slice(classroomId.length + 1).split(':');
  if (rest.length < 2) return null;
  return { studentId: rest[0], webappId: rest.slice(1).join(':') };
}

function clampNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function clampString(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

/**
 * 把一条来自学生浏览器的原始事件收成契约形状。
 *
 * ⚠️ **白名单式重建，不是挑字段改**：socket 事件没有 HTTP 层的参数校验，而这条数据
 * 来自学生机器上的任意页面（教师网页里也能跑 JS）。逐字段重建 ⇒ 客户端塞不进
 * 契约之外的东西（超大字符串、嵌套对象、`__proto__` 之类），落在服务端内存里的
 * 形状与大小都是这里说了算的。
 */
export function sanitizeWebappEvent(value: unknown): WebappEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!WEBAPP_EVENT_KINDS.has(kind)) return null;
  return {
    kind,
    selector: clampString(raw.selector, MAX_WEBAPP_SELECTOR_CHARS),
    inputType: clampString(raw.inputType, MAX_WEBAPP_SHORT_FIELD_CHARS),
    length: clampNumber(raw.length),
    depth: clampNumber(raw.depth),
    to: clampString(raw.to, MAX_WEBAPP_SHORT_FIELD_CHARS),
    at: clampNumber(raw.at),
  };
}

/** 校验 webapp-event 的外层形状；事件数组为空 / 全被过滤掉都按「没有可上报的东西」丢弃。 */
export function validateWebappEventPayload(value: unknown): { classroomId: string; webappId: string; events: WebappEvent[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const classroomId = typeof raw.classroomId === 'string' ? raw.classroomId.trim() : '';
  const webappId = typeof raw.webappId === 'string' ? raw.webappId.trim() : '';
  if (!classroomId || !webappId) return null;
  if (!Array.isArray(raw.events) || raw.events.length === 0 || raw.events.length > MAX_WEBAPP_EVENTS_PER_MESSAGE) return null;
  const events: WebappEvent[] = [];
  for (const item of raw.events) {
    const event = sanitizeWebappEvent(item);
    if (event) events.push(event);
  }
  if (events.length === 0) return null;
  return { classroomId, webappId, events };
}

/** 校验 webapp-frame 的形状（只接 data URL 形式的图片，且有长度上界）。 */
export function validateWebappFramePayload(value: unknown): { classroomId: string; webappId: string; dataUrl: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const classroomId = typeof raw.classroomId === 'string' ? raw.classroomId.trim() : '';
  const webappId = typeof raw.webappId === 'string' ? raw.webappId.trim() : '';
  if (!classroomId || !webappId) return null;
  const dataUrl = raw.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(WEBAPP_DATA_URL_PREFIX)) return null;
  if (dataUrl.length > MAX_WEBAPP_DATA_URL_CHARS) return null;
  return { classroomId, webappId, dataUrl };
}

/** watch / unwatch 共用的载荷形状校验。 */
export function validateWebappWatchPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const classroomId = typeof raw.classroomId === 'string' ? raw.classroomId.trim() : '';
  return classroomId || null;
}

/**
 * 本课堂是否有教师在看探究助手视图（Ruling 9 的按需推流判据）。
 *
 * 房间空时 Socket.IO 会把房间删掉 ⇒ `get()` 返回 undefined ⇒ 必须有 `?? 0`。
 *
 * ⚠️ 判据是**房间**而不是下面 watchers 那个 Map：房间是 Socket.IO 自己维护的，
 * 断线、离开都自动生效；Map 只是记账（谁订阅过、TTL 与 drain 要清哪些课堂）。
 * 两者必须一致 —— webapp-monitor.test.ts 里有一条用例专门把两者钉在一起。
 */
export function hasWatchers(io: Server, classroomId: string): boolean {
  return (io.sockets.adapter.rooms.get(webappMonitorRoom(classroomId))?.size ?? 0) > 0;
}

/** 订阅到达：取消待触发的「停止推流」。 */
export function cancelDemandNotification(classroomId: string): void {
  const timer = pendingDemandTimers.get(classroomId);
  if (!timer) return;
  clearTimeout(timer);
  pendingDemandTimers.delete(classroomId);
}

/**
 * watchers 归零后**延迟**通知学生停推（Ruling 9 第 2 条）。
 *
 * 已经有了待触发的定时器就不重置 —— 否则持续抖动（每次刷新都重新计时）会让
 * 停止通知永远推不出去，学生端一直白推。
 */
export function scheduleDemandNotification(io: Server, classroomId: string): void {
  if (pendingDemandTimers.has(classroomId)) return;
  const timer = setTimeout(() => {
    pendingDemandTimers.delete(classroomId);
    // 期间又有人订阅就什么都不做（订阅那条路径已经 cancel 过了，这里是二重保险）。
    if (hasWatchers(io, classroomId)) return;
    io.to(`classroom:${classroomId}`).emit('webapp-monitor-demand', { watching: false });
  }, WEBAPP_DEMAND_DEBOUNCE_MS);
  // unref：这是一个纯粹的「延迟通知」，不该在关闭流程里把一个已经没人等的进程钉住
  // 15 秒（同 :302 的 cacheCleanupTimer）。node:test 的 mock timers 也提供 unref。
  timer.unref();
  pendingDemandTimers.set(classroomId, timer);
}

/** 把一个学生的一次上报累加进内存（帧走覆盖，事件走计数）。 */
function accumulateWebappEvents(
  classroomId: string,
  studentId: string,
  webappId: string,
  events: WebappEvent[],
  now: number,
): void {
  const key = webappKey(classroomId, studentId, webappId);
  const counter = webappMonitor.counters.get(key) ?? { clicks: 0, inputs: 0, maxDepth: 0, reports: 0, frames: 0, lastAt: now };
  for (const event of events) {
    if (event.kind === 'click') counter.clicks += 1;
    else if (event.kind === 'input') counter.inputs += 1;
    else if (event.kind === 'scroll') counter.maxDepth = Math.max(counter.maxDepth, event.depth);
    else if (event.kind === 'report') counter.reports += 1;
    // navigate / visibility 只转发不计数：规格要的汇总项是「时长 + 交互次数」，
    // 而时长另由首帧→末帧给出（见 WebappUsage.durationMs 的注释）。
  }
  counter.lastAt = now;
  webappMonitor.counters.set(key, counter);
}

/**
 * 帧**只留最新一帧**：同一把键再进来就是覆盖，不是追加。
 *
 * 这条不是优化而是内存上界本身 —— 40 人 × 每帧 ~10-31KB（见上面的实测注释），
 * 追加式存储会让内存随课堂时长线性增长。
 *
 * counter.frames 仍然累加：内存里只留 1 条，**收到的总数**在计数里（课后汇总要用）。
 */
function storeWebappFrame(classroomId: string, studentId: string, webappId: string, dataUrl: string, now: number): void {
  const key = webappKey(classroomId, studentId, webappId);
  const previous = webappMonitor.frames.get(key);
  webappMonitor.frames.set(key, { dataUrl, at: now, firstAt: previous ? previous.firstAt : now });
  const counter = webappMonitor.counters.get(key) ?? { clicks: 0, inputs: 0, maxDepth: 0, reports: 0, frames: 0, lastAt: now };
  counter.frames += 1;
  counter.lastAt = now;
  webappMonitor.counters.set(key, counter);
}

/** TTL 裁剪（由 pruneSocketCaches 驱动）。 */
function pruneWebappMonitor(now: number): void {
  const cutoff = now - WEBAPP_MONITOR_TTL_MS;
  for (const [key, frame] of webappMonitor.frames) {
    if (frame.at <= cutoff) webappMonitor.frames.delete(key);
  }
  for (const [key, counter] of webappMonitor.counters) {
    if (counter.lastAt <= cutoff) webappMonitor.counters.delete(key);
  }
  // 空 Set 只可能在「订阅者的 disconnect 没跑到」时出现；正常路径上 disconnect 会删掉
  // 整个键。这里兜底，避免 Map 本身随课堂数无界增长。
  for (const [classroomId, socketIds] of webappMonitor.watchers) {
    if (socketIds.size === 0) webappMonitor.watchers.delete(classroomId);
  }
}

/** 测试与诊断用：读一条帧 / 一条计数（不改变内存）。 */
export function peekWebappMonitor(classroomId: string, studentId: string, webappId: string): { frame: WebappFrameEntry | null; counter: WebappCounterEntry | null } {
  const key = webappKey(classroomId, studentId, webappId);
  return { frame: webappMonitor.frames.get(key) ?? null, counter: webappMonitor.counters.get(key) ?? null };
}

/** 测试与诊断用：某个课堂当前的内存条目数。 */
export function webappMonitorSizes(classroomId: string): { frames: number; counters: number; watchers: number } {
  const prefix = `${classroomId}:`;
  let frames = 0;
  let counters = 0;
  for (const key of webappMonitor.frames.keys()) if (key.startsWith(prefix)) frames += 1;
  for (const key of webappMonitor.counters.keys()) if (key.startsWith(prefix)) counters += 1;
  return { frames, counters, watchers: webappMonitor.watchers.get(classroomId)?.size ?? 0 };
}

/**
 * 取走本课堂的全部监控数据并**清空**它（规格 §5.5「课堂结束释放」）。
 *
 * 由 HTTP 路由在课堂结束那条路径上调用 —— 内存态在本模块、结束逻辑在 routes/classroom.ts，
 * 两者不在同一个模块（预审 2）。经 `app.set('webappMonitor', …)` 暴露给路由，照
 * activeConnections / activeStreams 的既有做法，而不是让路由 import 本模块的内部状态。
 *
 * 时长口径：**首帧 → 末帧**（不是用 visibility 事件累计前台时长）。两种算法都受
 * 「按需推流」影响 —— 没有教师在看时学生根本不推，两种算法都看不到那段区间；
 * 首帧→末帧少一次状态机，且得到的是墙上时钟跨度（会把中途的间隔算进去）。
 * 选它，并且在 WebappUsage.durationMs 的注释里写明了这个口径。
 */
export function drainWebappMonitor(classroomId: string): WebappUsageRow[] {
  const prefix = `${classroomId}:`;
  const rows = new Map<string, WebappUsageRow>();

  for (const [key, counter] of webappMonitor.counters) {
    if (!key.startsWith(prefix)) continue;
    const ids = splitWebappKey(key, classroomId);
    webappMonitor.counters.delete(key);
    if (!ids) continue;
    rows.set(`${ids.studentId}:${ids.webappId}`, {
      studentId: ids.studentId,
      webappId: ids.webappId,
      durationMs: 0,
      clicks: counter.clicks,
      inputs: counter.inputs,
      maxDepth: counter.maxDepth,
      reports: counter.reports,
      frameCount: counter.frames,
    });
  }

  for (const [key, frame] of webappMonitor.frames) {
    if (!key.startsWith(prefix)) continue;
    const ids = splitWebappKey(key, classroomId);
    webappMonitor.frames.delete(key);
    if (!ids) continue;
    const row = rows.get(`${ids.studentId}:${ids.webappId}`) ?? {
      studentId: ids.studentId,
      webappId: ids.webappId,
      durationMs: 0,
      clicks: 0,
      inputs: 0,
      maxDepth: 0,
      reports: 0,
      frameCount: 0,
    };
    // 帧数由 counters 记（这里只是补一条「只发过帧、没发过事件」的行）；
    // durationMs 只在这一处算，用的是服务端收到首帧与末帧的时刻。
    row.durationMs = Math.max(0, frame.at - frame.firstAt);
    rows.set(`${ids.studentId}:${ids.webappId}`, row);
  }

  webappMonitor.watchers.delete(classroomId);
  // 待触发的「停止推流」必须一起取消：否则 15 秒后会给一个**已经结束**的课堂
  // 广播 watching:false（无害但没意义），且定时器会一直挂到那时。
  cancelDemandNotification(classroomId);

  return [...rows.values()];
}

/**
 * 唯一落盘项（规格 §5.5）：把 drain 出来的汇总写进 WebappUsage。
 *
 * `createMany` 而不是逐条 upsert：一个参与者在一次课堂里对一个网页只有一行，
 * 而课堂结束这条路径本身只可能成功一次（状态机在路由里把守）。表上的
 * `@@unique([classroomId, studentId, webappId])` 是「万一重放也不会写重」的兜底。
 *
 * ⚠️ 抛错由调用方处理（路由那边已经结束课堂、无法回滚，所以它记日志而不是报 500）。
 */
export async function recordWebappSummary(prisma: PrismaClient, classroomId: string, rows: WebappUsageRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await prisma.webappUsage.createMany({
    data: rows.map(row => ({
      classroomId,
      webappId: row.webappId,
      studentId: row.studentId,
      durationMs: row.durationMs,
      clicks: row.clicks,
      inputs: row.inputs,
      maxDepth: row.maxDepth,
      reports: row.reports,
      frameCount: row.frameCount,
    })),
  });
  return rows.length;
}

export function setupSocketHandlers(io: Server, prisma: PrismaClient, app?: import('express').Application) {
  // 追踪每个学生的活跃连接，key: `${classroomId}:${studentId}`
  const activeConnections = new Map<string, string>();
  // 暴露给 HTTP 路由使用
  if (app) {
    app.set('activeConnections', activeConnections);
    app.set('activeStreams', activeStreams);
    // 探究助手的内存态住在**本模块**，而「课堂结束」在 routes/classroom.ts（预审 2）。
    // 照上面两行的既有做法经 app.set 暴露，而不是让路由 import 本模块的内部状态。
    app.set('webappMonitor', { drain: drainWebappMonitor, record: recordWebappSummary });
  }
  const cacheCleanupTimer = setInterval(() => pruneSocketCaches(), NOTIFICATION_CACHE_TTL);
  cacheCleanupTimer.unref();
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // 身份选择页监听课堂在线状态（无需身份）
    socket.on('listen-classroom-status', (classroomId: string) => {
      socket.join(`status:${classroomId}`);
      socket.emit('online-students', { classroomId, studentIds: getOnlineStudentIds(classroomId, activeConnections) });
    });

    // 学生加入课堂
    socket.on('join-classroom', async (data: JoinRoomData) => {
      try {
        const classroom = await prisma.classroom.findUnique({
          where: { code: data.classroomCode },
          include: {
            classroomAgents: { include: { agent: true } },
            groups: { include: { agent: true } },
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
          return;
        }

        const studentSession = verifyStudentToken(data.token);
        if (!studentSession || studentSession.classroomId !== classroom.id || studentSession.studentId !== data.studentId) {
          socket.emit('student-auth-error', { error: '学生会话已失效，请重新选择身份' });
          return;
        }

        // 令牌签发后教师仍可能调整课堂成员；加入实时课堂前必须再次确认归属。
        const classroomStudent = await prisma.classroomStudent.findFirst({
          where: { classroomId: classroom.id, id: data.studentId },
        });
        if (!classroomStudent) {
          socket.emit('student-auth-error', { error: '你已不在当前课堂，请重新选择身份' });
          return;
        }

        // 同一学生重复连接时，断开旧连接，保留新连接
        const connKey = `${classroom.id}:${classroomStudent.id}`;
        const oldSocketId = activeConnections.get(connKey);
        if (oldSocketId && oldSocketId !== socket.id) {
          try { io.sockets.sockets.get(oldSocketId)?.emit('ai-error', { error: '账号已在其他设备登录' }); } catch {}
          try { io.sockets.sockets.get(oldSocketId)?.disconnect(true); } catch {}
        }

        // 记录新连接
        activeConnections.set(connKey, socket.id);

        // 更新学生状态
        await prisma.classroomStudent.updateMany({
          where: {
            classroomId: classroom.id,
            id: data.studentId,
          },
          data: { status: 'online' },
        });

        socket.join(`classroom:${classroom.id}`);
        if (classroomStudent.studentId) socket.join(`student:${classroomStudent.studentId}`);
        socket.data.classroomId = classroom.id;
        socket.data.studentId = classroomStudent.id;

        socket.emit('joined', {
          classroomId: classroom.id,
          agents: classroom.classroomAgents.map((ca: Prisma.ClassroomAgentGetPayload<{ include: { agent: true } }>) => ({
            id: ca.agent.id,
            name: ca.agent.name,
            logo: ca.agent.logo,
            platform: ca.agent.platform,
          })),
          groups: classroom.groups,
          blacklisted: classroomStudent?.blacklisted || false,
        });

        // 若已被黑屏，立即通知学生端
        if (classroomStudent?.blacklisted) {
          socket.emit('student-blacklisted', { studentId: classroomStudent.id });
        }

        // 重放教师缓存通知（断开连接期间错过的消息）
        try {
          const cached = teacherNotificationCache.get(classroom.id);
          if (cached && cached.length > 0) {
            const validCutoff = Date.now() - NOTIFICATION_CACHE_TTL;
            for (const n of cached) {
              // 只放行全班广播（studentId===null）或发给当前学生的通知
              if (n.timestamp > validCutoff && (n.studentId === null || n.studentId === classroomStudent.id)) {
                socket.emit('teacher-notification', { id: n.id, message: n.message });
              }
            }
          }
        } catch {}

        // 通知教师端
        io.to(`teacher:${classroom.id}`).emit('student-online', {
          studentId: classroomStudent.id,
          socketId: socket.id,
        });

        // 广播在线状态给身份选择页
        io.to(`status:${classroom.id}`).emit('online-students', { classroomId: classroom.id, studentIds: getOnlineStudentIds(classroom.id, activeConnections) });

        // 探究助手按需推流的**初始状态**（规格 §5.5 / Ruling 9）。
        // 学生端默认不推，由这条消息决定要不要开始 —— 少了它，「教师先开看板、学生后进课堂」
        // 这个顺序下学生永远等不到 watching:true，图墙会一直空着且没有任何报错。
        // 不做「本课堂有没有关联网页」的判断：那要多一次查询，而这条消息只有几十字节。
        socket.emit('webapp-monitor-demand', { watching: hasWatchers(io, classroom.id) });

        console.log(`[Socket] Participant ${classroomStudent.id} joined classroom ${classroom.id}`);
      } catch (error) {
        console.error('[Socket] join-classroom error:', error);
        socket.emit('ai-error', { error: '加入课堂失败' });
      }
    });

    // 教师加入课堂看板
    socket.on('join-teacher-board', async (classroomId: string) => {
      if (!hasTeacherSessionCookie(socket.handshake.headers.cookie)) {
        socket.emit('teacher-auth-error', { error: '教师会话已失效，请重新登录' });
        return;
      }
      // 先离开上一个课堂的看板房间再进新的：join 只加不减，不清理的话本 socket 会同时待在
      // teacher:X 与 teacher:Y 两个房间里，两个课堂的模块状态广播都会推过来。
      // 放在鉴权之后：会话失效的请求不得造成任何房间变更。
      for (const room of staleTeacherRooms(socket.rooms, classroomId)) {
        socket.leave(room);
        // 被离开的若正好是**探究助手监控房间**，记账与「按需推流」都得跟着走。
        // 少了这一段就是一条静默的泄漏：教师从 X 的看板直接切到 Y 的看板（或任何让
        // staleTeacherRooms 代劳退房的路径）时，X 的房间没了、watchers 还留着 →
        // hasWatchers(X) 虽然会正确变 false，但**没有任何人通知 X 的学生停推**
        // （unwatch / disconnect 那两条路才发通知）。学生就一直推。
        if (!room.endsWith(WEBAPP_MONITOR_ROOM_SUFFIX)) continue;
        const watchedClassroomId = room.slice(TEACHER_ROOM_PREFIX.length, room.length - WEBAPP_MONITOR_ROOM_SUFFIX.length);
        const socketIds = webappMonitor.watchers.get(watchedClassroomId);
        if (socketIds) {
          socketIds.delete(socket.id);
          if (socketIds.size === 0) webappMonitor.watchers.delete(watchedClassroomId);
        }
        if (!hasWatchers(io, watchedClassroomId)) scheduleDemandNotification(io, watchedClassroomId);
      }
      socket.join(`teacher:${classroomId}`);
      socket.data.classroomId = classroomId;
      socket.data.isTeacher = true;
      console.log(`[Socket] Teacher joined board: ${classroomId}`);
    });

    // ══════════════════════════════════════════════════════════════════════
    // 探究助手实时监控（规格 §5.5）
    // ══════════════════════════════════════════════════════════════════════

    /**
     * 上报者归属校验 —— 三步，任何一步不过就整条丢弃（不回报具体原因）：
     *
     *   1. socket 会话：classroomId 必须与 join-classroom 时记下的一致，且本 socket
     *      确实在 `classroom:<id>` 房间里（= 走完了完整的加入流程）。
     *   2. 复查课堂成员：令牌签发后教师仍可能调整课堂成员，照 join-classroom :328-341
     *      的第二步再查一次 ClassroomStudent。
     *   3. **复查网页归属**：这个课堂必须真的关联了这个 webappId。少了这一步，学生可以
     *      拿任意 webappId 上报，污染**别的网页**的统计与汇总（brief 明写的必须项）。
     *
     * ⚠️ 这里**不**重放 verifyStudentToken：学生会话的凭据在 join-classroom 时已经验过
     * 一次（socket.data 就是那次验证的产物），而令牌只有 2 小时有效 —— 再验一次会给
     * 超过 2 小时的课堂加一条**静默**的截止线（chat 照常、监控悄悄停），
     * 而安全上并没有多买到东西（socket 会话本身不可伪造）。
     *
     * 失败**不 emit 任何错误事件**：探究助手是学生端的次要通道，一条 auth 错误弹窗打断
     * 学生做题是净损失；而「这个 webappId 属不属于本课堂」也不该变成可探测的信息。
     */
    async function resolveWebappReporter(classroomId: string, webappId: string) {
      if (!socket.data.studentId || socket.data.classroomId !== classroomId) return null;
      if (!socket.rooms.has(`classroom:${classroomId}`)) return null;
      const membership = await prisma.classroomStudent.findFirst({
        where: { classroomId, id: socket.data.studentId },
        select: { id: true },
      });
      if (!membership) return null;
      const linked = await prisma.classroomWebapp.findFirst({
        where: { classroomId, webappId },
        select: { id: true },
      });
      if (!linked) return null;
      return { classroomId, studentId: membership.id };
    }

    /**
     * 学生的结构事件上报。
     *
     * **先累加、后看有没有人订阅**：内存里留下的是计数（有界），而「按需推流」管的是
     * **转发**。理由见下面那行注释 —— 反过来（没人看就不记）会让课后汇总在教师没开
     * 看板时整批为空，而汇总正是本模块唯一的落盘项。
     */
    socket.on('webapp-event', async (data: unknown) => {
      try {
        const payload = validateWebappEventPayload(data);
        if (!payload) return;
        const reporter = await resolveWebappReporter(payload.classroomId, payload.webappId);
        if (!reporter) return;

        accumulateWebappEvents(reporter.classroomId, reporter.studentId, payload.webappId, payload.events, Date.now());

        // 按需推流：没有教师在看探究助手视图时**一个字节都不转发**（Ruling 9）。
        // 注意这不是省内存的手段 —— 学生端的「零开销」靠的是 webapp-monitor-demand
        // 让它在源头就不发；这一行挡的是「学生还在发（刚订阅/刚恢复）而教师已经走了」。
        if (!hasWatchers(io, reporter.classroomId)) return;

        io.to(webappMonitorRoom(reporter.classroomId)).emit('webapp-student-event', {
          studentId: reporter.studentId,
          webappId: payload.webappId,
          events: payload.events,
        });
      } catch (error) {
        console.error('[Socket] webapp-event error:', error);
      }
    });

    /** 学生的缩略图帧上报（每个键只留最新一帧，见 storeWebappFrame）。 */
    socket.on('webapp-frame', async (data: unknown) => {
      try {
        const payload = validateWebappFramePayload(data);
        if (!payload) return;
        const reporter = await resolveWebappReporter(payload.classroomId, payload.webappId);
        if (!reporter) return;

        const now = Date.now();
        storeWebappFrame(reporter.classroomId, reporter.studentId, payload.webappId, payload.dataUrl, now);

        if (!hasWatchers(io, reporter.classroomId)) return;
        io.to(webappMonitorRoom(reporter.classroomId)).emit('webapp-student-frame', {
          studentId: reporter.studentId,
          webappId: payload.webappId,
          dataUrl: payload.dataUrl,
          // at 用**服务端**收到的时刻，不用客户端时间戳：图墙上的新旧排序不能由学生机器的时钟决定。
          at: now,
        });
      } catch (error) {
        console.error('[Socket] webapp-frame error:', error);
      }
    });

    /**
     * 教师订阅 / 取消订阅本课堂的探究助手视图（T7 的视图挂载与卸载）。
     *
     * 订阅：鉴权 + 必须是本课堂的教师会话，然后 join `teacher:<id>:webapp`
     *      （按需推流的判据就是这个房间）+ 立刻广播 watching:true，
     *      否则先开看板的教师永远等不到学生推流。
     */
    socket.on('watch-webapp-monitor', (data: unknown) => {
      const classroomId = validateWebappWatchPayload(data);
      if (!classroomId) return;
      if (!socket.data.isTeacher || socket.data.classroomId !== classroomId || !hasTeacherSessionCookie(socket.handshake.headers.cookie)) {
        socket.emit('teacher-auth-error', { error: '无权订阅探究助手监控' });
        return;
      }
      if (!webappMonitor.watchers.has(classroomId)) webappMonitor.watchers.set(classroomId, new Set());
      webappMonitor.watchers.get(classroomId)!.add(socket.id);
      socket.join(webappMonitorRoom(classroomId));
      // 有人回来了：取消待触发的「停止推流」（Ruling 9 第 2 条的防抖）。
      cancelDemandNotification(classroomId);
      io.to(`classroom:${classroomId}`).emit('webapp-monitor-demand', { watching: true });
      console.log(`[Socket] Teacher watching webapp monitor: ${classroomId}`);
    });

    /**
     * 取消订阅。
     *
     * ⚠️ 这里**故意不做鉴权**，与订阅不对称：离开是一个**降级**动作，永远不会多给出
     * 任何权限；而如果因为它失败了（教师会话刚好过期，或 T7 卸载时 socket 已重连），
     * 房间就永远留着 → hasWatchers 恒为真 → **学生端一直推流**（T7 brief 明写
     * 「unwatch 不能省」说的就是这个）。降级动作失败的方向必须是安全的那一侧。
     */
    socket.on('unwatch-webapp-monitor', (data: unknown) => {
      const classroomId = validateWebappWatchPayload(data);
      if (!classroomId) return;
      const socketIds = webappMonitor.watchers.get(classroomId);
      if (socketIds) {
        socketIds.delete(socket.id);
        if (socketIds.size === 0) webappMonitor.watchers.delete(classroomId);
      }
      socket.leave(webappMonitorRoom(classroomId));
      if (!hasWatchers(io, classroomId)) scheduleDemandNotification(io, classroomId);
    });

    // 学生发送消息（流式）
    socket.on('send-message', async (input: SendMessageData) => {
      try {
        const data = validateStudentMessagePayload(input);
        if (!data) {
          socket.emit('ai-error', { error: '消息或附件格式无效' });
          return;
        }
        if (!socket.data.classroomId || !socket.data.studentId || socket.data.studentId !== data.studentId) {
          socket.emit('student-auth-error', { error: '学生身份无效，请重新进入课堂' });
          return;
        }
        const classroom = await prisma.classroom.findUnique({
          where: { code: data.classroomCode },
          include: {
            classroomAgents: {
              include: { agent: true },
            },
            groups: {
              include: { agent: true },
            },
          },
        });

        if (!classroom || classroom.status === 'ended') {
          socket.emit('ai-error', { error: '课堂不存在或已结束' });
          return;
        }
        if (classroom.id !== socket.data.classroomId) {
          socket.emit('student-auth-error', { error: '课堂身份不匹配' });
          return;
        }

        if (classroom.status === 'paused') {
          socket.emit('ai-error', { error: '课堂已暂停，请等待老师继续' });
          return;
        }

        const classroomStudent = await prisma.classroomStudent.findFirst({
          where: {
            classroomId: classroom.id,
            // 客户端与学生会话中传递的是 ClassroomStudent 的参与记录 ID，
            // 而不是基础 Student 表的 ID。两者混用会让已成功加入课堂的学生
            // 在发送第一条消息时又被误判为“不存在”。
            id: data.studentId,
          },
          include: { student: true, group: true },
        });

        if (!classroomStudent) {
          socket.emit('ai-error', { error: '未找到学生记录' });
          return;
        }

        const studentName = classroomStudent.student?.name || classroomStudent.group?.name || '未命名小组';
        const displayParticipantId = classroomStudent.id;
        // Shield word check
        // Check if student is blacklisted
        if (classroomStudent.blacklisted) {
          socket.emit('ai-error', { error: '你已被老师黑屏处理，暂时无法发送消息' });
          socket.emit('student-blacklisted', { studentId: data.studentId });
          return;
        }
        // Load shield words and check content (使用预构建 AC 自动机)
        const shieldResult = await checkWithFilter(prisma, data.content);
        if (shieldResult && shieldResult.matched.length > 0) {
          const { filtered, matched } = shieldResult;
          if (matched.length > 0) {
            // 记录原文后再替换为过滤版（Warning 存原文供教师查阅）
            const originalContent = data.content;
            data.content = filtered;
            // Save the filtered user message
            const filteredMessage = await prisma.message.create({
              data: {
                classroomId: classroom.id,
                studentId: classroomStudent.id,
                content: filtered,
                role: 'user',
                displayName: anonymizer.anonymize(studentName),
              },
            });
            // Broadcast filtered message to teacher
            io.to(`teacher:${classroom.id}`).emit('student-message', {
              studentId: displayParticipantId,
              studentName,
              content: filtered,
              role: 'user',
              messageId: filteredMessage.id,
              timestamp: filteredMessage.createdAt,
              shieldFiltered: true,
            });
            // Create warning record with original content + matched words
            await prisma.shieldWarning.create({
              data: {
                classroomId: classroom.id,
                studentId: classroomStudent.id,
                word: matched.join(', '),
                content: extractContextAroundMatch(originalContent, matched, 200),
              },
            });
            // Increment warning count (原子操作，使用返回值确保准确)
            const updatedCS = await prisma.classroomStudent.update({
              where: { id: classroomStudent.id },
              data: { warningCount: { increment: 1 } },
            });
            const newWarningCount = updatedCS.warningCount;
            // Emit warning to teacher
            io.to(`teacher:${classroom.id}`).emit('shield-warning', {
              studentId: displayParticipantId,
              studentName,
              matched,
              filteredContent: filtered,
              warningCount: newWarningCount,
              classroomId: classroom.id,
            });
            // Emit warning to student (without revealing the actual words)
            io.to(socket.id).emit('shield-warned', {
              filteredContent: filtered,
              warningCount: newWarningCount,
              studentName,
            });
            // Check auto-blacklist threshold
            const shieldConfig = await prisma.shieldConfig.findFirst();
            const threshold = shieldConfig?.autoBlackCount || 0;
            if (threshold > 0 && newWarningCount >= threshold) {
              await prisma.classroomStudent.update({
                where: { id: classroomStudent.id },
                data: { blacklisted: true },
              });
              io.to(`teacher:${classroom.id}`).emit('student-blacklisted', { studentId: data.studentId, studentName, autoBlack: true });
              io.to(socket.id).emit('student-blacklisted', { studentId: data.studentId });
              io.to(socket.id).emit('ai-error', { error: `你已被自动黑屏（累计触发 ${threshold} 次）` });
            }
            // Do NOT proceed to AI call
            return;
          }
        }

        // Determine agent: for group/advanced mode, use the group's agent; otherwise use the first classroom agent
        let agent;
        if ((classroom.mode === 'group' || classroom.mode === 'advanced') && classroomStudent.group?.agentId) {
          const classroomGroup = classroom.groups.find(g => g.id === classroomStudent.groupId);
          agent = classroomGroup?.agent || null;
        } else {
          agent = classroom.classroomAgents[0]?.agent;
        }
        if (!agent) {
          socket.emit('ai-error', { error: '未配置AI智能体' });
          return;
        }

        // 智能体被停用时不调用 AI，给出温馨提示
        if (agent.enabled === false) {
          // 保存用户消息（保留对话记录）
          const userMessage = await prisma.message.create({
            data: {
              classroomId: classroom.id,
              studentId: classroomStudent.id,
              content: data.content,
              role: 'user',
              displayName: anonymizer.anonymize(studentName),
              fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
              fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
            },
          });
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId, studentName,
            content: data.content, role: 'user',
            messageId: userMessage.id, timestamp: userMessage.createdAt,
            fileUrls: data.fileUrls, fileNames: data.fileNames,
          });
          io.to(socket.id).emit('agent-disabled', {
            agentName: agent.name,
          });
          return;
        }

        // 提问频率限制（被屏蔽的消息不计入）
        if (!(await checkRateLimit(data.studentId, prisma))) {
          socket.emit('ai-error', { error: `提问太频繁了，请稍后再试（每分钟限 ${cachedRateLimit} 次）` });
          return;
        }

        // AI Proxy call (流式)
        // 先取历史再存消息，确保 additional_messages 不含当前消息，避免重复
        const pastMessages = await prisma.message.findMany({
          where: { studentId: classroomStudent.id },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });

        // 取最近 30 条消息（约 15 轮对话），反转回正序
        const recentHistory = pastMessages.reverse();
        const formattedHistory = recentHistory.map((h: Prisma.MessageGetPayload<object>) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        }));

        // 计算 roundCount：统计 DB 中所有 user 消息数 + 1（当前消息还没存）
        const pastUserCount = await prisma.message.count({
          where: { studentId: classroomStudent.id, role: 'user' },
        });
        const roundCount = pastUserCount + 1;

        // Save user message
        const userMessage = await prisma.message.create({
          data: {
            classroomId: classroom.id,
            studentId: classroomStudent.id,
            content: data.content,
            role: 'user',
            displayName: anonymizer.anonymize(studentName),
            fileUrls: data.fileUrls?.length ? JSON.stringify(data.fileUrls) : undefined,
            fileNames: data.fileNames?.length ? JSON.stringify(data.fileNames) : undefined,
          },
        });

        // Broadcast to teacher board
        io.to(`teacher:${classroom.id}`).emit('student-message', {
          studentId: data.studentId,
          studentName,
          content: data.content,
          role: 'user',
          roundIndex: roundCount,
          messageId: userMessage.id,
          timestamp: userMessage.createdAt,
          fileUrls: data.fileUrls,
          fileNames: data.fileNames,
        });

        // 通知学生正在思考
        io.to(`teacher:${classroom.id}`).emit('student-thinking', {
          studentId: data.studentId,
          status: true,
        });

        // Send to student that AI is thinking
        io.to(socket.id).emit('ai-thinking');

        // 智谱清言 / 文心使用对话上下文 ID 维护记忆，从内存中恢复
        const platformNeedsConvId = ['coze', 'zhipuai', 'wenxin'].includes(agent.platform);
        const platformConvKey = `${classroom.id}:${data.studentId}:${agent.id}`;
        const storedConversation = platformConversations.get(platformConvKey);
        const platformConvId = storedConversation?.conversationId;
        const agentConfig: AgentConfig = {
          platform: agent.platform,
          apiUrl: agent.apiUrl || undefined,
          apiKey: (() => { try { return decrypt(agent.apiKey); } catch { return agent.apiKey; } })(),
          botId: agent.botId || undefined,
          extra: agent.extra || undefined,
          conversationId: platformNeedsConvId ? platformConvId : undefined,
        };

        const abortController = new AbortController();
        const streamKey = socket.id;
        activeStreams.set(streamKey, abortController);

        let fullContent = '';
        let displayedContent = '';
        let hasDeepThinking = false; // 是否接收到了深度思考内容
        try {
          const result = await proxyAIRequestStream(
            agentConfig,
            data.content,
            studentName,
            (chunk) => {
              // 首次收到回答 chunk，若之前有深度思考，通知教师端思考阶段结束
              if (hasDeepThinking) {
                hasDeepThinking = false;
                io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                  studentId: data.studentId,
                  status: false,
                });
              }
              fullContent += chunk;
              // 实时清理流式内容，隐藏 Markdown 图片链接
              const cleanFull = cleanStreamContent(fullContent);
              if (cleanFull.length > displayedContent.length) {
                const newPart = cleanFull.slice(displayedContent.length);
                displayedContent = cleanFull;
                // 实时推送给学生
                io.to(socket.id).emit('ai-chunk', { content: newPart, roundIndex: roundCount });
                // 实时推送给教师看板
                io.to(`teacher:${classroom.id}`).emit('student-chunk', {
                  studentId: data.studentId,
                  content: newPart,
                  roundIndex: roundCount,
                });
              }
            },
            formattedHistory,
            data.fileUrls || (data.fileUrl ? [data.fileUrl] : []),
            abortController.signal,
            (thinking) => {
              // 深度思考内容到达
              if (!hasDeepThinking) {
                hasDeepThinking = true;
                // 通知教师端学生正在深度思考
                io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                  studentId: data.studentId,
                  status: true,
                });
              }
              // 将思考内容实时推送给学生端（不保存到数据库）
              io.to(socket.id).emit('ai-thinking-content', { content: thinking });
            }
          );

          if (result.aborted) {
            // 用户中断生成：不保存、不推送任何内容，直接丢弃
            if (hasDeepThinking) {
              hasDeepThinking = false;
              io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
                studentId: data.studentId,
                status: false,
              });
            }
            io.to(`teacher:${classroom.id}`).emit('student-thinking', {
              studentId: data.studentId,
              status: false,
            });
            return;
          }

          if (result.success && result.content) {
          // 保存平台对话上下文 ID（智谱清言 conversationId / 文心 threadId），后续请求保持上下文
          // 必须在 success 块内保存，防止工具调用失败等场景保存了损坏的 context id
          if (platformNeedsConvId && result.conversationId) {
            platformConversations.set(platformConvKey, { conversationId: result.conversationId, lastUsedAt: Date.now() });
          }
          // Save AI response
          const aiMessage = await prisma.message.create({
            data: {
              classroomId: classroom.id,
              studentId: classroomStudent.id,
              content: result.content,
              role: 'assistant',
              roundIndex: roundCount,
              agentId: agent.id,
              followUps: result.followUps ? JSON.stringify(result.followUps) : undefined,
            },
          });

          // Update interaction stats
          await prisma.interaction.upsert({
            where: {
              classroomId_studentId: {
                classroomId: classroom.id,
                studentId: data.studentId,
              },
            },
            create: {
              classroomId: classroom.id,
              studentId: data.studentId,
              totalRounds: roundCount,
              firstMsgLen: roundCount === 1 ? data.content.length : undefined,
            },
            update: {
              totalRounds: roundCount,
            },
          });

          // Update classroom student round count
          await prisma.classroomStudent.update({
            where: { id: classroomStudent.id },
            data: { totalRounds: { increment: 1 } },
          });

          // Send AI completion to student
          io.to(socket.id).emit('ai-response', {
            content: result.content,
            messageId: aiMessage.id,
            roundIndex: roundCount,
            followUps: result.followUps,
          });

          // Broadcast to teacher board
          io.to(`teacher:${classroom.id}`).emit('student-message', {
            studentId: data.studentId,
            studentName,
            content: result.content,
            role: 'assistant',
            roundIndex: roundCount,
            messageId: aiMessage.id,
            timestamp: aiMessage.createdAt,
            followUps: result.followUps,
          });

          // Notify teacher AI stopped thinking
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
        } else {
          // AI 响应失败，清理深度思考状态（如果有）
          if (hasDeepThinking) {
            hasDeepThinking = false;
            io.to(`teacher:${classroom.id}`).emit('student-deep-thinking', {
              studentId: data.studentId,
              status: false,
            });
          }
          io.to(socket.id).emit('ai-error', {
            error: result.error || 'AI 响应失败',
          });
          io.to(`teacher:${classroom.id}`).emit('student-thinking', {
            studentId: data.studentId,
            status: false,
          });
          // 更新智能体状态并推送告警（带冷却，同一智能体 2 分钟内只通知一次）
          if (agent) {
            try {
              await prisma.agent.update({
                where: { id: agent.id },
                data: {
                  lastCheckAt: new Date(),
                  lastCheckOk: false,
                  lastCheckError: result.error || '连接失败',
                },
              });
            } catch {}
            const now = Date.now();
            const lastAlert = agentAlertCooldown.get(agent.id);
            if (!lastAlert || now - lastAlert > AGENT_ALERT_COOLDOWN_MS) {
              agentAlertCooldown.set(agent.id, now);
              io.emit('agent-connection-lost', {
                agentId: agent.id,
                agentName: agent.name,
              });
              io.emit('agents-checked', { failed: [agent.name] });
            }
          }
          }
        } finally {
          activeStreams.delete(streamKey);
        }
      } catch (error) {
        console.error('[Socket] send-message error:', error);
        io.to(socket.id).emit('ai-error', { error: '消息发送失败' });
      }
    });

    // 学生请求停止 AI 生成
    socket.on('stop-generation', async () => {
      // 查该学生所在课堂是否允许中断
      let classroomId: string | null = null;
      for (const room of socket.rooms) {
        if (room.startsWith('classroom:')) { classroomId = room.slice(10); break; }
      }
      if (classroomId) {
        const classroom = await prisma.classroom.findUnique({ where: { id: classroomId } });
        if (!classroom || !classroom.allowStudentStop) return;
      }
      const controller = activeStreams.get(socket.id);
      if (controller) {
        controller.abort();
      }
    });

    // 教师发送通知给学生：全班广播 / 定向单个学生 / 定向多个学生（如小组成员）
    // 教师通知：全班广播 / 定向单个学生 / 定向组（分组/高级模式）
    socket.on('teacher-send-notification', async (data: unknown) => {
      if (!socket.data.isTeacher || !hasTeacherSessionCookie(socket.handshake.headers.cookie)) {
        socket.emit('teacher-auth-error', { error: '无权发送教师通知' });
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        socket.emit('teacher-auth-error', { error: '通知格式无效' });
        return;
      }
      const { classroomId, studentId, groupId, message } = data as {
        classroomId?: unknown; studentId?: unknown; groupId?: unknown; message?: unknown;
      };
      if (
        typeof classroomId !== 'string' || classroomId !== socket.data.classroomId ||
        typeof message !== 'string' || !message.trim() || message.length > 1_000 ||
        (studentId !== undefined && typeof studentId !== 'string') ||
        (groupId !== undefined && typeof groupId !== 'string')
      ) {
        socket.emit('teacher-auth-error', { error: '通知格式无效或课堂不匹配' });
        return;
      }
      try {
        if (groupId) {
          // 定向到组：该组只有一个小组参与者，通知与实时连接均使用参与者 ID。
          const members = await prisma.classroomStudent.findMany({
            where: { classroomId, groupId },
            select: { id: true, studentId: true },
          });
          for (const m of members) {
            const notif = await prisma.teacherNotification.create({
              data: { classroomId, studentId: m.id, groupId, content: message },
            });
            if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
            const cache = teacherNotificationCache.get(classroomId)!;
            cache.push({ id: notif.id, message, timestamp: Date.now(), studentId: m.id });
            const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
            teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
            const connKey = `${classroomId}:${m.id}`;
            const targetSocketId = activeConnections.get(connKey);
            if (targetSocketId) {
              io.to(targetSocketId).emit('teacher-notification', { id: notif.id, message });
            }
          }
        } else if (studentId) {
          // 定向到单个学生
          const notif = await prisma.teacherNotification.create({
            data: { classroomId, studentId, content: message },
          });
          if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
          const cache = teacherNotificationCache.get(classroomId)!;
          cache.push({ id: notif.id, message, timestamp: Date.now(), studentId });
          const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
          teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
          const connKey = `${classroomId}:${studentId}`;
          const targetSocketId = activeConnections.get(connKey);
          if (targetSocketId) {
            io.to(targetSocketId).emit('teacher-notification', { id: notif.id, message });
          }
        } else {
          // 全班广播
          const notif = await prisma.teacherNotification.create({
            data: { classroomId, studentId: null, content: message },
          });
          if (!teacherNotificationCache.has(classroomId)) teacherNotificationCache.set(classroomId, []);
          const cache = teacherNotificationCache.get(classroomId)!;
          cache.push({ id: notif.id, message, timestamp: Date.now(), studentId: null });
          const cutoff = Date.now() - NOTIFICATION_CACHE_TTL;
          teacherNotificationCache.set(classroomId, cache.filter(n => n.timestamp > cutoff).slice(-MAX_CACHED_NOTIFICATIONS));
          io.to(`classroom:${classroomId}`).emit('teacher-notification', { id: notif.id, message });
        }
      } catch (err) {
        console.error('[Socket] save notification error:', err);
      }
    });

    // 断开连接
    socket.on('disconnect', async () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      // 浏览器关闭、网络切换或被新设备顶下线时，立即取消仍在进行的 AI 请求。
      // 否则上游流会持续到自然结束，既浪费额度也可能留下无接收方的任务。
      const activeStream = activeStreams.get(socket.id);
      if (activeStream) {
        activeStream.abort();
        activeStreams.delete(socket.id);
      }
      const { classroomId, studentId, isTeacher } = socket.data;
      const connKey = classroomId && studentId ? `${classroomId}:${studentId}` : null;

      // 探究助手监控的订阅记账：Socket.IO 会在断开时自动把本 socket 从所有房间摘掉
      // （所以 hasWatchers 立刻就是对的），但 watchers 这个 Map 是我们的账本，必须自己清 ——
      // 不清的话它不仅会无界增长，还会让「这个课堂还有没有订阅者」永远说不清。
      // 归零则走与 unwatch 相同的防抖路径。
      for (const [watchedClassroomId, socketIds] of webappMonitor.watchers) {
        if (!socketIds.delete(socket.id)) continue;
        if (socketIds.size === 0) webappMonitor.watchers.delete(watchedClassroomId);
        if (!hasWatchers(io, watchedClassroomId)) scheduleDemandNotification(io, watchedClassroomId);
      }

      // 清理活跃连接记录
      const disconnectedCurrentStudent = connKey
        ? clearCurrentStudentConnection(activeConnections, connKey, socket.id)
        : false;

      if (classroomId && studentId && !isTeacher && disconnectedCurrentStudent) {
        // 更新学生离线状态
        await prisma.classroomStudent.updateMany({
          where: { classroomId, id: studentId },
          data: { status: 'offline' },
        });

        io.to(`teacher:${classroomId}`).emit('student-offline', {
          studentId,
        });

        // 广播在线状态给身份选择页
        io.to(`status:${classroomId}`).emit('online-students', { classroomId, studentIds: getOnlineStudentIds(classroomId, activeConnections) });
      }
    });
  });
}
