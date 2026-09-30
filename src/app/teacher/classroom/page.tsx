'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo, Suspense, useLayoutEffect, Fragment, type ReactNode, type Ref } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { WordCloud, type Word, type WordRendererData } from "@isoterik/react-word-cloud";
import { api } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { stripImages, stripMarkdownToPlainText, Markdown } from '@/lib/markdown';
import { getApiBaseUrl, getClassroomPort } from '@/lib/api-base';
const API_BASE = getApiBaseUrl();
function fixSvgUrl(svg: string) { return svg ? svg.replace(/href="\/uploads\//g, `href="${API_BASE}/uploads/`) : svg; }
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import { Toast } from '@/lib/components';
import { useWebappMonitor } from './use-webapp-monitor';
import { ExploreDetailPanel, ExploreMemberStrip, ExploreTile } from './explore-tiles';
import { WorksheetTileContent } from './worksheet-tiles';
import { MatrixOverlay } from './matrix-overlay';
import { AnalysisOverlay } from './analysis-overlay';
import { QuestionStatsOverlay } from './question-stats-overlay';
import { clearConfirmText, participantOverview } from './worksheet-drawer-state';
import { resolveRewardScale } from '@/lib/worksheet-reward';
import { activeAnswer, moduleCountUnit, stateHasCells, tileBadgeText, tileShowsWorksheetClear, worksheetTileState, type TileBadge } from './worksheet-tile-state';
import { WorksheetDrawer, type WorksheetDrawerEntry, type WorksheetDrawerView } from './worksheet-drawer';
import { useWorksheetBoard } from './use-worksheet-board';
import { applyModuleState, DEFAULT_MODULE_STATE, isClassroomModuleKey, isClassroomModuleState, isModuleId, MODULE_KEY_BY_ID, MODULE_KEYS, MODULE_STATES, moduleStateOf, type ModuleId } from '@/lib/classroom-modules';
import { cardInOnlineModule, onlineModuleDistribution, onlineTotal, resolveFocus, unplacedNote, type FocusModule } from './board-module-counts';
import { COMPANION_MENU_ITEMS, HEADER_BUSY_KEYS, WORKSHEET_MENU_ITEMS, headerControlGroups, headerLayout, type HeaderControlId } from './header-controls';
// ★ 2026-09-30：逐题开放。`normalizeOpenQuestions` 收线缆上那份 id 清单（判据在那个文件里），
// 浮层是这一屏的第三个「按学习单看全班」的工具。
import { normalizeOpenQuestions } from '@/lib/worksheet-answer-mode';
import { WorksheetOpenOverlay } from './worksheet-open-overlay';
import { effectiveGroupAgent, effectiveGroupWorksheet } from '@/lib/classroom-material';
import { AgentNavigationIcon, ExploreSpaceNavigationIcon, WorksheetNavigationIcon } from '@/lib/navigation-icons';
import type { AvatarSummary, ClassroomCardGroup, ClassroomCardMessage, ClassroomCardStudent, ClassroomDetail, ClassroomMessage, ClassroomModuleKey, ClassroomModuleSetting, ClassroomModuleState, StudentSummary, WorksheetMaterialSummary } from '@/lib/types';
import type { Socket } from 'socket.io-client';

type ClassroomGroupDisplay = { id: string; name: string };
type DisplayMessage = Pick<ClassroomMessage, 'content' | 'role' | 'createdAt' | 'roundIndex' | 'fileUrls' | 'fileNames'> & { id?: string };
type ClassroomGroupCard = { group: ClassroomCardGroup | null; members: ClassroomCardStudent[] };
type ClassroomDisplayCard = ClassroomCardStudent | ClassroomGroupCard;
type StudentBoardFilter = 'all' | 'online' | 'thinking' | 'attention' | 'offline';
/** 第二组筛选胶囊（按模块）的取值。`all` = 不按模块筛。 */
type StudentModuleFilter = 'all' | TileModule;

function isClassroomGroupCard(card: ClassroomDisplayCard): card is ClassroomGroupCard {
  return 'members' in card;
}

/**
 * ★ 2026-09-30：把线缆上那份「逐题开放」映射收干净（`/api/classroom/:id` 的 `worksheetOpen`）。
 *
 * ⚠️ 老服务端不发这一格 ⇒ **空映射**（= 一份单都没开放），不是「全部开放」：
 * 后者会把一份设了手动静止的卷子整个放开，而屏幕上没有任何异常。
 * ⚠️ 每个键上的清单再过一遍 `normalizeOpenQuestions`（坏形状丢掉）——
 * 与 socket 那条广播**共用同一个判据**，不在这里另写一份。
 */
function normalizeOpenMap(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [worksheetId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!worksheetId) continue;
    const ids = normalizeOpenQuestions(value);
    if (ids.length > 0) out[worksheetId] = ids;
  }
  return out;
}

function getGroupInitial(name?: string | null): string {
  return Array.from(name?.trim() || '')[0] || '组';
}

function PermissionMenuItem({ label, enabled, busy, onToggle }: {
  label: string;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}) {

  return (
    <button role="menuitemcheckbox" aria-checked={enabled} disabled={busy} onClick={onToggle}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px', border: 0, borderRadius: 8, background: 'transparent', cursor: busy ? 'wait' : 'pointer', color: '#334155', textAlign: 'left', fontSize: '0.813rem', opacity: busy ? 0.7 : 1 }}>
      <span style={{ width: 34, height: 20, padding: 2, borderRadius: 999, background: enabled ? '#527198' : '#cbd5e1', display: 'flex', justifyContent: enabled ? 'flex-end' : 'flex-start', transition: 'all .15s', flexShrink: 0 }}>
        <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(15,23,42,.2)' }} />
      </span>
      <span style={{ flex: 1 }}>{busy ? '更新中...' : label}</span>
      <span style={{ color: enabled ? '#3f7859' : '#94a3b8', fontSize: '0.75rem' }}>{enabled ? '已开启' : '已关闭'}</span>
    </button>
  );
}

/**
 * ⊘ ★ 2026-09-29 **删除** `PermissionSection`（原来是「课堂权限」浮窗里画段标题 + 分隔线的那一层）。
 *
 * 它随那次拆分一起失去了对象：那个浮窗按模块拆成「探究空间」与「智能学伴」两个
 * （各自一个 `SettingsDialog`），而**每个弹窗现在只有一段** —— 段标题与弹窗标题是同一句话，
 * 分隔线也没有第二段可隔。
 *
 * ⚠️ 按本仓的规矩留一句带日期的话，而不是让它悄悄消失：下次有人想给弹窗分段时，
 * `git log` 里能找到它，直接捡回来即可（它的实现是「标题 + 可选 note + 条件画上分隔线」）。
 */

/** 模块名与三态的中文文案。用 Record<联合类型, string> 是为了让三态词汇表扩项时这里报错。 */
const MODULE_LABELS: Record<ClassroomModuleKey, string> = {
  'learning-sheet': '学习单',
  explorer: '探究空间',
  companion: '智能学伴',
};

/**
 * 教师端的三态中文名。★ 2026-09-29（教师）：「将**预告**改成**暂停**」。
 *
 * 🔴 改的只是**中文标签**，`preview` 这个值一个字没动（改值 = 库 + API + 三份校验表
 * 一起动，换不来任何功能）。语义随之偏了一点，如实记下：
 * `preview` 原来叫「预告」（即将开放），现在叫「暂停」（本来能用、暂时不能）——
 * 两者靠同一句话活在同一个格子里：**这个模块是有的，但现在用不了**。
 * ⚠️ 所以**学生端那句话**（`use-module-tabs.ts` / `student-home.tsx`）必须同时照顾这两种来意，
 * 不能写成「即将开放」（对一个刚被暂停的模块，那是一句假话）。
 */
const MODULE_STATE_LABELS: Record<ClassroomModuleState, string> = {
  open: '开放',
  preview: '暂停',
  hidden: '隐藏',
};

/**
 * 同一个中文名，按 `ModuleId`（前端语义名）索引。
 *
 * 不重写一份字面量：`MODULE_LABELS` 已经按后端 key 存了这三个名字，这里只是**换一把钥匙**
 * ——写第二份字面量就是给自己留一个会漂移的副本（改了一处、另一处照旧）。
 * `satisfies Record<ModuleId, string>` 保证漏掉一个模块时**编译失败**。
 */
const MODULE_ID_LABELS = {
  worksheet: MODULE_LABELS[MODULE_KEY_BY_ID.worksheet],
  explore: MODULE_LABELS[MODULE_KEY_BY_ID.explore],
  companion: MODULE_LABELS[MODULE_KEY_BY_ID.companion],
} as const satisfies Record<ModuleId, string>;

/**
 * 三态那三个按钮上的说明（鼠标悬浮可见）。
 *
 * ★ 2026-09-29：`preview` 那条按教师的要求改了口径 —— 原来写「学生可见但被锁定」
 * （描述界面的样子），现在写**学生会看到什么、老师该期待什么**。
 * 教师这次的原话是「暂停状态主要是**提醒学生**，这个模块是有的，但是目前暂时不能用」
 * —— 那句话是给学生的，教师这一侧就要说清楚他会看到什么。
 */
const MODULE_STATE_HINTS: Record<ClassroomModuleState, string> = {
  open: '学生可直接使用',
  preview: '学生看得见，但暂时用不了',
  hidden: '学生端不显示',
};

/**
 * 探究空间画面的分辨率档位。
 *
 * `hint` 是**实测的单帧体积**（真实教师网页、桌面浏览器），直接写在按钮上给教师看：
 * 采集的代价不是一个抽象概念，是每帧几十 K 字符的传输与存盘。640 一帧约 24K，
 * 已经占掉单条上限（32K）的七成以上 —— 教师看不到这个数字就没法判断值不值。
 * ⚠️ 这些是**实测值**，不是按宽度线性估算出来的，别"顺手改成公式"。
 */
const WEBAPP_WIDTH_OPTIONS: Array<{ width: number; hint: string }> = [
  { width: 160, hint: '约4.6K' },
  { width: 240, hint: '约7.5K' },
  { width: 320, hint: '约12.5K' },
  { width: 480, hint: '约22K' },
  { width: 640, hint: '约24K' },
];

/**
 * 画面更新的基准周期档位（毫秒）。服务端接受 5000~60000，这里只给几档常用的。
 *
 * ★ 2026-09-25：加了 **5 秒**（教师要求，并问「是否可行」）。**服务端零改动** ——
 * `WEBAPP_INTERVAL_MIN_MS` 本来就是 5000，这一档一直合法，只是界面上没给。
 *
 * ⚠️ 但它是**服务端写明的下界**，理由逐字在 `webapp-capture.ts`：
 * 「比这更密的话，学生端的截图开销会明显咬住课堂（而且网络也会变成持续负载）」。
 * ⇒ 这一档是**全班每个学生**都按它跑（详情档那个「只影响被聚焦的一个」是另一回事），
 * 40 人的班在 5 秒档上就是**每秒 8 帧**的聚合上传。教师选它要自己知道这件事。
 */
const WEBAPP_INTERVAL_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 5000, label: '5 秒' },
  { ms: 10000, label: '10 秒' },
  { ms: 15000, label: '15 秒' },
  { ms: 20000, label: '20 秒' },
  { ms: 30000, label: '30 秒' },
];

// 缺省值必须与服务端 `DEFAULT_WEBAPP_CAPTURE` 一致（320 / 10000）。
// 教师端拿到的可能是老数据（没有这三个字段），此时按默认显示 —— 而不是显示成"关闭/最小档"。
const DEFAULT_WEBAPP_WIDTH = 320;
const DEFAULT_WEBAPP_FRAME_INTERVAL_MS = 10000;

/**
 * **详情档**那一档的档位与派生规则（★ 2026-09-25）。
 *
 * 🔴 这四个数必须与服务端 `server/src/services/webapp-capture.ts` 的
 * `WEBAPP_DETAIL_DIVISOR` / `WEBAPP_DETAIL_MIN_MS` / `WEBAPP_DETAIL_MAX_MS` 逐字一致：
 * 客户端拿它**画选中态**、服务端拿它**算下发的真实周期**，两边不一致的表现是
 * 「面板上选着 3 秒，学生端按 2 秒在跑」—— 没有任何地方会报错。
 *
 * ⚠️ 为什么客户端要自己算一遍派生值：详情面板上那个控件必须**停在一个档位上**，
 * 而「没调过」时停在哪儿只有派生规则说了算。**权威仍在服务端**（真正下发给学生的是它算的）；
 * 这里算的只用于显示。
 */
const WEBAPP_DETAIL_DIVISOR = 5;
const WEBAPP_DETAIL_MIN_MS = 1000;
const WEBAPP_DETAIL_MAX_MS = 5000;

/**
 * 采集参数里的一个档位按钮。
 *
 * 与下面的 ModuleStateRadio 刻意分开：那个的说明只进 `title`（悬停才可见），
 * 而这里每一档旁边必须**明明白白写着代价**，教师扫一眼就能比较。
 * 选中态、disabled、busy 的表现则与 ModuleStateRadio 保持一致（同一份菜单里两套观感会更糟）。
 */
function CaptureOption({ label, hint, selected, busy, disabled, onSelect }: {
  label: string;
  /** 副标注（分辨率档位用来写实测体积）。没有就不占位，行高靠 minHeight 对齐。 */
  hint?: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} aria-busy={busy} title={hint ? `${label}（${hint}）` : label}
      disabled={disabled} onClick={onSelect}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, minHeight: 34, padding: '4px 2px', border: `1px solid ${selected ? '#527198' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#f2f5f8' : 'white', color: selected ? '#466384' : '#475569', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
      <span>{busy ? '...' : label}</span>
      {hint && <span style={{ fontSize: '0.625rem', fontWeight: 400, color: selected ? '#3b82f6' : '#94a3b8' }}>{hint}</span>}
    </button>
  );
}

/**
 * 三态里的一个选项。与 PermissionMenuItem 的开关刻意分开：那是布尔、
 * role="menuitemcheckbox"；这里是三选一、role="menuitemradio"。混在一起
 * 会让同一份菜单里出现两套互斥语义，读起来像坏了。
 */
function ModuleStateRadio({ label, hint, selected, busy, disabled, onSelect }: {
  label: string;
  hint: string;
  selected: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} aria-busy={busy} title={hint}
      disabled={disabled} onClick={onSelect}
      style={{ flex: 1, minHeight: 30, padding: '5px 6px', border: `1px solid ${selected ? '#527198' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#f2f5f8' : 'white', color: selected ? '#466384' : '#475569', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1 }}>
      {label}
    </button>
  );
}

/**
 * 设置弹窗的**共用外壳**（★ 2026-09-29）：遮罩 + 标题栏 + 关闭按钮 + 焦点锚点。
 *
 * 🔴 抽出来是因为这一天它从**一个**变成了**两个**（「课堂权限」按模块拆成
 * 「探究空间」与「智能学伴」）。两处各写一份的话：关闭按钮的 `aria-label`、
 * `zIndex`、圆角、`maxWidth` 会各长各的 —— 而它们并排出现在同一个工具栏上，
 * 差一点点就看得出来。
 *
 * `open` 为假时**什么都不渲染**（含遮罩）：调用方因此可以直接把两个都写在 JSX 里，
 * 不必在两边各套一层条件。
 *
 * ⚠️ `dialogRef` 是**焦点锚点**：打开时把焦点移进这个盒子（`tabIndex={-1}`），
 * 关闭时由调用方还回触发按钮 —— 少了「进」这一步，键盘与读屏用户感知不到自己刚打开了窗。
 * ⚠️ **没有 `PermissionSection` 的分段线了**：每个弹窗现在只有一段（标题已经说明了范围）。
 */
function SettingsDialog({ open, title, subtitle, dialogRef, maxWidth = 560, onClose, children }: {
  open: boolean;
  title: string;
  /** 可选的一句话，排在标题栏下面、控件上面。 */
  subtitle?: string;
  dialogRef?: Ref<HTMLDivElement>;
  /** ★ 2026-09-29：词云那个弹窗要宽得多（它是两栏的词云 + TOP10）⇒ 提成参数。 */
  maxWidth?: number;
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" style={{ zIndex: 400 }} onClick={onClose}>
      <div ref={dialogRef} className="modal-content" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth, padding: 0, borderRadius: 14, outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px', borderBottom: '1px solid #e2e8f0', borderTopLeftRadius: 14, borderTopRightRadius: 14, background: 'linear-gradient(135deg, #f8faff, #f0f4ff)' }}>
          <h3 style={{ margin: 0, flex: 1, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{title}</h3>
          <button type="button" aria-label={`关闭${title}设置窗口`} onClick={onClose}
            style={{ width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '6px 12px 10px' }}>
          {subtitle && (
            <div style={{ padding: '10px 10px 4px', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.6 }}>{subtitle}</div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * 「对话分析」弹窗（★ 2026-09-29，教师：「把词云的这块功能迁移到下方『智能学伴』这个下拉按钮
 * 里边，专门给它设置一个选项，后弹出一个**弹窗**来显示」）。
 *
 * 🔴 它**不是新写的**：里面就是原来那块 `AnalyticsPanel`（高频词云 + 活跃学生 TOP 10），
 * 一行逻辑都没改 —— 换的只是**容器**（原来挂在看板上方那块面板里，现在在一个弹窗里）。
 * ⚠️ 所以「词云不见了」这个问题从此有两种成因，别混：**模块被设成 hidden**（学生端看不见学伴了，
 * 那块统计也就无从谈起，见调用点）／**智能体没配**（`AnalyticsPanel` 会显示空态）。
 * 弹窗比原来的面板宽（`maxWidth: 960`）：词云是两栏布局，560 会把 TOP10 挤成两行。
 */
function WordCloudDialog({ classroomId, allMessages, loadAnalytics, onClose }: {
  classroomId: string;
  allMessages: ClassroomMessage[];
  loadAnalytics: () => void;
  onClose: () => void;
}) {
  return (
    <SettingsDialog open title="对话分析" maxWidth={960} onClose={onClose}>
      <AnalyticsPanel classroomId={classroomId} allMessages={allMessages} loadAnalytics={loadAnalytics} />
    </SettingsDialog>
  );
}

/**
 * 「智能学伴」那个下拉的**面板**（★ 2026-09-29，教师：「把词云的这块功能迁移到下方
 * 『智能学伴』这个下拉按钮里边，专门给它设置一个选项，后弹出一个弹窗来显示」）。
 *
 * 两项：**对话分析**（词云弹窗）与**设置**（四项能力开关）。名字在判据层
 * （`COMPANION_MENU_ITEMS`，有用例钉着），这里只把 id 接到动作。
 * ⚠️ 与「学习单」「模块状态」那两个菜单**同住一层的写法**（`position: relative` 的包裹层
 * 是锚点，面板 `absolute; right: 0; top: 100% + 8`）。
 */
function CompanionMenu({ onSelect, onClose }: {
  onSelect: (id: 'analysis' | 'settings') => void;
  onClose: () => void;
}) {
  return (
    <div role="menu" aria-label="智能学伴" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 80, width: 216, padding: 6, borderRadius: 12, background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 16px 40px rgba(15,23,42,0.14)' }}>
      {COMPANION_MENU_ITEMS.map((item) => (
        <button key={item.id} type="button" role="menuitem" title={item.title}
          onClick={() => { onClose(); onSelect(item.id); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderRadius: 8, background: 'transparent', color: '#334155', fontSize: '0.813rem', fontWeight: 600, cursor: 'pointer' }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 「学习单」那个下拉的**面板**（★ 2026-09-29，教师：「『学习单』改名为『答题分析』，
 * 『矩阵』改名为『进度矩阵』，两者合并成一个『学习单』，通过鼠标点击下拉后选择」）。
 *
 * 🔴 各项的**名字**在 `WORKSHEET_MENU_ITEMS`（判据层，有用例钉着）—— 这里只把 id 接到动作。
 * 少了那一条的话，「有哪几项、叫什么」会只活在这段 JSX 里，删掉一项没有任何东西会红。
 * ★ 2026-09-30：「逐题开放」成了第三项（`id: 'open'`），本组件只负责把它递出去。
 *
 * ⚠️ 与「模块状态」那个菜单**同住一层的写法**：包住按钮与面板的那一层带
 * `position: relative`（`worksheetMenuRef`），面板 `absolute; right: 0; top: 100% + 8`。
 * 这也是「点外面关」那条监听的锚点。
 */
function WorksheetMenu({ onSelect, onClose }: {
  onSelect: (id: (typeof WORKSHEET_MENU_ITEMS)[number]['id']) => void;
  onClose: () => void;
}) {
  return (
    <div role="menu" aria-label="学习单" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 80, width: 216, padding: 6, borderRadius: 12, background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 16px 40px rgba(15,23,42,0.14)' }}>
      {WORKSHEET_MENU_ITEMS.map((item) => (
        <button key={item.id} type="button" role="menuitem" title={item.title}
          onClick={() => { onClose(); onSelect(item.id); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, borderRadius: 8, background: 'transparent', color: '#334155', fontSize: '0.813rem', fontWeight: 600, cursor: 'pointer' }}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 「模块状态」那个下拉菜单的**面板**（★ 2026-09-29 从头部 JSX 里搬出来）。
 *
 * 🔴 搬出来是**为了配合「控件由判据表驱动」**：按钮现在由 `header.controls.map` 画，
 * 而那个菜单必须与按钮**同住一层**（它的锚点是包住两者的 `modulesMenuRef`，
 * `position: absolute; right: 0; top: calc(100% + 8px)` 靠那一层的 `position: relative`）。
 * 留在原处的话，它就会变成 `map` 里的一块 40 行 JSX。
 *
 * ⚠️ **行为一个字没改**（连文案与样式一起搬的）。四个入参是它真正用到的东西，
 * 没有顺手把 `classroom` 整个递进来 —— 那会把这个组件的依赖面扩到整间课堂。
 */
function ModuleStateMenu({ modules, busy, neverConfigured, onSelect }: {
  modules: readonly ClassroomModuleSetting[] | undefined;
  busy: string | null;
  neverConfigured: boolean;
  onSelect: (moduleKey: ClassroomModuleKey, state: ClassroomModuleState) => void;
}) {
  return (
    <div role="menu" aria-label="课堂模块状态" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 80, width: 288, padding: 8, borderRadius: 12, background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 16px 40px rgba(15,23,42,0.14)' }}>
      <div style={{ padding: '6px 10px 8px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>课堂模块</div>
      {neverConfigured && (
        <div style={{ margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: '0.75rem', lineHeight: 1.5 }}>
          本课堂未单独配置过模块，以下三项均为默认的「暂停」态。
        </div>
      )}
      {MODULE_KEYS.map((moduleKey) => {
        const currentState = moduleStateOf(modules, moduleKey);
        const moduleBusy = busy === `module:${moduleKey}`;
        return (
          <div key={moduleKey} role="group" aria-label={MODULE_LABELS[moduleKey]} style={{ padding: '4px 10px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.813rem', color: '#334155' }}>
              <span style={{ flex: 1 }}>{MODULE_LABELS[moduleKey]}</span>
              {moduleBusy && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>更新中...</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {MODULE_STATES.map((state) => (
                <ModuleStateRadio key={state}
                  label={MODULE_STATE_LABELS[state]}
                  hint={MODULE_STATE_HINTS[state]}
                  selected={currentState === state}
                  busy={moduleBusy}
                  disabled={busy !== null}
                  onSelect={() => onSelect(moduleKey, state)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 看板上的一个「段选」按钮（跟随/指定，以及指定模式下的三选一）。
 *
 * 与 `ModuleStateRadio` 刻意分开：那个是**菜单里的**选项（`role="menuitemradio"`，
 * 生命周期跟着菜单走），这个是常驻在筛选行上的开关，用 `aria-pressed` 而不是
 * `menuitemradio` —— 挂在菜单语义下的常驻控件会让读屏把它念成菜单的一部分。
 */
function SegmentedButton({ label, hint, selected, onSelect }: {
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} title={hint} onClick={onSelect}
      style={{ minHeight: 30, padding: '5px 10px', border: `1px solid ${selected ? '#527198' : '#e2e8f0'}`, borderRadius: 8, background: selected ? '#f2f5f8' : 'white', color: selected ? '#466384' : '#475569', cursor: 'pointer', fontSize: '0.75rem', fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
}

/**
 * 模块筛选行里的一个胶囊（原「此刻各模块人数」里的一个计数块）。
 *
 * P2.3 修正把这一行从**纯信息**变成**筛选器**：原来顶部那张卡里显示的是同一批数字，
 * 两处并存会让人以为是冗余，所以只留一处 —— 留下的这处必须能点，于是计数块本身
 * 改成了按钮（用户 2026-09-23：「另加一组」，不是替换已有的状态筛选）。
 *
 * `muted` 保留原义：**不是三件套**的（首页 / 未知），以及**尚未支持**的学习单
 * —— 它们与真正能用的模块不是一个分量，同样的着色会让人以为它们也一样能用。
 */
function ModuleCountChip({ label, value, unit, hint, muted = false, tone = 'default', selected, onSelect }: {
  label: string;
  value: number;
  /** ★ M5a：量词（「人」/「组」）。放在数字后面，字号比数字小一档。 */
  unit?: string;
  hint?: string;
  muted?: boolean;
  /**
   * `attention` ⇒ 红字红底。
   *
   * ★ 2026-09-25：合并筛选行时从这里收进来的 —— 「需关注」那一格原来是**内联 button**，
   * 有自己的红档（有值得注意的人时整格泛红）。合并后六个格子必须**同一个组件**，
   * 否则一行里两种长相，教师会以为它们是两类东西。
   */
  tone?: 'default' | 'attention';
  selected: boolean;
  onSelect: () => void;
}) {
  const idleColor = muted ? '#94a3b8' : tone === 'attention' ? '#934e4e' : '#475569';
  const numberColor = muted ? '#cbd5e1' : tone === 'attention' ? '#934e4e' : '#466384';
  return (
    <button type="button" aria-pressed={selected} title={hint} onClick={onSelect}
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap',
        minHeight: 32, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${selected ? '#527198' : tone === 'attention' ? '#fecaca' : '#e2e8f0'}`,
        background: selected ? '#527198' : tone === 'attention' ? '#f8eeee' : 'white',
        color: selected ? 'white' : idleColor,
        fontSize: '0.813rem', fontWeight: selected ? 600 : 500,
      }}>
      <span>{label}</span>
      <span style={{ fontSize: '1rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: selected ? 'white' : numberColor }}>{value}</span>
      {unit && (
        <span style={{ fontSize: '0.688rem', fontWeight: 500, color: selected ? 'rgba(255,255,255,.85)' : '#94a3b8' }}>
          {unit}
        </span>
      )}
      {hint && <span style={{ fontSize: '0.625rem', color: selected ? 'rgba(255,255,255,.75)' : '#cbd5e1' }}>{hint}</span>}
    </button>
  );
}

/**
 * 看板模式（P2.3）—— 两个视图（`board` / `webapp`）合成一个之后，格子内容改由它决定：
 *   · `follow` 每格显示**该学生此刻在用**的模块；
 *   · `assign` 全班格子统一显示教师选定的那一个模块。
 */
type BoardMode = 'follow' | 'assign';

/**
 * 徽章行里那个模块相关的徽章（`null` = 这一格不该有它）。
 *
 * ⚠️ 它在**主看板与全屏网格两处**都渲染，而这两个地方本来就是逐字重复的两段 JSX
 * （`renderTileContent` 那条注释说的就是这件事）。抽成一个组件，是为了让这条规则只写一遍
 * —— 两处各写一份必然在某一处先漂移。
 *
 * ★ 2026-09-28：**现在只剩学伴那一档**（学习单的「已交 N/M」随教师第 5 条去掉）。
 * 那两个分支（`badge.kind === 'rounds' ? … : …`）随之收成一个 —— 留着一个永远走不到的
 * 分支会让下一个人以为学习单还会发徽章。
 */
function TileBadgeChip({ badge, compact = false }: { badge: TileBadge; compact?: boolean }) {
  return (
    <div
      title="对话轮数（只在智能学伴模块下显示）"
      style={{
        padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6,
        fontSize: compact ? 8 : '0.625rem', fontWeight: 600,
        background: badge.rounds > 0 ? '#eef3f8' : '#f3f4f6',
        color: badge.rounds > 0 ? '#527198' : '#9ca3af',
        whiteSpace: 'nowrap',
      }}>
      {tileBadgeText(badge)}
    </div>
  );
}

/**
 * ★ 2026-09-25（教师截图批注）：格子上的**模块指示字**。
 *
 * 教师原话：「增加一个当前监看的三件套中哪一个的状态图标，简单的用『学』『探』『智』来演示，
 * 好看一些」。
 *
 * 🔴 为什么值得一个专门的指示：格子正文虽然已经画着当前模块的内容，但**四十个格子扫过去**
 * 时，「这一格是探究网页的截图 / 学习单的表 / 学伴的对话」要靠逐格辨认内容才分得出来。
 * 一个汉字就够扫了 —— 这也是它只在**一个字**上做的原因，写成「学习单」三个字反而变慢。
 *
 * ⚠️ 颜色**与学生端 `MODULE_META` 的 `accent` 同源**（学习单蓝 / 探究空间紫 / 智能学伴青）：
 * 学生在卡片上认到的颜色、进到模块里看到的颜色、教师在看板上看到的颜色是同一个，
 * 这条在 §4.6 就立过。改这里必须同步改 `src/app/classroom/module-meta.tsx`。
 */
const MODULE_INITIALS: Record<ModuleId, { char: string; color: string; bg: string }> = {
  worksheet: { char: '学', color: '#527198', bg: '#f2f5f8' },
  explore: { char: '探', color: '#7c3aed', bg: '#f5f3ff' },
  companion: { char: '智', color: '#0e7490', bg: '#ecfeff' },
};

/** 「首页」那一档：不在任何模块里，但**也不是不知道**（与 `unknown` 是两回事）。 */
const HOME_INITIAL = { char: '首', color: '#94a3b8', bg: '#f1f5f9' };

/**
 * 一个格子的「他此刻在哪一件套」。
 *
 * ⊘ 两种情况**刻意什么都不画**：
 *   · `unknown` —— 还没收到这个学生的 focus。画一个「？」会把「不知道」说成一个状态，
 *     而刚上课那几十秒里几乎每一格都是它，一屏问号纯属噪声；
 *   · `mixed`  —— **组内成员此刻不在同一个模块**。画任何**一个**字都是**撒谎**
 *     （这正是 `GroupTileModule` 比 `TileModule` 多出 `mixed` 这一档的理由）。
 *     组内逐人的位置由 `tileLocationNote` 说，那是另一个读者、另一个时机。
 *
 * ⚠️ 无障碍：一个光秃秃的「学」对读屏是无意义的，所以给整块 `role="img"` +
 * `aria-label`，汉字本身 `aria-hidden`。本仓立过「图标化只减视觉宽度、不减无障碍信息」。
 */
function ModuleInitialChip({ module, compact = false }: { module: GroupTileModule; compact?: boolean }) {
  if (module === 'unknown' || module === 'mixed') return null;
  const meta = module === 'home' ? HOME_INITIAL : MODULE_INITIALS[module];
  const label = module === 'home' ? '首页' : MODULE_ID_LABELS[module];
  return (
    <div
      role="img"
      aria-label={`当前在：${label}`}
      title={`当前在：${label}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: compact ? 14 : 18, height: compact ? 14 : 18, padding: '0 4px',
        borderRadius: compact ? 4 : 6,
        fontSize: compact ? 8 : 10, fontWeight: 700, lineHeight: 1,
        background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
      }}>
      <span aria-hidden="true">{meta.char}</span>
    </div>
  );
}

/**
 * 一个格子**内容区**该渲染什么。
 *   · `ModuleId`  —— 三件套之一（跟随模式下由该学生的 focus 决定，指定模式下是教师选的）
 *   · `'home'`    —— 学生此刻停在**首页**（focus 明确是 `null`）
 *   · `'unknown'` —— 还没收到这个学生的 focus。**不猜**：猜一个模块会让教师看到
 *                    一个不存在的事实（比一句「不知道」糟得多）。
 *
 * ★ 2026-09-29：定义**搬到** `board-module-counts.ts`（那边叫 `FocusModule`）。
 * 这里留一个别名，是因为「这一格显示什么」与「他在哪个模块」在**两个文件里都要用**，
 * 而两份结构相同、各自声明的联合类型**不会互相报错** —— 加第四个模块时只改一处，
 * 另一处静默地少一个成员。别名让定义只有一份。
 */
type TileModule = FocusModule;

/** 小组格子专用：组内成员此刻**不在同一个模块**。 */
type GroupTileModule = TileModule | 'mixed';

type StudentPresenceEvent = { studentId: string };
type StudentThinkingEvent = StudentPresenceEvent & { status: boolean };
type StudentMessageEvent = StudentPresenceEvent & {
  content: string;
  role: string;
  roundIndex?: number | null;
  timestamp: string;
  shieldFiltered?: boolean;
  fileUrls?: string | null;
  fileNames?: string | null;
};
type ShieldWarningEvent = StudentPresenceEvent & { warningCount: number };
type StudentAvatarChangedEvent = StudentPresenceEvent & { avatarId: number | null; svgContent?: string | null };
type ClassroomPermissionEvent = { allow: boolean };

export default function ClassroomBoard() {
  return (
    <Suspense fallback={<div style={{textAlign:'center',padding:60,color:'#94a3b8',fontSize:14}}>加载中...</div>}>
      <ClassroomBoardContent />
    </Suspense>
  );
}

function ClassroomBoardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || '';

  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [students, setStudents] = useState<ClassroomCardStudent[]>([]);
  const [studentStatuses, setStudentStatuses] = useState<Record<string, string>>({});
  const [deepThinkingStatuses, setDeepThinkingStatuses] = useState<Record<string, boolean>>({});
  const [studentRounds, setStudentRounds] = useState<Record<string, number>>({});
  const [selectedStudent, setSelectedStudent] = useState<StudentSummary | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ClassroomGroupDisplay | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [selectedRounds, setSelectedRounds] = useState<number[]>([]);
  const [codeScreenKey, setCodeScreenKey] = useState(0);
  const [teacherCode, setTeacherCode] = useState('');
  const [studentUrl, setStudentUrl] = useState('');
  const [studentAvatars, setStudentAvatars] = useState<Record<number, string>>({});
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0 });
  const [loadingMessages, setLoadingMessages] = useState(false);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, offX: 0, offY: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);
  const selectedStudentIdRef = useRef<string | null>(null); // 避免 useEffect 依赖 selectedStudent 导致重复挂载 socket
  // 投屏弹窗打开时监听 Socket 网卡切换事件
  useEffect(() => {
    if (codeScreenKey > 0) {
      let socket: Socket | null = null;
      import('socket.io-client').then(({ io }) => {
        socket = io(getApiBaseUrl(), { transports: ['websocket', 'polling'] });
        socket.on('nic-changed', () => {
          fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' }).then(r => r.json()).then(d => {
            if (d.studentUrl) setStudentUrl(d.studentUrl);
          }).catch(() => {});
        });
      });
      return () => { if (socket) socket.disconnect(); };
    }
  }, [codeScreenKey]);
  // 加载头像 SVG
  useEffect(() => {
    api.getAvatarsAll('student').then(data => {
      const m: Record<number, string> = {};
      data.forEach((a: AvatarSummary) => { m[a.id] = a.svgContent; });
      setStudentAvatars(m);
    }).catch(() => {});
  }, []);

  // 全屏图片预览：ESC 关闭 + 滚轮缩放 + 鼠标拖拽
  useEffect(() => {
    if (!fullscreenImg) return;
    const d = dragRef.current;
    d.dragging = false; d.offX = 0; d.offY = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFullscreenImg(null); setZoomLevel(1); }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.abs(e.deltaY) < 20 ? e.deltaY * 0.005 : e.deltaY > 0 ? -0.12 : 0.12;
      setZoomLevel(prev => Math.max(0.3, Math.min(15, prev + step)));
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      d.dragging = true;
      d.startX = e.clientX - d.offX;
      d.startY = e.clientY - d.offY;
      if (overlayRef.current) overlayRef.current.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!d.dragging) return;
      d.offX = e.clientX - d.startX;
      d.offY = e.clientY - d.startY;
      setImgOffset({ x: d.offX, y: d.offY });
    };
    const onMouseUp = () => {
      if (d.dragging) {
        d.dragging = false;
        if (overlayRef.current) overlayRef.current.style.cursor = 'zoom-out';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [fullscreenImg]);

  const openFullscreenImage = (url: string) => {
    setZoomLevel(1);
    setImgOffset({ x: 0, y: 0 });
    setFullscreenImg(url);
  };


  /** 生成并下载带 Logo 的二维码图片 */
  const downloadQRCode = async () => {
    const qrValue = studentUrl ? `${studentUrl}?code=${teacherCode}` : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}/classroom?code=${teacherCode}`;
    const qrSize = 760;
    const textHeight = 70;
    const totalWidth = qrSize;
    const totalHeight = qrSize + textHeight;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d')!;

    await QRCode.toCanvas(canvas, qrValue, {
      width: qrSize,
      margin: 3,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });

    const logoSize = qrSize * 0.2;
    const cx = qrSize / 2, cy = qrSize / 2;
    const logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    await new Promise<void>((resolve) => {
      logoImg.onload = () => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2 + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
        ctx.restore();
        resolve();
      };
      logoImg.onerror = () => { resolve(); };
      logoImg.src = `/qr-logo.png`;
    });

    const title = classroom?.title || '互动课堂';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(title, qrSize / 2, qrSize + textHeight / 2);

    const link = document.createElement('a');
    link.download = `支点课堂-${teacherCode}-${title}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const [paused, setPaused] = useState(false);
  // ★ M5a：课堂级「锁定作答」。与 `paused` 同一类：本地乐观更新 + 收自己的广播校正。
  const [answersLocked, setAnswersLocked] = useState(false);
  /**
   * ★ 2026-09-30：课堂级「逐题开放」—— `{ [学习单 id]: [已开放的题 id…] }`。
   *
   * 两个来路（与 `answersLocked` 同一条纪律）：
   *   · **底**：`GET /api/classroom/:id` 的快照（刷新页面之后仍然要对）；
   *   · **校正**：`worksheet-open-changed` 广播 —— 服务端发的是**整张映射**，
   *     所以它一来就整张覆盖（别的标签页改了也立刻跟上）。
   * ⚠️ 本机点的那一下**先乐观更新**（写进去 → 再发请求），失败回滚 + 提示；
   *    而广播回来会把乐观那一份换成服务端那一份（两边一样，所以看不出跳动）。
   */
  const [worksheetOpen, setWorksheetOpen] = useState<Record<string, string[]>>({});
  /** 「逐题开放」那个浮层开着没有。 */
  const [showWorksheetOpen, setShowWorksheetOpen] = useState(false);
  /** 正在写开放清单（写的时候按钮要禁用：整份替换，两次并发会互相盖）。 */
  const [worksheetOpenBusy, setWorksheetOpenBusy] = useState(false);
  /**
   * 上面那一份的 ref（`loadClassroom` 要拿它做「这次快照是不是旧的」那个判断）。
   * ⚠️ 走 ref 而不是把它加进 `loadClassroom` 的依赖：那个回调进的是 socket 那个大 effect
   * 的依赖数组，换身份会让**所有监听器**重挂一遍（本仓已有这一条教训）。
   */
  const worksheetOpenRef = useRef<Record<string, string[]>>({});
  useEffect(() => { worksheetOpenRef.current = worksheetOpen; }, [worksheetOpen]);
  const [allMessages, setAllMessages] = useState<ClassroomMessage[]>([]);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  // ★ M5b：学习单矩阵的覆盖层。**第三份独立 state** —— 不参与「跟随 / 指定」的分支，
  // 也不共用 `gridFullscreen` 的列数与筛选（规格 §3.1 / GC 28）。
  const [matrixOpen, setMatrixOpen] = useState(false);
  /**
   * ★ M7a：正在看哪一道题的分析载荷（`null` = 没开）。
   * ⚠️ 与 `matrixOpen` **可以同时为真** —— 分析浮层（270）就叠在矩阵浮层（250）之上，
   * 关掉分析会回到矩阵，而不是回到课堂页。
   */
  const [analysisTarget, setAnalysisTarget] = useState<{ worksheetId: string; questionId: string } | null>(null);
  /**
   * ★ 2026-09-28：**按题统计浮层**开在哪一题（`null` = 没开）。规格 `specs/2026-09-28-按题统计与分析.md`。
   * 层级 293（在抽屉 291 之上）—— 它是从抽屉里点开的，关闭后回到题列表。
   */
  const [questionStatsTarget, setQuestionStatsTarget] = useState<{ worksheetId: string; questionId: string } | null>(null);
  /**
   * 看板模式（P2.3 把 `board` / `webapp` 两个视图合成了一个）。
   *
   * ⚠️ 这里**曾经**是 `teacherView: 'board' | 'webapp'` + `TeacherPageTabs` 的视图切换。
   * 两个视图各自有用的东西（学生的在线/轮数、探究空间的缩略图与「已打开/滚到哪」）
   * 现在都长在**同一批格子**里，切换按钮因此没有了存在意义。
   *
   * 默认 `follow`：教师绝大多数时候想知道「这个学生此刻在干什么」，
   * 而 `assign` 是一次主动的、有明确目的的选择（全班看同一个模块）。
   */
  const [boardMode, setBoardMode] = useState<BoardMode>('follow');
  /** 指定模式下全班统一显示的那个模块。默认「智能学伴」= 合并前那个视图的内容。 */
  const [assignModule, setAssignModule] = useState<ModuleId>('companion');
  /**
   * 学生 id → 他**此刻在哪个模块**（`null` = 首页）。数据源是 `student-module-focus`。
   *
   * ⚠️ 键不存在 = **还没收到**这个学生的 focus（不猜、也不按 null 处理）：
   * 服务端只对「已知状态」的学生回放，离线或从没切换过的学生本就没有状态。
   * 所以下面 `resolveTileModule` 用 `hasOwnProperty` 判在场，而不是读值判空。
   */
  const [studentModuleFocus, setStudentModuleFocus] = useState<Record<string, ModuleId | null>>({});
  /**
   * ★ 2026-09-28：学习单的**全部数据**（快照 + 广播增量 + 题目树 + settings）由
   * `useWorksheetBoard` 一处拥有 —— 教师裁定 ①「统一整个看板的数据层」。
   *
   * 🔴 这里曾经有**四个** state（`worksheetProgress` / `worksheetNodes` / `worksheetBoard` /
   * `worksheetBoardLoading`）加**两套**取数函数（`loadWorksheetNodes` 60 秒轮询、
   * `loadWorksheetBoard` 只在开抽屉与矩阵开着时拉）。而 **格子只吃广播** ——
   * 于是教师刷新一次页面，全班掉回「还没收到作答」；学生离开再回来（没有保存动作 ⇒
   * 没有广播）格子也不知道。那就是教师报的第 1 条 bug，根因是「格子是唯一没接两条腿的
   * 消费方」，而**矩阵早就两条腿了**（`worksheet-matrix.ts`）。
   *
   * ⇒ 现在三处消费方（格子 / 矩阵 / 抽屉）读的是**同一份**，轮询常开。
   * 取数与合并的规则在 `use-worksheet-board.ts` 与 `worksheet-board-data.ts`（后者是
   * 纯函数、有测试）。
   */
  const wb = useWorksheetBoard(id ?? null);
  /**
   * ⚠️ 把这两个**稳定引用**解构出来，而不是在依赖数组里写 `wb.xxx`：
   * 写 `[wb.refresh]` 时 `react-hooks/exhaustive-deps` 认不出它是稳定的
   * （它看到的是「读了 `wb` 这个对象」），于是报一条 missing dependency；
   * 而按它说的把整个 `wb` 放进依赖，`wb` 每次渲染都是新对象 ⇒ 这两个回调**每帧重建**
   * ⇒ 依赖它们的所有 memo 全部打穿。解构是唯一两边都对的做法。
   */
  const { refresh: refreshWorksheetBoard, markReviewed: markWorksheetReviewed } = wb;
  /**
   * 学习单抽屉（规格 §7.3）开在哪一层。
   *
   * ⚠️ 每次打开都塞一个**新的对象**（`token` 只是让这件事显式化）：抽屉内部的下钻栈
   * （学习单 → 题 → 作答）以这个对象的**引用**为依赖重置，换一个学生、再点一次同一个入口
   * 都算新的一次 —— 少了它，教师从「张三」切到「李四」时抽屉会停在张三那个下钻层次上。
   * 🔴 与「数据新鲜度」是**两件事**：数据由 `wb` 供给，`token` 只管下钻栈。
   */
  const [worksheetDrawer, setWorksheetDrawer] = useState<WorksheetDrawerEntry | null>(null);
  /** 正在标记「已查看」的那一条（`participantId:questionId`）—— 防止连点，并让按钮显示「标记中…」。 */
  const [worksheetReviewBusy, setWorksheetReviewBusy] = useState<string | null>(null);
  /**
   * 「停在第 N 题 · X 分钟」需要一只会走的表：没有新的作答广播时也要让分钟数自己往上走
   * （以及 5 分钟那一刻从「正在做」翻成「停住了」）。30 秒一格 —— 分钟数最多差半分钟，
   * 而这段时间里的渲染开销与一次 socket 消息同级。
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** 教师点开的**探究详情**是哪个学生（`null` = 没点开）。它会让学生转高频截图。 */
  const [exploreDetailId, setExploreDetailId] = useState<string | null>(null);
  const [fsCols, setFsCols] = useState(5);
  const gridRef = useRef<HTMLDivElement>(null);
  const fsContentRef = useRef<HTMLDivElement>(null);
  const fullscreenContentRef = useRef<HTMLDivElement>(null);
  const { joinTeacherBoard, on, emit } = useSocket();
  const [notifyState, setNotifyState] = useState<{ show: boolean; studentId?: string; studentName?: string; groupId?: string }>({ show: false });
  const [notifyText, setNotifyText] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const notifySendingRef = useRef(false);
  const drawerMessagesRef = useRef<HTMLDivElement>(null);
  const groupTooltipThrottle = useRef(0);
  const [studentWarnings, setStudentWarnings] = useState<Record<string, number>>({});
  const [studentBlacklisted, setStudentBlacklisted] = useState<Record<string, boolean>>({});
  const [groupTooltip, setGroupTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const controlBusyRef = useRef(false);
  /**
   * ★ 2026-09-29（教师）：原来那**一个**「课堂权限」弹窗按模块拆成两个 ——
   * 「探究空间」与「智能学伴」各一个，每个紧挨着它自己的按钮。
   *
   * ⚠️ 用一个「哪一个开着」的联合值，而不是两个布尔：两个布尔能同时为真
   *（两个遮罩叠在一起，关掉上面那个才看得见下面那个），而那种状态**没有任何用处**。
   */
  const [settingsDialog, setSettingsDialog] = useState<'explore' | 'companion' | null>(null);
  const settingsDialogRef = useRef<HTMLDivElement>(null);
  /**
   * 每个头部按钮的 DOM 引用（键是控件 id）。
   *
   * ⚠️ 原来是一个 `permissionsButtonRef`：那时只有一个按钮会开弹窗，而现在是两个
   * ⇒ 关闭时要把焦点还回**开它的那一个**。用一个表而不是两个 ref：加第三个设置按钮时
   * 不必再添一份。
   */
  const headerButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  /** 这一个弹窗是哪个按钮开的（关闭时把焦点还回去用）。 */
  const settingsOpenerRef = useRef<'explore-settings' | 'companion-menu'>('explore-settings');
  /** 是否**曾经**打开过。只为了避免首屏渲染（浮窗本来是关着的）去抢焦点。 */
  const settingsDialogOpenedRef = useRef(false);
  const [showModulesMenu, setShowModulesMenu] = useState(false);
  const modulesMenuRef = useRef<HTMLDivElement>(null);
  /** ★ 2026-09-29：「学习单」那个下拉（答题分析 / 进度矩阵）。 */
  const [showWorksheetMenu, setShowWorksheetMenu] = useState(false);
  const worksheetMenuRef = useRef<HTMLDivElement>(null);
  /** ★ 2026-09-29：「智能学伴」那个下拉（对话分析 / 设置）。 */
  const [showCompanionMenu, setShowCompanionMenu] = useState(false);
  const companionMenuRef = useRef<HTMLDivElement>(null);
  const [studentBoardFilter, setStudentBoardFilter] = useState<StudentBoardFilter>('all');
  /**
   * 第二组筛选：按**该生此刻所在的模块**。与上面那组**同时生效**（「与」关系）——
   * 两组答的是两个不同的问题（「他掉线了吗」/「他在用哪一件」），教师要的是交集。
   */
  const [studentModuleFilter, setStudentModuleFilter] = useState<StudentModuleFilter>('all');
  const [clearBusy, setClearBusy] = useState<string | null>(null);
  /**
   * ★ 2026-09-29（教师）：「把词云的这块功能迁移到下方『智能学伴』这个下拉按钮里边，
   * 专门给它设置一个选项，后弹出一个弹窗来显示，这样一来，**页面上方原来的 tab 页面就全部取消了**。」
   * ⇒ 词云搬进工具条那个下拉的「对话分析」，点开是这个弹窗。
   */
  const [showWordCloud, setShowWordCloud] = useState(false);
  const clearBusyRef = useRef(false);

  // 「点外面关」只留给还在用下拉菜单的「模块状态」。
  // ⚠️ 课堂权限改成浮动窗之后**必须**把它从这份监听里摘掉：`permissionsMenuRef` 一旦是个空 ref，
  // `!undefined` 恒为真，浮窗会在**任何** pointerdown（含窗内每一次点击）时被关掉 ——
  // 而 pointerdown 早于 click，后果是窗内每个控件都点不动（点下去窗先没了）。
  useEffect(() => {
    const closeMenusOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // ★ 2026-09-29：「学习单」那个下拉与「模块状态」那个菜单**共用这一条监听** ——
      // 各写一份的话，两个菜单会互相不关（点开 B 时 A 还开着）。
      if (!modulesMenuRef.current?.contains(target)) setShowModulesMenu(false);
      if (!worksheetMenuRef.current?.contains(target)) setShowWorksheetMenu(false);
      if (!companionMenuRef.current?.contains(target)) setShowCompanionMenu(false);
    };
    document.addEventListener('pointerdown', closeMenusOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsidePointerDown);
  }, []);

  // 课堂权限浮动窗的 Esc 关闭（"关闭方式"三条里的第二条：遮罩 / 关闭按钮见浮窗 JSX）。
  //
  // 写法照同项目已有的浮窗（`WebappPreviewDialog`、agent-form-modal）：监听只在浮窗**开着**时挂着，
  // 关掉之后这个 handler 根本不存在。这个 handler 从头到尾只调用 `setShowPermissionsDialog(false)`
  // 这一个 setter —— 它没有能力去关别的浮层。
  // ⚠️ 不要往这里加别的 setter：这页上吃 Esc 的浮层不止一个（全屏图片预览、投屏发码），
  // 顺手一起关，教师按一次 Esc 会连带丢掉投屏画面。
  useEffect(() => {
    if (settingsDialog === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsDialog(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsDialog]);

  // 焦点进出：打开时进浮窗，关闭时还回触发按钮。
  // 少了「进」这一步，焦点会留在工具栏那个按钮上 —— 键盘与读屏用户感知不到自己刚打开了一个窗
  // （浮窗容器上的 `tabIndex={-1}` 就是为了让它能被聚焦）。
  // `settingsDialogOpenedRef` 只是防止首屏渲染时（浮窗本来是关着的）跳去抢焦点。
  // ⚠️ 还回去的是**开它的那一个**按钮（`settingsOpenerRef`）—— 两个设置按钮都在这条路上，
  // 还错了的话键盘用户按 Esc 之后焦点会跑到隔壁那个按钮上，而屏幕上看不出差别。
  useEffect(() => {
    if (settingsDialog !== null) {
      settingsDialogOpenedRef.current = true;
      settingsDialogRef.current?.focus();
      return;
    }
    if (settingsDialogOpenedRef.current) headerButtonRefs.current[settingsOpenerRef.current]?.focus();
  }, [settingsDialog]);

  // 分组/高级模式：按小组聚合卡片
  const groupCards = useMemo<ClassroomGroupCard[] | null>(() => {
    if (!classroom || (classroom.mode !== 'advanced' && classroom.mode !== 'group')) return null;
    const map = new Map<string, ClassroomGroupCard>();
    for (const cs of students) {
      if (!cs.groupId) continue;
      let groupCard = map.get(cs.groupId);
      if (!groupCard) {
        groupCard = { group: cs.group ?? null, members: [] };
        map.set(cs.groupId, groupCard);
      }
      groupCard.members.push(cs);
    }
    // 组内按学号排序
    for (const g of map.values()) {
      g.members.sort((a, b) => (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999));
    }
    // 按组名排序
    return Array.from(map.values()).sort((a, b) => (a.group?.name || '').localeCompare(b.group?.name || ''));
  }, [classroom, students]);

  // 课堂小组 ID → 创建课堂时冻结的成员快照；不依赖可变的小组名称。
  const groupMembersMap = useMemo(() => {
    const map: Record<string, Array<{ studentName: string; groupName: string }>> = {};
    if (!groupCards || !classroom?.groupMembersMap) return map;
    for (const g of groupCards) {
      if (!g.group?.id || !g.group.name) continue;
      const group = g.group;
      const backendData = classroom.groupMembersMap[group.id];
      if (backendData) {
        map[group.id] = backendData.members.map((m) => ({
          studentName: m.name,
          groupName: group.name,
        }));
      }
    }
    return map;
  }, [groupCards, classroom]);

  /**
   * ★ 2026-09-30：浮层那份入参**必须 memo**。
   *
   * 🔴 在 JSX 里现写 `Object.entries(...).map(...)` 每次都换一个数组身份 ⇒ 浮层里那个
   *    `useMemo`（`flattenAnswerable` 走整棵树）**每次渲染都重算**，而这一页每次
   *    socket 事件都会重渲（学生的作答、上下线都算）。看板是**投影给全班看的**，
   *    白做功的那几帧正是它掉帧的地方。
   */
  const openOverlayWorksheets = useMemo(
    () => Object.entries(wb.nodesByWorksheet).map(([worksheetId, nodes]) => ({
      id: worksheetId,
      title: wb.board?.worksheets.find((sheet) => sheet.id === worksheetId)?.title || '未命名学习单',
      nodes,
      settings: wb.settingsByWorksheet[worksheetId],
    })),
    [wb.nodesByWorksheet, wb.board, wb.settingsByWorksheet],
  );

  const classroomStudentCount = groupCards
    ? groupCards.reduce((total, group) => total + (group.group?.id ? (groupMembersMap[group.group.id]?.length ?? 0) : 0), 0)
    : students.length;

  // 打开抽屉时自动滚动到底部（最新消息）
  useEffect(() => {
    if (selectedStudent && drawerMessagesRef.current) {
      // 等待 React 渲染消息列表后再滚动
      requestAnimationFrame(() => {
        drawerMessagesRef.current?.scrollTo({ top: 999999, behavior: 'smooth' });
      });
    }
  }, [selectedStudent, messages]);

  // 投屏{selectedRounds.length > 0 ? ` (${selectedRounds.length})` : ''}讲评展开时自动滚到底部
  useEffect(() => {
    if (showFullscreen && fullscreenContentRef.current) {
      requestAnimationFrame(() => {
        fullscreenContentRef.current?.scrollTo({ top: fullscreenContentRef.current.scrollHeight, behavior: 'auto' });
      });
    }
  }, [showFullscreen, messages]);

  /* 「停住了」那只表 —— 见 `nowMs` 的注释。 */
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * 打开抽屉。`token` 每次换新 ⇒ 抽屉内部的下钻栈从这一层重新开始。
   *
   * ⚠️ 顺手把**对话抽屉**关掉：两者是同一块位置（右上角、宽 420）的浮层，
   * 同时开着会叠在一起，而教师只会看到上面那一个。
   */
  const openWorksheetDrawer = useCallback((view: WorksheetDrawerView) => {
    setSelectedStudent(null);
    setSelectedGroup(null);
    selectedStudentIdRef.current = null;
    setExploreDetailId(null);
    setWorksheetDrawer({ token: Date.now(), view });
    // ★ 2026-09-28：打开抽屉时**仍然重拉一次**（而不是只吃 30 秒轮询的那一份）。
    // 理由没变、而且更成立了：教师几乎总是为了「此刻他做到哪了」才点开抽屉，而轮询那份
    // 最多可能旧 30 秒。这一次重拉由 `wb` 拥有，所以「数据只有一个来源」这条没有被破坏。
    refreshWorksheetBoard();
  }, [refreshWorksheetBoard]);

  /**
   * ★ M5b：矩阵的下钻。两条都**复用现成的抽屉入口**（规格 §3.7），零抽屉改动。
   * ⚠️ 抽屉的层级是 290/291，本覆盖层是 250 ⇒ 抽屉画在上面，**不关矩阵**。
   *    只重开抽屉（让下钻栈从入口那层重新开始），教师关掉抽屉就回到矩阵原来的位置。
   */
  const openMatrixQuestion = useCallback((worksheetId: string, questionId: string) => {
    openWorksheetDrawer({ kind: 'question', worksheetId, questionId });
  }, [openWorksheetDrawer]);
  const openMatrixParticipant = useCallback((participantId: string) => {
    openWorksheetDrawer({ kind: 'participant', participantId });
  }, [openWorksheetDrawer]);

  // ★ 2026-09-28：矩阵那条「开着才轮询」的 effect 搬进了 `useWorksheetBoard`（常开）。
  // 它当时成立的前提是「只有矩阵在用这份数据」—— 格子接上来之后那个前提就没有了，
  // 而格子恰恰是最需要历史的那一个（第 1 条 bug）。节拍没变，仍是 30 秒。

  /**
   * 标记「已查看」（`POST /api/worksheets/:id/review`，粒度是**参与者 × 题**）。
   *
   * ⚠️ 成功后**就地更新**那一行的 `reviewedAt`，不重拉整批：教师的动作是逐题点的，
   * 每点一次重拉一次整堂课的作答行没有必要（而且会让滚动位置跳）。
   * 时间戳用服务端回的**那一个**，不是本地 `Date.now()` —— 看板上的「刚看过」以它为准。
   */
  const reviewWorksheetAnswer = useCallback(async (worksheetId: string, participantId: string, questionId: string) => {
    const key = `${participantId}:${questionId}`;
    setWorksheetReviewBusy(key);
    try {
      const result = await api.reviewWorksheetAnswer(worksheetId, { participantId, questionId });
      // ★ 2026-09-28：就地更新那一行搬到 `wb.markReviewed`（快照在 hook 里，调用方不能直接改它）。
      markWorksheetReviewed(worksheetId, participantId, questionId, result.reviewedAt);
    } catch (error) {
      // 服务端的文案直接给学生看（409 那句是「该学生还没有作答这道题」）——
      // 本组件已经不给未作答的题按钮了，所以走到这里的是真的异常（断网 / 会话过期）。
      setToast({ msg: error instanceof Error ? error.message : '标记「已查看」失败', type: 'error' });
    } finally {
      setWorksheetReviewBusy(null);
    }
  }, [markWorksheetReviewed]);

  // ★ 2026-09-28：题目树那条 60 秒的定期重拉也搬进了 `useWorksheetBoard`
  //（教师课上改单**不广播**，所以它必须留着，理由逐字未变）。

  const loadClassroom = useCallback(async () => {
    if (!id) return;
    // ★ 2026-09-30：发请求**之前**记下「此刻本地那份逐题开放清单」—— 回来时拿它做等值判断
    //（见下面 `setWorksheetOpen` 那一行：期间被改过就不收这份快照）。
    const openAtRequest = worksheetOpenRef.current;
    try {
      const cr = await api.getClassroom(id);
      setClassroom(cr);
      setTeacherCode(cr.code || '');
      setPaused(cr.status === 'paused');
      // ★ M5a：`=== true` 是刻意的 —— 老服务端不发这个字段（`ClassroomSummary.answersLocked?`
      // 是可选的），必须按「未锁定」处理，不能把它当成必填读出个 undefined 当真值。
      setAnswersLocked(cr.answersLocked === true);
      // ★ 2026-09-30：同上一条 —— 老服务端不发这一格 ⇒ 收成空映射（= 一份单都没开放）。
      // 🔴 **只在本地这一份没被改过时才收下**（与学生会话层 `flagsSnapshotRef` 同一条理由）：
      //    这次 GET 是**在**教师的某次「开放」之前发出的，而它带着**旧**清单回来
      //    （`syncGroups` 之后也会走这一条）⇒ 不看一眼就覆盖，屏幕上的开放状态会**退回去**，
      //    而没有任何东西会红（下一次广播才自愈，中间那段时间教师看到的是一份假的进度）。
      setWorksheetOpen((previous) => (previous === openAtRequest ? normalizeOpenMap(cr.worksheetOpen) : previous));
      const students = cr.students || [];
      // 排序：标准模式按学号，分组/高级模式按组名
      const mode = cr.mode || 'standard';
      if (mode === 'standard') {
        students.sort((a, b) => (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999));
      } else {
        students.sort((a, b) => {
          const ga = a.group?.name || '';
          const gb = b.group?.name || '';
          if (ga !== gb) return ga.localeCompare(gb);
          return (parseInt(a.student.studentNo ?? '', 10) || 999999) - (parseInt(b.student.studentNo ?? '', 10) || 999999);
        });
      }
      setStudents(students);
      const statuses: Record<string, string> = {};
      const rounds: Record<string, number> = {};
      const warnings: Record<string, number> = {};
      const blacklisted: Record<string, boolean> = {};
      students.forEach((s) => {
        rounds[s.id] = s.totalRounds || 0;
        warnings[s.id] = s.warningCount || 0;
        blacklisted[s.id] = s.blacklisted || false;
      });
      // 不通过 DB status 字段初始化在线状态，依赖 HTTP API 获取当前在线学生
      try {
        const online = await api.getOnlineStudentIds(id);
        online.studentIds?.forEach((sid: string) => { statuses[sid] = 'online'; });
      } catch {}
      setStudentStatuses(statuses);
      setStudentRounds(rounds);
      setStudentWarnings(warnings);
      setStudentBlacklisted(blacklisted);

      // 加载每位学生最近一轮对话预览和词云数据
      try {
        const allMsgs = await api.getAllMessages(id);
        setAllMessages(allMsgs);
        const grouped = new Map<string, ClassroomMessage[]>();
        for (const msg of allMsgs) {
          const sid = msg.classroomStudent?.id;
          if (!sid) continue;
          if (!grouped.has(sid)) grouped.set(sid, []);
          grouped.get(sid)!.push(msg);
        }
        setStudents(prev => prev.map(s => {
          const sid = s.id;
          const msgs = grouped.get(sid);
          if (!msgs || msgs.length === 0) return s;
          const lastUser = msgs.filter((m) => m.role === 'user').slice(-1)?.[0];
          const lastAssistant = msgs.filter((m) => m.role === 'assistant').slice(-1)?.[0];
          const preview: ClassroomCardStudent['messages'] = [];
          if (lastUser) preview.push({ content: lastUser.content, role: 'user', createdAt: lastUser.createdAt });
          if (lastAssistant && (!lastUser || new Date(lastAssistant.createdAt) > new Date(lastUser.createdAt))) {
            preview.push({ content: lastAssistant.content, role: 'assistant', createdAt: lastAssistant.createdAt });
          }
          return { ...s, messages: preview };
        }));
      } catch {}
      // ★ 2026-09-28：**题目树不再在这里拉**（原来这一段会算出「课堂里在用的那几份」
      // 再逐份 `GET /:id`）。
      //
      // 现在由 `useWorksheetBoard` 负责：它从**作答行快照里的那几份**学习单自己取
      //（`loadNodes`），而它本来就已经在首屏与每 30 秒各拉一次快照了 —— 少了一套
      // 「谁该拉、什么时候拉」的独立口径。
      //
      // ⚠️ 删掉的这段算法（课堂级 `worksheets` ∪ 各组 `groups[].worksheet`，去重）
      // 与新口径**不是同一件事**，但差别只在一种情形上：某一组配的学习单**已经被删**
      //（悬空 targetId）。那时旧口径会把一个取不到的 id 也拿去 GET（拿到 404，
      // 而格子那一格永远停在「内容还没加载到」）；新口径直接不列它 ——
      // 服务端的作答行快照本来就不会为它发回条目。**新的那一侧更对**。

      // ⚠️ 这里原来还顺手拉一次 `api.getAgents()` 来定抽屉里那个智能体署名。删掉了：
      // 它读的 `cr.agentIds` **服务端从来不下发**（只在创建课堂的请求体里被读），
      // 于是恒回落 `agents[0]` = 整个智能体库的第一个，抽屉里每条助手消息都挂着错的
      // 名字与头像。署名改由 `drawerAgent`（下方，走 `effectiveGroupAgent`）算，
      // 顺带省掉一次「把整个智能体库拉下来只为挑第一个」的请求。
    } catch {}
  }, [id]);

  const loadAnalytics = useCallback(async () => {
    if (!id) return;
    try {
      const msgs = await api.getAllMessages(id);
      setAllMessages(msgs);
    } catch {}
  }, [id]);

  // ESC 关闭投屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCodeScreenKey(0); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!id) { router.push('/teacher'); return; }
    const initialLoadTimer = window.setTimeout(() => { void loadClassroom(); }, 0);
    joinTeacherBoard(id);

    const unsub1 = on('student-online', (data: StudentPresenceEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'online' }));
    });
    const unsub2 = on('student-offline', (data: StudentPresenceEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: 'offline' }));
    });
    const unsub3 = on('student-thinking', (data: StudentThinkingEvent) => {
      setStudentStatuses(prev => ({ ...prev, [data.studentId]: data.status ? 'thinking' : 'online' }));
    });
    const unsubDeepThink = on('student-deep-thinking', (data: StudentThinkingEvent) => {
      if (data.status) {
        setDeepThinkingStatuses(prev => ({ ...prev, [data.studentId]: true }));
      } else {
        setDeepThinkingStatuses(prev => {
          const next = { ...prev };
          delete next[data.studentId];
          return next;
        });
      }
    });
    const unsub4 = on('student-message', (data: StudentMessageEvent) => {
      // 更新学生消息预览（仅保留最近3条用户提问）
      setStudents(prev => prev.map(s =>
        s.id === data.studentId
          ? {
              ...s,
              messages: data.role === 'user'
                ? [{ content: data.content, role: 'user', createdAt: data.timestamp }]
                : (() => {
                    const userMsgs = s.messages.filter((m) => m.role === 'user').slice(-1);
                    return [...userMsgs, { content: data.content, role: 'assistant', createdAt: data.timestamp }];
                  })()
            }
          : s
      ));
      // 更新学生对话轮数（屏蔽词触发的提问不计入轮数）
      if (data.role === 'user' && !data.shieldFiltered) {
        setStudentRounds(prev => ({
          ...prev,
          [data.studentId]: (prev[data.studentId] || 0) + 1,
        }));
      }
      // 如果当前选中该学生，追加消息
      if (selectedStudentIdRef.current === data.studentId) {
        setMessages(prev => [...prev, { content: data.content, role: data.role, roundIndex: data.roundIndex ?? null, createdAt: data.timestamp, fileUrls: data.fileUrls, fileNames: data.fileNames }]);
      }
    });

    const unsub5 = on('classroom-paused', () => setPaused(true));
    const unsub6 = on('classroom-resumed', () => setPaused(false));
    const unsub7 = on('classroom-ended', () => {
      setToast({ msg: '课堂已结束', type: 'success' });
      router.push('/teacher');
    });

    const unsub8 = on('shield-warning', (data: ShieldWarningEvent) => {
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: data.warningCount }));
    });

    const unsub9 = on('student-blacklisted', (data: StudentPresenceEvent) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: true }));
    });

    const unsub10 = on('student-unblacklisted', (data: StudentPresenceEvent) => {
      setStudentBlacklisted(prev => ({ ...prev, [data.studentId]: false }));
      setStudentWarnings(prev => ({ ...prev, [data.studentId]: 0 }));
    });

    const unsub11 = on('student-avatar-changed', (data: StudentAvatarChangedEvent) => {
      if (data.avatarId && data.svgContent) {
        const avatarId = data.avatarId;
        const svgContent = data.svgContent;
        setStudentAvatars(prev => ({ ...prev, [avatarId]: svgContent }));
      }
      // 更新学生列表中的 avatarId
      setStudents(prev => prev.map(s => {
        if (s.id === data.studentId) {
          return { ...s, student: { ...s.student, avatarId: data.avatarId } };
        }
        return s;
      }));
      // 同步更新当前选中的学生头像（打开抽屉时实时刷新）
      setSelectedStudent((prev) => {
        if (!prev || prev.id !== data.studentId) return prev;
        return { ...prev, avatarId: data.avatarId };
      });
    });

    const unsub12 = on('allow-stop-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowStudentStop: data.allow } : prev);
    });

    const unsub13 = on('allow-export-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowStudentExport: data.allow } : prev);
    });

    const unsub14 = on('follow-ups-changed', (data: ClassroomPermissionEvent) => {
      setClassroom((prev) => prev ? { ...prev, allowFollowUps: data.allow } : prev);
    });

    // 模块三态回显：服务端在 PUT 成功后向 classroom:<id> 与 teacher:<id> 双发，
    // 所以另一台教师机（或本机另一个标签页）改态时这里立刻跟上，不必等轮询。
    // 载荷是线缆上的值，先过类型守卫 —— 非法 key/state 直接忽略，不写进本地三元素数组。
    // 连 null / undefined 都会走到这里，所以不能直接解构（解构会先抛错，守卫就没机会跑）。
    const unsub15 = on('module-state-changed', (data) => {
      const { moduleKey, state } = data ?? {};
      if (!isClassroomModuleKey(moduleKey) || !isClassroomModuleState(state)) return;
      setClassroom((prev) => prev ? { ...prev, modules: applyModuleState(prev.modules, moduleKey, state) } : prev);
    });

    // 「这个学生此刻在看哪个模块」（P2.3 看板「跟随」模式的数据源）。
    //
    // ⚠️ 学生只在**切换时**上报（几十字节），教师中途进来看板时由服务端**回放**当前状态
    // （每个已知状态的学生各一条）—— 所以这里**不做**初值拉取：拉取会与回放两个来源打架，
    // 而且拉回来的那份可能比回放的还旧。
    //
    // 载荷是线缆上的值：只有三件套与 `null` 是合法的，其余（含拼错的 key）**整条丢掉**
    // —— 存进去就会渲染出一个不存在的模块，且全程不报错。
    const unsub16 = on('student-module-focus', (data) => {
      const { studentId, moduleId } = data ?? {};
      if (typeof studentId !== 'string') return;
      const resolved: ModuleId | null | undefined = moduleId === null
        ? null
        : (isModuleId(moduleId) ? moduleId : undefined);
      if (resolved === undefined) return;
      setStudentModuleFocus((prev) => ({ ...prev, [studentId]: resolved }));
    });

    // ★ 2026-09-28：`worksheet-answer-updated` 的订阅**搬进 `useWorksheetBoard`** 了。
    // 它原来在这里（`unsub17`），而这一页现在不再拥有学习单的任何一份数据 ——
    // 见上面 `wb` 那一段。校验规则（缺题号整条丢掉、认不出的 status 整条丢掉、
    // 比 classroomId 防串台）**逐字搬过去**，一条都没松。

    // ★ M5a：锁定/解锁作答。⚠️ 编号接着 17 往下排 —— 计划里给的 `unsub7`/`unsub8`
    // 在本文件里**已经被占用**（`classroom-ended` 与 `shield-warning`），
    // 照抄那两个名字会静默覆盖掉那两个监听器（名字相同 ⇒ 前者泄漏、后者被退订两次）。
    const unsub18 = on('answers-locked', () => setAnswersLocked(true));
    const unsub19 = on('answers-unlocked', () => setAnswersLocked(false));

    // ★ 2026-09-30：课堂级「逐题开放」。载荷**带状态本身**（见 `socket-events.ts` 那条），
    // 所以这里直接整张覆盖 —— 服务端发的是**整张映射**，本机这份是它的镜像。
    // ⚠️ 与学习单作答那条广播不同：这一条**不需要**防串台校验（载荷里没有任何学生数据），
    //    但**要**校验形状（`worksheetId` 是不是非空串）—— 一条坏载荷会把清单写到一个
    //    空键上，而屏幕上只是「打开的那几题又变回去了」。
    const unsub20 = on('worksheet-open-changed', (data) => {
      const worksheetId = typeof data?.worksheetId === 'string' ? data.worksheetId : '';
      if (!worksheetId) return;
      const questionIds = normalizeOpenQuestions(data?.questionIds);
      setWorksheetOpen((prev) => ({ ...prev, [worksheetId]: questionIds }));
    });

    return () => { window.clearTimeout(initialLoadTimer); unsub1?.(); unsub2?.(); unsub3?.(); unsubDeepThink?.(); unsub4?.(); unsub5?.(); unsub6?.(); unsub7?.(); unsub8?.(); unsub9?.(); unsub10?.(); unsub11?.(); unsub12?.(); unsub13?.(); unsub14?.(); unsub15?.(); unsub16?.(); unsub18?.(); unsub19?.(); unsub20?.(); };
  }, [id, joinTeacherBoard, on, loadClassroom, router]);

  const openStudentDrawer = async (student: StudentSummary) => {
    if (selectedStudentIdRef.current === student.id) return; // 已选中，无需重复拉取
    // 对话抽屉与学习单抽屉是**同一块位置**（右上角、宽 420）的浮层，同时开着会叠在一起。
    setWorksheetDrawer(null);
    selectedStudentIdRef.current = student.id;
    setSelectedStudent(student);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const msgs = await api.getStudentMessages(id, student.id);
      setMessages(msgs);
    } catch { setMessages([]); }
    finally { setLoadingMessages(false); }
  };

  /** 清除学生对话记录并同步更新监控框 */
  /**
   * 参与者 id → 他在快照里的名字（确认文案要用）。
   * ⚠️ 查不到就回一个**看得懂**的占位而不是空串：确认框里出现「确定清除「」的作答？」
   * 会让教师以为界面坏了，而那时他正要按下一个不可撤销的按钮。
   */
  const worksheetParticipantName = (participantId: string): string => {
    for (const worksheet of wb.board?.worksheets ?? []) {
      for (const participant of worksheet.participants) {
        if (participant.participantId === participantId) return participant.name;
      }
    }
    return '这个学生';
  };

  /**
   * ★ 2026-09-28（教师第 4 条）：清除某个学生在**这份学习单**上的作答数据。
   *
   * 🔴 确认文案里的数字取自**当前快照里那个参与者的 `answerRows`**，走的是
   * `clearConfirmText`（纯函数、有测试）—— 不在这里自己数一遍：
   * 自己数一份的表现是「屏幕上那个数」与「用例断言的那个数」不是同一个函数
   *（`worksheet-matrix.ts` 的 `rowTally` 上记过同一条教训）。
   *
   * ⚠️ 清完**必须**重拉快照（`wb.refresh()`）：服务端会广播，但教师这台机器的 socket
   * 断线时那条广播收不到，而「清了之后屏幕上还在」正是最不能出现的一种。
   */
  const clearWorksheetDataFor = async (participantId: string, participantName: string, questionId: string | null) => {
    const found = (() => {
      for (const worksheet of wb.board?.worksheets ?? []) {
        for (const participant of worksheet.participants) {
          if (participant.participantId === participantId) return { worksheet, participant };
        }
      }
      return null;
    })();
    // 快照还没到 / 这个人不在这份单上 ⇒ 说清楚，**不要**拿一个空的 rows 去拼一句
    // 「共 0 题有作答记录」然后真清一遍（那会清掉我们没看见的东西）。
    if (!found) {
      setToast({ msg: '还没读到这个学生的作答数据，请稍后再试', type: 'error' });
      return;
    }
    const { worksheet, participant } = found;

    // 只清一题时，确认文案换成那一题的题号 —— 整张那套数字在单题上读起来是错的。
    const rows = questionId
      ? participant.answerRows.filter((row) => row.questionId === questionId)
      : participant.answerRows;
    const settings = wb.settingsByWorksheet[worksheet.id];
    const scale = settings ? resolveRewardScale(settings) : null;
    const overview = participantOverview(
      wb.nodesByWorksheet[worksheet.id] ?? [], rows, scale,
    );
    const prompt = questionId
      ? `确定清除「${participantName}」这一题的作答？\n\n此操作不可撤销。`
      : clearConfirmText(participantName, worksheet.title, rows, overview.reward, overview.rewardText);
    if (!confirm(prompt)) return;

    try {
      const result = await api.clearWorksheetAnswers(id!, {
        participantId, worksheetId: worksheet.id, questionId,
      });
      refreshWorksheetBoard();
      setToast({
        msg: result.removed > 0
          ? `已清除「${participantName}」的 ${result.removed} 题作答`
          : `「${participantName}」没有可清除的作答`,
        type: 'success',
      });
    } catch (error) {
      setToast({ msg: `清除失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    }
  };

  const handleClearMessages = async (studentId: string, studentName: string) => {
    if (clearBusyRef.current) return;
    if (!confirm(`确定清除「${studentName}」的全部对话记录？`)) return;
    clearBusyRef.current = true;
    setClearBusy(studentId);
    try {
      await api.clearStudentMessages(id, studentId);
      // 清除监控框预览
      setStudents(prev => prev.map(s => {
        // 标准模式：s.student 存在时直接匹配
        if (s.student && s.id === studentId) {
          return { ...s, messages: [] };
        }
        return s;
      }));
      // 重置对话轮数
      setStudentRounds(prev => ({ ...prev, [studentId]: 0 }));
      // 如果当前抽屉中正显示该学生，清空消息列表
      if (selectedStudentIdRef.current === studentId) {
        setMessages([]);
      }
      setToast({ msg: `已清除「${studentName}」的对话记录`, type: 'success' });
    } catch (error) {
      setToast({ msg: `清除「${studentName}」失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      clearBusyRef.current = false;
      setClearBusy(null);
    }
  };

  const incrementAvatarChangeTokens = (studentId: string) => {
    const updateStudent = (student: StudentSummary) => student.id === studentId
      ? { ...student, avatarChangeTokens: student.avatarChangeTokens + 1 }
      : student;
    setStudents((previous) => previous.map((card) => ({
      ...card,
      student: updateStudent(card.student),
    })));
    setSelectedStudent((previous) => previous ? updateStudent(previous) : previous);
  };

  /** 清除小组全体成员的对话记录并同步更新监控框 */
  const handleClearGroupMessages = async (members: ClassroomCardStudent[], groupName: string) => {
    if (clearBusyRef.current) return;
    if (!confirm(`确定清除「${groupName}」全体成员的对话记录？`)) return;
    clearBusyRef.current = true;
    setClearBusy(`group:${groupName}`);
    const results = await Promise.allSettled(members.map(async m => {
      const studentId = m.id;
      await api.clearStudentMessages(id, studentId);
      return studentId;
    }));
    const succeeded = results.filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled').map(result => result.value);
    if (succeeded.length) {
        setStudents(prev => prev.map(s => {
          if (s.student && succeeded.includes(s.id)) return { ...s, messages: [] };
          return s;
        }));
      setStudentRounds(prev => Object.fromEntries(Object.entries(prev).map(([studentId, rounds]) => [studentId, succeeded.includes(studentId) ? 0 : rounds])));
      if (selectedStudentIdRef.current && succeeded.includes(selectedStudentIdRef.current)) setMessages([]);
    }
    const failed = results.length - succeeded.length;
    setToast(failed ? { msg: `「${groupName}」已清除 ${succeeded.length} 人，${failed} 人失败，请重试`, type: 'error' } : { msg: `已清除「${groupName}」全体 ${succeeded.length} 人的对话记录`, type: 'success' });
    clearBusyRef.current = false;
    setClearBusy(null);
  };

  const sendNotification = () => {
    if (notifySendingRef.current) return;
    const message = notifyText.trim();
    if (!message) return;
    notifySendingRef.current = true;
    emit('teacher-send-notification', { classroomId: id, studentId: notifyState.studentId, groupId: notifyState.groupId, message });
    setNotifySent(true);
    setTimeout(() => { setNotifyState({ show: false }); notifySendingRef.current = false; }, 1200);
  };

  const runControlAction = async (key: string, action: () => Promise<void>) => {
    if (controlBusyRef.current) return;
    controlBusyRef.current = true;
    setControlBusy(key);
    try {
      await action();
    } catch (error) {
      setToast({ msg: `课堂设置更新失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      controlBusyRef.current = false;
      setControlBusy(null);
    }
  };

  // ★ M5a：锁定/解锁作答。乐观更新 + 收自己的广播校正（与下面的 `toggleQuestions` 同一套）。
  // ⚠️ 它**不**动 `classroom.status` —— 锁定是另一个维度（停笔），与「暂停课堂」无关（GC 23）。
  const toggleAnswersLock = () => runControlAction(HEADER_BUSY_KEYS.lock, async () => {
    if (answersLocked) {
      await api.unlockAnswers(id);
      setAnswersLocked(false);
    } else {
      await api.lockAnswers(id);
      setAnswersLocked(true);
    }
  });

  /**
   * ★ 2026-09-30：写一份学习单的「已开放的题」（整份替换）。
   *
   * 🔴 **先乐观更新、再发请求、失败回滚**：这一屏是**当着全班**按的 —— 按下去到广播
   * 回来之间有一两个来回，什么都不动的话教师会以为没点上、于是再按一次（那一下会把
   * 第一次的改动**当成基线再发一遍**，两次结果相同但白跑一趟）。
   * ⚠️ 回滚要把**上一次**那一份还回去，不是清空：教师点了「开放下一题」失败之后，
   * 前面已经开好的那几题必须原样还在。
   */
  const setOpenQuestions = (worksheetId: string, questionIds: string[]) => {
    if (worksheetOpenBusy) return;   // 整份替换：并发两次会互相盖
    const previous = worksheetOpen[worksheetId] ?? [];
    setWorksheetOpen((prev) => ({ ...prev, [worksheetId]: questionIds }));
    setWorksheetOpenBusy(true);
    void (async () => {
      try {
        // 服务端回的是**整张映射**（别的单那份也在里面）⇒ 直接覆盖本地这一份。
        const result = await api.setClassroomWorksheetOpen(id, worksheetId, questionIds);
        if (result?.worksheetOpen && typeof result.worksheetOpen === 'object') {
          setWorksheetOpen(result.worksheetOpen);
        }
      } catch (error) {
        setWorksheetOpen((prev) => ({ ...prev, [worksheetId]: previous }));
        setToast({ msg: `没设上：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
      } finally {
        setWorksheetOpenBusy(false);
      }
    })();
  };

  const toggleQuestions = () => runControlAction(HEADER_BUSY_KEYS.pause, async () => {
    if (paused) {
      await api.resumeClassroom(id);
      setPaused(false);
      setClassroom((previous) => previous ? { ...previous, status: 'active' } : previous);
    } else {
      await api.pauseClassroom(id);
      setPaused(true);
      setClassroom((previous) => previous ? { ...previous, status: 'paused' } : previous);
    }
  });

  const syncGroups = () => runControlAction(HEADER_BUSY_KEYS.syncGroups, async () => {
    const result = await api.syncClassroomGroups(id);
    await loadClassroom();
    setToast({
      msg: result.addedGroups > 0
        ? `分组已同步，新增 ${result.addedGroups} 个小组${classroom?.mode === 'advanced' ? '（使用课堂默认智能体）' : ''}`
        : '分组成员已同步到课堂看板',
      type: 'success',
    });
  });

  const toggleStop = () => runControlAction('stop', async () => {
    const result = await api.toggleAllowStop(id);
    setClassroom((previous) => previous ? { ...previous, allowStudentStop: result.allowStudentStop } : previous);
  });

  // ★ 2026-09-25：**只禁提问**。与上面那个 `toggleQuestions`（整节课暂停）是两件事 ——
  // 这条只关掉「问问题」，学生仍可看学习单、看探究网页。
  // 🔴 名字里必须带「提问」：两个开关并排放在同一块界面里，分不清哪个是哪个的代价是
  // 教师按错了还以为没生效。
  const toggleAllowAsk = () => runControlAction('allow-ask', async () => {
    const result = await api.toggleAllowAsk(id);
    setClassroom((previous) => previous ? { ...previous, allowStudentAsk: result.allowStudentAsk } : previous);
  });

  const toggleExport = () => runControlAction('export', async () => {
    const result = await api.toggleAllowExport(id);
    setClassroom((previous) => previous ? { ...previous, allowStudentExport: result.allowStudentExport } : previous);
  });

  const toggleFollowUps = () => runControlAction('follow-ups', async () => {
    const result = await api.toggleAllowFollowUps(id);
    setClassroom((previous) => previous ? { ...previous, allowFollowUps: result.allowFollowUps } : previous);
  });

  // 探究空间画面采集（P2.2）。三个参数各是一个 busy 键，请求期间那一行整体禁用，防连点。
  //
  // 只发**本次改动的那一个**字段：服务端把「没给这个字段」读作「这次不改它」，
  // 三个一起发会把本地可能已经过期的另外两个值一起写回去（另一位教师刚调过就被覆盖）。
  // 传 null 更不行 —— 那会被当成数值 0 再夹成下界（已在服务端修掉，但界面上没必要去踩）。
  //
  // 回写的是**服务端的响应值**而不是请求值：夹取发生在服务端，界面上那几档只是候选。
  const setWebappCapture = (key: string, body: { enabled?: boolean; width?: number; frameIntervalMs?: number; detailIntervalMs?: number | null }) => {
    // 「关掉开关后，下面两行点了不生效」的**代码级**保证。
    // 界面上那两行已经 disabled（disabled 的按钮在浏览器里不会派发 click），这里再挡一道是因为
    // 那个属性是个样式层的东西：一次「顺手删掉 disabled 让文字别发灰」的改动就会让它失效，
    // 而失效的样子是**静默**的 —— 教师以为关掉了，请求照发，设置照改。
    if (!captureEnabled && key !== 'capture-enabled') return;
    return runControlAction(key, async () => {
      const result = await api.setWebappCapture(id, body);
      setClassroom((previous) => previous ? {
        ...previous,
        webappCaptureEnabled: result.enabled,
        webappThumbnailWidth: result.width,
        webappFrameIntervalMs: result.frameIntervalMs,
        // ⚠️ 这一格可能是 **`null`**（= 没调过、跟随基准）。写成 `result.detailIntervalMs ?? 2000`
        // 会让「跟随基准」的课堂在改过一次别的采集设置之后，界面上被固定成 2 秒。
        webappDetailIntervalMs: result.detailIntervalMs,
      } : previous);
    });
  };

  // 模块三态：与前三个开关不同，PUT 不返回「服务端权威的全量态」，所以要自己乐观更新。
  // 点击立刻写本地（下拉框里选中项马上跟手），失败则回滚并抛错，由 runControlAction 统一 Toast。
  // busy 键按模块区分，请求期间这一行整体禁用，防连点。
  const setModuleState = (moduleKey: ClassroomModuleKey, state: ClassroomModuleState) => {
    const previousState = moduleStateOf(classroom?.modules, moduleKey);
    // 点到当前态是空操作：服务端 upsert 幂等，但没必要为一次没有变化的写入惊动全体学生端。
    if (previousState === state) return;
    return runControlAction(`module:${moduleKey}`, async () => {
      setClassroom((previous) => previous ? { ...previous, modules: applyModuleState(previous.modules, moduleKey, state) } : previous);
      try {
        await api.setClassroomModuleState(id, moduleKey, state);
        // 成功后该课堂至少有这一行模块行了 —— 否则把 A 设成 open 再设回 preview 时，
        // 三态又全是暂停，而 hasModuleRows 还停在初始加载的 false 上，
        // 菜单会重新弹出「未单独配置过模块」这句已经不成立的话。
        setClassroom((previous) => previous ? { ...previous, hasModuleRows: true } : previous);
      } catch (error) {
        // 只回滚被点击的这一个模块。回滚整个数组快照会把这一个 RTT 窗口内其它模块收到的
        // 广播一并抹掉（窗口内另一位教师改了别的模块时，本机会显示成旧态直到刷新）。
        setClassroom((previous) => previous ? { ...previous, modules: applyModuleState(previous.modules, moduleKey, previousState) } : previous);
        throw error;
      }
    });
  };


  /**
   * 探究空间（缩略图 + 文字档）的**唯一**一份订阅。
   *
   * 🔴 这里必须是**唯一**调用点（P2.3 看板合成时从 `webapp-monitor-view.tsx` 搬上来的）。
   * 看板合成之后每个格子都要显示自己那一份画面/文字档，而把订阅塞进格子里就是
   * 「N 个格子 N 份订阅、N 次 watch/unwatch」—— 服务端按需推流的闸门（Ruling 9）
   * 会被搅乱，学生端也可能被反复开关推流。
   * ⇒ 状态在这一层，格子只从里面取自己那一条。
   *
   * ⚠️ 与合并前的一处**行为差异**（有意为之）：订阅跟着**看板**走，而不是某个视图。
   * 合并前教师必须切到探究空间视图才会让学生开始推流；现在**跟随模式**下每格都可能显示
   * 画面，所以「开着看板」就该在推流档位上。
   *
   * 🔴 但**不能**因此变成"只要开着看板就无脑推流"：watch 一旦下发，全班学生立刻开始
   * 按档位截图（老 iPad 上 55~68ms/帧）。「指定 · 智能学伴」这种课堂上，屏幕上**一格**
   * 都不会用到那些图，却会让 40 台设备白白每 10 秒光栅化一次整页。
   * ⇒ 由 `needsExploreFrames` 把这件事说清楚：跟随模式要；指定模式下只有指定的正是
   *    探究空间时才要。**这是成本闸门，不是优化**（见 use-webapp-monitor.ts 的 prop 注释）。
   */
  const webappStates = useWebappMonitor({
    classroomId: id,
    roster: classroom?.students ?? [],
    webapps: classroom?.webapps ?? [],
    focusStudentId: exploreDetailId,
    needsExploreFrames: boardMode === 'follow' || assignModule === 'explore',
  });

  if (!classroom) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: "0.875rem" }}>加载中...</div>;
  }

  // ⊘ ★ 2026-09-29：这里原来还有 `statusValues` 与四个数（`onlineCount` / `thinkingCount` /
  // `offlineCount` / `totalRounds`）—— 它们是那行统计卡**唯一**的消费者，卡片删掉之后
  // 四个数一起删（留着就是四个「看着像还有人用」的死变量）。
  // ⚠️ 别把它们「顺手」挪到别处去：那一套的口径（数 `studentStatuses` 的**值**，而不是
  // 逐名册数）与筛选行那一套**不同源**，两个口径同屏就会出现两个不一样的「离线」。
  // 现在全屏只有一套：`boardFilterCounts` + `onlineTotal(moduleDistribution)`。

  // 「这个课堂从没单独配置过模块，菜单里看到的是默认态」。
  //
  // 两个条件缺一不可：只看「三态都是暂停」会把教师主动把三项都设成暂停的课堂误判成未配置
  // （mergeModuleStates 补齐出来的默认态与显式设置的暂停在 modules 里长得一模一样）。
  // hasModuleRows 用 === false 而不是 !：服务端读不到模块行时不发这个字段，那是「不知道」，
  // 不是「没有」，不能借它断言未配置。
  const modulesNeverConfigured = classroom.hasModuleRows === false
    && MODULE_KEYS.every((moduleKey) => moduleStateOf(classroom.modules, moduleKey) === DEFAULT_MODULE_STATE);

  // 探究空间画面的采集设置。老数据/老响应里这三个字段可能**根本不存在**。
  //
  // 🔴 方向至关重要：**认不出 = 开 / 用默认**。写成 `!classroom.webappCaptureEnabled`
  // 会让「不知道」显示成「已关闭」，教师看到的是一个假的关闭态 —— 而实际学生端还在传画面。
  // 判据与服务端 `normalizeCaptureConfig` 对齐：enabled 用 `!== false`，
  // 数值用 `??`（不是 `||`，那会把合法的 0 也吃掉；这里没有 0 档，但方向要一致）。
  const captureEnabled = classroom.webappCaptureEnabled !== false;
  const captureWidth = classroom.webappThumbnailWidth ?? DEFAULT_WEBAPP_WIDTH;
  const captureIntervalMs = classroom.webappFrameIntervalMs ?? DEFAULT_WEBAPP_FRAME_INTERVAL_MS;
  // ★ 2026-09-25 详情档（教师可覆盖）：
  //   · 没调过（`null` / 缺字段 / 坏值）⇒ **派生**（基准的 1/5，夹在 1000~5000）——
  //     基准 10 秒 ⇒ 2 秒，与 P2.2 的行为逐字相同。
  //   · 调过 ⇒ 用他那个值（同样夹一次：库里可能是手改过的行）。
  // ⚠️ 这里**不能**用 `?? 2000` 兜底：基准 30 秒的慢设备课堂，详情档该是 6 秒，
  //    兜成 2 秒等于把教师当初避开的代价加回去（理由逐字在服务端的
  //    `WEBAPP_DETAIL_DIVISOR` 注释里）。
  const rawDetailOverride = classroom.webappDetailIntervalMs;
  const detailIntervalOverride = typeof rawDetailOverride === 'number' && Number.isFinite(rawDetailOverride)
    ? Math.min(WEBAPP_DETAIL_MAX_MS, Math.max(WEBAPP_DETAIL_MIN_MS, Math.round(rawDetailOverride)))
    : null;
  const derivedDetailIntervalMs = Math.max(WEBAPP_DETAIL_MIN_MS, Math.round(captureIntervalMs / WEBAPP_DETAIL_DIVISOR));
  const detailIntervalMs = detailIntervalOverride ?? derivedDetailIntervalMs;
  // 整个采集分组共用的禁用条件：关掉开关时下面两行置灰。
  // 注意 `disabled` 要落到 <button> 上，光靠样式挡不住键盘与脚本触发。
  const captureRowsDisabled = controlBusy !== null || !captureEnabled;
  // busy 指示按行给（分辨率/频率各一行），键的前缀在 setWebappCapture 里拼。
  const captureWidthBusy = controlBusy !== null && controlBusy.startsWith('capture-width-');
  const captureIntervalBusy = controlBusy !== null && controlBusy.startsWith('capture-interval-');

  const allDisplayCards: ClassroomDisplayCard[] = groupCards || students;
  const getDisplayCardStatus = (card: ClassroomDisplayCard): 'online' | 'thinking' | 'offline' => {
    if (isClassroomGroupCard(card)) {
      if (card.members.some((member) => studentStatuses[member.id] === 'thinking')) return 'thinking';
      if (card.members.some((member) => studentStatuses[member.id] === 'online')) return 'online';
      return 'offline';
    }
    const status = studentStatuses[card.id];
    return status === 'thinking' || status === 'online' ? status : 'offline';
  };
  const cardNeedsAttention = (card: ClassroomDisplayCard) => {
    const members = isClassroomGroupCard(card) ? card.members : [card];
    return members.some((member) => studentBlacklisted[member.id] || (studentWarnings[member.id] || 0) > 0);
  };
  /* ═══════════ P2.3：一个格子的内容区显示什么 ═══════════ */

  /**
   * 该生**实际**所在的模块 —— 与看板模式无关。
   *
   * 与 `resolveTileModule` 的差别只在「指定」模式：那时格子显示的是教师指定的那个，
   * 而学生人还在自己点开的模块里。两者的差只有这里读得到，格子上那行「实际在：X」
   * 与小组格的实际位置统计都靠它（见 `tileLocationNote`）。
   *
   * ★ 2026-09-29：判据搬去 `board-module-counts.ts` 的 `resolveFocus`（**唯一一份**）——
   * 看板那一行的「谁在哪个模块」也要用它，而两处各写一遍必然有一处先漂
   *（筛出来的格子与数字对不上，两边都不报错）。这里只把地图递过去。
   */
  const resolveStudentFocus = (studentId: string): TileModule => resolveFocus(studentModuleFocus, studentId);

  /**
   * 单个学生**这一格**该显示哪个模块。
   *
   * `hasOwnProperty` 而不是读值判 `undefined`：**键不在 = 从没收到过**（`unknown`），
   * 与「收到了 null = 他在首页」是两件不同的事 —— 合并成一件就会把「不知道」说成
   * 「在首页」，而那是**编造**出来的一条事实。（这一层判断在 `resolveStudentFocus` 里，
   * 指定模式下不走它 —— 那时格子的内容由教师指定，与学生位置无关。）
   */
  const resolveTileModule = (studentId: string): TileModule => {
    if (boardMode === 'assign') return assignModule;
    return resolveStudentFocus(studentId);
  };

  /** 小组格子：组内成员**全在同一个模块**就是那个模块，否则 `mixed`。 */
  const resolveGroupTileModule = (members: ClassroomCardStudent[]): GroupTileModule => {
    if (boardMode === 'assign') return assignModule;
    if (members.length === 0) return 'unknown';
    const first = resolveTileModule(members[0].id);
    return members.every((member) => resolveTileModule(member.id) === first) ? first : 'mixed';
  };

  /**
   * 这一格要不要显示「清除对话」垃圾桶。
   *
   * 🔴 用户原话：它**只针对学生与智能体对话的内容**。所以只在内容区真的显示着
   * 「智能学伴」的对话时才出现 —— 探究空间那格、学习单那格、在首页/状态未知那格
   * **都不显示**。一个点了没用的按钮比没有按钮更糟。
   *
   * 小组格是唯一的灰度情形：组内混着几个模块时，只要**有成员在学伴**，垃圾桶就还有
   * 意义（它一次清掉全组的学伴对话）；全组都不在学伴时不显示。
   */
  const tileShowsClear = (module: GroupTileModule, members: ClassroomCardStudent[]): boolean => {
    if (module === 'companion') return true;
    if (module !== 'mixed') return false;
    return members.some((member) => resolveTileModule(member.id) === 'companion');
  };

  /** 一个模块在教师看板上的中文名。`home` / `unknown` 不是模块，是两种「不在这三个里」。 */
  const moduleLabelOf = (module: TileModule): string => {
    if (module === 'home') return '首页';
    if (module === 'unknown') return '…';
    return MODULE_ID_LABELS[module];
  };

  /**
   * 这一格的参与者此刻该作答的那一份学习单（`null` = 没有）。
   *
   * 交给 `effectiveGroupWorksheet`（与学生端**同一个**解析口径：高级模式只认自己那个组，
   * 本组没配就是 `null`，不拿课堂级的顶上）——看板这一侧**不自己挑**，否则
   * 「学生答的那份」与「教师看到的那份」会分叉，而且分叉时不报任何错。
   */
  const tileWorksheetOf = (participant: ClassroomCardStudent | null): WorksheetMaterialSummary | null =>
    effectiveGroupWorksheet(classroom, { groupId: participant?.groupId ?? null });

  /**
   * 徽章行里那个**模块相关**的徽章的文字（`null` = 这一格不该有它）。
   *
   * 🔴 用户 2026-09-23（截图批注）：「这个『几轮』只在智能学伴里有」。在此之前这一行
   * 无条件写着 `{rounds} 轮`，于是「学生在学习单里」的格子上也挂着一个学伴对话数。
   *
   * 三件套**各判各的**，外加兜底 —— 徽章行从此是模块相关的，不是一行固定内容：
   *   · 智能学伴 → `{rounds} 轮`
   *   · 学习单   → **没有徽章**（★ 2026-09-28，教师第 5 条：「已交 X/Y 没有意义，去掉」）
   *   · 探究空间 → 不显示（那一格显示的是画面，与对话轮数无关）
   *   · 兜底     → `home` / `unknown` / 线缆上多出来的取值都不显示
   *
   * 小组格的灰度情形与 `tileShowsClear` 同款：组内混着几个模块时，只要有成员在学伴，
   * 这个数字就还有意义（`rounds` 数的是**学伴对话**，不是「在这个模块里说了几句」）。
   *
   * ⊘ 2026-09-28 作废：这一段原先还解释「学习单那一档为什么是『已交 N/M』而不是规格 §3-I
   * 写的『已看 N/M』」。那一整段现在**没有对象了**（学习单不再有徽章），所以删掉 ——
   * 留着的后果是下一个人以为「已交 N/M」还在屏幕上，而它已经没有了。
   */
  // ⚠️ 第三/四个参数里 `online` 在 ★ 2026-09-28 之后**不再被用到**（它原来只喂给
// 「学习单已交 N/M」那个徽章，而那个随第 5 条去掉了）—— 顺手删掉，免得下一个人以为
// 徽章还会看在线状态。
const tileModuleBadge = (module: GroupTileModule, members: ClassroomCardStudent[], rounds: number): TileBadge | null => {
    switch (module) {
      case 'companion':
        return { kind: 'rounds', rounds };
      case 'worksheet':
        // ★ 2026-09-28（教师第 5 条）：**学习单这一格不再有徽章**。
        // 原话：「看板上部的『已交 X/Y』这个信息我觉得是没有意义的，可以去掉」。
        // 依据：那一行数字与格子正文里那串方块**说的是同一件事**（方块就是逐题状态），
        // 而方块更细（哪几题、什么状态）。徽章只是把同一个数再说一遍，占着一行的位置。
        // ⚠️ 连带作废了 `stateHasCells` 那条「徽章与方块必须数同一批东西」的不变式 ——
        // 见 `worksheet-tile-state.ts` 里那个函数上的注释（它按本仓的规矩标了作废日期）。
        return null;
      case 'explore':
        return null;
      case 'mixed': {
        if (members.some((member) => resolveTileModule(member.id) === 'companion')) return { kind: 'rounds', rounds };
        // ★ 学习单那一档与上面同一条：不再给徽章（第 5 条）。
        return null;
      }
      default:
        return null;
    }
  };

  /**
   * 格子内容区那行小字：这个学生**实际**在哪个模块（「当前位置」）。
   *
   * 🔴 只在「指定」模式下出现。跟随模式下格子的模块就是这个学生的实际位置
   * （同一个来源 `resolveStudentFocus`），写出来只是把同一件事说两遍；小组格的逐人差异
   * 也已经由 `mixed` 分支列出来了。指定模式下则不然：教师选的是「探究空间」，而某个
   * 学生可能正待在「学习单」里 —— 格子上显示的是等待画面，这行小字是唯一告诉教师
   * 「他在哪儿」的东西（用户 2026-09-23 的截图批注：箭头指向格子空白处）。
   *
   * 学生格说他自己在哪；小组格只列**不在**指定模块里的那些人，都在就不显示
   * （否则「3 人都在探究空间」会盖在每一格上，那是噪音，不是信息）。
   */
  const tileLocationNote = (module: GroupTileModule, members: ClassroomCardStudent[]): string | null => {
    if (boardMode !== 'assign') return null;
    if (members.length === 0) return null;
    // 学生格（含只有 1 人的小组）：他自己的实际位置。
    if (members.length === 1) {
      const actual = resolveStudentFocus(members[0].id);
      if (actual === module) return null;
      // `unknown` 在 `moduleLabelOf` 里是「…」（给格子标题用的），这句话里要说清楚。
      return actual === 'unknown' ? '位置未知' : `实际在：${moduleLabelOf(actual)}`;
    }
    // 小组格：按实际位置归类。
    const tally = new Map<TileModule, number>();
    for (const member of members) {
      const actual = resolveStudentFocus(member.id);
      if (actual === module) continue;
      tally.set(actual, (tally.get(actual) ?? 0) + 1);
    }
    if (tally.size === 0) return null;
    const parts = [...tally.entries()].map(([actual, count]) =>
      `${actual === 'unknown' ? '位置未知' : moduleLabelOf(actual)} ${count}`);
    return `实际：${parts.join('、')}`;
  };

  /**
   * 三件套各几人（+ 首页 / 未知）。
   *
   * ★ 2026-09-29（教师批注 ③）：「这里显示的人数应该是指**当前正处在这个页面中的
   * 在线人数**」。⇒ 只数**在线**（`online` / `thinking`）的人。截图里的症状是
   * 全班 40、离线 38，而「学习单」写着 8 —— 那 8 个里多数是离线、只是最后停在学习单的。
   *
   * 🔴 数字与筛选**同一套判据**（`cardInOnlineModule`，教师选定「一起改」）：
   * 只改数字会留下「写 2 人、点开 8 格」，比原来一致地错更糟。
   *
   * ⚠️ 相加 = **此刻在线人数**，不是参与者总数。界面上那一行仍然
   * 「在线 + 离线 = 全部」，所以三个模块格相加**不该**等于「全部」—— 那不是算错。
   *
   * ⚠️ 单位是**参与者**（分组 / 高级模式下就是组，量词由 `moduleCountUnit` 给）：
   * 小组格会把这些学生藏起来（一个组一个格子），所以**不能**改数 `allDisplayCards`。
   */
  const moduleDistribution: Record<TileModule, number> = onlineModuleDistribution(
    students.map((student) => student.id),
    studentModuleFocus,
    studentStatuses,
  );

  // ★ M5a：模块筛选行那六个数字的量词（分组/高级模式下参与者是组 ⇒ 那是组数）。
  // 与 `moduleDistribution` 同一处：两者必须同源，否则量词与数字会各说各的。
  const moduleCountUnitSuffix = moduleCountUnit(classroom.mode);

  /**
   * 模块筛选的**生效值**。
   *
   * 🔴 只在「跟随」模式下生效：指定模式下全班的格子都是教师选的那一个模块
   * （`resolveTileModule` 直接返回 `assignModule`），按模块筛就只剩「全中」与「全不中」
   * 两种结果 —— 那种筛选器对教师毫无用处，却会让人以为它坏了。所以指定模式下这一行
   * 不渲染（见下面筛选行的 JSX），筛选值也**不生效**而不是偷偷清空 state：
   * 切回跟随时教师原来挑的那一项还在。
   */
  const effectiveModuleFilter: StudentModuleFilter = boardMode === 'follow' ? studentModuleFilter : 'all';

  /**
   * 一个格子是否属于某个模块的筛选。
   *
   * ⚠️ 按**人**判（任一成员在该模块即命中），不是按格子的 `tileModule` 判：
   * 小组格的 `tileModule` 可能是 `mixed`，而它确实**含有**在「学习单」里的人
   * —— 教师点「学习单」是想找出这些学生，把 mixed 格整格藏掉正好把他们藏起来了。
   * 代价是一个 mixed 格会在多个模块筛选下都出现（它本来就横跨多个模块）。
   *
   * ★ 2026-09-29（教师批注 ③）：判据加上**在线**，移到 `board-module-counts.ts`
   *（`cardInOnlineModule`）—— 与那一格的数字**同一套判据**。教师选定「数字和筛选一起改」：
   * 只改数字会留下「写 2 人、点开 8 格」。
   */
  const cardInModule = (card: ClassroomDisplayCard, module: TileModule): boolean => {
    const members = isClassroomGroupCard(card) ? card.members : [card];
    return cardInOnlineModule(members.map((member) => member.id), module, studentModuleFocus, studentStatuses);
  };

  /* ═══════════ 筛选：状态那一组 + 模块那一组（「与」关系） ═══════════ */

  /**
   * ⚠️ 这两段刻意排在**模块判定之后**：过滤器里要调 `cardInModule` / `resolveStudentFocus`，
   * 而它们是 `const` 箭头函数 —— 排到前面就是 TDZ 的 `ReferenceError`（首屏即崩），
   * 不是「还没算好」那种能靠默认值兜住的错。
   */
  const displayCards = allDisplayCards.filter((card) => {
    if (studentBoardFilter !== 'all') {
      if (studentBoardFilter === 'attention') {
        if (!cardNeedsAttention(card)) return false;
      } else if (getDisplayCardStatus(card) !== studentBoardFilter) {
        return false;
      }
    }
    // 两组筛选是**「与」**关系：状态那一组答「他掉线了吗」，模块这一组答「他在用哪一件」。
    // 模块那一组的生效值见 `effectiveModuleFilter`（指定模式下恒为 `all`）。
    return effectiveModuleFilter === 'all' || cardInModule(card, effectiveModuleFilter);
  });
  /**
   * 「这间课堂在用什么材料」的那一份形状（`ClassroomMaterials`）。
   *
   * 🔴 **课堂级智能体在教师端这条路径上叫 `classroomAgents`**（`GET /:id` 的 include），
   * 不叫 `agents` —— 而 `agents` 在类型上是**可选**的 ⇒ 把原始 `classroom` 递下去时
   * `classroom.agents` 恒为 `undefined`，`effectiveGroupAgent` **静默**回 `null`
   *（=「这间课堂没配智能体」），而 tsc / eslint / 用例**全绿**。
   *
   * ⚠️ ★ 2026-09-29 **为这一条付过学费**：我用原始 `classroom` 去调 `visibleModules`，
   * 于是「智能学伴」页签对**所有**课堂消失、词云跟着不见（教师报「词云还是没有回来」），
   * 而同一个函数的网页 / 学习单两条恰好读的就是同名小写字段 ⇒ 只有智能体那一条静默地错。
   * `drawerAgent` 那处**早就拼过同一个对象**（它的注释里写着「这里只做改名」），我没找到它。
   * ⇒ 现在拼一次、两处共用，并且立了一条网盯着调用点（`classroom-materials-shape.test.ts`）。
   */
  const materials = { ...classroom, agents: classroom.classroomAgents?.map((item) => item.agent) };

  const boardFilterCounts: Record<StudentBoardFilter, number> = {
    all: allDisplayCards.length,
    online: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'online').length,
    thinking: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'thinking').length,
    attention: allDisplayCards.filter(cardNeedsAttention).length,
    offline: allDisplayCards.filter((card) => getDisplayCardStatus(card) === 'offline').length,
  };

  /* ═══════════ 头部（★ 2026-09-29 重构：判据抽进 `header-controls.ts`）═══════════ */

  /**
   * 这一屏头部有哪些控件、各叫什么、禁不禁用 —— 全部来自那个纯函数
   *（逐条用例在 `header-controls.test.ts`；⚠️ 不在这里写条数，它每次加用例都会过期）。
   *
   * 🔴 这里**只递输入、只画结果**：`同步分组` 的两道条件、
   * 两个开关的标签翻转、忙态的三个键，原先全写在这一段的 JSX 三元里，**没有任何回归网**。
   * 判据搬走之后，本文件只剩「把 `control.id` 接到哪个 handler、配哪个图标」。
   * ⚠️ 那两件事（handler / 图标）**不进判据层**：它们是本文件里的闭包与 JSX，
   * 搬出去只会得到一份需要 20 个回调的签名，收益为零。
   */
  const header = headerLayout({
    mode: classroom.mode,
    status: classroom.status,
    paused,
    answersLocked,
    boardMode,
    gridFullscreen,
    busy: controlBusy,
    worksheetMenuOpen: showWorksheetMenu,
    exploreOpen: settingsDialog === 'explore',
    companionMenuOpen: showCompanionMenu,
    modulesOpen: showModulesMenu,
  });

  /** 每个控件的动作。`Record<HeaderControlId, …>` 是道门：判据层加一项而这里没接 ⇒ 编译失败。 */
  const headerActions: Record<HeaderControlId, () => void> = {
    pause: () => void toggleQuestions(),
    lock: () => void toggleAnswersLock(),
    'sync-groups': () => void syncGroups(),
    notify: () => { setNotifyText(''); setNotifySent(false); setNotifyState({ show: true }); },
    'worksheet-menu': () => setShowWorksheetMenu((visible) => !visible),
    fullscreen: () => setGridFullscreen(true),
    // ★ 2026-09-29：两个设置弹窗各记下「是谁开的」，关闭时焦点要还回那一个（见上面那条 effect）。
    'explore-settings': () => { settingsOpenerRef.current = 'explore-settings'; setSettingsDialog('explore'); },
    'companion-menu': () => setShowCompanionMenu((visible) => !visible),
    'module-state': () => setShowModulesMenu((visible) => !visible),
  };

  /** 每个控件的图标。收 `active` 的只有「暂停课堂」—— 播放/暂停两个形状。 */
  const headerIcons: Record<HeaderControlId, (active: boolean) => ReactNode> = {
    pause: (active) => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {active ? <><path d="M8 5v14l11-7z" /></> : <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>}
      </svg>
    ),
    lock: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
    'sync-groups': () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>
    ),
    notify: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    ),
    // ★ 2026-09-29（教师）：「三个图标改一改，跟左侧菜单栏一致。」
    // ⇒ 学习单 / 探究空间 / 智能学伴 这三枚换成**教师侧栏那三枚的同一个组件**
    //（原来这里是我手画的三枚：一张纸、一个地球、一个对话气泡 —— 与侧栏毫无关系）。
    // ⚠️ 共用组件而不是「照着画一遍」：各画一份必然漂移，而屏幕上只是「两处的图标不一样」。
    'worksheet-menu': () => <WorksheetNavigationIcon size={16} strokeWidth={1.5} />,
    fullscreen: () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
    ),
    'explore-settings': () => <ExploreSpaceNavigationIcon size={16} strokeWidth={1.5} />,
    'companion-menu': () => <AgentNavigationIcon size={16} strokeWidth={1.5} />,
    'module-state': () => (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
    ),
  };

  const headerCaret = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
  );

  /**
   * 筛选行右段（「此刻在线」）那两个数。
   *
   * 🔴 三个模块数字是**在线**口径（教师批注 ③），而左段是**参与者**口径 ——
   * 两个分母共用一行时，`三个模块 + 离线 + 全部` 这三条凑不齐（差的那一个正是在首页 /
   * 位置未定的人）。所以右段要**自己把分母写出来**（「此刻在线 N 人」），并用
   * `unplacedNote` 把那半句话补上（`0` 时不出现）。见那两个函数。
   *
   * ⚠️ **口径与 `onlineCount` 不同，这不是笔误**：上面那个数数的是
   * `Object.values(studentStatuses)` —— 那是一张「**连过**这张看板的学生」的表
   *（`loadClassroom` 只把 HTTP 查到的在线 id 写进去，离线且从没连过的人**根本没有键**），
   * 而且换组后消失的参与者可能留在里面。这一个数逐**名册**数（`students`）——
   * 与它左边那两个模块格、以及「全部 / 离线」两格**同一个分母**，才谈得上对账。
   * ⇒ 两者在「有人被移出名册」时会差几个。屏幕上方那块统计卡用的是旧口径，
   * 本次不动它（那是另一屏的事），但**别把这里换成它**。
   */
  const onlineParticipants = onlineTotal(moduleDistribution);
  const unplaced = unplacedNote(moduleDistribution, moduleCountUnitSuffix);


  /**
   * 探究画面的两个全局计数（合并前那面「图墙」顶部那一行就是它们）。
   *
   * 按**人**数、覆盖全班：与刚才那面图墙的语义一致 ——「这个班上有多少人在用探究空间」
   * 与「这一格是谁」是两个问题，第 2 个由每格的缩略图回答。
   */
  const exploreWithFrame = students.filter(s => webappStates[s.id]?.dataUrl).length;
  // 「打开了网页」= 收到过文字档且**此刻在前台**。与 withFrame 是两个独立的数：
  // 关掉画面的课堂里 withFrame 恒为 0，而这个数字仍然是有意义的。
  const exploreOpened = students.filter(s => webappStates[s.id]?.presence?.visible).length;

  /**
   * 探究详情浮层对应的学生。
   *
   * ⚠️ 从**名册**里现查，而不是把学生对象存进 state：名册在课堂进行中会变
   * （学生加入/离开、同步分组），存对象就等于留着一份不会更新的旧快照。
   * 查不到就当作没打开 —— 一个已经不在名册上的 id 不该让浮层继续挂在屏幕上。
   */
  const exploreDetailStudent = exploreDetailId ? students.find(s => s.id === exploreDetailId) ?? null : null;

  /**
   * 对话抽屉里给助手消息**署名**的那一个智能体（名字 + 头像）。
   *
   * 🔴 **必须与该学生（或小组）此刻实际在用的那一个是同一个。** 署名错了，教师看到的
   * 是一条张冠李戴的记录 —— 名字和头像都属于别的组 —— 而且**不会报任何错**。
   *
   * 取法与「这间课堂在用什么材料」同一条规矩，**不在这里另写一份回落**：
   * `effectiveGroupAgent`（`@/lib/classroom-material`）。它已经带着那条关键约束 ——
   * **高级模式只认学生自己那个组，该组没配就是 `null`（不回落）**；标准 / 分组模式
   * 才读课堂级（spec §1.3 / §4.4）。
   *
   * ⚠️ 课堂级那一个在教师端这条路径上叫 `classroomAgents`（`GET /:id` 的 include），
   * 不叫 `agents` —— 这里**只做改名**，解析仍交给那个函数（它的注释里写明了调用方要
   * 「拼一下」）。不改名的话 `classroom.agents` 恒为 `undefined`，标准模式下会退化成
   * 没名字，那是把一处谎换成另一处空白。
   *
   * ⚠️ 学生 → 组的映射从**名册**现查（与 `exploreDetailStudent` 同一条理由：名册会变，
   * 存对象就是留一份不更新的旧快照）。查不到时 `groupId` 给 `null` ⇒ 高级模式下
   * 解析结果就是 `null`（不猜、也不拿课堂级顶上），界面显示「AI 助手」。
   */
  const drawerAgent = effectiveGroupAgent(
    // ⚠️ 用上面那一份 `materials`（**同一份形状，拼一次**）—— 原来这里自己又拼了一遍，
    // 而那正是上面那个 bug 的成因之一：同一件事存在两个拼法时，总有一处忘了拼。
    materials,
    { groupId: students.find((s) => s.id === selectedStudent?.id)?.groupId ?? null },
  );

  /**
   * 打开某个学生的探究详情。
   *
   * ⚠️ 顺手把**对话抽屉**关掉：两者是同一块位置（右上角、宽 420）的浮层，
   * 不互斥的话教师先点开 A 的对话、再点开 B 的探究画面，就会看到两块面板叠在一起
   * —— 而它们各自看起来都「正常」，只是合起来谁也读不出来。
   */
  const openExploreDetail = (studentId: string) => {
    setSelectedStudent(null);
    setSelectedGroup(null);
    selectedStudentIdRef.current = null;
    // 与另外两个浮层互斥（同一块 420px 位置，见 `openStudentDrawer` 的同款一行）。
    setWorksheetDrawer(null);
    setExploreDetailId(studentId);
  };

  /**
   * 格子内容区的**唯一**渲染实现：主看板与全屏网格都调它。
   *
   * 为什么必须只有一份：这两处本来就是逐字重复的（合并前就是），再加一层「按模块分支」
   * 的分叉，全屏里少一个缩略图这类差异只会在全屏里才看得见。
   * 差异只剩 `compact`（全屏格子更小、字更小）这一个旋钮。
   */
  const renderTileContent = ({ module, members, isGroup, online, groupName, userMsg, assistantMsg, compact }: {
    module: GroupTileModule;
    /** 这一格代表的成员：学生格 = 那一个学生；小组格 = 全组成员（`members[0]` 是「主」学生）。 */
    members: ClassroomCardStudent[];
    isGroup: boolean;
    /** 学生格的在线判据；小组格传 `getDisplayCardStatus(card) !== 'offline'`。 */
    online: boolean;
    groupName?: string;
    userMsg?: ClassroomCardMessage;
    assistantMsg?: ClassroomCardMessage;
    compact: boolean;
  }) => {
    const primary = members[0];
    // 与合并前逐字一致：学生格的说话人后面带一个冒号，小组格用消息自带的 `studentName`。
    const speaker = isGroup
      ? (userMsg?.studentName || groupName || primary?.student.name || '')
      : `${primary?.student.name ?? ''}:`;

    /** 「最近一轮 Q&A」—— 合并前那个格子的内容，逐字保留（它就是 companion 的内容）。 */
    const companion = userMsg ? (
      <>
        <div style={{
          padding: compact ? '5px 8px' : '10px 14px', borderRadius: compact ? 6 : 8,
          background: '#eef3f8',
          fontSize: compact ? '0.625rem' : '0.75rem', lineHeight: compact ? 1.4 : 1.6, color: '#334155',
          wordBreak: 'break-word',
        }}>
          <span style={{ fontWeight: 600, color: '#527198', marginRight: compact ? 3 : 4 }}>{speaker}</span>
          <span>{stripMarkdownToPlainText(userMsg.content)}</span>
        </div>
        {assistantMsg && (
          <div style={{
            padding: compact ? '5px 8px' : '10px 14px', borderRadius: compact ? 6 : 8,
            background: '#f8fafc',
            border: '1px solid #eef2f6',
            fontSize: compact ? '0.625rem' : '0.75rem', lineHeight: compact ? 1.4 : 1.6, color: '#64748b',
            wordBreak: 'break-word',
          }}>
            <span style={{ fontWeight: 600, color: '#3f7859', marginRight: compact ? 3 : 4 }}>AI:</span>
            <span>{stripMarkdownToPlainText(assistantMsg.content)}</span>
          </div>
        )}
      </>
    ) : (
      <div style={{ padding: compact ? '6px 10px' : '10px 14px', borderRadius: compact ? 6 : 8, background: '#f9fafb', fontSize: compact ? '0.688rem' : '0.75rem', color: '#cbd5e1', textAlign: 'center' }}>
        暂无对话
      </div>
    );

    /** 「这一格没有可显示的内容」的统一长相（学习单 / 首页 / 状态未知三处共用）。 */
    const placeholder = (label: string, hint: string) => (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 6px', borderRadius: compact ? 6 : 8, background: '#f9fafb', border: '1px dashed #e2e8f0', textAlign: 'center' }}>
        <span style={{ fontSize: compact ? '0.688rem' : '0.813rem', fontWeight: 600, color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '0.625rem', color: '#cbd5e1', lineHeight: 1.4 }}>{hint}</span>
      </div>
    );

    // 按这一格的模块渲染。**唯一**的实现：主看板与全屏网格都调它（见函数头的注释）。
    const content = (() => {
      switch (module) {
      case 'companion':
        return companion;
      case 'explore':
        return isGroup ? (
          <ExploreMemberStrip
            members={members}
            states={webappStates}
            statuses={studentStatuses}
            captureEnabled={captureEnabled}
            onOpenStudent={openExploreDetail}
          />
        ) : (
          <ExploreTile
            name={primary?.student.name ?? ''}
            state={primary ? webappStates[primary.id] : undefined}
            online={online}
            captureEnabled={captureEnabled}
            compact={compact}
          />
        );
      // 学习单那一格：状态 + 逐题方格阵（规格 §7.2）。
      //
      // ⚠️ 取哪一份、进度是什么，**在这里算一次**再交给 `worksheetTileState`（纯函数）——
      // 判据写在 JSX 里就没有回归网了（本仓没有前端测试框架，那一份逻辑有 18 条断言）。
      case 'worksheet': {
        const participant = members[0] ?? null;
        const worksheet = tileWorksheetOf(participant);
        // ★ 2026-09-28：他**此刻正在编辑**的那一份（来自「正在输入」那条实时通道，没落库）。
        // 🔴 它同时喂给 `worksheetTileState` 与 `activeAnswer` —— **两者必须同源**，
        // 否则会出现「标题说正在做第 3 题、下面画的是第 5 题」（各挑各的，两边都不报错）。
        // ⚠️ 按 `worksheetId` 过滤：两份学习单若有同名题号（复制出来的），只靠题号判会串。
        const liveDraft = participant ? wb.liveDrafts[participant.id] : undefined;
        const draft = liveDraft && worksheet && liveDraft.worksheetId === worksheet.id ? liveDraft : null;
        const state = worksheetTileState({
          worksheet,
          // 键不在 = 题目还没加载到（`null`，格子如实说「内容还没加载到」）。
          nodes: worksheet ? wb.nodesByWorksheet[worksheet.id] ?? null : null,
          // `undefined` = 打开看板后没收到过这个人的作答（不是「零作答」，见 state 的注释）。
          progress: participant ? wb.progress[participant.id] : undefined,
          liveQuestionId: draft?.questionId ?? null,
          online,
          now: nowMs,
        });
        // ★ 2026-09-29（教师第 6 条）：「这个面板里显示的是学生学习单的监控情况，还缺少一个
        // **非常重要**的信息，就是学生目前所获得的奖励个数」。
        //
        // 🔴 取数与清题那条路（`handleClearAnswers`）**同一套**：题目树 + 这个人的全部作答行 +
        // 那份学习单的奖励档 ⇒ `participantOverview`（纯函数、有 8 条用例）。
        // ⚠️ **不在这里自己把分数加起来** —— 奖励是「各题得分之和」，而「哪几题算分、
        // 主观题算不算」全在那一层里（规格 §9.1 那张图）；这里再加一遍就是第二份真源。
        // ⚠️ `answerRows` 与 `nodes` **算一次、两处用**（格子正文与奖励）—— 各取一份的
        // 表现是「同一格上写了两个不同的数」，而屏幕上不报错。
        const tileNodes = worksheet ? wb.nodesByWorksheet[worksheet.id] ?? [] : [];
        const tileRows = participant && worksheet
          ? (wb.board?.worksheets.filter((item) => item.id === worksheet.id)[0]
            ?.participants.filter((item) => item.participantId === participant.id)[0]?.answerRows) ?? []
          : [];
        const tileSettings = worksheet ? wb.settingsByWorksheet[worksheet.id] : undefined;
        const tileScale = tileSettings ? resolveRewardScale(tileSettings) : null;
        const overview = participant && worksheet
          ? participantOverview(tileNodes, tileRows, tileScale)
          : null;
        return (
          <WorksheetTileContent
            state={state}
            // ★ 2026-09-28（教师）：下方那一块 ——「学生此刻正在做的那一题」的实时作答。
            // 🔴 那一题由 `activeAnswer` 挑，而它**复用格子正文同一个判据**
            //（`activeQuestionIndex`）⇒ 上面写「正在做 任务二 · 1」，下面预览的一定是
            // 那一题（各挑各的会让教师照着另一道题的答案去讲这一道，且两边都不报错）。
            // ⚠️ `cells` 取 `state.cells`（不是 `progress.cells`）：那是格子正文真正用的
            // 那一份，另取一份就是第二条合并路径，可能与正文分叉。
            answer={participant && stateHasCells(state) && worksheet
              ? activeAnswer(
                tileNodes,
                tileRows,
                state.cells,
                wb.progress[participant.id]?.lastQuestionId ?? null,
                // ★ **同一份**实时预览（与上面 `liveQuestionId` 同源，见那里的注释）。
                draft,
              )
              : null}
            // ★ 2026-09-29 第二轮（教师）：「那个地方要用**图标**，『×3』字要小一点」
            // ⇒ 传**档位 + 个数**（不是拼好的文字）—— 文字符号画不出那个卡通图标。
            // ⚠️ `null` = 那份学习单的 settings 还没到 ⇒ 格子不画奖励，**不是**画一个 `×0`
            //（「不知道」与「零个」是两句不同的话，`participantOverview` 那半边分得清）。
            reward={overview && tileScale ? { style: tileScale.style, amount: overview.reward } : null}
            compact={compact}
          />
        );
      }
      case 'home':
        return placeholder('在首页', '学生此刻停在首页，不在任何模块里');
      case 'unknown':
        return placeholder('…', '还没收到这个学生的模块状态');
      case 'mixed':
        // 组内成员各在各的模块：先把「谁在哪儿」列出来，再保留原有的全组对话预览
        // —— 列出清单不等于可以把对话藏起来（那会把一个既有的能力弄丢）。
        return (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
              {members.map((member) => (
                <div key={member.id} style={{ display: 'flex', gap: 6, fontSize: compact ? '0.625rem' : '0.688rem', lineHeight: 1.4 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }}>{member.student.name}</span>
                  <span style={{ marginLeft: 'auto', color: '#64748b', whiteSpace: 'nowrap' }}>{moduleLabelOf(resolveTileModule(member.id))}</span>
                </div>
              ))}
            </div>
            {companion}
          </>
        );
      default:
        // TS 认为不可达（联合类型已被上面穷尽）。留一条兜底是因为**线缆值**可能不在联合里：
        // 服务端只放行三件套与 null，但看板不该因为上游多了一种取值就渲染出一片空白。
        return placeholder('…', '这个模块看板还不认识');
      }
    })();

    // 「当前所在位置」那行小字。只在指定模式下、且与该格显示的模块不同时出现 ——
    // 判断全在 `tileLocationNote` 里，两处看板（主看板 / 全屏）共用这一个出口。
    const locationNote = tileLocationNote(module, members);
    if (!locationNote) return content;
    return (
      <>
        <div title="该学生此刻实际所在的模块（指定模式下与他被指定的可能不同）"
          style={{
            flexShrink: 0, padding: compact ? '2px 6px' : '3px 8px', borderRadius: compact ? 4 : 6,
            background: '#f8fafc', border: '1px solid #eef2f6',
            fontSize: compact ? '0.563rem' : '0.688rem', color: '#64748b', lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
          {locationNote}
        </div>
        {content}
      </>
    );
  };

  // 投屏轮次预计算
  const msgRounds: (number | null)[] = [];
  let _r = 0;
  for (let _i = 0; _i < messages.length; _i++) {
    const _m = messages[_i];
    if (_m.role === 'user') _r++;
    msgRounds.push((_m.role === 'user' || _m.role === 'assistant') ? (_r || 1) : null);
  }
  // 投屏过滤（只展示 selectedRounds 中的轮次）
  const projMsgs = messages.filter((_, i) => msgRounds[i] != null && selectedRounds.includes(msgRounds[i]!));
  const msgChecked = msgRounds.map(ri => ri != null && selectedRounds.includes(ri));
  const allRis = (() => {
    const s = new Set<number>();
    for (const mr of msgRounds) { if (mr != null) s.add(mr); }
    return Array.from(s).sort((a: number, b: number) => a - b);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {gridFullscreen && <style>{`body { overflow: hidden; }`}</style>}
      <style>{`.preview-scroll::-webkit-scrollbar { width: 4px; } .preview-scroll::-webkit-scrollbar-track { background: transparent; } .preview-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; } .preview-scroll { scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent; } .control-btn:hover { background: #f1f5f9 !important; } @keyframes slideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 顶部区域（非全屏时显示） */}
      {!gridFullscreen && (<>
      <div className="teacher-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <button onClick={() => router.push('/teacher')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '6px 8px', borderRadius: 8, marginTop: 2, flexShrink: 0,
              color: '#64748b', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: "1.375rem", fontWeight: 700, margin: 0 }}>{classroom.title || '课堂看板'}</h1>
            <span style={{
              fontSize: "0.688rem", fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: classroom.mode === 'advanced' ? '#ecfdf5' : classroom.mode === 'group' ? '#f5f3ff' : '#eef3f8',
              color: classroom.mode === 'advanced' ? '#059669' : classroom.mode === 'group' ? '#7c3aed' : '#527198',
              whiteSpace: 'nowrap', lineHeight: '20px',
            }}>
              {classroom.mode === 'advanced' ? '高级模式' : classroom.mode === 'group' ? '分组模式' : '标准模式'}
            </span>
            <span className={`tag ${classroom.status === 'paused' ? 'tag-yellow' : classroom.status === 'active' ? 'tag-green' : 'tag-gray'}`}>
              {classroom.status === 'paused' ? '已暂停' : classroom.status === 'active' ? '进行中' : '已结束'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px 3px 10px', borderRadius: 6,
              background: '#eef3f8', fontSize: "0.813rem", fontWeight: 500, color: '#527198',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></svg>
              互动码 <strong style={{ fontSize: "1rem", letterSpacing: 3, fontFamily: 'monospace' }}>{teacherCode}</strong>
            </div>
            {classroom.classes?.length > 0 && (
              <span style={{ fontSize: "0.75rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                {classroom.classes.map((cc) => cc.class.name).join('、')}
              </span>
            )}
            <span style={{ fontSize: "0.813rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
              {classroomStudentCount} 名学生
            </span>
          </div>
        </div>
          </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {classroom.status !== 'ended' && (
            <>
              <button className="btn btn-primary btn-lg" onClick={() => {
                fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' }).then(r => r.json()).then(d => {
                      setStudentUrl(d.studentUrl || '');
                }).catch(() => {}).finally(() => setCodeScreenKey(k => k + 1));
              }} style={{ fontSize: "0.875rem", display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                投屏发码
              </button>
            </>
          )}
        </div>
      </div>


      {/* ⊘ ★ 2026-09-29（教师）：「图中这一行状态图标可以取消了。」
          ⇒ 整行删掉 —— 四张统计卡（在线人数 / 互动中 / 离线 / 总交互轮数）与那张
          「探究空间」卡一起走。去处与理由各一条：
            · **探究空间那两个计数**搬进了下面那个统计面板的「探究空间」页（★ 同日新建，
              它就在这一行原来的位置往下一点，一样是常显的）；
            · **指定模式那句「全班统一显示「X」」**不再单独读数 —— 「指定」那三个段选按钮里
              选中的那一个就是同一件事，而且它紧挨着设置它的控件（原来那句话离控件很远）。
          🔴 顺带消掉了一处**同屏两个口径**：这四张卡里的「在线人数 / 离线」数的是
          `Object.values(studentStatuses)`（= 「**连过**这张看板的学生」，离线且从没连过的
          人**根本没有键**），而筛选行那两格走 `getDisplayCardStatus`（缺状态一律算离线）
          ⇒ 两者在「有人被移出名册」时会差几个，而它们在**同一屏**上。现在只剩筛选行那一套。
          ⚠️ `data-board-distribution` 这个属性随之消失 —— 已确认**全仓零消费者**
          （`scripts/` 与 `.superpowers/` 里都搜不到）；探针真正用的是 student-grid 上那个
          `data-webapp-monitor`，那一个没动。 */}
      </>)}
      {/* 对话分析面板（只属于**智能学伴**）。
          🔴 模块态为 `hidden` 时不渲染 —— 学生端看不见学伴了，教师端还挂着一块
          「谁说了多少轮、高频词是什么」的面板，等于在讲一件课堂上已经不存在的事。
          `open` / `preview` 都渲染（两种看板模式下同理：这块面板与看板模式无关）。
          全屏时它仍在 DOM 里，由上面那层 fixed 遮罩盖住 —— 不再依赖「始终渲染」那个说法。

          ⚠️ **为什么只管 companion**：这块面板统计的**全部**是学伴对话
          （`allMessages` 来自学伴聊天记录、`topStudents` 数的是学伴轮数）。
          探究空间不需要同类面板（它有自己的画面/事件监控，见看板顶部的探究那一行）。
          「学习单」将来要有（谁做到哪、哪道题错得多），但**要另行设计** ——
          用户 2026-09-23 明确：「探究空间不需要，学习单要有的，但是需要后期重新设计」。 */}
      {/* 统计面板（★ 2026-09-29 教师第 5 条：三个模块统一到这一处，用 Tab 切换）。
          ⚠️ **按模块的显隐逐个判断**：那个模块被设成 `hidden` 时它的页签不出现 ——
             学生端已经看不见它了，教师端还挂着一块它的统计，等于在讲一件课堂上不存在的事
             （这是原来那条 `companion !== 'hidden'` 的规则，现在按页签各判一次）。
          🔴 `tab` 是**算出来的**（`statsTabs` 里没有当前这一项时回落到学伴）：
             教师把当前页签那个模块设成 hidden 之后，页签消失了、而 state 还指着它 ——
             不回落的话整个面板会**什么都不渲染**，看起来像坏了。 */}
      {/* ⊘ ★ 2026-09-29（教师）：上面那块三页签的统计面板**整个取消**。
          词云（对话分析）搬进了工具条「智能学伴▾ → 对话分析」，点开就是这个弹窗；
          我先前给学习单/探究空间那两页写的草稿内容一并取消。
          ⚠️ 词云**不是被删掉** —— 它换了个家。 */}
      {showWordCloud && (
        <WordCloudDialog
          classroomId={id}
          allMessages={allMessages}
          loadAnalytics={loadAnalytics}
          onClose={() => setShowWordCloud(false)} />
      )}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0 }}>
        <div ref={gridRef} style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              {/* ⊘ 2026-09-30（教师）：「这些字不要了」—— 原来这一行下面还有一句
                  「点击学生卡片查看完整对话，使用筛选快速定位课堂状态」。
                  ⚠️ 副标题整个删掉（不是藏起来）：这一屏是**投影给全班看的**，
                  标题下面多一行小字只会占地方；而那两句话本身在第一次用的时候就懂了。 */}
              <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0, color: '#0f172a' }}>学生互动面板</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* ★ 2026-09-29（教师选「乙」）：这一行的控件由**判据表**驱动 ——
                  「在不在 / 叫什么 / 禁不禁用 / 分到哪一组」全来自 `header-controls.ts`
                  （25 条用例），这里只做两件本文件才有的事：把 id 接到 handler、配图标。
                  ⚠️ 分组靠**位置 + 分隔线**，不靠颜色深浅 —— 这是投影给全班看的屏，
                  把按钮改淡有真实的可发现性代价，而分组本身已经解决了「五种东西看着像一种」。
                  ⚠️ `矩阵` 挪到了 `学习单` 旁边：两者是「按学习单看全班」的两面
                  （一个按题看正确率与逐生作答、一个看学生×题谁卡住），原先被两个设置项隔开。 */}
              {/* ★ 2026-09-30（教师第三轮）：「这个要**归归类**，按钮样式要有区分。」
                  ⇒ 分组从「组与组之间一条 1px 分隔线」改成**一个盒子装一组**：
                  那条线（`#e2e8f0`）在投影仪上基本看不见，而盒子是**结构性**的。
                  ⚠️ 按钮本身**一个字没改**（对比度、尺寸、圆角都不动）——
                     这一屏是投影给全班看的，把按钮按类别改淡有真实的可发现性代价。
                  ⚠️ 分组是**判据层给的**（`headerControlGroups`），这里只管画：
                     别在这一层自己数「第几个开始是新组」—— 那种数法没有任何东西钉得住。 */}
              {headerControlGroups(header.controls).map((group) => (
                <div
                  key={group[0].id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '3px 4px', borderRadius: 12, background: '#e8eef6',
                  }}
                >
                  {group.map((control) => {
                  const button = (
                    <button type="button"
                      // ★ 2026-09-29：每个按钮都登记进 `headerButtonRefs`（两个设置弹窗关闭时
                      // 要把焦点还回**开它的那一个**，见那条 effect）。原来只有「课堂权限」一个。
                      ref={(el) => { headerButtonRefs.current[control.id] = el; }}
                      className={control.active ? 'btn btn-primary' : 'btn btn-secondary'}
                      onClick={headerActions[control.id]}
                      disabled={control.disabled}
                      title={control.title || undefined}
                      aria-haspopup={control.popup ?? undefined}
                      aria-expanded={control.popup ? control.expanded : undefined}
                      style={{
                        minHeight: 36, padding: '7px 12px',
                        // 两个**状态开关**是唯一点蓝字的（与「已暂停 / 已锁定」时整块变蓝同一套语义）；
                        // 其余控件用默认字色。这是既有的层级，重构没动它。
                        color: control.active ? 'white' : control.kind === 'state' ? '#527198' : undefined,
                      }}>
                      {headerIcons[control.id](control.active)}
                      {control.label}
                      {control.popup && headerCaret}
                    </button>
                  );
                  return (
                    <Fragment key={control.id}>
                      {/* ⊘ 2026-09-30：原来这里画一条 1px 的组边界线
                          （`control.startsGroup`）—— 改成盒子之后它没有用了，
                          而**判据层的那个字段也一并删了**（留着一个没人读的布尔
                          只会让下一个人以为分组还在那儿按线分）。 */}
                      {/* 🔴 模块状态的下拉菜单靠「点外面关」，而那个判据是
                          `modulesMenuRef.contains(target)` —— 锚点必须**同时包住按钮与菜单**，
                          所以只有它需要一层 `position: relative` 的包裹。
                          ⚠️ 这是 DOM 管道（哪个元素持有 ref、哪个浮层就地渲染），不是判据：
                          判据全在 `header-controls.ts`，这里只有两个 id 分支。 */}
                      {control.popup ? (
                        <div
                          ref={control.id === 'module-state' ? modulesMenuRef
                            : control.id === 'worksheet-menu' ? worksheetMenuRef
                              : control.id === 'companion-menu' ? companionMenuRef
                                : undefined}
                          style={{ position: 'relative' }}>
                          {button}
                          {control.id === 'module-state' && showModulesMenu && (
                            <ModuleStateMenu
                              modules={classroom.modules}
                              busy={controlBusy}
                              neverConfigured={modulesNeverConfigured}
                              onSelect={(moduleKey, state) => void setModuleState(moduleKey, state)} />
                          )}
                          {control.id === 'companion-menu' && showCompanionMenu && (
                            <CompanionMenu
                              onSelect={(item) => {
                                if (item === 'analysis') setShowWordCloud(true);
                                else { settingsOpenerRef.current = 'companion-menu'; setSettingsDialog('companion'); }
                              }}
                              onClose={() => setShowCompanionMenu(false)} />
                          )}
                          {control.id === 'worksheet-menu' && showWorksheetMenu && (
                            <WorksheetMenu
                              // 「答题分析」= 原来那个「学习单」按钮（抽屉）；
                              // 「进度矩阵」= 原来那个「矩阵」按钮（浮层）。两条路一个字都没改。
                              // ★ 2026-09-30：「逐题开放」= 新加的那个浮层（手动逐题开放那一档）。
                              // ⚠️ 三分支写成 `switch` 而不是 if/else 链：再加一项时 tsc 会**报错**
                              //（`item` 的联合类型没被穷尽），而 if/else 链会静默走进最后一个分支。
                              onSelect={(item) => {
                                if (item === 'analysis') { openWorksheetDrawer({ kind: 'worksheets' }); return; }
                                if (item === 'matrix') { setMatrixOpen(true); return; }
                                setShowWorksheetOpen(true);
                              }}
                              onClose={() => setShowWorksheetMenu(false)} />
                          )}
                        </div>
                      ) : button}
                    </Fragment>
                  );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* 看板模式开关（P2.3）。⚠️ **独立一行**，与筛选行同处（就在格子正上方）：
              它是「这一屏答的是哪个问题」的总开关，藏在某个菜单里等于没有。
              显不显示由 `header.showsHeader` 给（全屏时整块头部一起藏掉）。 */}
          {header.showsHeader && (
            <div aria-label="看板模式" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>看板模式</span>
              {/* ★ 2026-09-29（头部重构）：**那句常显的解释搬进了悬浮说明**。
                  「每格显示该学生此刻在用的模块；还没收到状态的学生显示「…」」原来是
                  紧跟在这两个按钮后面的一行灰字 —— 而它是**读一次就够**的知识
                  （「…」的含义），却常年占着格子上方的一行。放进 `hint`（= `title`）
                  之后仍然查得到，而且紧挨着它解释的那个按钮。
                  ⚠️ 「…」的含义必须留着：教师看到一格画着「…」时唯一的解释就是这一句。 */}
              <SegmentedButton label="跟随"
                hint="每格显示该学生此刻在用哪个模块；还没收到状态的学生显示「…」"
                selected={boardMode === 'follow'} onSelect={() => setBoardMode('follow')} />
              <SegmentedButton label="指定" hint="全班格子统一显示下面选定的那一个模块"
                selected={boardMode === 'assign'} onSelect={() => setBoardMode('assign')} />
              {boardMode === 'assign' && (
                <>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: 4 }}>全班显示</span>
                  {(['worksheet', 'explore', 'companion'] as ModuleId[]).map((moduleId) => (
                    <SegmentedButton key={moduleId}
                      label={MODULE_ID_LABELS[moduleId]}
                      hint={`全班格子都显示「${MODULE_ID_LABELS[moduleId]}」`}
                      selected={assignModule === moduleId} onSelect={() => setAssignModule(moduleId)} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* ★ 2026-09-25（教师截图批注）：**两组筛选并成一行**，只留六格 ——
              全部 / 学习单 / 探究空间 / 智能学伴 / 需关注 / 离线。
              原来上面一组是**状态**（全部 / 在线 / 互动中 / 需关注 / 离线），下面一组是**模块**
              （全部 / 学习单 / 探究空间 / 智能学伴 / 首页 / 未知），两组是**「与」**关系。

              🔴 **合并的代价说清楚：两个维度从此互斥。** 六格共用一个「当前选中」——
              点模块格会把状态格清回「全部」，点状态格会把模块格清回「全部」。
              ⇒ 过去那个「在线 **且** 在用学习单」的组合**不可达了**（教师裁定接受）。
              state 仍然是两个（`studentBoardFilter` / `studentModuleFilter`），
              只是在下面每个 `onSelect` 里互相清空 —— 这样 `displayCards` 那段「与」的判据
              **一个字都不用动**（它今天恒只有一边不是 `all`）。
              「在线 / 互动中」两格按要求**去掉**：仍留在 `StudentBoardFilter` 类型与判据里
              （代码路径没删），只是界面上不再有入口。

              ⚠️ 单位：这一行**六个数字分母相同**（参与者数，分组模式下是**组**，
              量词由 `moduleCountUnit` 给）。⚠️ 一个**既有**的窄缝：`groupCards` 会跳过
              **没有组 id 的参与者**（`page.tsx:660`）⇒ 分组模式下若有这种行，
              它不进任何格子，`需关注 / 离线` 会**小于** `全部`。合并前两个「全部」分处两行、
              看不出来，现在同一行上会显形。那是数据本身的问题（一个没有组的参与者），
              不是这一行算错 —— 别在这里加个减法把它抹平。 */}
          <div aria-label="学生筛选" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 2 }}>
            {/* ── 左段：状态。分母 = **参与者总数**（含离线）。 ──
                全部 —— 合并后**只剩这一个**，而且它是**重置**：点它会把两组筛选一起清回 `all`。
                ⚠️ 上面那段窄缝说的就是它与「需关注 / 离线」可能不等。 */}
            <ModuleCountChip label="全部" value={students.length} unit={moduleCountUnitSuffix}
              hint="取消所有筛选（含右边「此刻在线」那一段）"
              selected={studentBoardFilter === 'all' && effectiveModuleFilter === 'all'}
              onSelect={() => { setStudentBoardFilter('all'); setStudentModuleFilter('all'); }} />
            {/* 状态两格 —— ⚠️ 这两格的数字来自 `boardFilterCounts`（**格子数**），不是
                `moduleDistribution`（参与者数）。在「有没有组的参与者」那条窄缝上两者会不等，
                但常态下相等，且**格子确实是在线单位**（一个组就是一次上线下线），
                所以按格子数是对的 —— 别为了「同一行同源」把这里换掉。 */}
            <ModuleCountChip label="需关注" value={boardFilterCounts.attention} unit={moduleCountUnitSuffix}
              tone={boardFilterCounts.attention > 0 ? 'attention' : 'default'}
              selected={studentBoardFilter === 'attention'}
              onSelect={() => { setStudentBoardFilter('attention'); setStudentModuleFilter('all'); }} />
            <ModuleCountChip label="离线" value={boardFilterCounts.offline} unit={moduleCountUnitSuffix}
              selected={studentBoardFilter === 'offline'}
              onSelect={() => { setStudentBoardFilter('offline'); setStudentModuleFilter('all'); }} />
            {/* 🔴 **两段的分母不同，这是这行的要点**：左段（全部 / 需关注 / 离线）数的是
                **参与者**，右段数的是**此刻在线**的人。一条竖线把两段分开，右段带段标签 ——
                没有它们，`三个模块 + 离线 + 全部` 这三条永远凑不齐（差的那一个正是在首页 /
                位置未定的人），而屏幕上原先没有任何东西说明这件事。 */}
            {header.showsModuleFilter && (
              <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', minHeight: 22, background: '#e2e8f0', margin: '0 4px' }} />
            )}
            {/* ── 右段：此刻在线。分母 = **在线**的参与者（不是全部）。 ──
                ⚠️ 仍然**只在跟随模式下渲染**：指定模式全班都是同一个模块，按模块筛只剩
                「全中 / 全不中」两种结果，那种筛选器只会让人以为它坏了（见 `effectiveModuleFilter`）。
                🔴 单位是**参与者数**：`moduleDistribution` 逐 `students` 计数，而 `students`
                的每一行是一个参与者 —— **分组 / 高级模式下参与者就是组**（规格 §1.2），
                所以那些模式下这几个数字是**组数**，量词由 `moduleCountUnit(mode)` 给。
                ⇒ 必须是 `students.length` / `moduleDistribution`，**不是** `allDisplayCards.length`
                （后者是格子数，与参与者数在「有没有组的参与者」那条窄缝上并不相等）。
                ★ 2026-09-29（教师批注 ③）：这三个数字是**在线**口径。
                点其中一格筛出来的格子走**同一套判据**（`cardInOnlineModule`）。
                ⚠️ 与页头那个「N 名学生」是**两个口径**（那个在分组模式下按成员求和 = 真·人数）。
                两者都对，只是单位不同 —— 所以这里必须带上量词，否则同一屏两个数字看着像打架。
                ⊘ 2026-09-25：「首页 / 未知」两格按教师圈定的六格清单**没有 chip**
                （那两格的状态学生筛不出来，格子阵里照旧看得见）。
                ★ 2026-09-29：它们的**计数**现在由紧跟其后的 `unplaced` 那一句兜住 ——
                它只回答「还差的那几个在哪」，仍然**不是一个筛选项**。要真正加回来就是这里两行。 */}
            {header.showsModuleFilter && (
              <>
                {/* 段标签 = **把分母写在段首**。三个模块格是它的一个划分（不含首页 / 未定，
                    那部分由紧跟着的 `unplaced` 那句话兜住）。 */}
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>
                  此刻在线 <span style={{ color: '#466384' }}>{onlineParticipants}</span> {moduleCountUnitSuffix}
                </span>
                <ModuleCountChip label={MODULE_ID_LABELS.worksheet} value={moduleDistribution.worksheet} unit={moduleCountUnitSuffix}
                  selected={studentModuleFilter === 'worksheet'}
                  onSelect={() => { setStudentModuleFilter('worksheet'); setStudentBoardFilter('all'); }} />
                <ModuleCountChip label={MODULE_ID_LABELS.explore} value={moduleDistribution.explore} unit={moduleCountUnitSuffix}
                  selected={studentModuleFilter === 'explore'}
                  onSelect={() => { setStudentModuleFilter('explore'); setStudentBoardFilter('all'); }} />
                <ModuleCountChip label={MODULE_ID_LABELS.companion} value={moduleDistribution.companion} unit={moduleCountUnitSuffix}
                  selected={studentModuleFilter === 'companion'}
                  onSelect={() => { setStudentModuleFilter('companion'); setStudentBoardFilter('all'); }} />
                {/* 让这一行**对得上账**的那半句：`0` 时不出现（那时三个模块相加就等于在线）。
                    ⚠️ 它是**灰字不是按钮** —— 一个点下去只看「在首页和不知道在哪的人」的
                    筛选器没有用处（那正是 2026-09-25 圈掉那两格的理由）。 */}
                {unplaced && (
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>· {unplaced}</span>
                )}
              </>
            )}
          </div>
          {/* `data-webapp-monitor` 三个属性是给**离线 E2E 探针**用的锚点
              （`.superpowers/sdd/…/dom-shot-e2e` 下那几个 verify 脚本按选择器取本块 innerText）。
              合并前它挂在 `webapp-monitor-view.tsx` 的根节点上，那个文件删掉之后锚点会断，
              所以搬到这里 —— 探针脚本不随产品走，但「锚点凭空消失」不该是一次合并的副作用。 */}
          <div className="student-grid"
            data-webapp-monitor={id}
            data-monitored={exploreWithFrame}
            data-opened={exploreOpened}>
            {allDisplayCards.length === 0 ? (
              <div style={{
                gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px',
                background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 14,
                  background: '#f1f5f9', margin: '0 auto 12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  </svg>
                </div>
                <div style={{ fontSize: "0.938rem", fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>暂无学生加入</div>
                <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>学生通过互动码 <strong style={{ color: '#527198', fontFamily: 'monospace', fontSize: "0.938rem", letterSpacing: 2 }}>{teacherCode}</strong> 加入后，将在此处显示</div>
              </div>
            ) : displayCards.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '44px 20px', background: 'white', borderRadius: 14, border: '1px dashed #cbd5e1', color: '#64748b' }}>
                <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>当前筛选下没有学生</div>
                {/* 🔴 两组筛选都要清掉。只清状态那一组的话，教师点完「查看全部学生」仍然
                    看不到人（模块那一组还卡着），而按钮的字面意思正是「全部学生」。 */}
                <button type="button" onClick={() => { setStudentBoardFilter('all'); setStudentModuleFilter('all'); }} style={{ marginTop: 10, border: 0, background: 'transparent', color: '#527198', cursor: 'pointer', fontWeight: 600 }}>查看全部学生</button>
              </div>
            ) : (
              displayCards.map((item: ClassroomDisplayCard) => {
                const isGroup = isClassroomGroupCard(item);
                const cs = isGroup ? item.members[0] : item;
                const student = cs.student;
                const sid = cs.id;
                const status = getDisplayCardStatus(item);
                const rounds = isGroup
                  ? item.members.reduce((sum: number, m) => sum + (studentRounds[m.id] || 0), 0)
                  : studentRounds[sid] || 0;
                const allMsgs = isGroup ? item.members.flatMap((m) => m.messages).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                const userMsg = isGroup ? allMsgs!.filter((m) => m.role === 'user')[0] : cs.messages.filter((m) => m.role === 'user').slice(-1)?.[0];
                const assistantMsg = isGroup ? allMsgs!.filter((m) => m.role === 'assistant')[0] : cs.messages.filter((m) => m.role === 'assistant').slice(-1)?.[0];
                const isSelected = !isGroup && selectedStudent?.id === sid;
                // 这一格的内容区该显示哪个模块（跟随 = 该学生的 focus；指定 = 教师选的）。
                const tileModule = isGroup ? resolveGroupTileModule(item.members) : resolveTileModule(sid);
                const showClear = tileShowsClear(tileModule, isGroup ? item.members : [cs]);
                const showWorksheetClear = tileShowsWorksheetClear(
                  tileModule, (isGroup ? item.members : [cs]).map((member) => resolveTileModule(member.id)));
                // 徽章行里那个模块相关的徽章（`null` = 这一格不该有它）。只算一次 ——
                // 下面「渲染与否」与「显示什么」读的是同一个值，算两遍就是两份口径。
                // ⚠️ 在线状态传**这一格真实的那一个**（不是常量）：徽章里那个数走的是
                // 与格子正文同一个 `worksheetTileState`，传假的就会算出另一个数。
                const moduleBadge = tileModuleBadge(tileModule, isGroup ? item.members : [cs], rounds);
                return (
                  <div key={isGroup ? item.group?.id : cs.id}
                    onClick={() => {
                      // 点开的内容跟着格子显示的内容走：显示探究画面的格子点开的是**探究详情**
                      // （同时把那个学生转成高频截图），其余仍旧打开对话抽屉。
                      if (!isGroup && tileModule === 'explore') { openExploreDetail(sid); return; }
                      // 显示**学习单**的格子点开的是逐题作答详情（规格 §7.3 形态 A）——
                      // 与上面探究空间那一条同一条规矩。
                      // ⚠️ 参与者 id 用 `cs.id`（`ClassroomStudent.id`）而**不是** `student.id`：
                      // 小组 / 高级模式下它是「组」那一个参与者，而抽屉与 `review` 端点要的
                      // 正是这个 id。用 `student.id` 会指向一个不在课堂里的人（且不报错）。
                      if (tileModule === 'worksheet') {
                        openWorksheetDrawer({ kind: 'participant', participantId: cs.id });
                        return;
                      }
                      setExploreDetailId(null);
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer({ ...student, id: cs.id });
                    }}
                    style={{
                      cursor: 'pointer',
                      border: '2px solid',
                      borderColor: isSelected ? '#527198' : status === 'thinking' ? '#956834' : '#e2e8f0',
                      padding: isGroup ? '18px 18px 16px' : '20px 18px 18px',
                      borderRadius: 12,
                      position: 'relative',
                      background: 'white',
                      display: 'flex',
                      flexDirection: 'column',
                      height: 260,
                      transition: 'all 0.15s',
                      boxShadow: isSelected ? '0 4px 16px rgba(82, 113, 152,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                      overflow: 'hidden',
                    }}>
                    {/* 头像 + 姓名行（含操作按钮）+ 学号 + 状态标签 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: isGroup ? 10 : '50%', flexShrink: 0,
                        background: status === 'online' ? (isGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #10b981, #34d399)') : status === 'thinking' ? 'linear-gradient(135deg, #956834, #fbbf24)' : '#e5e7eb',
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: "0.938rem", overflow: 'hidden',
                      }}>
                        {isGroup ? (
                          getGroupInitial(item.group?.name)
                        ) : student.avatarId && studentAvatars[student.avatarId] ? (
                          <div style={{ width: 36, height: 36, filter: status === 'offline' ? 'grayscale(1)' : 'none' }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[student.avatarId]).replace('<svg', '<svg width="36" height="36"') }} />
                        ) : student.name[0]}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* 姓名行 + 操作按钮 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                            {isGroup ? (
                              <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                onMouseEnter={(e) => setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => { const n = Date.now(); if (n - groupTooltipThrottle.current < 100) return; groupTooltipThrottle.current = n; setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY }); }}
                                onMouseLeave={() => setGroupTooltip(null)}>
                                {item.group?.name || '(未命名)'}
                              </span>
                            ) : (
                              <>{student.name}{student.studentNo && <span style={{ fontSize: "0.625rem", fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>#{student.studentNo}</span>}</>
                            )}
                          </span>
                          {!isGroup && (classroom.mode === 'advanced' || classroom.mode === 'group') && cs.group && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '0 6px', borderRadius: 4, fontSize: "0.625rem", fontWeight: 600,
                              background: '#f5f3ff', color: '#7c3aed', lineHeight: '18px', flexShrink: 0,
                            }}>
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="#7c3aed" stroke="none"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                              {cs.group.name}
                            </span>
                          )}
                          <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, flexShrink: 0 }}>
                            {isGroup ? (
                              (() => {
                                const anyBlacklisted = item.members.some((m) => studentBlacklisted[m.id]);
                                return (
                                  <>
                                    <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                      onClick={async (e) => { e.stopPropagation();
                                        if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.id]: 0 })); } catch {} } }
                                        else { for (const m of item.members) { try { await api.blacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: true })); } catch {} } }
                                      }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#f3e3e3', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                      </svg>
                                    </button>
                                    <button title={item.group?.name ? `发通知给「${item.group.name}」` : '发通知'}
                                      onClick={(e) => { e.stopPropagation(); setNotifyText(''); setNotifySent(false); setNotifyState({ show: true, groupId: item.group?.id, studentName: item.group?.name || item.group?.id }); }}
                                      style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef3f8', color: '#4f46e5', padding: 0 }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                    </button>
                                    {showClear && (
                                      <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                        onClick={(e) => { e.stopPropagation(); handleClearGroupMessages(item.members, item.group?.name || '该小组'); }}
                                        style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                      </button>
                                    )}
                                  </>
                                );
                              })()
                            ) : (
                              <>
                                <button title={studentBlacklisted[sid] ? '解除黑屏' : '黑屏处理'}
                                  onClick={async (e) => { e.stopPropagation(); if (studentBlacklisted[sid]) { try { await api.unblacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: false })); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} } else { try { await api.blacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: true })); } catch {} } }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: studentBlacklisted[sid] ? '#d1fae5' : '#f3e3e3', color: studentBlacklisted[sid] ? '#047857' : '#b91c1c', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    {studentBlacklisted[sid] ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                  </svg>
                                </button>
                                <button title="发消息"
                                  onClick={(e) => { e.stopPropagation(); setNotifyText(''); setNotifySent(false); setNotifyState({ show: true, studentId: sid, studentName: student.name }); }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eef3f8', color: '#4f46e5', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                </button>
                                <button title="奖励一次头像更换权限（学生可在对话页自行兑换）"
                                  onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定奖励「${student.name}」一次头像更换权限？`)) return; try { await api.rewardStudentAvatar(id, sid); incrementAvatarChangeTokens(sid); setToast({ msg: `已奖励 ${student.name} 一次头像更换权限`, type: 'success' }); } catch {} }}
                                  style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf4eb', color: '#956834', padding: 0 }}>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                </button>
                                {/* 🔴 垃圾桶**只在内容区真的显示「智能学伴」对话时才出现**
                                    （用户原话：它只针对学生与智能体对话的内容）。 */}
                                {showClear && (
                                  <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                    onClick={(e) => { e.stopPropagation(); handleClearMessages(sid, student.name); }}
                                    style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                  </button>
                                )}
                                {/* ★ 2026-09-28（教师第 4 条）：**清学习单数据**。与上面那个垃圾桶
                                    同款同位置，判据也同构（`tileShowsWorksheetClear`）——
                                    一格上同时出现两个垃圾桶是不可能的（一个只在学伴那一格、
                                    一个只在学习单那一格；`mixed` 下两个都不给）。
                                    ⚠️ 粒度是**整张学习单**；清单题在抽屉的逐题行里。 */}
                                {showWorksheetClear && (
                                  <button title="清除这个学生在这份学习单上的全部作答"
                                    onClick={(e) => { e.stopPropagation(); void clearWorksheetDataFor(cs.id, student.name, null); }}
                                    style={{ width: 20, height: 20, border: 'none', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {/* 人数（仅小组） */}
                        {isGroup && (
                          <div style={{ fontSize: "0.688rem", color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>
                            {item.group?.id ? (groupMembersMap[item.group.id]?.length ?? item.members.length) : item.members.length} 人
                          </div>
                        )}
                        {/* 状态标签 */}
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {studentBlacklisted[sid] && (
                            <div title="已被黑屏" style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 600,
                              background: '#1e293b', color: 'white', whiteSpace: 'nowrap',
                            }}>
                              黑屏
                            </div>
                          )}
                          {(() => {
                            const isDeep = isGroup
                              ? item.members.some((m) => deepThinkingStatuses[m.id])
                              : deepThinkingStatuses[sid];
                            const bg = isDeep ? '#f5f3ff' : status === 'online' ? '#ecfdf5' : status === 'thinking' ? '#faf4eb' : '#f1f5f9';
                            const dotColor = isDeep ? '#7c3aed' : status === 'online' ? '#10b981' : status === 'thinking' ? '#956834' : '#94a3b8';
                            const textColor = isDeep ? '#7c3aed' : status === 'online' ? '#10b981' : status === 'thinking' ? '#956834' : '#94a3b8';
                            const label = isDeep ? '深度思考' : status === 'online' ? '在线' : status === 'thinking' ? '思考' : '离线';
                            return (
                              <div title="当前状态" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 500, background: bg, color: textColor, whiteSpace: 'nowrap' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
                                {label}
                              </div>
                            );
                          })()}
                          <ModuleInitialChip module={tileModule} />
                          {moduleBadge && <TileBadgeChip badge={moduleBadge} />}
                          {student.avatarChangeTokens > 0 && (
                            <div title="奖励次数" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 700, background: '#faf4eb', color: '#956834', whiteSpace: 'nowrap' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                              {student.avatarChangeTokens}
                            </div>
                          )}
                          {!isGroup && studentWarnings[sid] > 0 && (
                            <div title="警告次数（点击清零）" onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定将「${student.name}」的警告次数清零？`)) return; try { await api.resetStudentWarnings(id, sid); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 6, fontSize: "0.625rem", fontWeight: 600, background: '#f8eeee', color: '#934e4e', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                              {studentWarnings[sid]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>


                    {/* 内容区：按这一格的模块渲染（跟随 = 该学生此刻在用的；指定 = 教师选的）。
                        本格没有「学生与智能体对话」时也可能显示别的模块，所以
                        **没有**「最近一轮 Q&A 预览」这个固定说法了。 */}
                    <div className="preview-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                      {renderTileContent({
                        module: tileModule,
                        members: isGroup ? item.members : [cs],
                        isGroup,
                        online: status !== 'offline',
                        groupName: item.group?.name,
                        userMsg,
                        assistantMsg,
                        compact: false,
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 学习单抽屉（规格 §7.3）——与下面的对话抽屉**同一块 420px 位置**。
            两者互斥：`openWorksheetDrawer` 会把对话抽屉关掉，`openStudentDrawer`
            反过来（见各自的注释）。所以这里不需要再判「另一个开着没有」。
            ⚠️ 它必须与对话抽屉挂在**同一个层级**（格子容器的**外面**）：抽屉是
            `position: fixed`，而格子容器是 `overflow: auto` —— 挂进去会被裁掉，
            表现是「抽屉一打开就只剩一半」，且不报任何错。 */}
        {worksheetDrawer && (
          <WorksheetDrawer
            entry={worksheetDrawer}
            onClose={() => setWorksheetDrawer(null)}
            board={wb.board}
            nodesByWorksheet={wb.nodesByWorksheet}
            settingsByWorksheet={wb.settingsByWorksheet}
            loading={wb.loading}
            reviewBusy={worksheetReviewBusy}
            onReview={(worksheetId, participantId, questionId) => void reviewWorksheetAnswer(worksheetId, participantId, questionId)}
            onClearQuestion={(_worksheetId, participantId, questionId) => { void clearWorksheetDataFor(participantId, worksheetParticipantName(participantId), questionId); }}
            onOpenQuestionStats={(worksheetId, questionId) => setQuestionStatsTarget({ worksheetId, questionId })}
          />
        )}

        {/* 右侧对话详情 - 浮层模式 */}
        {selectedStudent && (
          <>
            {/* 遮罩层 */}
            <div onClick={() => { setSelectedStudent(null); setSelectedGroup(null); selectedStudentIdRef.current = null; }}
              style={{
                position: 'fixed', inset: 0, zIndex: 290, background: 'rgba(0,0,0,0.12)',
              }} />
            {/* 浮层面板 */}
            <div data-overscroll-guard="" style={{
              position: 'fixed', top: 96, right: 24, bottom: 24,
              width: 420, zIndex: 291,
              background: 'white', borderRadius: 14,
              border: '1px solid #e2e8f0',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                overscrollBehavior: 'contain',
            }}>
            {/* 抽屉头部 */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border)',
              background: 'linear-gradient(135deg, #f8faff, #f0f4ff)',
              borderRadius: '12px 12px 0 0',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: selectedGroup ? 10 : '50%', flexShrink: 0,
                    background: selectedGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #667eea, #764ba2)',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: "0.938rem", overflow: 'hidden',
                  }}>
                    {selectedGroup ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /></svg>
                    ) : selectedStudent.avatarId && studentAvatars[selectedStudent.avatarId] ? (
                      <div style={{ width: 36, height: 36 }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[selectedStudent.avatarId]).replace('<svg', '<svg width="36" height="36"') }} />
                    ) : selectedStudent.name[0]}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedGroup ? selectedGroup.name : selectedStudent.name}
                      {selectedGroup && groupMembersMap[selectedGroup.id] && (
                        <span style={{
                          fontSize: "0.688rem", fontWeight: 500, color: '#94a3b8', marginLeft: 2,
                        }}>
                          {groupMembersMap[selectedGroup.id].length} 人
                        </span>
                      )}
                    </h3>
                    <div style={{ fontSize: "0.75rem", color: 'var(--text-secondary)', marginTop: 2 }}>
                      共 {messages.filter((m) => m.role === 'user').length} 轮交互 · {messages.length} 条消息
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-secondary" style={{ fontSize: "0.688rem", padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setShowFullscreen(true)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    投屏
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: "0.688rem", padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => { setSelectedStudent(null); setSelectedGroup(null); selectedStudentIdRef.current = null; }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    关闭
                  </button>
                </div>
              </div>
            </div>

            {allRis.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px', borderBottom: '1px solid #eef2f6', background: '#fafbff' }}>
                <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>投屏选择</span>
                <button onClick={() => setSelectedRounds(allRis.every(ri => selectedRounds.includes(ri)) ? [] : [...allRis])}
                  style={{ fontSize: "0.688rem", color: '#6366f1', cursor: 'pointer', border: 'none', background: 'transparent', padding: 0, fontWeight: 500 }}>
                  {allRis.every(ri => selectedRounds.includes(ri)) ? '取消全选' : `全选 (${allRis.length - selectedRounds.length} / ${allRis.length})`}
                </button>
              </div>
            )}

            {/* 消息列表 */}
            <div ref={drawerMessagesRef} style={{
              flex: 1, overflow: 'auto', overscrollBehavior: 'contain', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {loadingMessages ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, border: '3px solid #eef2f6',
                    borderTop: '3px solid var(--primary)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ color: 'var(--text-secondary)', fontSize: "0.813rem" }}>加载历史消息...</span>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 40, fontSize: "0.813rem" }}>
                  暂无对话记录
                </div>
              ) : (
                messages.map((m, i: number) => (
                  <div key={`dr-${m.role}-${m.createdAt || i}`} style={{
                    padding: '10px 14px',
                    borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    background: m.role === 'user' ? '#eef3f8' : '#f8fafc',
                    border: '1px solid',
                    borderColor: m.role === 'user' ? '#e9eff6' : '#eef2f6',
                    maxWidth: '90%',
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <div onClick={() => {
                        const ri = msgRounds[i];
                        if (ri != null) setSelectedRounds(function(prev: number[]) {
                          return prev.includes(ri) ? prev.filter(x => x !== ri) : [...prev, ri];
                        });
                      }}
                        style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid', borderColor: msgChecked[i] ? '#6366f1' : '#d1d5db', background: msgChecked[i] ? '#6366f1' : 'transparent', cursor: msgRounds[i] != null ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .12s', flexShrink: 0, opacity: msgRounds[i] != null ? 1 : 0 }}>
                        {msgChecked[i] && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <div style={{ fontSize: "0.688rem", fontWeight: 600, color: m.role === 'user' ? 'var(--primary)' : '#64748b' }}>
                        {m.role === 'user' ? selectedStudent.name : 'AI'}
                      </div>
                    </div>
                    {/* 附件图片 */}
                    {(() => {
                      const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
                      const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
                      return urls.map((fu: string, fi: number) => (
                        <div key={fi} style={{ marginBottom: 6 }}>
                          {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                            <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                              onClick={() => openFullscreenImage(`${getApiBaseUrl()}${fu}`)}
                              style={{ maxWidth: 200, maxHeight: 150, borderRadius: 8, objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
                          ) : (
                            <div style={{ padding: '6px 10px', background: '#f3f4f6', borderRadius: 6, fontSize: "0.75rem", display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                              {names[fi] || '附件'}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                    <div style={{ fontSize: "0.875rem", lineHeight: 1.6, wordBreak: 'break-word', color: '#1a1a2e' }}>
                      <Markdown>{m.fileUrls?.length ? stripImages(m.content) : m.content}</Markdown>
                    </div>
                    <div style={{ fontSize: "0.625rem", color: '#94a3b8', marginTop: 6, display: 'flex', gap: 8 }}>
                      <span>{new Date(m.createdAt).toLocaleTimeString()}</span>

                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          </>
        )}

        {/* 探究详情浮层（P2.3：原来长在「探究空间视图」里，现在跟着**格子内容**走
            —— 点开一个显示着缩略图的格子就是它）。 */}
        {exploreDetailStudent && (
          <ExploreDetailPanel
            student={exploreDetailStudent}
            state={webappStates[exploreDetailStudent.id]}
            /* ⚠️ 用**实时**的 `studentStatuses`，不是 `classroom.students[].status`。
               后者是挂载时取一次的 API 快照、永不刷新 ⇒ 这个格子会永远显示「未在线」。
               （判据与 `getDisplayCardStatus` 同源：`thinking` 也算在场，
               否则「学伴正在回答」的那几秒里它会闪成「未在线」。） */
            online={studentStatuses[exploreDetailStudent.id] === 'online' || studentStatuses[exploreDetailStudent.id] === 'thinking'}
            webapps={classroom.webapps ?? []}
            /* 采集开关只用来**决定文案**（关掉画面时，一个信号都没收到的格子该说
               「未打开」而不是「等待画面…」——因为那时永远不会再来一帧）。
               它不决定任何数据的收发：那是学生端与服务端的事。 */
            captureEnabled={captureEnabled}
            /* ★ 2026-09-25 详情档周期：面板上那个 1~5 秒控件要停在**当前生效**的那一档。
               ⚠️ 传的是「生效值」（覆盖 ?? 派生），不是「覆盖值」—— 没调过的课堂
               也该看到 2 秒那一档是选中的，否则面板上**一个选中项都没有**。
               ⚠️ 但写回去时写的是**覆盖值**（`setWebappCapture` 那条路），
               所以「点了跟没点一样的那一档」也会把它固定下来。那是可接受的：
               他显式点了，就是要它。 */
            detailIntervalMs={detailIntervalMs}
            detailIsDerived={detailIntervalOverride === null}
            detailBusy={controlBusy === 'capture-detail-interval'}
            onSelectDetailInterval={(ms) => void setWebappCapture('capture-detail-interval', { detailIntervalMs: ms })}
            onClose={() => setExploreDetailId(null)}
          />
        )}

      </div>

      {/* 投屏发码 */}
      {codeScreenKey > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300, overflow: 'auto', overscrollBehavior: 'contain',
          background: '#0f172a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setCodeScreenKey(0)}>
          <div onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p style={{ fontSize: "1.875rem", color: 'rgba(255,255,255,0.6)', marginBottom: 36 }}>使用平板或手机自带相机扫码，微信/支付宝等扫码可能出现功能异常</p>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 56, marginBottom: 36, flexWrap: 'wrap' }}>
              <div style={{
                background: 'white', borderRadius: 24, overflow: 'hidden',
                display: 'inline-flex', flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              }}>
                <div style={{ padding: 24, position: 'relative', display: 'inline-flex' }}>
                  <QRCodeSVG
                    value={studentUrl ? `${studentUrl}?code=${teacherCode}` : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}/classroom?code=${teacherCode}`}
                    size={360}
                    level="M"
                  />
                  <img src="/qr-logo.png" alt=""
                    style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 72, height: 72, borderRadius: '50%',
                      objectFit: 'cover', background: 'white',
                      padding: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    }}
                    onError={e => { (e.target as HTMLElement).style.display = 'none'; }}
                  />
                </div>
                <button onClick={downloadQRCode}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '14px 0', border: 'none', cursor: 'pointer',
                    borderTop: '1px solid #eef2f6',
                    background: '#f8fafc', color: '#527198',
                    fontSize: "0.875rem", fontWeight: 600,
                    transition: 'all 0.15s', width: '100%',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f2f5f8'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  下载二维码图片
                </button>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: "1.375rem", color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>浏览器访问</div>
                <p style={{
                  fontSize: "2.75rem", fontWeight: 600, color: 'rgba(255,255,255,0.9)', margin: '0 0 8px 0',
                  fontFamily: 'monospace', letterSpacing: 1,
                }}>
                  {studentUrl ? studentUrl.replace('/classroom', '') : `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${typeof window !== 'undefined' ? getClassroomPort() : '3001'}`}
                </p>
                <div style={{ fontSize: "1.375rem", color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>输入互动码</div>
                <div style={{ display: 'flex', gap: 16 }}>
                  {(teacherCode || '').split('').map((d: string, i: number) => (
                    <div key={i} style={{
                      width: 96, height: 112, borderRadius: 14,
                      background: 'rgba(82, 113, 152,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: "4.5rem", fontWeight: 700, color: '#60a5fa',
                      lineHeight: 1,
                    }}>{d}</div>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn" style={{
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.15)', fontSize: "1.125rem", padding: '12px 36px',
              borderRadius: 10, cursor: 'pointer',
            }} onClick={() => setCodeScreenKey(0)}>
              返回看板
            </button>
          </div>
        </div>
      )}

      {/* 投屏讲评 */}
      {showFullscreen && (
        <div data-overscroll-guard="" style={{
          position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 300,
          background: '#fff',
          display: 'flex', flexDirection: 'column',
            overscrollBehavior: 'contain',
        }}>
          {/* 顶部信息栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 48px',
            background: 'white',
            borderBottom: '1px solid #eef2f6',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: '#0f172a', letterSpacing: 1 }}>
                {classroom?.title || '课堂'} · 学习展示
              </div>
              <div style={{ fontSize: "0.813rem", color: '#94a3b8' }}>
                {selectedStudent?.name || ''} · {projMsgs.filter((m) => m.role === 'user').length} 轮对话
              </div>
            </div>
            <button onClick={() => setShowFullscreen(false)}
              style={{ padding: '8px 20px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出投屏
            </button>
          </div>

          {/* 对话内容 */}
          <div ref={fullscreenContentRef} style={{
            flex: 1, overflow: 'auto', overscrollBehavior: 'contain', padding: '40px 60px',
            maxWidth: 1100, width: '100%', margin: '0 auto',
          }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 100, color: '#94a3b8', fontSize: "1.375rem" }}>
                暂无对话记录
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {projMsgs.map((m, i: number) => (
                  <div key={`fs-${m.role}-${m.createdAt || i}`} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}>
                    {/* 角色标签 */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 10,
                    }}>
                      {m.role === 'user' ? (
                        selectedStudent?.avatarId && studentAvatars[selectedStudent.avatarId] ? (
                          <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}
                            dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[selectedStudent.avatarId]).replace('<svg', '<svg width="48" height="48"') }} />
                        ) : (
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#eef3f8', color: '#667eea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: "0.938rem", fontWeight: 700, flexShrink: 0 }}>
                            {selectedStudent?.name?.[0] || '学'}
                          </div>
                        )
                      ) : drawerAgent && (
                        <div style={{
                          width: 48, height: 48, borderRadius: 8,
                          background: 'linear-gradient(135deg, #667eea, #764ba2)',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: "0.938rem", fontWeight: 700, overflow: 'hidden',
                        }}>
                          {drawerAgent.logo
                            ? <img src={`${getApiBaseUrl()}${drawerAgent.logo}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : drawerAgent.name[0]
                          }
                        </div>
                      )}
                      <span style={{
                        fontSize: "1.25rem", fontWeight: 600,
                        color: m.role === 'user' ? '#667eea' : '#475569',
                      }}>
                        {m.role === 'user' ? selectedStudent?.name || '学生' : (drawerAgent?.name || 'AI 助手')}
                      </span>
                    </div>

                    {/* 消息气泡 */}
                    <div style={{
                      maxWidth: '78%',
                      padding: '20px 28px',
                      borderRadius: m.role === 'user' ? '20px 20px 6px 20px' : '6px 20px 20px 20px',
                      background: m.role === 'user' ? '#eef3f8' : '#f8fafc',
                      border: '1px solid',
                      borderColor: m.role === 'user' ? '#e9eff6' : '#eef2f6',
                      lineHeight: 1.8,
                      fontSize: "1.375rem",
                      color: '#0f172a',
                      wordBreak: 'break-word',
                    }}>
                      {/* 附件图片 */}
                      {(() => {
                        const urls = m.fileUrls ? (typeof m.fileUrls === 'string' ? JSON.parse(m.fileUrls) : m.fileUrls) : [];
                        const names = m.fileNames ? (typeof m.fileNames === 'string' ? JSON.parse(m.fileNames) : m.fileNames) : [];
                        return urls.map((fu: string, fi: number) => (
                          <div key={fi} style={{ marginBottom: 12 }}>
                            {/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(fu) ? (
                              <img src={`${getApiBaseUrl()}${fu}`} alt={names[fi] || ''}
                                onClick={() => openFullscreenImage(`${getApiBaseUrl()}${fu}`)}
                                style={{ maxWidth: '100%', maxHeight: 400, borderRadius: 12, objectFit: 'contain', display: 'block', cursor: 'pointer' }} />
                            ) : (
                              <div style={{ padding: '10px 16px', background: m.role === 'user' ? 'rgba(102,126,234,0.08)' : '#f1f5f9', borderRadius: 10, fontSize: "1rem", display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                                {names[fi] || '附件'}
                              </div>
                            )}
                          </div>
                        ));
                      })()}
                      <Markdown>{m.fileUrls?.length ? stripImages(m.content) : m.content}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部水印 */}
          <div style={{
            textAlign: 'center', padding: '12px 0',
            fontSize: "0.813rem", color: '#cbd5e1',
            borderTop: '1px solid #f1f5f9',
          }}>
            支点课堂 · 投屏展示
          </div>
        </div>
      )}

      {/* 全屏学生网格覆盖层 — 盖过左侧导航栏 */}
      {gridFullscreen && (
        <div data-overscroll-guard="" style={{
          position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 250,
          background: '#f8fafc', display: 'flex', flexDirection: 'column',
            overscrollBehavior: 'contain',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 24px', background: 'white',
            borderBottom: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'linear-gradient(135deg, #527198, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: "0.813rem",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: "0.938rem", color: '#0f172a' }}>学生互动面板 · 全屏模式</span>
              {/* ★ 2026-09-30：全屏**两种模式都进得来**（`header-controls.ts` 那一条已取消）
                  ⇒ 这句话必须按模式分开。跟随模式下每格画的是**那个自己**此刻所在的模块
                  （`resolveTileModule`），照旧写「全班显示『X』」就是**编造**一句
                  「全班都在智能学伴」——而屏幕上没有任何东西会红。 */}
              {boardMode === 'assign' ? (
                <span style={{ fontSize: "0.75rem", color: '#527198', fontWeight: 600 }}>
                  全班显示「{MODULE_ID_LABELS[assignModule]}」
                </span>
              ) : (
                <span style={{ fontSize: "0.75rem", color: '#527198', fontWeight: 600 }}>
                  跟随：每格显示该生此刻所在的模块
                </span>
              )}
              {/* ★ 2026-09-30：跟随模式下模块筛选段落在全屏时被藏掉（`showsModuleFilter`），
                  而筛选**仍然生效**（`displayCards` 就是筛过的那一份）⇒ 不全屏时能看见的那个
                  条件，在这里必须自己说出来。只在**筛过**时才出现（不筛时它是一句废话）。 */}
              {boardMode === 'follow' && effectiveModuleFilter !== 'all' && (
                <span style={{ fontSize: "0.75rem", color: '#956834', fontWeight: 600 }}>
                  已筛「{moduleLabelOf(effectiveModuleFilter)}」
                </span>
              )}
              <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>
                {displayCards.length}{displayCards.length !== allDisplayCards.length ? ` / ${allDisplayCards.length}` : ''} {groupCards ? '个小组' : '名学生'}
              </span>
            </div>
            <button onClick={() => setGridFullscreen(false)}
              style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
                background: 'white', cursor: 'pointer', fontSize: "0.813rem", color: '#475569',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
              退出全屏
            </button>
          </div>
          <div ref={fsContentRef} style={{ flex: 1, overflow: 'hidden', padding: '12px 20px', display: 'flex', flexDirection: 'column' }}>
            {/* 布局控制栏 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: "0.75rem", color: '#94a3b8' }}>
                {displayCards.length}{displayCards.length !== allDisplayCards.length ? ` / ${allDisplayCards.length}` : ''} {groupCards ? '个小组' : '名学生'} · {fsCols} 列（{Math.ceil(displayCards.length / fsCols)} 行）
              </span>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setFsCols(c => Math.max(2, c - 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#475569', lineHeight: 1 }}>
                  −
                </button>
                <span style={{ fontSize: "0.75rem", color: '#64748b', padding: '0 6px', minWidth: 30, textAlign: 'center' }}>
                  {fsCols}列
                </span>
                <button onClick={() => setFsCols(c => Math.min(8, c + 1))}
                  style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: "0.875rem", color: '#475569', lineHeight: 1 }}>
                  +
                </button>
              </div>
            </div>
            {/* 全屏学生网格 — 动态撑满 */}
            <div style={{ flex: 1, display: 'grid', gap: 12,
              gridTemplateColumns: `repeat(${fsCols}, 1fr)`,
              alignContent: 'stretch',
            }}>
              {allDisplayCards.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 80, color: '#94a3b8' }}>
                  {groupCards ? '暂未分组' : '暂无学生加入'}
                </div>
              ) : displayCards.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 80, color: '#64748b' }}>
                  当前筛选下没有学生，请退出全屏后切换筛选条件
                </div>
              ) : (
                displayCards.map((item: ClassroomDisplayCard) => {
                  const isGroup = isClassroomGroupCard(item);
                  const cs = isGroup ? item.members[0] : item;
                  const student = cs.student;
                  const sid = cs.id;
                  const status = getDisplayCardStatus(item);
                  const rounds = isGroup
                    ? item.members.reduce((sum: number, m) => sum + (studentRounds[m.id] || 0), 0)
                    : studentRounds[sid] || 0;
                  const compact = fsCols >= 6;
                  const allMsgs = isGroup ? item.members.flatMap((m) => m.messages).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : null;
                  const userMsg = isGroup ? allMsgs!.filter((m) => m.role === 'user')[0] : cs.messages.filter((m) => m.role === 'user').slice(-1)?.[0];
                  const assistantMsg = isGroup ? allMsgs!.filter((m) => m.role === 'assistant')[0] : cs.messages.filter((m) => m.role === 'assistant').slice(-1)?.[0];
                  const isSelected = !isGroup && selectedStudent?.id === sid;
                  // 每格的模块**逐格算**（`resolveTileModule`，与主看板同一个函数）——
                  // 全屏在两种模式下都可达（★ 2026-09-30），跟随模式下各格本来就不同，
                  // 而这里从来就没写死过 `assignModule`。仍然走同一个 `renderTileContent`，
                  // 不另写一份「全屏专用」的渲染。
                  const tileModule = isGroup ? resolveGroupTileModule(item.members) : resolveTileModule(sid);
                  const showClear = tileShowsClear(tileModule, isGroup ? item.members : [cs]);
                  const showWorksheetClear = tileShowsWorksheetClear(
                    tileModule, (isGroup ? item.members : [cs]).map((member) => resolveTileModule(member.id)));
                  // 徽章行里那个模块相关的徽章（`null` = 这一格不该有它）。只算一次。
                  const moduleBadge = tileModuleBadge(tileModule, isGroup ? item.members : [cs], rounds);
                  return (
                    <div key={isGroup ? item.group?.id : cs.id}
                      onClick={() => {
                      if (!isGroup && tileModule === 'explore') { openExploreDetail(sid); return; }
                      // 与主看板那一条同款（全屏与主看板共用同一套「点开的内容跟着格子走」规则）。
                      if (tileModule === 'worksheet') {
                        openWorksheetDrawer({ kind: 'participant', participantId: cs.id });
                        return;
                      }
                      setExploreDetailId(null);
                      if (isGroup) setSelectedGroup(item.group);
                      else setSelectedGroup(null);
                      openStudentDrawer({ ...student, id: cs.id });
                    }}
                      style={{
                        cursor: 'pointer',
                        border: '2px solid',
                        borderColor: isSelected ? '#527198' : status === 'thinking' ? '#956834' : '#e2e8f0',
                        padding: compact ? (isGroup ? '14px 10px 6px' : '16px 12px 6px') : (isGroup ? '18px 14px 8px' : '20px 16px 8px'),
                        borderRadius: 12,
                        background: 'white', position: 'relative',
                        display: 'flex', flexDirection: 'column',
                        transition: 'all 0.15s',
                        boxShadow: isSelected ? '0 4px 16px rgba(82, 113, 152,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                        minHeight: 0,
                        height: compact ? 155 : 190,
                        overflow: 'hidden',
                      }}>
                      {/* 头像 + 姓名行（含操作按钮）+ 学号 + 状态标签 */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: compact ? 6 : 8, marginBottom: compact ? 3 : 6 }}>
                        <div style={{
                          width: compact ? 26 : 36,
                          height: compact ? 26 : 36,
                          borderRadius: isGroup ? (compact ? 6 : 8) : '50%', flexShrink: 0,
                          background: status === 'online' ? (isGroup ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'linear-gradient(135deg, #10b981, #34d399)') : status === 'thinking' ? 'linear-gradient(135deg, #956834, #fbbf24)' : '#e5e7eb',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: compact ? 11 : 14, overflow: 'hidden',
                        }}>
                          {isGroup ? (
                            getGroupInitial(item.group?.name)
                          ) : student.avatarId && studentAvatars[student.avatarId] ? (
                            <div style={{ width: compact ? 26 : 36, height: compact ? 26 : 36, filter: status === 'offline' ? 'grayscale(1)' : 'none' }} dangerouslySetInnerHTML={{ __html: fixSvgUrl(studentAvatars[student.avatarId]).replace('<svg', `<svg width="${compact ? 26 : 36}" height="${compact ? 26 : 36}"`) }} />
                          ) : student.name[0]}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* 姓名行 + 操作按钮 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: compact ? 12 : 14, fontWeight: 600, color: status === 'offline' ? '#9ca3af' : '#1a1a2e', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                              {isGroup ? (
                                <span style={{ cursor: 'help', borderBottom: '1px dashed #94a3b8' }}
                                  onMouseMove={(e) => setGroupTooltip({ id: item.group?.id ?? '', x: e.clientX, y: e.clientY })}
                                  onMouseLeave={() => setGroupTooltip(null)}>
                                  {item.group?.name || '(未命名)'}
                                </span>
                              ) : (
                                <>{student.name}{student.studentNo && <span style={{ fontSize: compact ? 8 : 10, fontWeight: 500, color: '#94a3b8', marginLeft: 3 }}>#{student.studentNo}</span>}</>
                              )}
                            </span>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: compact ? 2 : 3, flexShrink: 0 }}>
                              {isGroup ? (
                                (() => {
                                  const anyBlacklisted = item.members.some((m) => studentBlacklisted[m.id]);
                                  return (
                                    <>
                                      <button title={anyBlacklisted ? '解除黑屏' : '黑屏处理'}
                                        onClick={async (e) => { e.stopPropagation();
                                          if (anyBlacklisted) { for (const m of item.members) { try { await api.unblacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: false })); setStudentWarnings(prev => ({ ...prev, [m.id]: 0 })); } catch {} } }
                                          else { for (const m of item.members) { try { await api.blacklistStudent(id, m.id); setStudentBlacklisted(prev => ({ ...prev, [m.id]: true })); } catch {} } }
                                        }}
                                        style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: anyBlacklisted ? '#d1fae5' : '#f3e3e3', color: anyBlacklisted ? '#047857' : '#b91c1c', padding: 0 }}>
                                        <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          {anyBlacklisted ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                        </svg>
                                      </button>
                                      {showClear && (
                                        <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                          onClick={(e) => { e.stopPropagation(); handleClearGroupMessages(item.members, item.group?.name || '该小组'); }}
                                          style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                          <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                        </button>
                                      )}
                                    </>
                                  );
                                })()
                              ) : (
                                <>
                                  <button title={studentBlacklisted[sid] ? '解除黑屏' : '黑屏处理'}
                                    onClick={async (e) => { e.stopPropagation(); if (studentBlacklisted[sid]) { try { await api.unblacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: false })); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} } else { try { await api.blacklistStudent(id, sid); setStudentBlacklisted(prev => ({ ...prev, [sid]: true })); } catch {} } }}
                                    style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: studentBlacklisted[sid] ? '#d1fae5' : '#f3e3e3', color: studentBlacklisted[sid] ? '#047857' : '#b91c1c', padding: 0 }}>
                                    <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      {studentBlacklisted[sid] ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /></>}
                                    </svg>
                                  </button>
                                  <button title="奖励一次头像更换权限（学生可在对话页自行兑换）"
                                    onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定奖励「${student.name}」一次头像更换权限？`)) return; try { await api.rewardStudentAvatar(id, sid); incrementAvatarChangeTokens(sid); setToast({ msg: `已奖励 ${student.name} 一次头像更换权限`, type: 'success' }); } catch {} }}
                                    style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf4eb', color: '#956834', padding: 0 }}>
                                    <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                  </button>
                                  {showClear && (
                                    <button title={clearBusy ? '正在清除，请稍候' : '清除对话'} disabled={clearBusy !== null}
                                      onClick={(e) => { e.stopPropagation(); handleClearMessages(sid, student.name); }}
                                      style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                      <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                    </button>
                                  )}
                                  {/* ★ 2026-09-28（教师第 4 条）：清学习单数据。与上面那个同款，
                                      判据同构（`tileShowsWorksheetClear`）—— 一格上不会同时出现两个。 */}
                                  {showWorksheetClear && (
                                    <button title="清除这个学生在这份学习单上的全部作答"
                                      onClick={(e) => { e.stopPropagation(); void clearWorksheetDataFor(cs.id, student.name, null); }}
                                      style={{ width: compact ? 16 : 18, height: compact ? 16 : 18, border: 'none', borderRadius: compact ? 2 : 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#64748b', padding: 0 }}>
                                      <svg width={compact ? 9 : 11} height={compact ? 9 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {/* 人数（仅小组） */}
                          {isGroup && (
                            <div style={{ fontSize: compact ? 9 : 10, color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>
                              {item.group?.id ? (groupMembersMap[item.group.id]?.length ?? item.members.length) : item.members.length} 人
                            </div>
                          )}
                          {/* 状态标签 */}
                          <div style={{ display: 'flex', gap: compact ? 2 : 3, marginTop: compact ? 2 : 4, flexWrap: 'wrap' }}>
                            {studentBlacklisted[sid] && (
                              <div title="已被黑屏" style={{
                                display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3,
                                padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6,
                                fontSize: compact ? 8 : 10, fontWeight: 600,
                                background: '#1e293b', color: 'white', whiteSpace: 'nowrap',
                              }}>
                                黑屏
                              </div>
                            )}
                            <div title="当前状态" style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 500, background: status === 'online' ? '#ecfdf5' : status === 'thinking' ? '#faf4eb' : '#f1f5f9', color: status === 'online' ? '#10b981' : status === 'thinking' ? '#956834' : '#94a3b8', whiteSpace: 'nowrap' }}>
                              <span style={{ width: compact ? 4 : 5, height: compact ? 4 : 5, borderRadius: '50%', background: status === 'online' ? '#10b981' : status === 'thinking' ? '#956834' : '#94a3b8', display: 'inline-block' }} />
                              {status === 'online' ? '在线' : status === 'thinking' ? '思考' : '离线'}
                            </div>
                            <ModuleInitialChip module={tileModule} compact />
                            {moduleBadge && <TileBadgeChip badge={moduleBadge} compact />}
                            {student.avatarChangeTokens > 0 && (
                              <div title="奖励次数" style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 700, background: '#faf4eb', color: '#956834', whiteSpace: 'nowrap' }}>
                                <svg width={compact ? 8 : 10} height={compact ? 8 : 10} viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                {student.avatarChangeTokens}
                              </div>
                            )}
                            {!isGroup && studentWarnings[sid] > 0 && (
                              <div title="警告次数（点击清零）" onClick={async (e) => { e.stopPropagation(); if (!confirm(`确定将「${student.name}」的警告次数清零？`)) return; try { await api.resetStudentWarnings(id, sid); setStudentWarnings(prev => ({ ...prev, [sid]: 0 })); } catch {} }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 3, padding: compact ? '0 5px' : '1px 7px', borderRadius: compact ? 4 : 6, fontSize: compact ? 8 : 10, fontWeight: 600, background: '#f8eeee', color: '#934e4e', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                                <svg width={compact ? 8 : 10} height={compact ? 8 : 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                {studentWarnings[sid]}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* 内容区：与主看板**同一个**渲染实现，只有 `compact` 不同
                          —— 两处各写一遍必然出现「全屏里少了缩略图」这类只在全屏才看得见的差异。 */}
                      <div className="preview-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                        {renderTileContent({
                          module: tileModule,
                          members: isGroup ? item.members : [cs],
                          isGroup,
                          online: status !== 'offline',
                          groupName: item.group?.name,
                          userMsg,
                          assistantMsg,
                          compact,
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ★ M5b：学习单矩阵覆盖层。与 `gridFullscreen` 是**两块互不相交**的覆盖层
          （矩阵的按钮在 `!gridFullscreen` 的头部里，所以两者不可能同时被点开）。 */}
      {matrixOpen && (
        <MatrixOverlay
          board={wb.board}
          nodesByWorksheet={wb.nodesByWorksheet}
          live={wb.progress}
          liveTrustedAfter={undefined}
          loading={wb.loading}
          participantCount={students.length}
          classroomId={classroom.id}
          // ⚠️ 只有高级模式才谈得上「有的组没配学习单」；标准 / 分组模式下这一行恒为 0，
          // 而两个快照取自不同时刻时差额**可能是正的**（课中途有人加入、或教师点了同步分组）
          // ⇒ 不收窄的话屏幕上会出现一句「另有 1 个参与者没有可作答的学习单」的**假话**（审查抓到）。
          advancedMode={classroom?.mode === 'advanced'}
          onClose={() => setMatrixOpen(false)}
          onOpenQuestion={openMatrixQuestion}
          onOpenParticipant={openMatrixParticipant}
          onOpenAnalysis={(worksheetId, questionId) => setAnalysisTarget({ worksheetId, questionId })}
        />
      )}

      {/* ★ 2026-09-30：逐题开放浮层（zIndex 260：与矩阵 250 / 分析 270 同一档）。
          「有哪几份学习单」直接用看板那份数据（`wb.nodesByWorksheet` 与 `wb.settingsByWorksheet`）——
          ⚠️ 不另拉一次：那两份是**同一份数据**的两种形状，各拉一次必然出现「浮层里说 6 题、
             看板列头说 5 题」这种对不上，而两边都不报错。 */}
      {showWorksheetOpen && (
        <WorksheetOpenOverlay
          worksheets={openOverlayWorksheets}
          open={worksheetOpen}
          onChange={setOpenQuestions}
          busy={worksheetOpenBusy}
          onClose={() => setShowWorksheetOpen(false)}
        />
      )}

      {/* AI 分析结果窗。第一次点击只在题行按钮上显示后台进度；完成后再次点击才打开本窗。
          **独立居中浮层**（zIndex 270：矩阵 250 之上、学习单抽屉 290/291 之下）。
          它**不复用**学生端外壳的 `layer-overlays` —— 那条「非前台层的浮层不得浮在上面」
          的不变量属于学生端的三层结构，与教师端这两个浮层无关。
          ⚠️ `mode` 是**必需**的：浮层里「已交 N/M」的单位靠 `moduleCountUnit(mode)` 定
          （分组 / 高级模式下是「组」而不是「人」）。 */}
      {analysisTarget && (
        <AnalysisOverlay
          classroomId={classroom.id}
          worksheetId={analysisTarget.worksheetId}
          questionId={analysisTarget.questionId}
          mode={classroom?.mode ?? 'standard'}
          onClose={() => setAnalysisTarget(null)}
        />
      )}

      {/* ★ 2026-09-28：按题统计与分析（层级 292/293，在抽屉 291 之上）。 */}
      {questionStatsTarget && (
        <QuestionStatsOverlay
          classroomId={id!}
          mode={classroom?.mode ?? 'standard'}
          board={wb.board}
          worksheetId={questionStatsTarget.worksheetId}
          questionId={questionStatsTarget.questionId}
          nodesByWorksheet={wb.nodesByWorksheet}
          onClose={() => setQuestionStatsTarget(null)}
        />
      )}

      {groupTooltip && groupMembersMap[groupTooltip.id] && (
        <div style={{
          position: 'fixed', left: groupTooltip.x + 12, top: groupTooltip.y - 10,
          zIndex: 9999, pointerEvents: 'none',
          background: '#1e293b', color: '#f1f5f9',
          padding: '8px 12px', borderRadius: 8, fontSize: "0.75rem",
          lineHeight: 1.7, whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>
          {groupMembersMap[groupTooltip.id].map((d) => d.studentName).filter(Boolean).join('、')}
        </div>
      )}
      {/* 发通知弹窗 */}
      {notifyState.show && (
        <div data-overscroll-guard="" style={{
          position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
            overscrollBehavior: 'contain',
        }} onClick={() => setNotifyState({ show: false })}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 14, padding: 0,
            maxWidth: 440, width: '90%', maxHeight: '90vh', overflowY: 'auto', overscrollBehavior: 'contain',
          }}>
            <div style={{ padding: '20px 24px 16px' }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: '0 0 4px' }}>
                {notifyState.groupId ? `发通知给「${notifyState.studentName || notifyState.groupId}」` : notifyState.studentId ? `发消息给 ${notifyState.studentName || notifyState.studentId}` : '发通知给全班'}
              </h3>
              <p style={{ fontSize: "0.75rem", color: '#64748b', margin: '0 0 14px' }}>
                {notifyState.groupId ? '消息将出现在该组每位成员的对话页下方' : notifyState.studentId ? '消息将出现在该学生对话页下方' : '消息将出现在全班学生的对话页下方'}
              </p>
              {notifySent ? (
                <div style={{
                  padding: '14px', borderRadius: 8, background: '#f0fdf4',
                  border: '1px solid #bbf7d0', textAlign: 'center',
                  fontSize: "0.875rem", color: '#166534', fontWeight: 500,
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }}><polyline points="20 6 9 17 4 12" /></svg>
                  已发送
                </div>
              ) : (
                <>
                  <textarea
                    className="input"
                    value={notifyText}
                    onChange={e => { setNotifyText(e.target.value); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendNotification();
                      }
                    }}
                    placeholder="输入你想对学生说的话..."
                    rows={4}
                    style={{ width: '100%', boxSizing: 'border-box', fontSize: "0.813rem", padding: '10px 14px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8' }}>Enter 发送 · Shift+Enter 换行</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setNotifyState({ show: false })} style={{ fontSize: "0.813rem", padding: '7px 18px' }}>取消</button>
                    <button className="btn btn-primary" onClick={sendNotification} disabled={!notifyText.trim() || notifySent}
                      style={{ fontSize: "0.813rem", padding: '7px 20px' }}>
                      发送
                    </button>
                  </div>
                </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ★ 2026-09-29（教师）：原来那一个「课堂权限」浮窗按模块**拆成两个** ——
          「探究空间」与「智能学伴」各一个，各自紧挨着打开它的那个按钮（工具栏上）。
          ⚠️ 原来那个浮窗的第三段（学习单）本来就只有一句「这一段还没有专属开关」，
             所以它没有对应的按钮 —— 它随「课堂权限」一起消失，**不是漏了**。
          ⚠️ 两个弹窗共用 `SettingsDialog` 那层外壳（遮罩 / 标题栏 / 关闭按钮 / 焦点锚点）：
             各写一份的话，两边的关闭按钮与 zIndex 迟早会长得不一样。
          ⚠️ 段里那些控件与 handler 是**原样搬来的** —— 同一批控件、同一批 handler、
             同一批 busy 键；「显示学生网页画面」关掉之后那两行置灰的三道闸也一起搬来了。 */}
      <SettingsDialog
        open={settingsDialog === 'explore'}
        title={MODULE_ID_LABELS.explore}
        dialogRef={settingsDialogRef}
        onClose={() => setSettingsDialog(null)}>
                <div role="group" aria-label="探究空间画面">
                  <div style={{ padding: '6px 10px 4px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>探究空间画面</div>
                  <div style={{ padding: '0 10px 6px', fontSize: '0.688rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    采集学生探究网页的画面。设备跑不动时可以整个关掉。
                  </div>
                  <PermissionMenuItem label="显示学生网页画面"
                    enabled={captureEnabled}
                    busy={controlBusy === 'capture-enabled'}
                    onToggle={() => void setWebappCapture('capture-enabled', { enabled: !captureEnabled })} />
                  {/* 后果写在**关闭时**、且不跟着下面两行一起变淡 —— 变淡了就没人看得清了。
                      只说「学生端不再传画面」这一件确凿的事，不承诺关掉之后还能看到别的什么。 */}
                  {!captureEnabled && (
                    <div style={{ margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.75rem', lineHeight: 1.5 }}>
                      已关闭：<strong>学生端不再传画面</strong>，下面的分辨率与更新频率随之失效。
                    </div>
                  )}
                  {/* 关掉开关时这两行整体置灰。
                      ⚠️ `opacity` 与 `cursor` 只是给人看的**提示**，拦不住键盘 Tab + 回车，
                          也拦不住脚本触发 —— 真正让「点了不生效」的是每个按钮上的 disabled
                          （`captureRowsDisabled` 同时含了「开关关着」与「有别的请求在跑」）。 */}
                  <div style={{ opacity: captureEnabled ? 1 : 0.45, cursor: captureEnabled ? 'default' : 'not-allowed' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 4px', fontSize: '0.75rem', color: '#334155' }}>
                      <span style={{ flex: 1 }}>分辨率</span>
                      {captureWidthBusy && <span style={{ fontSize: '0.688rem', color: '#94a3b8' }}>更新中...</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, padding: '0 10px 6px' }}>
                      {WEBAPP_WIDTH_OPTIONS.map((option) => {
                        const busyKey = `capture-width-${option.width}`;
                        return (
                          <CaptureOption key={option.width}
                            label={String(option.width)}
                            hint={option.hint}
                            selected={captureWidth === option.width}
                            busy={controlBusy === busyKey}
                            disabled={captureRowsDisabled}
                            onSelect={() => void setWebappCapture(busyKey, { width: option.width })} />
                        );
                      })}
                    </div>
                    <div style={{ padding: '0 10px 8px', fontSize: '0.688rem', color: '#94a3b8', lineHeight: 1.5 }}>
                      小字是每帧的实测体积，越大越清楚、传输也越重。
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 4px', fontSize: '0.75rem', color: '#334155' }}>
                      <span style={{ flex: 1 }}>更新频率</span>
                      {captureIntervalBusy && <span style={{ fontSize: '0.688rem', color: '#94a3b8' }}>更新中...</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, padding: '0 10px 4px' }}>
                      {WEBAPP_INTERVAL_OPTIONS.map((option) => {
                        const busyKey = `capture-interval-${option.ms}`;
                        return (
                          <CaptureOption key={option.ms}
                            label={option.label}
                            selected={captureIntervalMs === option.ms}
                            busy={controlBusy === busyKey}
                            disabled={captureRowsDisabled}
                            onSelect={() => void setWebappCapture(busyKey, { frameIntervalMs: option.ms })} />
                        );
                      })}
                    </div>
                  </div>
                </div>
      </SettingsDialog>

      <SettingsDialog
        open={settingsDialog === 'companion'}
        title={MODULE_ID_LABELS.companion}
        subtitle="学生端智能学伴页面的四项能力开关。"
        onClose={() => setSettingsDialog(null)}>
                <PermissionMenuItem label="允许中断 AI 回答" enabled={classroom.allowStudentStop !== false} busy={controlBusy === 'stop'} onToggle={() => void toggleStop()} />
                <PermissionMenuItem label="允许导出对话" enabled={classroom.allowStudentExport !== false} busy={controlBusy === 'export'} onToggle={() => void toggleExport()} />
                {/* ★ 2026-09-25：从工具栏搬过来的一条。原来工具栏上那个按钮**标签写着
                    「暂停学生提问」而调的是 `pauseClassroom`**（整节课），
                    教师要求把两件事拆开：「暂停课堂」留在工具栏，只禁提问归这里。 */}
                <PermissionMenuItem label="允许学生提问" enabled={classroom.allowStudentAsk !== false} busy={controlBusy === 'allow-ask'} onToggle={() => void toggleAllowAsk()} />
                <PermissionMenuItem label="显示追问建议" enabled={classroom.allowFollowUps !== false} busy={controlBusy === 'follow-ups'} onToggle={() => void toggleFollowUps()} />
      </SettingsDialog>
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* 全屏图片预览（支持无极缩放） */}
      {fullscreenImg && (
        <div ref={overlayRef}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)',
            cursor: 'zoom-out',
            userSelect: 'none',
          }}>
          <img src={fullscreenImg} alt=""
            draggable={false}
            style={{
              transform: `translate(${imgOffset.x}px, ${imgOffset.y}px) scale(${zoomLevel})`,
              transformOrigin: 'center center',
              maxWidth: '92vw', maxHeight: '92vh',
              objectFit: 'contain', borderRadius: 8,
              boxShadow: zoomLevel > 1 ? '0 0 60px rgba(0,0,0,0.4)' : '0 8px 40px rgba(0,0,0,0.5)',
              cursor: 'grab',
              pointerEvents: 'auto',
            }} />
          <button onClick={() => { setFullscreenImg(null); setZoomLevel(1); }}
            style={{
              position: 'absolute', top: 20, right: 24,
              width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.12)',
              color: 'white', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, lineHeight: 1,
              backdropFilter: 'blur(4px)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; }}>
            ✕
          </button>
          <div style={{
            position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            {/* 缩放滑竿 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
              borderRadius: 24, padding: '8px 20px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <input type="range" min="30" max="300" value={Math.round(zoomLevel * 100)}
                onChange={e => setZoomLevel(parseInt(e.target.value) / 100)}
                style={{
                  width: 140, height: 4, appearance: 'none',
                  background: 'rgba(255,255,255,0.2)', borderRadius: 2,
                  outline: 'none', cursor: 'pointer',
                }}
                onInput={e => {
                  const v = parseInt((e.target as HTMLInputElement).value) / 100;
                  setZoomLevel(v);
                }} />
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <span style={{
                minWidth: 44, textAlign: 'center',
                color: 'rgba(255,255,255,0.85)', fontSize: "0.813rem",
                fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              }}>{Math.round(zoomLevel * 100)}%</span>
            </div>
            {/* 滚轮提示 */}
            <span style={{
              color: 'rgba(255,255,255,0.35)', fontSize: "0.75rem",
              letterSpacing: 0.5,
            }}>滚轮缩放</span>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── 对话分析面板 ──────────────────────────────────────────────

function extractKeywords(texts: string[]): { word: string; count: number }[] {
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
    '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没',
    '看', '好', '自己', '这', '那', '什么', '怎么', '为什么', '因为', '所以',
    '但是', '如果', '虽然', '可以', '这个', '那个', '我们', '他们', '它们',
    '一个', '没有', '不是', '就是', '还是', '或者', '而且', '然后', '已经',
    '只是', '因为', '所以', '可以', '不能', '可能', '应该', '这些', '那些',
    '之后', '之前', '时候', '现在', '已经', '知道', '觉得', '认为', '需要',
    '通过', '进行', '以及', '还有', '之后', '这样', '不是', '就是', '只是',
    '因为', '所以', '可以', '可能', '能够', '把', '被', '让', '给', '对',
    '向', '从', '在', '到', '于', '与', '以', '为', '等', '之', '所', '比',
    '用', '做', '想', '问', '能', '让', '跟', '说', '看', '被',
    '请', '您', '谢谢', '感谢', '请问', '你好', '你好', '没问题',
    '回答', '问题', '答案', '内容', '信息', '方法', '步骤', '方式',
    '是否', '如何', '哪些', '什么', '怎么', '多少', '多久', '哪里',
    '这个', '那个', '这些', '那些', '这里', '那里', '这样', '那样',
    '的', '是', '了', '我', '们', '你', '他', '她', '它', '有', '不',
    '在', '和', '就', '也', '都', '到', '说', '要', '去', '会', '着',
    '没', '看', '好', '把', '被', '让', '给', '对', '向', '从', '以',
    '与', '为', '等', '之', '所', '比', '用', '做', '想', '问', '能',
    '让', '跟', '说', '看', '被', '其', '中', '大', '小', '多', '少',
    '长', '短', '高', '低', '新', '旧', '好', '坏', '快', '慢',
  ]);

  const sentenceDelimiters = /[，。！？、；：""''（）【】《》\n\r\t.?!;:()\-\[\]{}]+/;
  const wordCounts = new Map<string, number>();

  for (const text of texts) {
    const cleaned = text.replace(/https?:\/\/[^\s]+/g, '').replace(/\*\*/g, '').replace(/`[^`]+`/g, '');
    const sentences = cleaned.split(sentenceDelimiters).filter(Boolean);
    for (const sentence of sentences) {
      const chineseChars = sentence.replace(/[^一-鿿]/g, '');
      if (chineseChars.length < 2) continue;
      const chars = [...chineseChars];
      // 提取 2~4 字词组
      const maxGram = Math.min(4, chars.length);
      for (let n = 2; n <= maxGram; n++) {
        for (let i = 0; i <= chars.length - n; i++) {
          const gram = chars.slice(i, i + n).join('');
          if (/^\d+$/.test(gram)) continue;
          if (/^[a-zA-Z]{1,2}$/.test(gram)) continue;
          if (stopWords.has(gram[0]) || stopWords.has(gram[gram.length - 1])) continue;
          if (stopWords.has(gram)) continue;
          wordCounts.set(gram, (wordCounts.get(gram) || 0) + 1);
        }
      }
    }
  }

  // 去掉被更长的高频词包含的片段（"黄瓜" count=5 被 "黄瓜设计" count=5 包含 → 去掉"黄瓜"）
  const entries = [...wordCounts.entries()];
  const filtered = entries.filter(([word, count]) => {
    return !entries.some(([otherWord, otherCount]) =>
      otherWord !== word &&
      otherWord.includes(word) &&
      otherCount >= count * 0.7 &&
      otherWord.length > word.length
    );
  });

  return filtered
    .map(([word, count]) => ({ word, count }))
    .filter(w => w.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 60);
}

interface AnalyticsPanelProps {
  classroomId: string;
  allMessages: ClassroomMessage[];
  loadAnalytics: () => void;
  /**
   * ★ 2026-09-29：那一行页签（`StatsTabs`）。**由调用方渲染进来**，不是在这里再画一份 ——
   * 另两页住在另一个面板里，各画一份 Tab 栏必然分叉（选中态、圆角、aria）。
   * ⚠️ 它替掉了原来那个「对话分析」标题：「对话分析」现在只是**第一页的内容**，
   * 而这一行的位置答的是「看哪个模块的统计」。
   */
  tabs?: ReactNode;
}

function WordText({ data, ref }: { data: WordRendererData; ref?: Ref<SVGTextElement> }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), (data.index ?? 0) * 45);
    return () => clearTimeout(timer);
  }, [data.index]);

  return (
    <text
      ref={ref}
      textAnchor="middle"
      transform={`translate(${data.x}, ${data.y}) rotate(${data.rotate}) scale(${visible ? 1 : 0})`}
      style={{
        fontFamily: data.font,
        fontSize: data.size,
        fontWeight: 600,
        fill: data.fill,
        cursor: 'pointer',
        paintOrder: 'stroke',
        stroke: 'rgba(255,255,255,0.3)',
        strokeWidth: '0.5px',
        transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        opacity: visible ? (hovered ? 1 : 0.88) : 0,
        filter: hovered ? 'brightness(1.15) drop-shadow(0 0 6px currentColor)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {data.text}
    </text>
  );
}

/**
 * ⚠️ `memo` 不是装饰（P2.3 起才需要）：探究空间的订阅搬到了 `page.tsx`，于是**每一帧**
 * （每个学生每 10 秒左右一帧）都会让那一层重渲染，而这个面板挂在那层下面。
 * 它真正依赖的只有三样：`classroomId`、`allMessages`（只在加载时换引用）、`loadAnalytics`
 * （`useCallback` 稳定）—— `memo` 让它的重渲染次数回到这三个的节奏，
 * 而不是跟着别人的帧走。（内部那几处 `useMemo` 挡得住重算，挡不住重渲染。）
 */
const AnalyticsPanel = memo(function AnalyticsPanel({ classroomId, allMessages, loadAnalytics, tabs }: AnalyticsPanelProps) {
  /**
   * ★ 2026-09-29（教师）：「折叠不再记住，改吧。」
   *
   * ⊘ 原来它**按课堂记在 localStorage 里**（`cls_analytics_collapsed_<id>`）。去掉的理由是
   * 那一周里它让教师**两次找不到东西**：
   *   · 第一次：页签与「点整行就收起」挤在同一行 ⇒ 想切页签却**误触折叠**，而折叠态当时
   *     一个字都没有（一条空条 + 箭头），看着像坏了；
   *   · 第二次：词云不见了（词云就在这一页里）—— 而那次折叠**是上一次误触留下的**，
   *     刷新、重开都还在（键还在，所以一直折着）。
   * ⇒ 「记住」对一块**每节课都要用、还要投影给全班看**的面板收益本来就很小，而它的失效方式
   *   是「东西凭空不见了」。现在收起只在**当次**有效，刷新/重开一律展开。
   *
   * ⚠️ 老师浏览器里那个旧键（`cls_analytics_collapsed_*`）**没人读了**，是惰性的 ——
   * 不清它（清它要写一段只跑一次的迁移代码，而它不占地方也不影响任何行为）。
   */
  const [collapsed, setCollapsed] = useState(false);
  const [cloudSource, setCloudSource] = useState<'user' | 'assistant' | 'both'>('user');
  const cloudRef = useRef<HTMLDivElement>(null);
  const [cloudWidth, setCloudWidth] = useState(360);

  useLayoutEffect(() => {
    const el = cloudRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setCloudWidth(Math.max(200, Math.floor(rect.width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { loadAnalytics(); }, [classroomId, loadAnalytics]);

  // 词云计算：只在 allMessages 或 cloudSource 变化时才重算
  const isShieldFiltered = useCallback((m: ClassroomMessage) => (m.content || '').includes('**'), []);
  const filteredForCloud = useMemo(() => cloudSource === 'both'
    ? allMessages.filter((m) => !isShieldFiltered(m))
    : allMessages.filter((m) => m.role === cloudSource && !isShieldFiltered(m)), [allMessages, cloudSource, isShieldFiltered]);
  const words = useMemo(() => extractKeywords(filteredForCloud.map((m) => m.content || '')), [filteredForCloud]);

  // 活跃学生排名：每条学生提问计为一轮，不把 AI 回复重复计数。
  const topStudents = useMemo(() => {
    const studentRoundCounts = new Map<string, { name: string; count: number }>();
    for (const m of allMessages) {
      if (m.role !== 'user') continue;
      const sid = m.classroomStudent?.id;
      const name = m.classroomStudent?.student?.name || m.classroomStudent?.group?.name;
      if (!sid || !name) continue;
      const key = sid;
      const existing = studentRoundCounts.get(key) || { name, count: 0 };
      existing.count++;
      studentRoundCounts.set(key, existing);
    }
    const sorted = [...studentRoundCounts.entries()]
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const maxCount = sorted[0]?.count || 1;
    return { list: sorted, maxCount };
  }, [allMessages]);

  // 参与人数统计
  const participantCount = useMemo(() => {
    const sids = new Set<string>();
    for (const m of allMessages) {
      const sid = m.classroomStudent?.id;
      if (sid) sids.add(sid);
    }
    return sids.size;
  }, [allMessages]);

  // 词云组件 props 全部用 useMemo/useCallback 稳定引用，避免父组件重渲染时触发 WordCloud 重算
  const wordCloudData = useMemo(() => words.map(w => ({ text: w.word, value: w.count })), [words]);
  const stableFont = useCallback(() => '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', []);
  const wordFontSize = useCallback((word: Word) => {
    const counts = words.map(w => w.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const range = max - min || 1;
    return 11 + ((word.value - min) / range) * 16;
  }, [words]);
  const wordFill = useCallback((_word: Word, i: number) => `url(#wcg${(i % 6) + 1})`, []);
  const wordGradients = useMemo(() => [
    { id: 'wcg1', type: 'linear' as const, angle: 45, stops: [{ offset: '0%' as const, color: '#527198' }, { offset: '100%' as const, color: '#7c3aed' }] },
    { id: 'wcg2', type: 'linear' as const, angle: -45, stops: [{ offset: '0%' as const, color: '#db2777' }, { offset: '100%' as const, color: '#ea580c' }] },
    { id: 'wcg3', type: 'linear' as const, angle: 135, stops: [{ offset: '0%' as const, color: '#059669' }, { offset: '100%' as const, color: '#10b981' }] },
    { id: 'wcg4', type: 'linear' as const, angle: 90, stops: [{ offset: '0%' as const, color: '#7c3aed' }, { offset: '100%' as const, color: '#c084fc' }] },
    { id: 'wcg5', type: 'linear' as const, angle: 0, stops: [{ offset: '0%' as const, color: '#934e4e' }, { offset: '100%' as const, color: '#fbbf24' }] },
    { id: 'wcg6', type: 'linear' as const, angle: -90, stops: [{ offset: '0%' as const, color: '#0891b2' }, { offset: '100%' as const, color: '#2dd4bf' }] },
  ], []);
  const renderWord = useCallback((data: WordRendererData, ref?: Ref<SVGTextElement>) => <WordText data={data} ref={ref} />, []);
  const stableRotate = useCallback(() => 0, []);

  if (collapsed) {
    return (
      <div style={{
        background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
        marginBottom: 24, overflow: 'hidden',
      }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px',
          }}
        >
          {/* ★ 2026-09-29（教师）：「搜龙怎么字都没有了？而且原来的智能学伴的 tab 页面内容呢？」
              —— 那一条**空的**是折叠态：我上一轮把标题删掉、又把页签从折叠态拿掉，左边就空了。
              ⇒ 折叠态现在放**页签本身**（它就是这一条该有的字），而且**整条点哪儿都展开**：
              点页签 = 切换 **+** 展开（页签的点击冒泡到这一层，见 `StatsTabs` 的注释）。
              ⚠️ 这一条是**误触折叠**最容易被看到的地方 —— 教师上次正是「想切页签结果点折了」，
                 而折了之后它一个字都没有，看着像坏了。 */}
          <div onClick={() => setCollapsed(false)} style={{ cursor: 'pointer', minWidth: 0 }}>
            {tabs ?? <span style={{ fontSize: '0.938rem', fontWeight: 600, color: '#0f172a' }}>统计</span>}
          </div>
          <button type="button" aria-label="展开统计面板" onClick={() => setCollapsed(false)}
            style={{ border: 0, background: 'transparent', padding: 2, cursor: 'pointer', display: 'inline-flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'white', borderRadius: 14, border: '1px solid #e2e8f0',
      marginBottom: 24, overflow: 'hidden',
    }}>
      {/* ★ 2026-09-29（教师）：「这个 tab 切换看起来好怪哟」⇒ 定稿：**一行头部**。
          页签用本屏已有的段选（`StatsTabs`），右端是这一页自己的东西（计数 / 刷新 / 收起）。
          ⊘ 原来这里有**两行**头部（页签一行 + 标题一行，各一条线），中间夹着一条几乎空的带子。
            标题本身也去掉了 —— 「在看哪个模块」由段选说清了，再写一遍「对话分析」是重复
            （「智能学伴」那一段就是它的名字）。
          🔴 **整行不再「点了就收起」**：页签回到了这一行（教师选的布局），而「点偏一点就收起」
             正是教师先前抱怨的那件事 ⇒ 收起只由右端那个箭头负责（它现在是个真按钮）。
             ⚠️ `cursor: pointer` 与 `userSelect: none` 也一起撤了：那一行不再是可点区域，
                留着那个手型光标就是在骗人点它。 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '10px 20px', borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {tabs}
          <span style={{ fontSize: "0.75rem", color: '#94a3b8', fontWeight: 400 }}>
            {allMessages.length} 条消息 · {participantCount} 人参与
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); loadAnalytics(); }}
            style={{
              background: '#f1f5f9', border: 'none', borderRadius: 6,
              padding: '4px 10px', fontSize: "0.688rem", color: '#64748b',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            刷新
          </button>
          {/* 收起：**唯一**的收起入口（★ 2026-09-29）。它原来只是一个装饰性的 svg，
              收起靠点整行 —— 而那一行现在放着页签，误触的代价是「面板整个收起来」。 */}
          <button type="button" aria-label="收起统计面板" aria-expanded
            onClick={() => setCollapsed(true)}
            style={{ border: 0, background: 'transparent', padding: 2, cursor: 'pointer', display: 'inline-flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 0 }}>
        {/* 左列: 词云 */}
        <div style={{
          alignSelf: 'start', width: '100%',
          padding: '0 20px 20px', borderRight: '1px solid #f1f5f9',
          background: '#fff',
        }}>
          <style>{`
            .wc-cloud text { cursor: pointer; }
          `}</style>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingTop: 20 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              }} />
              高频词云
              {words.length > 0 && (
                <span style={{ fontSize: "0.688rem", fontWeight: 400, color: '#94a3b8', textTransform: 'none' }}>
                  {words.length} 个热词
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([['user', '学生提问'], ['assistant', 'AI回答'], ['both', '全部']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setCloudSource(key)}
                  style={{
                    padding: '3px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: "0.688rem", fontWeight: cloudSource === key ? 600 : 400,
                    background: cloudSource === key ? '#eef3f8' : 'transparent',
                    color: cloudSource === key ? '#527198' : '#94a3b8',
                    transition: 'all 0.12s',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {words.length === 0 ? (
            <div style={{
              flex: 1, minHeight: 200,
              fontSize: "0.813rem", color: '#cbd5e1', textAlign: 'center',
              padding: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
              暂无对话数据
            </div>
          ) : (
            <div ref={cloudRef} className="wc-cloud" style={{
              minHeight: 200, position: 'relative',
              margin: '0 auto', background: '#fff', borderRadius: 12, width: '100%',
            }}>
              <WordCloud
                words={wordCloudData}
                width={cloudWidth}
                height={Math.min(Math.floor(cloudWidth * 0.38), 220)}
                font={stableFont}
                fontSize={wordFontSize}
                fill={wordFill}
                gradients={wordGradients}
                renderWord={renderWord}
                rotate={stableRotate}
                spiral="archimedean"
                padding={3}
                enableTooltip
                transition="all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
              />
            </div>
          )}
        </div>

        {/* 右列: 活跃排行 */}
        <div style={{ alignSelf: 'start', width: '100%', minWidth: 0 }}>
          {/* 活跃学生排名 */}
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              活跃学生 TOP 10
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {topStudents.list.length === 0 ? (
                <div style={{ fontSize: "0.813rem", color: '#cbd5e1', textAlign: 'center', padding: 16 }}>暂无数据</div>
              ) : (
                topStudents.list.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: i < 3 ? ['#f5ecdd', '#e5e7eb', '#fed7aa'][i] : '#f1f5f9',
                      color: i < 3 ? ['#92400e', '#475569', '#9a3412'][i] : '#94a3b8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: "0.625rem", fontWeight: 700, flexShrink: 0,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: "0.813rem", color: '#334155', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </span>
                    <div style={{
                      flex: '0 0 60px', height: 6, borderRadius: 3,
                      background: '#f1f5f9', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${(s.count / topStudents.maxCount) * 100}%`,
                        height: '100%', borderRadius: 3,
                        background: i < 3
                          ? ['#956834', '#94a3b8', '#f97316'][i]
                          : '#a5b4fc',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: "0.688rem", color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 40, textAlign: 'right' }}>
                      {s.count} 轮
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
