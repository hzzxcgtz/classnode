import { Server, Socket } from 'socket.io';
import { PrismaClient, Prisma } from '@prisma/client';
import { proxyAIRequestStream } from '../services/ai-proxy.js';
import type { AgentConfig } from '../services/ai-proxy.js';
import { anonymizer } from '../services/anonymizer.js';
import { buildShieldFilter } from '../services/shield-filter.js';
import { decrypt } from '../services/crypto.js';
import { hasTeacherSessionCookie } from '../middleware/auth.js';
import { verifyStudentToken } from '../middleware/student-auth.js';
import { detailIntervalFor, normalizeCaptureConfig } from '../services/webapp-capture.js';
import { EMPTY_GROUP_MATERIAL_VIEW, resolveMaterialTargetId, resolveGroupMaterialViews, resolveParticipantWebappId } from '../services/group-material-resolve.js';
import { studentAgentView } from '../services/agent-purpose.js';

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

/**
 * 教师看板房间的前缀，与下面 join-teacher-board 及各处 io.to(`teacher:${id}`) 的写法一致。
 *
 * 🔴 **那个 `<id>` 是「课堂 id」，不是「教师 id」**（2026-09-24 在此处澄清；F2 的裁定是
 * **不改**其余各处的写法 —— `teacher:<id>` 是全仓通用的记法而不是笔误，只改一处是拿一致性
 * 换一次注释。要数它有几处就自己跑 `grep -rn "teacher:<id>" src server/src`，别引用数字）。
 * 但它读起来确实像个教师 id，而**认错它的后果是静默的**：房间名对不上 ⇒ 事件照发、
 * 日志干净、看板永远不动（`routes/worksheets.ts` 的 `worksheetBoardRoom` 上有完整说明）。
 * ⇒ 在唯一的声明处点明这件事，比在每个使用点各改一次便宜。
 */
const TEACHER_ROOM_PREFIX = 'teacher:';

/**
 * 「教师正在看探究空间视图」的房间后缀（规格 §5.5 的按需推流，Ruling 9）。
 *
 * ⚠️ **不能用 `teacher:<id>` 本身**：教师只要打开课堂看板就进了那个房间，而
 * 「在看探究空间视图」是更窄的一件事 —— 用宽的那个，会让每个只是开着看板的教师
 * 都触发全体学生推流，Ruling 9 的按需推流就白做了。
 *
 * ⚠️ **也不要换个前缀**（例如 `webapp:<id>`）来躲开 staleTeacherRooms：那个函数只清
 * `teacher:` 前缀的房间，换前缀等于让本房间**永远不被清理** —— 把一个静默的洞换成
 * 一个静默的泄漏。正确做法是让 staleTeacherRooms 认识它（这就是下面 keep 里那一行）。
 */
const WEBAPP_MONITOR_ROOM_SUFFIX = ':webapp';

/** 本课堂的探究空间监控房间名（只有 T7 的探究空间视图挂载时才 join）。 */
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
 * 写法会**每次都把探究空间监控房间也扫掉**（它以 `teacher:` 开头、又不等于 keep）：
 * 教师打开探究空间视图后，任何重新触发 join-teacher-board 的动作（effect 依赖变化、
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
// 探究空间实时监控的服务端内存态（规格 §5.5，Ruling 8 / Ruling 9）
//
// 链路：iframe(SDK) ──postMessage──▶ 学生端父页面 ──socket.io──▶ 这里的三个 Map
//       ──socket.io──▶ 教师看板的 teacher:<id>:webapp 房间
//
// ⚠️ **只存内存，不落盘**（规格 §5.5）。唯一的落盘项是课堂结束时的一次汇总，
// 由 drainWebappMonitor() + recordWebappSummary() 完成，见下面两个函数。
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个学生在一个网页上的最新一帧。**覆盖式**：一个键恒为 1 条。
 *
 * ⚠️ 这里曾经还有一个与它成对的 `counters` Map（点了几次 / 输入几次 / 滚到多深 /
 * 上报几次）—— 随学生操作行为的采集链路一起删除了（用户裁定：操作行为不记录）。
 * 帧**总数**因此挪进本条目（`count`），因为课后汇总的 `frameCount` 仍然要写。
 */
interface WebappFrameEntry {
  dataUrl: string;
  /** 服务端**收到**这一帧的时刻 —— 不用客户端时间戳，避免客户端时钟偏移污染时长。 */
  at: number;
  /** 本键**第一帧**的时刻，覆盖时保留：时长 = at - firstAt（见下）。 */
  firstAt: number;
  /** 收到的帧**总数**（内存里永远只有最新 1 条，这个数字是它的对照，也是汇总的 frameCount）。 */
  count: number;
}

/**
 * 一个学生在一个网页上的**当前状态**（文字档）：可见性 + 滚动深度 + 切换次数。
 *
 * 🔴 **这是一个「当前状态」，不是流水账** —— 这是本结构唯一重要的性质。
 * 一个键恒为 **1 条**（覆盖式），所以内存**不随课堂时长增长**：学生滚 500 次、
 * 切 50 次，这里仍然只有这四项，只是 `switches` 这个**计数器**在加。
 * 存流水（每次滚动追加一条）会让内存线性增长 —— 那是规格 §5.5 的硬要求，
 * 也是这个模块里最容易悄悄违反的一条。
 *
 * ⚠️ 这里**没有**任何自由文本字段：`visible` 是布尔、`depth` 是 0/10/…/100、
 * `at` 是服务端时刻、`switches` 是一个计数。
 */
