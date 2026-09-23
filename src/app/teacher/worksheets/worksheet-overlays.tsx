'use client';

import { RelatedClassroomList } from '@/lib/components';
import type { WorksheetSummary, WorksheetUsage } from '@/lib/types';

/**
 * 把三样引用讲成中文（规格 §5.5）：① 课堂级关联 ② 组级材料 ③ 历史作答。
 *
 * 🔴 **不用服务端 `usage.message` 那句整话**，只取服务端给的**数字**，句子由本文件写。
 * 理由是那段话今天虽然已经改对了，但它**是一句给一行字用的整段话**：它把三样引用压成
 * 一个逗号串，而这里的弹窗要把清单、每一样各是什么、哪几间课堂分别列出来。
 * 两边的措辞会各自演化，共用一句整话只会让其中一边被迫将就 —— 所以这里不照搬。
 * （历史：那段话里曾经夹着一句「请先从这些课堂或小组中移除后再试」，而本仓**没有
 * 「移除」这个端点** —— 课堂设置只有 title 可改，组级材料的写入口只在创建课堂那一步。
 * 那是一次把教师指向不存在操作的误导，前端因此绕开了整句；服务端那一句已在
 * `routes/worksheets.ts` 的 `describeUsage` 里改掉，不再说谎。）
 *
 * ⚠️ 「其中 M 个已结束」不是废话：已结束的课堂**同样占着引用**，不说这一句，
 * 教师会以为「课都上完了怎么还不让删」。
 */
function usageLines(usage: WorksheetUsage): string[] {
  const lines: string[] = [];
  if (usage.classroomCount > 0) {
    lines.push(usage.endedClassroomCount > 0
      ? `被 ${usage.classroomCount} 个课堂引用（其中 ${usage.endedClassroomCount} 个已结束）`
      : `被 ${usage.classroomCount} 个课堂引用`);
  }
  if (usage.groupCount > 0) lines.push(`${usage.groupCount} 个小组把它当课堂材料`);
  if (usage.responseCount > 0) lines.push(`已收到 ${usage.responseCount} 份作答`);
  return lines;
}

const boxStyle = {
  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', marginBottom: 20,
} as const;

/**
 * 「无法删除」弹窗。
 *
 * 三件事必须同时说清（规格 §5.5）：
 *   1. **是哪些课堂**（`classrooms` 清单）—— 只说「正被课堂使用中」，教师唯一的出路
 *      是自己一间接一间去翻；usage 响应本来就带清单，调用方在删除守卫那一次请求里
 *      已经拿到了，直接传进来，不要为了展示再请求一次。
 *   2. **三样引用各是什么**（课堂级 / 组级 / 历史作答）—— 漏掉任何一样，教师都会以为
 *      「只是关联，删掉没关系」；而历史作答被漏掉时删除会被**数据库**拒绝（`RESTRICT`）。
 *   3. 🔴 **出路**：改内容 ⇒ 编辑；想要新的 ⇒ 复制一份。这两个是**真按钮**，不是一句
 *      建议 —— 教师读到「无法删除」时真正想问的只有这两件事。
 */
