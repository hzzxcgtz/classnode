"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { platformColors } from "@/lib/constants";
import { getApiBaseUrl, getClassroomPort } from "@/lib/api-base";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import { Toast, TeacherPageHeader } from "@/lib/components";
import type { ActiveClassroom, AgentSummary, ClassroomSettingsGroup } from "@/lib/types";
import { classroomMaterialsInUse } from "@/lib/classroom-material";
import type { Socket } from "socket.io-client";

const SOCKET_URL = getApiBaseUrl();

export default function TeacherDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeClassrooms, setActiveClassrooms] = useState<ActiveClassroom[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, number>>({});
  const [settingsModalClassroom, setSettingsModalClassroom] =
    useState<ActiveClassroom | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGroups, setEditGroups] = useState<ClassroomSettingsGroup[]>([]);
  const [allAgents, setAllAgents] = useState<AgentSummary[]>([]);
  const [editAgentId, setEditAgentId] = useState("");
  const [qrCodeClassroom, setQrCodeClassroom] = useState<ActiveClassroom | null>(null);
  const [studentUrl, setStudentUrl] = useState("");
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingQrClassroomId, setLoadingQrClassroomId] = useState<string | null>(null);
  const [endingClassroomId, setEndingClassroomId] = useState<string | null>(null);
  const [lanAccess, setLanAccess] = useState(true);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<string | null>(null);
  const [classroomSearch, setClassroomSearch] = useState("");
  const [classroomStatusFilter, setClassroomStatusFilter] = useState<"all" | "running" | "paused">("all");
  const endingRef = useRef(false);
  const settingsSavingRef = useRef(false);
  const qrLoadingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  // 用 ref 跟踪最新的 classroom 列表，避免 socket connect 闭包中的 stale 值
  const activeClassroomsRef = useRef(activeClassrooms);

  useEffect(() => {
    activeClassroomsRef.current = activeClassrooms;
  }, [activeClassrooms]);

  // ESC 关闭投屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrCodeClassroom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // 定期刷新课堂数据，确保统计数据实时更新（socket 事件不一定覆盖所有字段）
  useEffect(() => {
    if (loading) return;
    const interval = setInterval(async () => {
      try {
        const data = await api.getActiveClassrooms();
        setActiveClassrooms(data);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, [loading]);

  // 连接 socket 订阅在线状态（仅创建一次，不随数据刷新重建）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { io } = await import("socket.io-client");

      const sk = io(SOCKET_URL, { transports: ["websocket", "polling"] });

      sk.on("connect", () => {
        if (!cancelled) {
          // 用 ref 拿到最新的 classroom 列表，而非闭包中的 stale 值
          const crs = activeClassroomsRef.current;
          crs.forEach((cr) => {
            sk.emit("listen-classroom-status", cr.id);
          });
        }
      });

      sk.on("online-students", (data: { classroomId: string; studentIds?: string[] }) => {
        if (!cancelled) {
          setOnlineMap((prev: Record<string, number>) => ({
            ...prev,
            [data.classroomId]: data.studentIds?.length || 0,
          }));
        }
      });

      sk.on("nic-changed", () => {
        fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' }).then(r => r.json()).then(d => {
          if (d.studentUrl) setStudentUrl(d.studentUrl);
        }).catch(() => {});
      });

      socketRef.current = sk;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 当活跃课堂列表变化时，通知 socket 开始监听新课堂的状态
  useEffect(() => {
    const sk = socketRef.current;
    if (!sk?.connected || activeClassrooms.length === 0) return;
    activeClassrooms.forEach((cr) => {
      sk.emit("listen-classroom-status", cr.id);
    });
  }, [activeClassrooms]);

  async function loadData() {
    setLoading(true);
    try {
      const [data, settings] = await Promise.all([api.getActiveClassrooms(), api.getSettings().catch((): Record<string, string> => ({}))]);
      setActiveClassrooms(data);
      setLanAccess(settings['lan-access'] !== 'false');
    } catch {}
    setLoading(false);
  }

  async function toggleLanAccess() {
    if (networkSaving) return;
    setNetworkSaving(true);
    const next = !lanAccess;
    try {
      await api.updateSetting('lan-access', String(next));
      setLanAccess(next);
      setToast({ msg: next ? '局域网访问已开启，学生可以连接' : '局域网访问已关闭，仅本机可访问', type: 'success' });
    } catch (error: unknown) {
      setToast({ msg: error instanceof Error ? error.message : '网络模式切换失败', type: 'error' });
    } finally {
      setNetworkSaving(false);
    }
  }

  async function toggleQuickPermission(
    classroom: ActiveClassroom,
    permission: 'questions' | 'stop' | 'export' | 'followUps',
  ) {
    if (permissionBusy) return;
    const busyKey = `${classroom.id}:${permission}`;
    setPermissionBusy(busyKey);
    try {
      let patch: Partial<ActiveClassroom> = {};
      let message = '';
      if (permission === 'questions') {
        const willEnable = classroom.status === 'paused';
        if (willEnable) await api.resumeClassroom(classroom.id);
        else await api.pauseClassroom(classroom.id);
        patch = { status: willEnable ? 'active' : 'paused' };
        message = willEnable ? '已恢复学生提问' : '已暂停学生提问';
      } else if (permission === 'stop') {
        const result = await api.toggleAllowStop(classroom.id);
        patch = { allowStudentStop: result.allowStudentStop };
        message = result.allowStudentStop ? '已允许学生中断回答' : '已禁止学生中断回答';
      } else if (permission === 'export') {
        const result = await api.toggleAllowExport(classroom.id);
        patch = { allowStudentExport: result.allowStudentExport };
        message = result.allowStudentExport ? '已允许学生导出对话' : '已禁止学生导出对话';
      } else {
        const result = await api.toggleAllowFollowUps(classroom.id);
        patch = { allowFollowUps: result.allowFollowUps };
        message = result.allowFollowUps ? '已显示追问建议' : '已隐藏追问建议';
      }
      setActiveClassrooms(current => current.map(item => item.id === classroom.id ? { ...item, ...patch } : item));
      setToast({ msg: `${classroom.title || '当前课堂'}：${message}`, type: 'success' });
    } catch (error) {
      setToast({ msg: `权限更新失败：${error instanceof Error ? error.message : '请求异常'}`, type: 'error' });
    } finally {
      setPermissionBusy(null);
    }
  }

  const endClassroom = async (classroom: ActiveClassroom) => {
    if (endingRef.current) return;
    if (!confirm(`确定结束课堂「${classroom.title || "未命名课堂"}」？\n结束后学生端将停止互动，数据自动保存至历史记录。`)) return;
    endingRef.current = true;
    setEndingClassroomId(classroom.id);
    try {
      await api.endClassroom(classroom.id);
      await loadData();
      setToast({ msg: `课堂「${classroom.title || "未命名课堂"}」已结束`, type: "success" });
    } catch (error) {
      setToast({ msg: `结束课堂失败：${error instanceof Error ? error.message : "请求异常"}`, type: "error" });
    } finally {
      endingRef.current = false;
      setEndingClassroomId(null);
    }
  };

  const openSettings = async (cr: ActiveClassroom) => {
    setSettingsModalClassroom(cr);
    setEditTitle(cr.title || "");
    const groups = cr.groups.map((g) => ({
      id: g.id,
      name: g.name,
      agentId: g.agent?.id || "",
    }));
    setEditGroups(groups);
    // 标准/分组模式：取第一个 classroomAgent 作为当前选中的智能体
    const currentAgentId =
      cr.classroomAgents?.[0]?.agent?.id || groups[0]?.agentId || "";
    setEditAgentId(currentAgentId);
    try {
      const agents = await api.getAgents();
      setAllAgents(agents);
    } catch (error) {
      setToast({ msg: `智能体列表加载失败：${error instanceof Error ? error.message : "请求异常"}`, type: "error" });
    }
  };

  const handleSaveSettings = async () => {
    if (!settingsModalClassroom || settingsSavingRef.current) return;
    settingsSavingRef.current = true;
    setSavingSettings(true);
    try {
      await api.updateClassroomSettings(settingsModalClassroom.id, {
        title: editTitle,
      });
      setSettingsModalClassroom(null);
      await loadData();
      setToast({ msg: "课堂设置已保存", type: "success" });
    } catch (error) {
      setToast({ msg: `保存课堂设置失败：${error instanceof Error ? error.message : "请求异常"}`, type: "error" });
    } finally {
      settingsSavingRef.current = false;
      setSavingSettings(false);
    }
  };

  const openQrCode = async (classroom: ActiveClassroom) => {
    if (qrLoadingRef.current) return;
    qrLoadingRef.current = true;
    setLoadingQrClassroomId(classroom.id);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/server-info`, { credentials: 'include' });
      if (!response.ok) throw new Error("无法读取学生端地址");
      const data = await response.json();
      setStudentUrl(data.studentUrl || "");
      setQrCodeClassroom(classroom);
    } catch (error) {
      setToast({ msg: `互动码加载失败：${error instanceof Error ? error.message : "请求异常"}`, type: "error" });
    } finally {
      qrLoadingRef.current = false;
      setLoadingQrClassroomId(null);
    }
  };

  /** 生成并下载带 Logo 的二维码图片 */
  const downloadQRCode = async (cr: ActiveClassroom) => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "";
    const port = typeof window !== "undefined" ? getClassroomPort() : "3001";
    const qrValue = studentUrl ? `${studentUrl}?code=${cr.code}` : `http://${host}:${port}/classroom?code=${cr.code}`;
    const qrSize = 760;
    const textHeight = 70;
    const totalWidth = qrSize;
    const totalHeight = qrSize + textHeight;

    const canvas = document.createElement("canvas");
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d")!;

    // QR 码
    await QRCode.toCanvas(canvas, qrValue, {
      width: qrSize,
      margin: 3,
      color: { dark: "#1a1a2e", light: "#ffffff" },
    });

    // 中心嵌入 Logo
    const logoSize = qrSize * 0.2;
    const cx = qrSize / 2,
      cy = qrSize / 2;
    const logoImg = new Image();
    logoImg.crossOrigin = "anonymous";
    await new Promise<void>((resolve) => {
      logoImg.onload = () => {
        // 白色圆底
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2 + 8, 0, Math.PI * 2);
        ctx.fill();
        // 圆形裁剪绘制 Logo
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(
          logoImg,
          cx - logoSize / 2,
          cy - logoSize / 2,
          logoSize,
          logoSize,
        );
        ctx.restore();
        resolve();
      };
      logoImg.onerror = () => {
        /* 静默忽略 */ resolve();
      };
      logoImg.src = `/qr-logo.png`;
    });

    // 下方课堂名称
    const title = cr.title || "互动课堂";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#1a1a2e";
    ctx.font =
      'bold 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(title, qrSize / 2, qrSize + textHeight / 2);

    // 下载
    const link = document.createElement("a");
    link.download = `ClassNode-${cr.code}-${title}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const copyClassroomCode = async (classroom: ActiveClassroom) => {
    if (!classroom.code) {
      setToast({ msg: "当前课堂还没有可用互动码", type: "error" });
      return;
    }
    try {
      await navigator.clipboard.writeText(classroom.code);
      setToast({ msg: `互动码 ${classroom.code} 已复制`, type: "success" });
    } catch {
      setToast({ msg: "互动码复制失败，请手动记录", type: "error" });
    }
  };

  const activeTotals = activeClassrooms.reduce(
    (summary, classroom) => {
      summary.students += classroom.realStudentCount ?? (classroom._count?.students || 0);
      summary.online += onlineMap[classroom.id] || 0;
      summary.rounds += (classroom.students || []).reduce(
        (total: number, student) => total + (student.totalRounds || 0),
        0,
      );
      if (classroom.status === "paused") summary.paused += 1;
      return summary;
    },
    { students: 0, online: 0, rounds: 0, paused: 0 },
  );
  const normalizedClassroomSearch = classroomSearch.trim().toLocaleLowerCase("zh-CN");
  const visibleClassrooms = activeClassrooms.filter((classroom) => {
    const matchesSearch = !normalizedClassroomSearch || [
      classroom.title || "",
      classroom.code || "",
      classroom.classes?.[0]?.class?.name || "",
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedClassroomSearch));
    const matchesStatus = classroomStatusFilter === "all"
      || (classroomStatusFilter === "paused" && classroom.status === "paused")
      || (classroomStatusFilter === "running" && classroom.status !== "paused");
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div
        className="classroom-management-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "60vh",
        }}
      >
        加载中...
      </div>
    );
  }

  return (
    <div>
      <TeacherPageHeader title="课堂管理" description="创建课堂并实时掌握学生互动进度。" actions={
        <button className="btn btn-primary" onClick={() => router.push('/teacher/classroom/new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          创建新课堂
        </button>
      } />

      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2
            style={{
              fontSize: "0.938rem",
              fontWeight: 600,
              margin: 0,
              color: "#0f172a",
            }}
          >
            活跃课堂
          </h2>
          {activeClassrooms.length > 0 && (
            <span
              style={{
                fontSize: "0.75rem",
                padding: "1px 8px",
                borderRadius: 10,
                background: "#dcfce7",
                color: "#16a34a",
                fontWeight: 500,
              }}
            >
              {activeClassrooms.length} 个
            </span>
          )}
        </div>
        <div className="classroom-management-toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={() => void toggleLanAccess()} disabled={networkSaving}
          title={lanAccess ? '学生设备可通过局域网访问' : '当前仅教师电脑本机可访问'}>
          <span className={`network-status-dot ${lanAccess ? 'is-open' : ''}`} />
          {networkSaving ? '切换中…' : lanAccess ? '局域网访问已开放' : '局域网访问已关闭'}
        </button>
      </div>
      </div>

      {activeClassrooms.length > 0 && (
        <><div className="active-classroom-overview" aria-label="活跃课堂概览">
          {[
            { label: "活跃课堂", value: activeClassrooms.length, tone: "blue" },
            { label: "参与学生", value: activeTotals.students, tone: "purple" },
            { label: "当前在线", value: activeTotals.online, tone: "green" },
            { label: "互动轮次", value: activeTotals.rounds, tone: "amber" },
          ].map((item) => (
            <div key={item.label} className={`tone-${item.tone}`}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
          <div className="active-classroom-filters teacher-list-toolbar">
          <label className="active-classroom-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={classroomSearch}
              onChange={(event) => setClassroomSearch(event.target.value)}
              placeholder="搜索课堂名称、互动码或班级"
              aria-label="搜索活跃课堂"
            />
            {classroomSearch && <button type="button" onClick={() => setClassroomSearch("")} aria-label="清空课堂搜索">×</button>}
          </label>
          <div className="active-classroom-filter-tabs" role="group" aria-label="课堂状态筛选">
            {[
              { value: "all" as const, label: "全部", count: activeClassrooms.length },
              { value: "running" as const, label: "进行中", count: activeClassrooms.length - activeTotals.paused },
              { value: "paused" as const, label: "已暂停", count: activeTotals.paused },
            ].map((filter) => (
              <button key={filter.value} type="button" aria-pressed={classroomStatusFilter === filter.value}
                onClick={() => setClassroomStatusFilter(filter.value)}>
                {filter.label} <span>{filter.count}</span>
              </button>
            ))}
          </div>
        </div></>
      )}

      {/* 课堂列表 */}
      {activeClassrooms.length > 0 ? (
        <div className="active-classroom-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleClassrooms.length === 0 ? (
            <div className="active-classroom-filter-empty">
              <strong>没有符合条件的课堂</strong>
              <span>可以更换关键词或课堂状态</span>
              <button type="button" className="btn btn-secondary" onClick={() => { setClassroomSearch(""); setClassroomStatusFilter("all"); }}>
                查看全部课堂
              </button>
            </div>
          ) : visibleClassrooms.map((cr) => (
            <div
              key={cr.id}
              className="active-classroom-card"
              style={{
                background: "white",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                overflow: "hidden",
                transition: "box-shadow 0.15s",
              }}
            >
              {/* 上半部分：基本信息 */}
              <div
                className="active-classroom-card-header"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px 20px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="active-classroom-title-row"
                    style={{
                      fontWeight: 700,
                      fontSize: "1.125rem",
                      color: "#0f172a",
                      marginBottom: 3,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {cr.title || "未命名课堂"}
                    {(() => {
                      const modeCfg: Record<
                        string,
                        {
                          label: string;
                          bg: string;
                          color: string;
                          border: string;
                          icon: ReactNode;
                        }
                      > = {
                        standard: {
                          label: "标准模式",
                          bg: "#f7f7ff",
                          color: "#5558b7",
                          border: "#e2e3f7",
                          icon: (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                            </svg>
                          ),
                        },
                        group: {
                          label: "分组模式",
                          bg: "#faf7ff",
                          color: "#7556a9",
                          border: "#ebe1f7",
                          icon: (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <rect x="2" y="3" width="6" height="6" rx="1" />
                              <rect x="16" y="3" width="6" height="6" rx="1" />
                              <rect x="9" y="15" width="6" height="6" rx="1" />
                            </svg>
                          ),
                        },
                        advanced: {
                          label: "高级模式",
                          bg: "#fffaf0",
                          color: "#a66b1c",
                          border: "#f2e5c8",
                          icon: (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                          ),
                        },
                      };
                      const cfg = modeCfg[cr.mode] || modeCfg.standard;
                      return (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            minHeight: 26,
                            padding: "3px 9px",
                            borderRadius: 8,
                            border: `1px solid ${cfg.border}`,
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            verticalAlign: "middle",
                            lineHeight: "16px",
                            background: cfg.bg,
                            color: cfg.color,
                            boxSizing: "border-box",
                          }}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      );
                    })()}
                    <button type="button"
                      onClick={() => void copyClassroomCode(cr)}
                      title="点击复制互动码"
                      aria-label={`复制互动码 ${cr.code}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        minHeight: 26,
                        padding: "3px 9px",
                        borderRadius: 8,
                        background: "#f8fafc",
                        color: "#475569",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        border: "1px solid #e2e8f0",
                        cursor: "pointer",
                        boxSizing: "border-box",
                      }}
                    >
                      <span style={{ color: "#94a3b8", fontWeight: 500 }}>互动码</span>
                      <strong style={{ color: "#0f766e", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.75rem", letterSpacing: "0.04em" }}>{cr.code}</strong>
                      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                    {cr.classes?.[0]?.class?.name && (
                      <>
                        {cr.classes[0].class.name}
                        <span style={{ margin: "0 6px", color: "#e2e8f0" }}>
                          |
                        </span>
                      </>
                    )}
                    {cr.mode === 'group' || cr.mode === 'advanced'
                      ? `${cr.participantCount ?? (cr._count?.students || 0)} 个小组 · ${cr.realStudentCount ?? 0} 名学生`
                      : `${cr.realStudentCount ?? (cr._count?.students || 0)} 名学生`}
                    <span style={{ margin: "0 6px", color: "#e2e8f0" }}>|</span>
                    <span>
                      {new Date(cr.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      创建
                    </span>
                  </div>
                </div>
                {/* 右上角统计数据 */}
                <div
                  className="active-classroom-stats"
                  style={{
                    display: "flex",
                    gap: 16,
                    flexShrink: 0,
                    marginLeft: "auto",
                  }}
                >
                  {[
                    {
                      label: "在线",
                      value: onlineMap[cr.id] || 0,
                      color: "#22c55e",
                    },
                    {
                      label: "离线",
                      value: Math.max(
                        0,
                        (cr.participantCount ?? (cr._count?.students || 0)) - (onlineMap[cr.id] || 0),
                      ),
                      color: "#94a3b8",
                    },
                    {
                      label: "互动",
                      value: (cr.students || []).reduce(
                        (sum: number, s) => sum + (s.totalRounds || 0),
                        0,
                      ),
                      color: "#2563eb",
                    },
                  ].map((stat, i) => (
                    <div key={i} style={{ textAlign: "center", minWidth: 40 }}>
                      <div
                        style={{
                          fontSize: "1.125rem",
                          fontWeight: 700,
                          color: stat.color,
                          lineHeight: 1.2,
                        }}
                      >
                        {stat.value}
                      </div>
                      <div
                        style={{
                          fontSize: "0.688rem",
                          color: "#94a3b8",
                          marginTop: 1,
                        }}
                      >
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* 中间部分：材料引用。**按类型分组**，每类可容纳多份。
                  🔴 用户 2026-09-23（截图批注）：「这个区域要分类显示学习单、探究网页、
                  智能学伴的引用情况，因为高级模式同一类不止一个，这些事要认真思考」。
                  在此之前这里只有一类（智能体），而且与网页/学习单混在一行里无从分辨。

                  ⚠️ **来源由 `classroomMaterialsInUse` 统一决定**：高级模式取 `groups[]`
                  （每组一份），标准 / 分组模式取课堂级（`classroomAgents` / `webapps` /
                  `worksheets`）。这里曾经只读课堂级那一条 —— 高级模式下会显示成
                  「未关联」而其实每个组都配了，与 2026-09-23 修掉的那个快照 bug 同源。
                  ⚠️ 三件套的名字与别处一致：**学习单 / 探究空间 / 智能学伴**。
                  ⚠️ 空的那几类不渲染（整行都没有材料时整块不渲染），但「有数据就显示得出来」
                  —— 三类走同一套渲染，学习单接上服务端那天这里一个字都不用改。 */}
              {(() => {
                const materials = classroomMaterialsInUse({
                  mode: cr.mode,
                  groups: cr.groups,
                  // ⚠️ `/api/classroom/active` 里课堂级智能体叫 `classroomAgents`（外面包着一层
                  // `agentId`），与学生端的 `agents` 不是同一个名字 —— 在这里对一次，
                  // 别把两种形状散到后面去。
                  agents: cr.classroomAgents.map((ca) => ca.agent).filter(Boolean),
                  webapps: cr.webapps,
                  worksheets: cr.worksheets,
                });
                const total = materials.worksheets.length + materials.webapps.length + materials.agents.length;
                if (total === 0) return null;

                /** 一个材料条。三类共用一套长相，只有左侧那个图标不同。 */
                const chip = (key: string, icon: ReactNode, name: string, groupNames: string[]) => (
                  <span key={key} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 10px 3px 4px", borderRadius: 6,
                    background: "#f8fafc", border: "1px solid #eef2f6",
                    fontSize: "0.75rem", color: "#475569",
                  }}>
                    {icon}
                    {name}
                    {/* 高级模式下同一类有多份，光看名字不知道为什么有多个 ——
                        把「这一份是谁的」写在旁边（用户要求「认真思考」的那一点）。 */}
                    {groupNames.length > 0 && (
                      <span style={{ fontSize: "0.625rem", color: "#94a3b8" }}>{groupNames.join("、")}</span>
                    )}
                  </span>
                );

                /** 一个方形的图标块（与原来智能体那个 logo 块同一个形状）。 */
                const iconBox = (background: string, content: ReactNode) => (
                  <span style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    background, color: "white",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.563rem", fontWeight: 700, overflow: "hidden",
                  }}>
                    {content}
                  </span>
                );

                /** 一类材料：一个类名 + 它的全部条目。空类不渲染。 */
                const section = (label: string, chips: ReactNode[]) => chips.length === 0 ? null : (
                  <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.688rem", color: "#94a3b8", fontWeight: 700, marginRight: 2 }}>{label}</span>
                    {chips}
                  </span>
                );

                return (
                  <div
                    className="active-classroom-agent-row"
                    style={{
                      padding: "8px 20px",
                      borderTop: "1px solid #f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    {/* 顺序 = 三件套本身（学习单 / 探究空间 / 智能学伴）。 */}
                    {section("学习单", materials.worksheets.map(({ material, groupNames }) => chip(
                      material.id,
                      iconBox("#0ea5e9", <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
                      material.title,
                      groupNames,
                    )))}
                    {section("探究网页", materials.webapps.map(({ material, groupNames }) => chip(
                      material.id,
                      iconBox("#2563eb", <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>),
                      material.name,
                      groupNames,
                    )))}
                    {section("智能学伴", materials.agents.map(({ material: agt, groupNames }) => chip(
                      agt.id,
                      iconBox(platformColors[agt.platform] || "#64748b", agt.logo ? (
                        <img
                          src={agt.logo.startsWith("/") ? `${getApiBaseUrl()}${agt.logo}` : agt.logo}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : agt.name[0]),
                      agt.name,
                      groupNames,
                    )))}
                    <span className="active-classroom-permissions" style={{ marginLeft: 'auto' }}>
                      <span className="active-classroom-permissions-label">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        学生权限
                      </span>
                      <span className="active-classroom-permission-group">
                        {([
                          { key: 'questions', label: '提问', enabled: cr.status !== 'paused' },
                          { key: 'stop', label: '中断', enabled: cr.allowStudentStop !== false },
                          { key: 'export', label: '导出', enabled: cr.allowStudentExport !== false },
                          { key: 'followUps', label: '追问', enabled: cr.allowFollowUps !== false },
                        ] as const).map(permission => {
                          const busy = permissionBusy === `${cr.id}:${permission.key}`;
                          return (
                          <button
                            type="button"
                            key={permission.key}
                            className={`active-classroom-permission ${permission.enabled ? 'is-enabled' : 'is-disabled'} ${busy ? 'is-busy' : ''}`}
                            title={`点击${permission.enabled ? '关闭' : '开启'}${permission.label}`}
                            aria-pressed={permission.enabled}
                            aria-busy={busy}
                            disabled={permissionBusy !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleQuickPermission(cr, permission.key);
                            }}
                          >
                            <span className="active-classroom-permission-icon" aria-hidden="true">
                              {busy ? (
                                <span className="active-classroom-permission-spinner" />
                              ) : permission.enabled ? (
                                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 6 2.4 2.4L10 3"/></svg>
                              ) : (
                                <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m3 3 6 6M9 3 3 9"/></svg>
                              )}
                            </span>
                            {permission.label}
                          </button>
                          );
                        })}
                      </span>
                    </span>
                  </div>
                );
              })()}
              {/* 下半部分：操作栏 */}
              <div
                className="active-classroom-footer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 20px",
                  background: "#fafbfc",
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: cr.status === "paused" ? "#f59e0b" : "#22c55e",
                    boxShadow:
                      cr.status === "paused"
                        ? "0 0 6px rgba(245,158,11,0.4)"
                        : "0 0 6px rgba(34,197,94,0.4)",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    marginRight: "auto",
                    color: cr.status === "paused" ? "#d97706" : "#16a34a",
                  }}
                >
                  {cr.status === "paused" ? "已暂停" : "进行中"}
                </span>

                <div className="active-classroom-actions">
                {/* 编辑 + 互动码 */}
                <button onClick={() => openSettings(cr)} title="修改课堂设置"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#475569"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  编辑
                </button>
                <button onClick={() => void openQrCode(cr)} disabled={loadingQrClassroomId !== null} title="显示互动码"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#7c3aed"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="17" y="2" width="5" height="5" rx="1"/><rect x="2" y="17" width="5" height="5" rx="1"/><path d="M11 2h2"/><path d="M11 22h2"/><path d="M2 11v2"/><path d="M22 11v2"/><path d="M15 15h2v2h-2z"/><path d="M17 15v-1a2 2 0 0 0-2-2h-1"/><path d="M15 19v1a2 2 0 0 0 2 2h1"/><path d="M19 17h2v2h-2z"/></svg>
                  {loadingQrClassroomId === cr.id ? "加载中..." : "互动码"}
                </button>

                {/* 结束课堂 — 红字轮廓，hover 加强 */}
                <button onClick={() => void endClassroom(cr)} disabled={endingClassroomId !== null}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 500, background: "transparent", color: "#ef4444", border: "1px solid #fca5a5", cursor: "pointer", lineHeight: 1, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.borderColor = "#f87171"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#fca5a5"; }}>
                  {endingClassroomId === cr.id ? "结束中..." : "结束课堂"}
                </button>

                {/* 进入课堂 — 醒目填充按钮 */}
                <button onClick={() => router.push(`/teacher/classroom?id=${cr.id}`)}
                  style={{ padding: "7px 18px", borderRadius: 8, fontSize: "0.813rem", fontWeight: 600, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "white", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s", boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, #1d4ed8, #1e40af)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(37,99,235,0.35)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, #2563eb, #1d4ed8)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(37,99,235,0.25)"; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  进入课堂
                </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 空状态 */
        <div
          style={{
            background: "white",
            borderRadius: 14,
            padding: "48px 20px",
            border: "1px solid #e2e8f0",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "#f1f5f9",
              margin: "0 auto 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "0.938rem",
              fontWeight: 600,
              color: "#0f172a",
              marginBottom: 6,
            }}
          >
            暂无活跃课堂
          </div>
          <p
            style={{
              fontSize: "0.813rem",
              color: "#94a3b8",
              margin: "0 0 20px",
            }}
          >
            创建新课堂后，学生通过互动码加入，即可开始互动教学
          </p>
          <button
            onClick={() => router.push("/teacher/classroom/new")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 24px",
              borderRadius: 8,
              fontSize: "0.875rem",
              fontWeight: 600,
              background: "#2563eb",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            创建第一个课堂
          </button>
        </div>
      )}

      {/* 投屏发码 */}
      {qrCodeClassroom && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            overflow: "auto",
            background: "#0f172a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setQrCodeClassroom(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ textAlign: "center", padding: "40px 20px" }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 24px",
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(255,255,255,0.8)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p
              style={{
                fontSize: "1.875rem",
                color: "rgba(255,255,255,0.6)",
                marginBottom: 36,
              }}
            >
              使用平板或手机自带相机扫码，微信 / 支付宝等扫码可能出现功能异常
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 56,
                marginBottom: 36,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  background: "white",
                  borderRadius: 24,
                  overflow: "hidden",
                  display: "inline-flex",
                  flexDirection: "column",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                }}
              >
                <div
                  style={{
                    padding: 24,
                    position: "relative",
                    display: "inline-flex",
                  }}
                >
                  <QRCodeSVG
                    value={studentUrl ? `${studentUrl}?code=${qrCodeClassroom.code}` : `http://${typeof window !== "undefined" ? window.location.hostname : ""}:${typeof window !== "undefined" ? getClassroomPort() : "3001"}/classroom?code=${qrCodeClassroom.code}`}
                    size={360}
                    level="M"
                  />
                  <img
                    src="/qr-logo.png"
                    alt=""
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      objectFit: "cover",
                      background: "white",
                      padding: 4,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    }}
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                </div>
                {/* 下载按钮 — 作为二维码卡片的一部分 */}
                <button
                  onClick={() => downloadQRCode(qrCodeClassroom)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "14px 0",
                    border: "none",
                    cursor: "pointer",
                    borderTop: "1px solid #eef2f6",
                    background: "#f8fafc",
                    color: "#2563eb",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    transition: "all 0.15s",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#eff6ff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#f8fafc";
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  下载二维码图片
                </button>
              </div>
              <div style={{ textAlign: "left" }}>
                <div
                  style={{
                    fontSize: "1.375rem",
                    color: "rgba(255,255,255,0.5)",
                    marginBottom: 8,
                  }}
                >
                  浏览器访问
                </div>
                <p
                  style={{
                    fontSize: "2.75rem",
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.9)",
                    margin: "0 0 28px 0",
                    fontFamily: "monospace",
                    letterSpacing: 1,
                  }}
                >
                  {studentUrl ? studentUrl.replace('/classroom', '') : `http://${typeof window !== "undefined" ? window.location.hostname : ""}:${typeof window !== "undefined" ? getClassroomPort() : "3001"}`}
                </p>
                <div
                  style={{
                    fontSize: "1.375rem",
                    color: "rgba(255,255,255,0.5)",
                    marginBottom: 10,
                  }}
                >
                  输入互动码
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  {(qrCodeClassroom.code || "")
                    .split("")
                    .map((d: string, i: number) => (
                      <div
                        key={i}
                        style={{
                          width: 96,
                          height: 112,
                          borderRadius: 14,
                          background: "rgba(37,99,235,0.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "4.5rem",
                          fontWeight: 700,
                          color: "#60a5fa",
                          lineHeight: 1,
                        }}
                      >
                        {d}
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <button
              className="btn"
              style={{
                background: "rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.8)",
                border: "1px solid rgba(255,255,255,0.15)",
                fontSize: "1.125rem",
                padding: "12px 36px",
                borderRadius: 10,
                cursor: "pointer",
              }}
              onClick={() => setQrCodeClassroom(null)}
            >
              返回看板
            </button>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          msg={toast.msg}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* 课堂设置弹窗 */}
      {settingsModalClassroom && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(4px)",
          }}
          onClick={() => {
            setSettingsModalClassroom(null);
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 16,
              maxWidth: 480,
              width: "90%",
              boxShadow: "0 25px 80px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div
              style={{
                padding: "24px 28px 16px",
                borderBottom: "1px solid #f1f5f9",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "#eef2ff",
                  color: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </div>
              <div>
                <h3
                  style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "#0f172a",
                    margin: 0,
                  }}
                >
                  课堂设置
                </h3>
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    margin: "2px 0 0",
                  }}
                >
                  可修改课堂名称，其余内容创建后不可更改
                </p>
              </div>
            </div>
            {/* 弹窗内容 */}
            <div style={{ padding: "20px 28px" }}>
              {/* 课堂名称 */}
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M4 20h16" />
                    <path d="M4 20V4m0 0h16v16" />
                  </svg>
                  课堂名称
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="未命名课堂"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    fontSize: "0.875rem",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.15s",
                    background: "#fafbfc",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "#2563eb";
                    e.currentTarget.style.background = "white";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e2e8f0";
                    e.currentTarget.style.background = "#fafbfc";
                  }}
                />
              </div>

              {/* 当前智能体（只读展示）- 高级模式不显示，仅展示下方小组智能体 */}
              {allAgents.length > 0 &&
                settingsModalClassroom?.mode !== "advanced" && (
                  <div>
                    <label
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "#475569",
                        marginBottom: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <rect x="4" y="4" width="16" height="16" rx="3" />
                        <path d="M9 12h6" />
                        <path d="M12 9v6" />
                      </svg>
                      AI智能体
                      <span
                        style={{
                          fontSize: "0.688rem",
                          color: "#94a3b8",
                          fontWeight: 400,
                          marginLeft: 4,
                        }}
                      >
                        （创建后不可更改）
                      </span>
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        opacity: 0.7,
                      }}
                    >
                      {(() => {
                        const agent = allAgents.find(
                          (a) => a.id === editAgentId,
                        );
                        if (!agent)
                          return (
                            <span
                              style={{ fontSize: "0.813rem", color: "#94a3b8" }}
                            >
                              未配置
                            </span>
                          );
                        const logoUrl = agent.logo
                          ? agent.logo.startsWith("/")
                            ? `${getApiBaseUrl()}${agent.logo}`
                            : agent.logo
                          : null;
                        return (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "1px solid #e2e8f0",
                              background: "#f8fafc",
                              fontSize: "0.813rem",
                              color: "#64748b",
                            }}
                          >
                            {logoUrl ? (
                              <img
                                src={logoUrl}
                                alt=""
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 4,
                                  background:
                                    "linear-gradient(135deg, #667eea, #764ba2)",
                                  color: "white",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "0.625rem",
                                  fontWeight: 700,
                                }}
                              >
                                {agent.name[0]}
                              </div>
                            )}
                            <span>{agent.name}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

              {/* 高级模式：小组智能体列表（只读） */}
              {settingsModalClassroom?.mode === "advanced" &&
                editGroups.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "#475569",
                        marginBottom: 10,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <rect x="2" y="3" width="6" height="6" rx="1" />
                        <rect x="16" y="3" width="6" height="6" rx="1" />
                        <rect x="9" y="15" width="6" height="6" rx="1" />
                      </svg>
                      小组智能体
                      <span
                        style={{
                          fontSize: "0.688rem",
                          color: "#94a3b8",
                          fontWeight: 400,
                          marginLeft: 4,
                        }}
                      >
                        （创建后不可更改）
                      </span>
                    </div>
                    <div
                      style={{
                        background: "#f8fafc",
                        borderRadius: 10,
                        border: "1px solid #eef2f6",
                        padding: "12px 14px",
                        opacity: 0.7,
                      }}
                    >
                      {editGroups.map((g, idx: number) => {
                        const agent = allAgents.find(
                          (a) => a.id === g.agentId,
                        );
                        const logoUrl = agent?.logo
                          ? agent.logo.startsWith("/")
                            ? `${getApiBaseUrl()}${agent.logo}`
                            : agent.logo
                          : null;
                        return (
                          <div
                            key={g.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 0",
                              borderBottom:
                                idx < editGroups.length - 1
                                  ? "1px solid #eef2f6"
                                  : "none",
                            }}
                          >
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: "#2563eb",
                                color: "white",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.688rem",
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {idx + 1}
                            </div>
                            <span
                              style={{
                                fontSize: "0.813rem",
                                fontWeight: 500,
                                color: "#0f172a",
                                minWidth: 70,
                                flexShrink: 0,
                              }}
                            >
                              {g.name}
                            </span>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "1px solid #e2e8f0",
                                background: "white",
                                fontSize: "0.813rem",
                                color: "#64748b",
                              }}
                            >
                              {logoUrl ? (
                                <img
                                  src={logoUrl}
                                  alt=""
                                  style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 4,
                                    objectFit: "cover",
                                  }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 4,
                                    background:
                                      "linear-gradient(135deg, #667eea, #764ba2)",
                                    color: "white",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "0.625rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  {agent?.name?.[0] || "?"}
                                </div>
                              )}
                              <span>{agent?.name || "未配置"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              {/* 探究网页（只读展示）。
                  ⚠️ 不放在上面那两个 `allAgents.length > 0` / `mode === 'advanced'` 条件里：
                  网页与「有没有加载到智能体」「是哪种模式」都无关，被哪个条件包住都会让
                  某类课堂的网页**无声地**不显示。 */}
              <div style={{ marginTop: 20 }}>
                <label
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#475569",
                    marginBottom: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
                  </svg>
                  探究网页
                  <span
                    style={{
                      fontSize: "0.688rem",
                      color: "#94a3b8",
                      fontWeight: 400,
                      marginLeft: 4,
                    }}
                  >
                    （创建后不可更改）
                  </span>
                </label>
                {(() => {
                  // 🔴 **权威来源随模式变**（与 `effectiveGroupWebapp`、服务端
                  // `resolveMaterialTargetId` 同一条规矩）：高级模式下探究网页的权威来源是
                  // **各组**，课堂级那张关联表在该模式下服务端**根本不写**（spec §4.3）
                  // ⇒ 只读 `webapps` 恒为空、这里显示「未关联」而其实每个组都配了。
                  // 用户 2026-09-23：「这部分显示为空白，其实已经有关联了」。
                  const materials = classroomMaterialsInUse({
                    mode: settingsModalClassroom.mode,
                    groups: settingsModalClassroom.groups,
                    agents: settingsModalClassroom.classroomAgents.map((ca) => ca.agent).filter(Boolean),
                    webapps: settingsModalClassroom.webapps,
                    worksheets: settingsModalClassroom.worksheets,
                  }).webapps;

                  if (materials.length === 0) {
                    return (
                      <span style={{ fontSize: "0.813rem", color: "#94a3b8" }}>
                        {/* 两种模式的「没有」不是同一件事：高级模式是「一个组都没配」，
                            课堂级那张表在该模式下压根不被读。 */}
                        {settingsModalClassroom.mode === "advanced"
                          ? "各组均未配置探究网页"
                          : "未关联"}
                      </span>
                    );
                  }

                  // 多选时代留下的课堂可能挂着多条。这种情况必须**当面说清**：
                  // 保存设置时服务端会把多余的裁掉（并写服务端日志），
                  // 教师有权在按下保存之前知道这一次保存会顺带删掉什么。
                  // ⚠️ 只对**课堂级**这条路径说：高级模式下网页按组配置，保存时不会被裁。
                  const classroomWebapps = settingsModalClassroom.webapps ?? [];
                  const trimmedCount = settingsModalClassroom.mode === "advanced"
                    ? 0
                    : Math.max(0, classroomWebapps.length - 1);

                  return (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          opacity: 0.7,
                        }}
                      >
                        {materials.map(({ material, groupNames }) => (
                          <div
                            key={material.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "1px solid #e2e8f0",
                              background: "#f8fafc",
                              fontSize: "0.813rem",
                              color: "#64748b",
                            }}
                          >
                            <span>{material.name}</span>
                            {/* 高级模式下同一类不止一个 —— 光看名字不知道为什么有多个。 */}
                            {groupNames.length > 0 && (
                              <span style={{ fontSize: "0.688rem", color: "#94a3b8" }}>
                                {groupNames.join("、")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {trimmedCount > 0 && (
                        <div
                          role="alert"
                          style={{
                            marginTop: 8,
                            fontSize: "0.75rem",
                            color: "#92400e",
                            background: "#fffbeb",
                            border: "1px solid #fde68a",
                            borderRadius: 8,
                            padding: "8px 12px",
                            lineHeight: 1.6,
                          }}
                        >
                          本课堂关联了 {classroomWebapps.length} 个探究网页，只有第一个（
                          {classroomWebapps[0].name}）会生效。保存设置后，另外 {trimmedCount}{" "}
                          个关联会被自动移除（服务端日志会记录删除了哪些）。
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            {/* 弹窗底部按钮 */}
            <div
              style={{
                padding: "16px 28px",
                borderTop: "1px solid #f1f5f9",
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                background: "#fafbfc",
                borderRadius: "0 0 16px 16px",
              }}
            >
              <button
                onClick={() => setSettingsModalClassroom(null)} disabled={savingSettings}
                className="btn"
                style={{ fontSize: "0.813rem" }}
              >
                取消
              </button>
              <button
                onClick={() => void handleSaveSettings()} disabled={savingSettings}
                className="btn btn-primary"
                style={{ fontSize: "0.813rem" }}
              >
                {savingSettings ? "保存中..." : "保存设置"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