export interface WebappPresenceEntry {
  /** 学生此刻是不是在前台看着这个网页。 */
  visible: boolean;
  /** 此刻的滚动深度（十分位）。0 表示没滚 / 还在顶部。 */
  depth: number;
  /** 服务端**收到**这条状态的时刻 —— 不用客户端时间戳，避免学生机器的时钟偏移。 */
  at: number;
  /**
   * 本节课里可见性**切换过几次**（一个计数，不是一条流水）。
   * 它替代了旧的 clicks / inputs 计数：教师想知道「这个学生是不是一直在用」，
   * 切换次数是这件事最省的一个代理量。
   */
  switches: number;
  /**
   * 「有文字档、却一帧都没有」这条诊断**报过没有**（值是服务端时钟）。
   *
   * 挂在 presence 条目上、而不是另开一张 Map：它会随 presence 一起被 TTL 裁剪
   * 与课堂结束的清空带走，不必在三个清理点各补一遍 —— 漏任何一个都是一处长期泄漏，
   * 而泄漏的症状要等很久才看得见。`accumulateWebappPresence` 会把它原样带过。
   *
   * 为什么需要它：文字档是 ≥400ms 一批的，不节流会刷屏，而刷屏等于没有诊断。
   */
  framelessLoggedAt?: number;
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
  /**
   * 文字档的**当前状态**（键同上，恒为 1 条 / 键）。
   *
   * ⚠️ 与 frames 分开两本：它们的入站频率差一个量级（帧每 10 秒一条，事件是突发），
   * 且 TTL / drain 的语义相同但**读出者不同**（帧给图墙，presence 给「已打开」那一行）。
   * 合成一条会逼着两个字段互相兜默认值，而「认不出 = 用默认」在这种复合结构上
   * 很容易写成「没帧就把状态清空」。
   */
  presence: new Map<string, WebappPresenceEntry>(),
  /**
   * 「这个学生的设备**拍不出**这个网页的画面」—— key 与 frames / presence 同格式，
   * 值只有收到时刻。
   *
   * 🔴 为什么必须单独记一条：SDK 连续失败到阈值后会**放弃并退避**（诊断码
   * `dom-tier-gave-up`），而那条诊断是**一次性**的（退避之后约每分钟才重发一次）。
   * 教师若在中途才打开看板，只靠实时转发会看到「等待画面…」—— 而那句话说的是
   * 「第一帧还在路上」，与事实不符。这与本仓既有的那条原则是同一条尺子：
   * **「已打开 / 等待画面… / 未打开」必须分开，因为它们说的是不同的事。**
   *
   * 实测背景（2026-09-22）：老 iPad 上的纯 DOM 网页，snapdom 生成的 SVG 在 Safari 15
   * 上解码不出来 ⇒ 永远没有缩略图。这是平台限制（见 server/vendor/README.md），
   * 不是待修的 bug —— 所以教师端要能说出这两个字的区别。
   *
   * 生命周期与另外两本完全相同（同一套 TTL 裁剪、同一套 drain 释放）。
   */
  captureBlocked: new Map<string, { at: number }>(),
  /**
   * 学生**此刻在看哪个模块**（P2.3）：key `classroomId:studentId`，值只有
   * 「哪个模块」+ 收到时刻 —— **没有任何内容**。
   *
   * 读它的是教师看板的「跟随」模式（每格显示该学生当前在用的模块）。
   * 放在这个对象里是因为**生命周期与帧/状态完全相同**（同一套 TTL 裁剪、同一套 drain
   * 释放），单开一份必然要再写一遍那两条路径。
   */
  moduleFocus: new Map<string, { moduleId: string | null; at: number }>(),
  /** classroomId → 订阅了本课堂探究空间视图的 socketId 集合（Ruling 9 的记账）。 */
  watchers: new Map<string, Set<string>>(),
  /**
   * classroomId → 教师此刻**点开了详情**的那个 studentId（没点开则无此键）。
   *
   * 与 watchers 的区别是**粒度**：watchers 是整间课堂「有没有人看」，
   * 这个是「在看**哪一个**」。只有被点开的那个学生才升高频档 ——
   * 若做成整班一起升，40 人的班会让 40 台老 iPad 同时从 10 秒一帧变成 2 秒一帧。
   */
  focus: new Map<string, string>(),
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

/** 只接受 data URL 形式的图片，不接 http(s) 链（那会把教师看板变成外链加载器）。 */
const WEBAPP_DATA_URL_PREFIX = 'data:image/';

/** 一个短字符串字段的上界（课堂 id / 网页 id / 学生 id / to 这类）。 */
const MAX_WEBAPP_SHORT_FIELD_CHARS = 64;

/** 单条 webapp-event 里最多几条事件（拉长一次上报而不是高频小包是客户端自由，但要有上界）。 */
const MAX_WEBAPP_EVENTS_PER_MESSAGE = 50;

/**
 * 允许的 kind **白名单** —— 与 SDK 的 buildEvent 调用点**一一对应**，只有两种：
 *   · visibility —— 只有 'visible' / 'hidden' 两个取值；
 *   · scroll     —— 只有 0 / 10 / … / 100 这十一个十分位。
 *
 * ⚠️ 旧的 click / input / navigate / report 四项**不在表里**，而且不该被加回来：
 * 它们都要带「内容」才能用（点了哪个元素 / 输入框里有多少字符 / 跳到哪个锚点），
 * 而学生是未成年人（P2.2 用户裁定）。不在表里就整条丢弃：**白名单**而不是黑名单，
 * 将来 SDK 加通道时必须显式改这里。
 */
const WEBAPP_EVENT_KINDS = new Set(['visibility', 'scroll']);

/** 滚动深度的合法档位步长与上限（十分位：0 / 10 / … / 100）。 */
const WEBAPP_DEPTH_STEP = 10;
const WEBAPP_DEPTH_MAX = 100;

/**
 * 服务端侧的 WebappEvent —— 与 src/lib/socket-events.ts 的声明同形
 * （两边是独立包，不互相 import）。
 *
 * 🔴 **恰好四个字段，而里面没有任何自由文本字段**：`to` 是一个短枚举字面量，
 * `depth` 是一个十分位整数。旧的 selector / inputType / length 三项
 * **一项都没有回来**（P2.2 的 T5 刻意如此）。
 */
export interface WebappEvent {
  kind: string;
  to: string;
  depth: number;
  at: number;
}

/**
 * 课堂结束时写进 WebappUsage 的一行（谁、用了哪个网页、看了多久）。
 *
 * ⚠️ 这里曾经还有 clicks / inputs / maxDepth / reports 四项（学生操作行为的计数）。
 * 它们随事件链路一起**不再产出**（用户裁定）。**表结构没动**：WebappUsage 上那四个
 * 列还在，只是不再写入 —— 落库时走它们各自的 `@default(0)`，于是列里的值是 0，
 * 而不是「保留着上一节课的旧数字」。
 */
export interface WebappUsageRow {
  studentId: string;
  webappId: string;
  durationMs: number;
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

/** 数字字段的规范：非有限值 / 负数一律当 0，其余取整。 */
function clampNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 把一条来自学生浏览器的原始事件收成契约形状。
 *
 * ⚠️ **白名单式重建，不是挑字段改**：socket 事件没有 HTTP 层的参数校验，而这条数据
 * 来自学生机器上的任意页面（教师网页里也能跑 JS）。逐字段重建 ⇒ 客户端塞不进
 * 契约之外的东西（超大字符串、嵌套对象、`__proto__` 之类），落在服务端内存里的
 * 形状与大小都是这里说了算的。
 *
 * 🔴 **它也是「窄契约」的执行点之一**：返回的对象**只可能是四个键**
 * （kind / to / depth / at）。旧的 selector / inputType / length 三项即使被客户端
 * 塞进载荷，也在这里被丢掉 —— 而不是「靠客户端不发」。
 * 学生端父页面还有一层同款的重建（`use-explore-bridge.ts` 的 `toWebappEvent`），
 * 两层是刻意的：每一层都假定上一层可能已经坏了。
 *
 * 字段语义（与 SDK 的 buildEvent 一一对应）：
 *   · kind  = 'visibility' ⇒ to 只能是 'visible' / 'hidden'，depth 恒为 0；
 *   · kind  = 'scroll'     ⇒ to 恒为 ''，depth 是 0 / 10 / … / 100 的十分位。
 * 认不出的组合**整条丢弃**（不是"修一修留下"）：形状错的载荷没有可信的部分。
 */
export function sanitizeWebappEvent(value: unknown): WebappEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!WEBAPP_EVENT_KINDS.has(kind)) return null;
  if (kind === 'visibility') {
    if (raw.to !== 'visible' && raw.to !== 'hidden') return null;
    return {
      kind,
      to: raw.to,
      depth: 0,
      at: clampNumber(raw.at),
    };
  }
  // scroll：深度夹到 0…100 的十分位上（越界不丢整条 —— 那只是一个数字，
  // 而"学生滚过头了"不该让教师看到「什么都没发生」）。
  const depth = Math.min(WEBAPP_DEPTH_MAX, Math.round(clampNumber(raw.depth) / WEBAPP_DEPTH_STEP) * WEBAPP_DEPTH_STEP);
  return {
    kind,
    to: '',
    depth,
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

/**
 * `diag` 通道允许的枚举码 —— **与 SDK 的 `DIAG_CODES`、父页面的 `DIAG_CODES` 三处一致**。
 *
 * ⚠️ 三处必须同时改：改漏一处的后果是那条诊断**静默消失**（不报错，只是永远看不到），
 * 而这正是这条通道存在的意义所在。
 */
export const WEBAPP_DIAG_CODES = new Set([
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
]);

/**
 * 校验 `webapp-diag` 的载荷。
 *
 * ⚠️ **逐字段白名单重建**（与 `sanitizeWebappEvent` 同款）：只看白名单里的码，
 * 数字一律夹成非负整数。这条通道**不接受任何字符串字段** ——
 * 「诊断」不能变成绕开「装不下页面内容」那条保证的后门。
 */
export function validateWebappDiagPayload(value: unknown): {
  classroomId: string; webappId: string; code: string; n: number; w: number; h: number;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const classroomId = typeof raw.classroomId === 'string' ? raw.classroomId.trim() : '';
  const webappId = typeof raw.webappId === 'string' ? raw.webappId.trim() : '';
  if (!classroomId || !webappId) return null;
  const code = raw.code;
  if (typeof code !== 'string' || !WEBAPP_DIAG_CODES.has(code)) return null;
  const toInt = (input: unknown): number => (
    typeof input === 'number' && Number.isFinite(input) && input >= 0
      ? Math.min(Math.round(input), 100000000)
      : 0
  );
  return { classroomId, webappId, code, n: toInt(raw.n), w: toInt(raw.w), h: toInt(raw.h) };
}

/** watch / unwatch 共用的载荷形状校验。 */
export function validateWebappWatchPayload(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const classroomId = typeof raw.classroomId === 'string' ? raw.classroomId.trim() : '';
  return classroomId || null;
}

/**
 * 本课堂是否有教师在看探究空间视图（Ruling 9 的按需推流判据）。
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

/**
 * 逐学生下发按需推流档位。
 *
 * ⚠️ **必须逐个 socket 发，不能 `io.to(classroom:<id>)` 广播。** 两条理由：
 *   1. `detail` 是**每个学生不同**的（只有被点开详情的那一个为真）。若走广播，就得把
 *      studentId 放进载荷让各端自己筛 —— 那等于**告诉全班「教师正在看谁」**。
 *   2. 逐发之后每个学生收到的就是它自己该用的档位，客户端不需要任何推导，
 *      也不存在「推导写错了」这种失效模式。
 *
 * ⚠️ **不能用 `activeConnections` 遍历**：那份 Map 是 socket 装配函数**内部的**闭包变量
 * （不在模块作用域），而本函数要在模块级被 `drainWebappMonitor` 那条路径也用到。
 * 走房间成员 + `socket.data.studentId` 反而更稳 —— studentId 是 join-classroom 自己
 * 写在 socket 上的（与 activeConnections 同源、同时机），不必再反查 roster。
 */
/**
 * `focus-webapp-student` 的载荷校验。
 *
 * `studentId` 允许为 `null`（= 关掉详情）。**不校验它是否真在本课堂名册上**：
 * 这条只是「让某个学生的端转高频」，而档位是发给房间里真实存在的**学生** socket 的
 * —— 一个不在册的 id 匹配不到任何连接，效果自然为零。为它多查一次库买不到任何东西。
 * 长度仍然夹住，免得有人拿它塞垃圾进来。
 */
function validateWebappFocusPayload(data: unknown): { classroomId: string; studentId: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const classroomId = d.classroomId;
  if (typeof classroomId !== 'string' || !classroomId || classroomId.length > MAX_WEBAPP_SHORT_FIELD_CHARS) return null;
  const sid = d.studentId;
  if (sid === null || sid === undefined) return { classroomId, studentId: null };
  if (typeof sid !== 'string' || sid.length > MAX_WEBAPP_SHORT_FIELD_CHARS) return null;
  return { classroomId, studentId: sid || null };
}

export async function broadcastWebappDemand(io: Server, prisma: PrismaClient, classroomId: string): Promise<void> {
  const watching = hasWatchers(io, classroomId);
  const focused = webappMonitor.focus.get(classroomId) ?? null;
  const room = io.sockets.adapter.rooms.get(`classroom:${classroomId}`);
  if (!room) {
    return;
  }

  // 每堂课只读一次库。这条路径只在**订阅 / 退订 / 焦点变化**时走 —— 一堂课十来次，
  // 而它决定的是学生设备接下来干什么，值得这一次读。
  const config = normalizeCaptureConfig(
    await prisma.classroom.findUnique({
      where: { id: classroomId },
      select: { webappCaptureEnabled: true, webappThumbnailWidth: true, webappFrameIntervalMs: true },
    }),
  );

  for (const socketId of room) {
    const target = io.sockets.sockets.get(socketId);
    // 只发给**学生**（靠 studentId 辨认）。教师端也可能在这个房间里，而一条发给教师的
    // demand 只会让它多跑一次无用推导 —— 判定「谁该用什么档位」是服务端的事。
    const studentId = target?.data?.studentId as string | undefined;
    if (!target || !studentId) continue;
    // ⚠️ 没人看时 detail 必须为假 —— 否则会留下一个「watching=false 但 detail=true」
    // 的非法组合，而那正是客户端最容易推导错的一种状态。
    const detail = watching && focused === studentId;
    target.emit('webapp-monitor-demand', {
      watching,
      detail,
      captureEnabled: config.enabled,
      width: config.width,
      // ⚠️ 下发的是**本档的最终周期**，不是「图墙基准」：wall 与 detail 的差别由服务端算好。
      //    让学生端自己乘一个比例，等于把这个比例的定义复制到另一个语言、另一个位置。
      frameIntervalMs: detail ? detailIntervalFor(config.frameIntervalMs) : config.frameIntervalMs,
    });
  }
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
export function scheduleDemandNotification(io: Server, prisma: PrismaClient, classroomId: string): void {
  if (pendingDemandTimers.has(classroomId)) return;
  const timer = setTimeout(() => {
    pendingDemandTimers.delete(classroomId);
    // 期间又有人订阅就什么都不做（订阅那条路径已经 cancel 过了，这里是二重保险）。
    if (hasWatchers(io, classroomId)) return;
    // 定时器回调里不能 await：这条路径要读一次课堂配置。失败只记日志 ——
    // 通知没发出去的最坏后果是学生多推一会儿，不该把进程带下去。
    broadcastWebappDemand(io, prisma, classroomId).catch((error) => {
      console.error('[Socket] 下发推流档位失败:', error);
    });
  }, WEBAPP_DEMAND_DEBOUNCE_MS);
  // unref：这是一个纯粹的「延迟通知」，不该在关闭流程里把一个已经没人等的进程钉住
  // 15 秒（同 :302 的 cacheCleanupTimer）。node:test 的 mock timers 也提供 unref。
  timer.unref();
  pendingDemandTimers.set(classroomId, timer);
}

/**
 * 帧**只留最新一帧**：同一把键再进来就是覆盖，不是追加。
 *
 * 这条不是优化而是内存上界本身 —— 40 人 × 每帧 ~10-31KB（见上面的实测注释），
 * 追加式存储会让内存随课堂时长线性增长。
 *
 * `count` 仍然累加：内存里只留 1 条，**收到的总数**在这个数字里（课后汇总要用）。
 */
function storeWebappFrame(classroomId: string, studentId: string, webappId: string, dataUrl: string, now: number): void {
  const key = webappKey(classroomId, studentId, webappId);
  const previous = webappMonitor.frames.get(key);
  webappMonitor.frames.set(key, {
    dataUrl,
    at: now,
    firstAt: previous ? previous.firstAt : now,
    count: (previous ? previous.count : 0) + 1,
  });
}

/**
 * 把一批文字档事件收成**当前状态**（覆盖式，键恒为 1 条）。
 *
 * 🔴 **这是「不存流水账」这条要求的执行点。** 无论这一批有几条事件、一节课来多少批，
 * 落进 Map 的永远是一个 `WebappPresenceEntry`：**五个字段，全是标量或短枚举**。
 * 事件里的 `at` **刻意不用** —— 存的是服务端收到的时刻，学生机器的时钟不可信。
 *
 * ⚠️ **把保证说准**（原来写的是「四个字段」）：这条保证的实质是
 * **这里装不下任何页面内容** —— 没有 selector / inputType / length / value 的位置，
 * 每个字段的取值范围都被逐一枚举过。第 5 个字段 `framelessLoggedAt` 是一个服务端
 * 时间戳（诊断用的「报过没有」标记），仍然落在这个范围内，**没有放宽**上面那条实质保证。
 * 往这里加字段仍然是需要刻意为之的改动 —— `webapp-monitor.test.ts` 有一条契约测试
 * 钉着这张字段表，就是为此存在的。
 *
 * 「当前状态」的语义要写清楚，否则很容易被误读成"丢了数据"：
 *   · visibility —— **最后一条**说的是什么，状态就是什么；`switches` 记录它变过几次；
 *   · scroll     —— **最后一条**的深度就是当前深度（学生往回滚，深度就变小）。
 * 这两个语义正是教师图墙要的（「现在是什么样」），而流水账给不了这个答案。
 */
function accumulateWebappPresence(
  classroomId: string,
  studentId: string,
  webappId: string,
  events: WebappEvent[],
  now: number,
): void {
  const key = webappKey(classroomId, studentId, webappId);
  const previous = webappMonitor.presence.get(key);
  let visible = previous ? previous.visible : false;
  let depth = previous ? previous.depth : 0;
  let switches = previous ? previous.switches : 0;

  for (const event of events) {
    if (event.kind === 'visibility') {
      const next = event.to !== 'hidden';
      if (next !== visible) switches += 1;
      visible = next;
    } else if (event.kind === 'scroll') {
      depth = event.depth;
    }
  }

  // `framelessLoggedAt` 必须**原样带过**：这个函数每次都用新对象覆盖旧条目，
  // 漏带的话「只报一次」会退化成「每批都报」，而那正是要避免的刷屏。
  // 用条件展开而不是直接写 `framelessLoggedAt: previous?.framelessLoggedAt`：
  // 后者在开启 `exactOptionalPropertyTypes` 时会把 `undefined` 当成非法值。
  webappMonitor.presence.set(key, {
    visible,
    depth,
    at: now,
    switches,
    ...(previous?.framelessLoggedAt !== undefined ? { framelessLoggedAt: previous.framelessLoggedAt } : {}),
  });
}

/** TTL 裁剪（由 pruneSocketCaches 驱动）。 */
function pruneWebappMonitor(now: number): void {
  const cutoff = now - WEBAPP_MONITOR_TTL_MS;
  for (const [key, frame] of webappMonitor.frames) {
    if (frame.at <= cutoff) webappMonitor.frames.delete(key);
  }
  for (const [key, presence] of webappMonitor.presence) {
    if (presence.at <= cutoff) webappMonitor.presence.delete(key);
  }
  for (const [key, focus] of webappMonitor.moduleFocus) {
    if (focus.at <= cutoff) webappMonitor.moduleFocus.delete(key);
  }
  for (const [key, blocked] of webappMonitor.captureBlocked) {
    if (blocked.at <= cutoff) webappMonitor.captureBlocked.delete(key);
  }
  // 空 Set 只可能在「订阅者的 disconnect 没跑到」时出现；正常路径上 disconnect 会删掉
  // 整个键。这里兜底，避免 Map 本身随课堂数无界增长。
  for (const [classroomId, socketIds] of webappMonitor.watchers) {
    if (socketIds.size === 0) webappMonitor.watchers.delete(classroomId);
  }
}

/** 测试与诊断用：读一条帧（不改变内存）。没有则返回 null。 */
export function peekWebappFrame(classroomId: string, studentId: string, webappId: string): WebappFrameEntry | null {
  return webappMonitor.frames.get(webappKey(classroomId, studentId, webappId)) ?? null;
}

/** 测试与诊断用：读一条文字档状态（不改变内存）。没有则返回 null。 */
export function peekWebappPresence(classroomId: string, studentId: string, webappId: string): WebappPresenceEntry | null {
  return webappMonitor.presence.get(webappKey(classroomId, studentId, webappId)) ?? null;
}

/** 测试与诊断用：某个课堂当前的内存条目数。 */
export function webappMonitorSizes(classroomId: string): { frames: number; presence: number; watchers: number } {
  const prefix = `${classroomId}:`;
  let frames = 0;
  let presence = 0;
  for (const key of webappMonitor.frames.keys()) if (key.startsWith(prefix)) frames += 1;
  for (const key of webappMonitor.presence.keys()) if (key.startsWith(prefix)) presence += 1;
  return { frames, presence, watchers: webappMonitor.watchers.get(classroomId)?.size ?? 0 };
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
export function drainWebappMonitor(io: Server, classroomId: string): WebappUsageRow[] {
  const prefix = `${classroomId}:`;
  const rows = new Map<string, WebappUsageRow>();
  // 课堂结束：焦点与帧一起释放（规格 §5.5 要求课堂结束释放全部监控内存）。
  webappMonitor.focus.delete(classroomId);

  // 现在**一个键只有一条帧记录**，所以汇总是一趟循环：帧在就有行，没有就没有行。
  // （原先还有 counters 那一趟 —— 事件计数的那趟随事件链路删掉了，而文字档恢复之后
  //   它**也没有回来**：文字档要的是「现在是什么样」，不是「点了多少次」，
  //   所以它不进汇总，只在内存里有一个覆盖式的当前状态。）
  for (const [key, frame] of webappMonitor.frames) {
    if (!key.startsWith(prefix)) continue;
    const ids = splitWebappKey(key, classroomId);
    webappMonitor.frames.delete(key);
    if (!ids) continue;
    // durationMs 只在这一处算，用的是服务端收到首帧与末帧的时刻。
    rows.set(`${ids.studentId}:${ids.webappId}`, {
      studentId: ids.studentId,
      webappId: ids.webappId,
      durationMs: Math.max(0, frame.at - frame.firstAt),
      frameCount: frame.count,
    });
  }

  // 文字档的当前状态随课堂一起释放（规格 §5.5）。⚠️ 两个要点：
  //   · 只删**本课堂**的键（下面按前缀扫），不是整本 clear —— drain 是 per-classroom 的，
  //     整本清会把别的课堂的状态一起抹掉（用例「drain 只能清自己那个课堂」守着这条）；
  //   · 它**不产出汇总行**：它是"此刻"的状态，课堂结束后没有意义，也没有对应的落盘列。
  for (const key of [...webappMonitor.presence.keys()]) {
    if (key.startsWith(prefix)) webappMonitor.presence.delete(key);
  }
  for (const key of [...webappMonitor.moduleFocus.keys()]) {
    if (key.startsWith(prefix)) webappMonitor.moduleFocus.delete(key);
  }
  // 「拍不出画面」标记同样随课堂释放 —— 它是"此刻"的设备状态，课堂结束后没有意义。
  for (const key of [...webappMonitor.captureBlocked.keys()]) {
    if (key.startsWith(prefix)) webappMonitor.captureBlocked.delete(key);
  }

  webappMonitor.watchers.delete(classroomId);
  // 待触发的「停止推流」必须一起取消：否则 15 秒后会给一个**已经结束**的课堂
  // 广播 watching:false（无害但没意义），且定时器会一直挂到那时。
  cancelDemandNotification(classroomId);

  // ⚠️ 还要让订阅者**真的退出房间**（只清上面那本记账是不够的）。
  // hasWatchers 读的是 Socket.IO 自己的房间表，不是这本 Map —— 不踢人的话
  // `drain` 之后 `hasWatchers` 仍然是 true：「结束即释放」不是终态，教师那块图墙
  // 还会继续收到一个已经结束的课堂的帧，而 Redis/内存里被踢掉的记账再也说不清谁在看。
  // （审查者在真实适配器上实测过：drain 之后 webapp 房间 size 仍是 1。）
  io.in(webappMonitorRoom(classroomId)).socketsLeave(webappMonitorRoom(classroomId));

  return [...rows.values()];
}

/**
 * 唯一落盘项（规格 §5.5）：把 drain 出来的汇总写进 WebappUsage。
 *
 * ⚠️ **按唯一键 (classroomId, studentId, webappId) 替换，不是追加。**
 *
 * 「一个课堂只会结束一次」是**错的**，而这一点被仓内代码证否：`canTransition` 允许
 * `restore: ['ended']`（services/classroom-state.ts），也就是「结束错了 → 恢复 →
 * 上完 → 再结束」是一条**合法且常见**的路径。用 createMany 追加的话，第二次结束
 * 会撞上 WebappUsage 的唯一索引 —— 而 **createMany 撞唯一键是整批失败，不是只丢
 * 冲突的那一行** ⇒ 第二节课**全体学生、全部网页**的汇总一起丢。路由又按设计吞掉
 * 错误回 200（课堂已经结束、不可回滚），教师端看不到任何异常。审查者用 dev.db 的
 * **副本** + 真实服务器实测复现过：第二次结束后行数仍然是 1，日志里是
 * `Unique constraint failed on the fields: (classroomId, studentId, webappId)`。
 *
 * 语义上「替换」本来就是对的那一个：那把唯一键说的是「一个参与者一个网页一行」，
 * 所以这个课堂的汇总 = **最后一次结束时的状态**（中途退出课堂的学生也不会留下残行）。
 *
 * 删除与写入在**同一个事务**里：任一步失败整体回滚，旧数据不会被半途删掉。
 *
 * ⚠️ **边界（明说，不藏）**：`rows` 为空时**什么都不做**，连删除也不做。
 * 因为「空 drain」有两种无法在这一层区分的成因：① 这节课确实没人用探究空间；
 * ② 这节课没有教师打开过看板 ⇒ 学生按 Ruling 9 根本没推流 ⇒ 一条数据都没收到
 * （后者是已知的按需推流代价，见 task-5-report.md §6.4）。② 会把上一节课**真实存在**
 * 的汇总删掉，而按「空 = 覆盖成空」处理就会丢掉那些数据 —— 在成因不可区分时，
 * 保守方向是**不删**。有数据时（≥1 行）才整体替换。
 *
 * ⚠️ **写入的列变少了**（clicks / inputs / maxDepth / reports 不再产出）：那四列**留在
 * 表里**（不动 schema、不跑 db push），落库时走它们各自的 `@default(0)` ⇒ 值恒为 0。
 * 这件事是有意的、也是可验证的：旧版本写进去的旧数字会被下一次替换抹平。
 */
export async function recordWebappSummary(prisma: PrismaClient, classroomId: string, rows: WebappUsageRow[]): Promise<number> {
  const data = rows.map(row => ({
    classroomId,
    webappId: row.webappId,
    studentId: row.studentId,
    durationMs: row.durationMs,
    frameCount: row.frameCount,
  }));
  if (data.length === 0) return 0;
  await prisma.$transaction([
    prisma.webappUsage.deleteMany({ where: { classroomId } }),
    prisma.webappUsage.createMany({ data }),
  ]);
  return data.length;
}

/**
 * 路由取用的门面（经 `app.set('webappMonitor', …)` 暴露）。
 *
 * 存在的理由：**drain 需要 io，而路由手里只有 `req.app`**。把 io 绑在这里，
 * 路由就只需要 `monitor.drain(classroomId)`；更重要的是，生产与测试走的是
 * **同一个工厂**，不会出现「测试自己拼了一个参数顺序不对的闭包」这种事
 * （那会让整条落盘路径静默写出 0 行，而用例只看行数时才发现）。
 */
export function createWebappMonitorFacade(io: Server): {
  drain: (classroomId: string) => WebappUsageRow[];
  record: typeof recordWebappSummary;
} {
  return {
    drain: (classroomId: string) => drainWebappMonitor(io, classroomId),
    record: recordWebappSummary,
  };
}

export function setupSocketHandlers(io: Server, prisma: PrismaClient, app?: import('express').Application) {
  // 追踪每个学生的活跃连接，key: `${classroomId}:${studentId}`
  const activeConnections = new Map<string, string>();
  // 暴露给 HTTP 路由使用
  if (app) {
    app.set('activeConnections', activeConnections);
    app.set('activeStreams', activeStreams);
    // 探究空间的内存态住在**本模块**，而「课堂结束」在 routes/classroom.ts（预审 2）。
    // 照上面两行的既有做法经 app.set 暴露，而不是让路由 import 本模块的内部状态。
    app.set('webappMonitor', createWebappMonitorFacade(io));
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
            groups: { include: { materials: true } },
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

        // 各组的材料（`agent` / `webapp` / `worksheet`，都可能为 null）走**同一个**解析口径
        // （`resolveGroupMaterialViews`）—— 学生端拿到的组材料必须与 `GET /code/:code`
        // 逐字一致，否则「首屏显示的那个智能体」与「真正对话用的那个」可能不是一个。
        const groupMaterialViews = await resolveGroupMaterialViews(prisma, classroom.groups);
        socket.emit('joined', {
          classroomId: classroom.id,
          // ★ M7b：与 `GET /code/:code` 用**同一个** `studentAgentView` —— 上面那条注释逐字
          // 要求「学生端拿到的组材料必须与它逐字一致」，而这条载荷是学生**连接后**那一份。
          // 两处各写一份 `.map` 的话，学生在**刷新前/后**会看到不一样的智能体列表。
          agents: classroom.classroomAgents
            .map((ca: Prisma.ClassroomAgentGetPayload<{ include: { agent: true } }>) => studentAgentView(ca))
            .filter((view): view is NonNullable<typeof view> => view !== null),
          groups: classroom.groups.map((group) => ({
            id: group.id,
            name: group.name,
            ...(groupMaterialViews.get(group.id) ?? EMPTY_GROUP_MATERIAL_VIEW),
          })),
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

        // 探究空间按需推流的**初始状态**（规格 §5.5 / Ruling 9）。
        // 学生端默认不推，由这条消息决定要不要开始 —— 少了它，「教师先开看板、学生后进课堂」
        // 这个顺序下学生永远等不到 watching:true，图墙会一直空着且没有任何报错。
        // 不做「本课堂有没有关联网页」的判断：那要多一次查询，而这条消息只有几十字节。
        // ⚠️ 这里必须**同时**给出 detail：教师先开看板、再点开某个学生的详情、
        //    然后学生才进课堂 —— 这个顺序下若只给 watching，那个学生一进来就是
        //    wall 档，直到教师重新点一次详情才会转高频（而教师不会知道要再点一次）。
        const demandWatching = hasWatchers(io, classroom.id);
        const demandDetail = demandWatching && webappMonitor.focus.get(classroom.id) === classroomStudent.id;
        // 与 broadcastWebappDemand 用**同一套**归一化 —— 两条路径各写一份默认值必然漂移。
        const joinConfig = normalizeCaptureConfig(
          await prisma.classroom.findUnique({
            where: { id: classroom.id },
            select: { webappCaptureEnabled: true, webappThumbnailWidth: true, webappFrameIntervalMs: true },
          }),
        );
        socket.emit('webapp-monitor-demand', {
          watching: demandWatching,
          detail: demandDetail,
          captureEnabled: joinConfig.enabled,
          width: joinConfig.width,
          frameIntervalMs: demandDetail
            ? detailIntervalFor(joinConfig.frameIntervalMs)
            : joinConfig.frameIntervalMs,
        });

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
        // 被离开的若正好是**探究空间监控房间**，记账与「按需推流」都得跟着走。
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
        if (!hasWatchers(io, watchedClassroomId)) scheduleDemandNotification(io, prisma, watchedClassroomId);
      }
      socket.join(`teacher:${classroomId}`);
      socket.data.classroomId = classroomId;
      socket.data.isTeacher = true;

      /**
       * ⚠️ **回放当前状态**（P2.3）。学生只在**变化时**上报「我在哪个模块」，所以教师
       * 中途进来看板时，那些「已经在某个模块里待着」的学生**一条消息都不会补发** ——
       * 看板的「跟随」模式会把它们显示成"不知道他在哪"，而学生明明正开着。
       *
       * 与 `webapp-monitor-demand` 在 join 时下发那一条是**同一类问题**
       * （「教师先开、学生后进」与「学生先进、教师后开」两个顺序都得成立）。
       */
      const focusPrefix = `${classroomId}:`;
      for (const [key, focus] of webappMonitor.moduleFocus) {
        if (!key.startsWith(focusPrefix)) continue;
        socket.emit('student-module-focus', {
          studentId: key.slice(focusPrefix.length),
          moduleId: focus.moduleId,
          at: focus.at,
        });
      }

      console.log(`[Socket] Teacher joined board: ${classroomId}`);
    });

    // ══════════════════════════════════════════════════════════════════════
    // 探究空间实时监控（规格 §5.5）
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
     * 失败**不 emit 任何错误事件**：探究空间是学生端的次要通道，一条 auth 错误弹窗打断
     * 学生做题是净损失；而「这个 webappId 属不属于本课堂」也不该变成可探测的信息。
     */
    /**
     * 判定「这个 socket 能不能代表该课堂上报」。
     *
     * ⚠️ 返回**拒因**而不是裸 `null`：五条判据的处置完全不同，而它们从前被压成同一句话
     * ——2026-09-22 实测里一次重连后冲刷出 15 条「不是本课堂的有效学生」，
     * 光凭那句话查不出到底是哪一条，也就没法定位。
     */
    async function resolveWebappReporter(classroomId: string, webappId: string): Promise<
      { ok: true; classroomId: string; studentId: string } | { ok: false; reason: string }
    > {
      if (!socket.data.studentId || socket.data.classroomId !== classroomId) {
        return { ok: false, reason: '这个 socket 不是学生，或它认的课堂不是这个' };
      }
      if (!socket.rooms.has(`classroom:${classroomId}`)) {
        // ⚠️ 这一条最常见，也最容易被误读成「学生搞错了」：socket 连着、身份也对，
        // 只是（重连之后）**还没重新 join 课堂房间**。客户端把断线期间缓冲的帧
        // 一次性冲刷出去时，撞的正是这一条 —— 那些帧会被整批丢掉。
        return { ok: false, reason: '还没 join 课堂房间（重连后尚未重新加入？）' };
      }
      const membership = await prisma.classroomStudent.findFirst({
        where: { classroomId, id: socket.data.studentId },
        select: { id: true },
      });
      if (!membership) return { ok: false, reason: '不在本课堂的学生名册里' };
      // 「这个 socket 报的网页算不算它的」——判定整体交给 `resolveParticipantWebappId`，
      // 唯一口径是 `resolveMaterialTargetId`（高级模式不回落那条规则在那边，这里不重写）。
      //
      // ⚠️ **这条判据改严了，改前改后的差别是**：
      //   · 改前问的是「**本课堂**关联过这个网页吗」—— 查的是课堂级的 `ClassroomWebapp`。
      //     两个后果：① 高级模式下那张表**恒为空**（该模式的网页权威来源是「每组一份」，
      //     见 `POST /create-advanced`），于是每一帧都在这里被拒（2026-09-23 用户报
      //     「探究空间的快照完全不显示」的根因，学生端一直是好的、一直在正常上报）；
      //     ② 只要课堂级关联过，学生就能替**别的组**送帧，污染那个网页的统计。
      //   · 改后问的是「**这是你自己的**网页吗」：按该参与者自己的模式/组解析出唯一
      //     有效网页再比对。① 与 ② 一起堵上。
      //
      // 课堂状态与「有效网页」两条查询互不依赖，**并行**发。
      // （旧实现把状态搭在「关联过吗」那次查询上顺带取回；那条判据整体作废了，
      //   状态因此单独查一次 —— 一次主键查找。）
      const [classroom, effective] = await Promise.all([
        prisma.classroom.findUnique({ where: { id: classroomId }, select: { status: true } }),
        resolveParticipantWebappId(prisma, { classroomId, participantId: membership.id }),
      ]);
      if (effective === null) return { ok: false, reason: '该学生（或其小组）没有配置探究网页' };
      if (effective !== webappId) {
        return { ok: false, reason: `上报的网页不是该学生的有效网页（有效 ${effective}，上报 ${webappId}）` };
      }
      // 课堂已结束 ⇒ 不再收上报。少了这一条，「结束即释放」仍然不是终态：drain 把内存
      // 清空之后，还没断线的学生（客户端还没来得及跳走）每 5 秒继续上报，内存条目会
      // **重新长回来**，而它们要等到 6 小时 TTL 或下一次 drain 才会被释放
      // （审查者的实测：结束之后学生再上报 → 内存条目又长回来）。
      // 只挡 'ended'，不挡 'paused'：暂停时教师往往正是要看看学生屏幕上现在是什么。
      // 只对 status 做判断，所以 restore 之后（status 回到 active）上报自动恢复。
      if (classroom?.status === 'ended') return { ok: false, reason: '课堂已结束' };
      return { ok: true, classroomId, studentId: membership.id };
    }

    // ⚠️ 这里曾经是 `webapp-event`（学生的结构事件上报：点击 / 输入 / 滚动 / 跳转 /
    // 前后台切换）。**整条删掉了**（用户裁定：学生的操作行为不需要记录）——
    // 服务端不再有这个入站事件，它的形状校验与累计计数也一并删除。
    // **留在链路上的只有下面这一条帧上报。**

    /**
     * 学生的**文字档**上报（P2.2 的 T5）。
     *
     * ⚠️ 与帧那条链路的差别有两处，都是刻意的：
     *   1. **入站不受 captureEnabled 影响** —— 教师关掉画面时这条就是唯一的信号来源，
     *      所以服务端这一侧根本没有那道闸（闸在**发送端**的 SDK 里，而它只管帧）；
     *   2. **存的是「当前状态」而不是事件本身**（见 accumulateWebappPresence）——
     *      内存里恒为一条，不随课堂时长增长。
     *
     * **先累加、后看有没有人订阅**：内存里留下的是一个有界的当前状态，而「按需推流」
     * 管的是**转发**。理由与帧那条同款 —— 反过来（没人看就不记）会让教师打开看板时
     * 图墙上一片「未打开」，而学生其实一直开着页面。
     */
    socket.on('webapp-event', async (data: unknown) => {
      try {
        const payload = validateWebappEventPayload(data);
        if (!payload) return;
        const reporter = await resolveWebappReporter(payload.classroomId, payload.webappId);
        if (!reporter.ok) {
          // 文字档被拒也要留痕（否则「学生明明在用、教师却看到未在线」无从查起），
          // 但**每个 socket 只记一次**：文字档是 ≥400ms 一批的，一个坏掉的 socket
          // 40 分钟能刷出几千行，那等于把日志淹掉。
          // 标记挂在 socket 上，随连接一起消失 —— 不需要任何清理。
          if (!socket.data.webappRejectionLogged) {
            socket.data.webappRejectionLogged = true;
            console.warn(
              `[Socket] webapp-event 被拒：${reporter.reason}`
              + ` classroom=${payload.classroomId} webappId=${payload.webappId}`,
            );
          }
          return;
        }

        const now = Date.now();
        accumulateWebappPresence(reporter.classroomId, reporter.studentId, payload.webappId, payload.events, now);

        // 🔴 诊断（iPad 事故的直接产物）：学生报了文字档，却**一帧都没有**。
        //
        // 这正是「教师端只看得到浏览位置、看不到图片」的形状 —— 而它此前**一个字都不说**：
        // 失败只写进 iframe 的 console，而 iPad 上没有开发者工具。出问题时只能靠猜。
        //
        // 判据是 `peekWebappFrame` 为空：帧是**覆盖式**存的（每个键恒 1 条），
        // 所以「没有这一条」就等于「这个学生这个网页一帧都没成功送到过」。
        //
        // ⚠️ 只报一次（标记挂在 presence 条目上，随它一起被 TTL 清掉）—— 文字档是
        //    ≥400ms 一批的，不节流就是刷屏，而刷屏等于没有诊断。
        // ⚠️ 刻意放在 `hasWatchers` 那个提前返回**之前**：它是一条独立观测，
        //    不该因为教师此刻没开看板就消失。
        const presenceNow = peekWebappPresence(reporter.classroomId, reporter.studentId, payload.webappId);
        if (
          presenceNow
          && !presenceNow.framelessLoggedAt
          && !peekWebappFrame(reporter.classroomId, reporter.studentId, payload.webappId)
        ) {
          presenceNow.framelessLoggedAt = now;
          console.warn(
            '[Socket] webapp-frameless：只收到文字档、一帧都没有'
            + ` classroom=${reporter.classroomId} student=${reporter.studentId} webapp=${payload.webappId}`
            + ` events=${payload.events.length}`
            + ' —— 若这一行只在老 iPad 上出现、桌面机上没有，问题在截图那一档'
            + '（SDK 的 canvas 直读或 snapdom 光栅化），不在传输或渲染',
          );
        }

        // 按需推流：没有教师在看探究空间视图时**一个字节都不转发**（Ruling 9）。
        if (!hasWatchers(io, reporter.classroomId)) return;

        const presence = peekWebappPresence(reporter.classroomId, reporter.studentId, payload.webappId);
        if (!presence) return;
        // 转发的是**当前状态**，不是刚收到的那几条事件 —— 教师图墙要回答的是
        // 「这个学生现在有没有在用」，流水账给不了这个答案（也给不出有界的内存）。
        io.to(webappMonitorRoom(reporter.classroomId)).emit('webapp-student-presence', {
          studentId: reporter.studentId,
          webappId: payload.webappId,
          visible: presence.visible,
          depth: presence.depth,
          // at 用**服务端**收到的时刻，不用客户端时间戳（与帧同款）。
          at: presence.at,
          switches: presence.switches,
        });
      } catch (error) {
        console.error('[Socket] webapp-event error:', error);
      }
    });

    /**
     * 学生的缩略图帧上报（每个键只留最新一帧，见 storeWebappFrame）。
     *
     * **先存、后看有没有人订阅**：内存里留下的是一帧（有界），而「按需推流」管的是
     * **转发**。反过来（没人看就不存）会让课后汇总在教师没开看板时整批为空，
     * 而汇总正是本模块唯一的落盘项。
     */
    socket.on('webapp-frame', async (data: unknown) => {
      try {
        const payload = validateWebappFramePayload(data);
        if (!payload) {
          // ⚠️ 这条日志是**刻意保留的诊断**，不是临时调试。这里从前是裸 `return` ——
          //    于是「学生端在发帧、服务端却一帧都没转发」这种情况完全没有痕迹，
          //    而它的形状与「学生端根本没发帧」在教师端看起来一模一样（都是空白）。
          //    下面只解释**为什么被拒**，不复述那条判定本身（判定只有一处，在
          //    `validateWebappFramePayload` 里）。
          const raw = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
          const dataUrl = raw?.dataUrl;
          const reason = typeof dataUrl !== 'string'
            ? 'dataUrl 不是字符串'
            : !dataUrl.startsWith(WEBAPP_DATA_URL_PREFIX)
              ? `dataUrl 前缀不是 ${WEBAPP_DATA_URL_PREFIX}（实际 ${dataUrl.slice(0, 24)}）`
              : `dataUrl 超长 ${dataUrl.length} > ${MAX_WEBAPP_DATA_URL_CHARS}`;
          console.warn(`[Socket] webapp-frame 被拒：${reason}`);
          return;
        }
        const reporter = await resolveWebappReporter(payload.classroomId, payload.webappId);
        if (!reporter.ok) {
          // 帧本来就低频（≤ 每 5 秒一条），不需要节流 —— 每条都留，连同拒因。
          console.warn(
            `[Socket] webapp-frame 被拒：${reporter.reason}`
            + ` classroom=${payload.classroomId} webappId=${payload.webappId}`,
          );
          return;
        }

        const now = Date.now();
        // 「**第一帧到达**」必须留痕，否则日志讲不出完整的故事。
        //
        // 这是 2026-09-22 那次真机实测暴露的缺口：`webapp-frameless` 只在**首次**观察到
        // 无帧时报一次，而首帧本身有 0~3s 的随机抖动 —— 实测里告警在 +0.5s 就报了，
        // 那台设备的 DOM 档 +1.8s 才开始。于是「告警」早于被观测的对象启动，
        // **之后到底有没有帧到达，光看日志分不出来**，我就没法凭它下结论。
        //
        // 有了这一行，判据才闭合：**有 frameless、却永远没有 frame-first** = 确证失败。
        const firstFrame = peekWebappFrame(reporter.classroomId, reporter.studentId, payload.webappId) === null;
        storeWebappFrame(reporter.classroomId, reporter.studentId, payload.webappId, payload.dataUrl, now);
        if (firstFrame) {
          console.log(
            '[Socket] webapp-frame-first：第一帧到达'
            + ` classroom=${reporter.classroomId} student=${reporter.studentId} webapp=${payload.webappId}`
            + ` dataUrl=${payload.dataUrl.length} 字符`,
          );
        }

        const watching = hasWatchers(io, reporter.classroomId);
        if (!watching) return;
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
     * 学生端的**截图失败诊断**（第 5 条通道的落点）。
     *
     * 🔴 这条存在的唯一理由：Safari 在 iOS 上不把跨源 iframe 单列成可检查目标，
     * SDK 在 iframe 里的 console 日志**结构上取不到** —— 老 iPad「有浏览位置、
     * 没有图片」的失败原因因此一直不可见。这里把「哪一类失败」落到服务端日志。
     *
     * ⚠️ 载荷里**只有一个封闭枚举码 + 三个整数**（见 `validateWebappDiagPayload`），
     * 装不下任何页面内容。
     * ⚠️ **不做归属校验就记**：诊断的价值在于「为什么会失败」，而失败很可能正是
     * 归属校验不通过（重连未重新 join 之类）。若这里也要求是有效学生，
     * 最需要的那一类诊断恰好会被丢掉。所以只校验**形状**，然后连同拒因一起记。
     */
    socket.on('webapp-diag', async (data: unknown) => {
      try {
        const payload = validateWebappDiagPayload(data);
        if (!payload) {
          console.warn('[Socket] webapp-diag 形状不合规，已丢弃');
          return;
        }
        // 能否归属到某个学生另记 —— 它本身就是一条有用的信息（为 null 说明这个 socket
        // 此刻不是该课堂的有效学生，见上面 `webapp-frame 被拒` 的同一套判据）。
        const reporter = await resolveWebappReporter(payload.classroomId, payload.webappId);
        console.warn(
          `[Socket] webapp-diag code=${payload.code} n=${payload.n} w=${payload.w} h=${payload.h}`
          + ` classroom=${payload.classroomId} webappId=${payload.webappId}`
          + ` reporter=${reporter.ok ? reporter.studentId : '无（' + reporter.reason + '）'}`,
        );

        // 「这台设备拍不出画面」要**推给教师看板**，不只是写日志。
        //
        // ⚠️ 两条都要做（**存 + 转发**），理由与帧那条不同：帧是「有就覆盖」的流，
        // 而这条是**一次性事件**（退避后约每分钟才可能重发）。只转发的话，
        // 教师中途打开看板会看到「等待画面…」—— 那句话说的是「第一帧还在路上」，
        // 与事实不符。存一份，才能让后来的人看到同一句话。
        if (payload.code === 'dom-tier-gave-up' && reporter.ok) {
          const key = webappKey(reporter.classroomId, reporter.studentId, payload.webappId);
          webappMonitor.captureBlocked.set(key, { at: Date.now() });
          if (hasWatchers(io, reporter.classroomId)) {
            io.to(webappMonitorRoom(reporter.classroomId)).emit('webapp-student-capture-blocked', {
              studentId: reporter.studentId,
              webappId: payload.webappId,
              // 这是**学生设备**上的采集失败，与「教师关掉了画面」是两回事（见 T7 的文案表）。
              at: Date.now(),
            });
          }
        }
      } catch (error) {
        console.error('[Socket] webapp-diag error:', error);
      }
    });

    /**
     * 教师订阅 / 取消订阅本课堂的探究空间视图（T7 的视图挂载与卸载）。
     *
     * 订阅：鉴权 + 必须是本课堂的教师会话，然后 join `teacher:<id>:webapp`
     *      （按需推流的判据就是这个房间）+ 立刻广播 watching:true，
     *      否则先开看板的教师永远等不到学生推流。
     */
    socket.on('watch-webapp-monitor', (data: unknown) => {
      const classroomId = validateWebappWatchPayload(data);
      if (!classroomId) return;
      // 鉴权由两部分组成，**都只读这条 socket 自己就有的事实**：
      //
      //  1. **身份**：握手 cookie 里的教师会话。原先这里写的是 `!socket.data.isTeacher`，
      //     而那个字段是 **join-teacher-board 置位的** —— 读它等于让订阅的成败取决于
      //     「两条事件谁先到」。这种依赖的失败形态是静默的（客户端只收到一条
      //     teacher-auth-error，或什么都收不到；界面上表现为「图墙一直是空的」）。
      //     实测：真实 socket.io 服务端 + 真实客户端下，同一 tick 连发两条时
      //     join-teacher-board 的 handler 恰好体内无 `await` 而先跑完，所以旧写法**没有
      //     复现出拒绝**；但这是「碰巧对」，给它加一个 `await` 就会翻车（报告里有那条
      //     变异实测）。⇒ 身份一律自己判。
      //
      //  2. **课堂归属**：`socket.data.classroomId` 是 join-teacher-board 写下的，
      //     判据写成**「写过才比」**：
      //       · 没写过（这条连接还没加入过任何看板）⇒ 放行。凭据已由第 1 条把住，
      //         而 `join-teacher-board` 自己也不校验「这个教师是不是这个课堂的」——
      //         两边同一把尺子。放行的是**同一个权限**，没有多给任何东西。
      //       · 写过且不是这个课堂 ⇒ 拒绝。这条是既有行为（回归用例：
      //         webapp-monitor.test.ts 的「教师不能订阅别的课堂」），必须留着。
      //     ⚠️ 「写过才比」是**有方向的**：信息越多越严。写成无条件比较就把第 1 条好不容易
      //     去掉的顺序依赖又请了回来（只是换了字段名），而那正是本函数要修的东西。
      const boundClassroomId = socket.data.classroomId as string | undefined;
      if (!hasTeacherSessionCookie(socket.handshake.headers.cookie) || (boundClassroomId !== undefined && boundClassroomId !== classroomId)) {
        socket.emit('teacher-auth-error', { error: '无权订阅探究空间监控' });
        return;
      }
      if (!webappMonitor.watchers.has(classroomId)) webappMonitor.watchers.set(classroomId, new Set());
      webappMonitor.watchers.get(classroomId)!.add(socket.id);

      // 回放「设备拍不出画面」的标记。
      //
      // ⚠️ **为什么只有这一项要回放，而帧与 presence 不回放**：那两项是**流**，学生端
      // 每 10 秒 / 每次交互都会重发，教师等一会儿自然就看到当前状态；而这条是
      // **一次性的粘性事件**（SDK 放弃时发一次，之后约每分钟才可能重发），不回放的话
      // 教师中途进来会看到「等待画面…」—— 那句话说的是「第一帧还在路上」，与事实不符。
      // 一句话：**流的等待是有界的，粘性事件的等待是无限的。**
      for (const key of webappMonitor.captureBlocked.keys()) {
        const ids = splitWebappKey(key, classroomId);
        if (!ids) continue;
        socket.emit('webapp-student-capture-blocked', {
          studentId: ids.studentId,
          webappId: ids.webappId,
          at: webappMonitor.captureBlocked.get(key)!.at,
        });
      }
      socket.join(webappMonitorRoom(classroomId));
      // 有人回来了：取消待触发的「停止推流」（Ruling 9 第 2 条的防抖）。
      cancelDemandNotification(classroomId);
      broadcastWebappDemand(io, prisma, classroomId);
      console.log(`[Socket] Teacher watching webapp monitor: ${classroomId}`);
    });

    /**
     * 教师点开 / 关掉某个学生的详情 —— 决定**那个学生**要不要转高频截图。
     *
     * ⚠️ 鉴权与订阅同款（教师 cookie + 课堂绑定）。这不只是形式：这条直接改变
     * **学生设备**的开销，是少数几个「教师端能让学生的老 iPad 多干活」的入口之一。
     * 失败一律静默返回，不给探测者任何反馈。
     *
     * 不 gate 在「此刻有没有 watcher」上：焦点可以先于订阅到达（教师恢复页面时
     * 抽屉本来就是开的），随后 `watch-webapp-monitor` 会用 broadcastWebappDemand
     * 把正确的组合一起发出去。
     */
    socket.on('focus-webapp-student', (raw: unknown) => {
      const payload = validateWebappFocusPayload(raw);
      if (!payload) return;
      const boundClassroomId = socket.data.classroomId as string | undefined;
      if (
        !hasTeacherSessionCookie(socket.handshake.headers.cookie) ||
        (boundClassroomId !== undefined && boundClassroomId !== payload.classroomId)
      ) {
        return;
      }
      if (payload.studentId) webappMonitor.focus.set(payload.classroomId, payload.studentId);
      else webappMonitor.focus.delete(payload.classroomId);
      broadcastWebappDemand(io, prisma, payload.classroomId);
    });

    /**
     * 学生上报「我此刻在看哪个模块」（P2.3 的看板「跟随」模式）。`moduleId: null` = 首页。
     *
     * ⚠️ 判据是 **socket.data**（join-classroom 时经令牌校验写进去的），不是载荷自报的
     * classroomId —— 载荷只用来与 socket 会话**比对**，不采信它。
     *
     * ⚠️ 模块 key 走白名单：只认三件套与 null。拼错的**整条丢掉**，不要把垃圾写进状态
     * —— 教师端的「跟随」会照着它渲染，写进去就会渲染出一个不存在的模块。
     */
    socket.on('module-focus', (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      const d = data as { classroomId?: unknown; moduleId?: unknown };
      const classroomId = socket.data.classroomId as string | undefined;
      const studentId = socket.data.studentId as string | undefined;
      if (!classroomId || !studentId) return;
      if (d.classroomId !== classroomId) return;

      let moduleId: string | null;
      if (d.moduleId === null || d.moduleId === undefined) moduleId = null;
      else if (d.moduleId === 'worksheet' || d.moduleId === 'explore' || d.moduleId === 'companion') moduleId = d.moduleId;
      else return;

      const now = Date.now();
      webappMonitor.moduleFocus.set(`${classroomId}:${studentId}`, { moduleId, at: now });
      io.to(`teacher:${classroomId}`).emit('student-module-focus', { studentId, moduleId, at: now });
    });

    /**
     * 取消订阅。
     *
     * ⚠️ 这里**故意不做鉴权**，与订阅不对称：离开是一个**降级**动作，永远不会多给出
     * 任何权限；而如果因为它失败了（教师会话刚好过期，或 T7 卸载时 socket 已重连），
     * 房间就永远留着 → hasWatchers 恒为真 → **学生端一直推流**（T7 brief 明写
     * 「unwatch 不能省」说的就是这个）。降级动作失败的方向必须是安全的那一侧。
     *
     * ⚠️ 与订阅那侧的「顺序耦合」无关：本 handler **从来没有读过 `socket.data.*`**
     * （只用 `socket.id` 与房间名），所以它本来就不受 join-teacher-board 先后的影响。
     * 它的「不对称」是刻意的安全取舍，不是为了绕开顺序问题 —— 别把它改成对称的。
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
      // ⚠️ **焦点必须一起清掉。** 教师离开视图时抽屉自然也没了，但 `focus` 是服务端
      // 自己的一份状态，不会跟着客户端的卸载走。留着它的后果是：教师下次再进来、
      // 而某个学生恰好还是那个 studentId ⇒ 那个学生**一上来就是 detail 档**，
      // 白白按 2 秒一帧烧自己的设备，而教师根本没点开他。
      webappMonitor.focus.delete(classroomId);
      if (!hasWatchers(io, classroomId)) scheduleDemandNotification(io, prisma, classroomId);
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
              include: { materials: true },
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

        // 该用哪个智能体：**唯一**的口径在 `resolveMaterialTargetId` 里。
        // 这里只负责把「课堂里有哪些组的哪份材料」与「课堂级那一份」喂给它。
        //
        // 🔴 高级模式下**不得回落**到课堂级：那个数组在高级模式里曾是「各组智能体的并集」，
        //    回落到它等于让学生静默地跟另一个组的智能体对话（错名字、错提示词、错平台账号），
        //    而 AI 正常回答、教师完全看不出（§1.2 ①）。
        const agentId = resolveMaterialTargetId({
          mode: classroom.mode,
          studentGroupId: classroomStudent.groupId,
          groupMaterials: classroom.groups.flatMap((g) => g.materials.map((m) => ({
            groupId: g.id, kind: m.kind, targetId: m.targetId,
          }))),
          classroomLevelId: classroom.classroomAgents[0]?.agentId ?? null,
          kind: 'agent',
        });
        // `agentById` 直接由**已有的那一次** classroom 查询构成，不额外查库：
        // 它完整覆盖标准/分组模式（那两种模式的权威来源就是课堂级，§4.4）⇒ 那两条路径
        // **零额外查询**。高级模式的目标（组级材料指向的智能体）通常不在其中，缺了才补
        // **至多一次** `findUnique` —— 比按「本课堂所有组的 agent 材料」一次 `findMany(in …)`
        // 更省（这里只关心当前这一个学生的那一个智能体）。
        const agentById = new Map(classroom.classroomAgents.map((ca) => [ca.agentId, ca.agent]));
        const agent = agentId
          ? (agentById.get(agentId) ?? await prisma.agent.findUnique({ where: { id: agentId } }))
          : null;
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

      // 探究空间监控的订阅记账：Socket.IO 会在断开时自动把本 socket 从所有房间摘掉
      // （所以 hasWatchers 立刻就是对的），但 watchers 这个 Map 是我们的账本，必须自己清 ——
      // 不清的话它不仅会无界增长，还会让「这个课堂还有没有订阅者」永远说不清。
      // 归零则走与 unwatch 相同的防抖路径。
      for (const [watchedClassroomId, socketIds] of webappMonitor.watchers) {
        if (!socketIds.delete(socket.id)) continue;
        if (socketIds.size === 0) webappMonitor.watchers.delete(watchedClassroomId);
        if (!hasWatchers(io, watchedClassroomId)) scheduleDemandNotification(io, prisma, watchedClassroomId);
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