export function WorksheetDeleteBlockedDialog({ worksheet, usage, duplicating, onEdit, onDuplicate, onClose }: {
  worksheet: WorksheetSummary;
  usage: WorksheetUsage;
  /** 「复制一份」是个网络请求，按钮上要有进行态。 */
  duplicating: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const lines = usageLines(usage);

  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="alertdialog" aria-modal="true" aria-labelledby="worksheet-delete-blocked-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 460, maxWidth: '90vw', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <div style={{ textAlign: 'center', marginBottom: 20 }}>
      <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#fef2f2', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
      </div>
      <h3 id="worksheet-delete-blocked-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px' }}>无法删除学习单</h3>
      <p style={{ fontSize: '0.813rem', color: '#64748b', margin: 0, wordBreak: 'break-all' }}>「{worksheet.title}」还在被使用，所以这次删除会被拦下。下面说清楚拦住它的是什么。</p>
    </div>

    <div style={boxStyle}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.813rem', color: '#991b1b', lineHeight: 1.9 }}>
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
      {usage.responseCount > 0 && (
        <div style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: 8 }}>
          这 {usage.responseCount} 份作答会随删除一起消失，学生的答案恢复不了。
        </div>
      )}
      {usage.classroomCount > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid #fecaca', paddingTop: 8 }}>
          <RelatedClassroomList classrooms={usage.classrooms} emptyText="没读到关联的课堂（这不该发生，请刷新重试）" />
        </div>
      )}
      {/* 已结束的课堂仍然占着引用 —— 这一点最容易被读成「数据出问题了」，所以单独说。 */}
      {usage.endedClassroomCount > 0 && (
        <div style={{ fontSize: '0.75rem', color: '#b91c1c', marginTop: 6 }}>
          课虽然上完了，那份关联还在，所以已结束的课堂同样会拦住删除。
        </div>
      )}
    </div>

    <div style={{ background: '#f8faff', border: '1px solid #dbe3ee', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ fontSize: '0.813rem', color: '#475569', lineHeight: 1.7 }}>
        若只是想改内容，请直接编辑；若想要一份新的，请用「复制一份」。
      </div>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4, lineHeight: 1.6 }}>
        复制出来的是一份全新的学习单：内容一模一样，但不会带着这里的课堂关联和作答。
      </div>
    </div>

    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onEdit}>编辑</button>
      <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={onDuplicate} disabled={duplicating}>
        {duplicating ? '复制中...' : '复制一份'}
      </button>
    </div>
    <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}

/**
 * 卡片上「引用情况」入口打开的清单。
 *
 * 与「无法删除」弹窗共用同一个 `usageLines` 与 `RelatedClassroomList` ——
 * 两处对同一份 usage 的说法必须一致，否则教师会以为它们说的不是同一件事。
 *
 * `usage` 为 `null` 表示**还在读**（不是「读到了、结果是空」）。这两种状态长得一样
 * 是本仓反复修过的一类缺陷，所以类型上把它们分开：`null` = 没读到，
 * 非 `null` 且三个计数都是 0 = 读到了、确实没有。
 */
export function WorksheetUsageDialog({ worksheet, usage, onClose }: {
  worksheet: WorksheetSummary;
  usage: WorksheetUsage | null;
  onClose: () => void;
}) {
  const lines = usage ? usageLines(usage) : [];

  return <><div className="modal-overlay" onClick={onClose} /><div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="worksheet-usage-title" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'white', borderRadius: 16, padding: 32, width: 460, maxWidth: '90vw', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
    <h3 id="worksheet-usage-title" style={{ fontSize: '1.063rem', fontWeight: 700, margin: '0 0 4px', wordBreak: 'break-all' }}>「{worksheet.title}」的引用情况</h3>
    <p style={{ fontSize: '0.813rem', color: '#64748b', margin: '0 0 16px', lineHeight: 1.7 }}>
      学习单可以被整堂课选中，也可以被高级模式下的某个小组单独选中；学生提交的作答会留在它上面。
    </p>
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '4px 14px', marginBottom: 20 }}>
      {usage === null ? (
        <RelatedClassroomList classrooms={[]} loading emptyText="" />
      ) : (
        <>
          {lines.length > 0 ? (
            <ul style={{ margin: '10px 0 4px', paddingLeft: 18, fontSize: '0.813rem', color: '#475569', lineHeight: 1.9 }}>
              {lines.map(line => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: '0.813rem', color: '#475569', padding: '10px 0 6px' }}>
              还没有课堂或小组在用这份学习单，也没有收到作答 —— 可以放心删除。
            </div>
          )}
          {/* 课堂清单只在**确实有**课堂级引用时才有内容可列；组级引用不进这个清单
              （它不是课堂，列出来会让「被 N 个课堂引用」与清单对不上号）。 */}
          <RelatedClassroomList
            classrooms={usage.classrooms}
            emptyText={usage.classroomCount === 0 ? '没有课堂引用它' : '没读到关联的课堂'}
          />
        </>
      )}
    </div>
    <button type="button" className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={onClose}>知道了</button>
  </div></>;
}
