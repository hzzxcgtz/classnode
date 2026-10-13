"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { platformColors } from "@/lib/constants";
import { getApiBaseUrl, getClassroomPort } from "@/lib/api-base";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import { Toast, TeacherPageHeader, TeacherLoadingState } from "@/lib/components";
import type { ActiveClassroom, AgentSummary, WebappSummary } from "@/lib/types";
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
  const [materialChoices, setMaterialChoices] = useState<{ agents: AgentSummary[]; webapps: WebappSummary[] }>({ agents: [], webapps: [] });
  const [choicesLoading, setChoicesLoading] = useState(false);
  const [choicesError, setChoicesError] = useState("");
  const [editMaterials, setEditMaterials] = useState<Record<string, { agentId: string; webappId: string }>>({});
  const settingsLoadRef = useRef(0);
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

  // ★ M6b/3：列表**加载失败**必须与「你确实一堂课都没有」分开。
  //    原先这里是 `catch {}`（空块）⇒ 失败后 activeClassrooms 停在 []，界面走到
  //    「创建第一个课堂」，与「真的一堂课都没有」**逐字相同** —— 教师会以为数据没了。
  const [loadError, setLoadError] = useState(false);

  async function loadData() {
    setLoading(true);
    setLoadError(false);
    try {
      const [data, settings] = await Promise.all([api.getActiveClassrooms(), api.getSettings().catch((): Record<string, string> => ({}))]);
      setActiveClassrooms(data);
      setLanAccess(settings['lan-access'] !== 'false');
    } catch {
      setLoadError(true);
    }
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
    const generation = ++settingsLoadRef.current;
    setSettingsModalClassroom(cr);
    setEditTitle(cr.title || "");
    setEditMaterials(cr.mode === "advanced"
      ? Object.fromEntries(cr.groups.map(g => [g.id, { agentId: g.agent?.id ?? "", webappId: g.webapp?.id ?? "" }]))
      : { classroom: { agentId: cr.classroomAgents[0]?.agent?.id ?? "", webappId: cr.webapps?.[0]?.id ?? "" } });
    setMaterialChoices({ agents: [], webapps: [] });
    setChoicesError("");
    setChoicesLoading(true);
    const results = await Promise.allSettled([api.getAgents(), api.getWebapps()]);
    if (generation !== settingsLoadRef.current) return;
    setMaterialChoices({
      agents: results[0].status === "fulfilled" ? results[0].value.filter(a => a.enabled && a.purpose !== "analysis") : [],
      webapps: results[1].status === "fulfilled" ? results[1].value : [],
    });
    if (results.some(result => result.status === "rejected")) setChoicesError("部分可选内容加载失败，请关闭弹窗后重试；仍可修改课堂名称。");
    setChoicesLoading(false);
  };

  const handleSaveSettings = async () => {
    if (!settingsModalClassroom || settingsSavingRef.current) return;
    settingsSavingRef.current = true;
    setSavingSettings(true);
    try {
      const changes = (scope: string, currentAgent: string, currentWebapp: string) => {
        const edit = editMaterials[scope];
        return {
          ...(edit?.agentId && edit.agentId !== currentAgent ? { agentId: edit.agentId } : {}),
          ...(edit?.webappId && edit.webappId !== currentWebapp ? { webappId: edit.webappId } : {}),
        };
      };
      const cr = settingsModalClassroom;
      const materialChanges = cr.mode === "advanced"
        ? { groups: cr.groups.map(g => ({ id: g.id, ...changes(g.id, g.agent?.id ?? "", g.webapp?.id ?? "") }))
          .filter(g => g.agentId || g.webappId) }
        : changes("classroom", cr.classroomAgents[0]?.agent?.id ?? "", cr.webapps?.[0]?.id ?? "");
      await api.updateClassroomSettings(cr.id, { title: editTitle, ...materialChanges });
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
    link.download = `支点课堂-${cr.code}-${title}.png`;
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

  // ★ M6b/4：改用现成的 `TeacherLoadingState`（带旋转圈 + `role="status"`）——
  //   这里原先是个只有三个字的居中 div，而同仓早就有那个组件。**不新写任何东西。**
  if (loading) {
    return <TeacherLoadingState label="正在加载课堂…" />;
  }

  return (
    <div>
      <TeacherPageHeader title="课堂管理" description="创建课堂并实时掌握学生互动进度。" actions={
        <>
        <button type="button" className="btn btn-ghost classroom-network-status" onClick={() => void toggleLanAccess()} disabled={networkSaving}
          title={lanAccess ? '学生设备可通过局域网访问' : '当前仅教师电脑本机可访问'} aria-pressed={lanAccess}>
          <span className={`network-status-dot ${lanAccess ? 'is-open' : ''}`} />
          {networkSaving ? '切换中…' : lanAccess ? '局域网访问已开放' : '局域网访问已关闭'}
        </button>
        <button className="btn btn-primary" onClick={() => router.push('/teacher/classroom/new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          创建新课堂
        </button>
        </>
      } />

      {activeClassrooms.length > 0 && (
        <><div className="active-classroom-overview" aria-label="活跃课堂概览">
          {[
            { label: "活跃课堂", value: activeClassrooms.length, tone: "blue" },
            { label: "参与学生", value: activeTotals.students, tone: "blue" },
            { label: "当前在线", value: activeTotals.online, tone: "green" },
            { label: "互动轮次", value: activeTotals.rounds, tone: "blue" },
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
                border: "1px solid var(--card-border)",
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
                            fontSize: "0.75rem",
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
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        border: "1px solid var(--card-border)",
                        cursor: "pointer",
                        boxSizing: "border-box",
                      }}
                    >
                      <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>互动码</span>
                      <strong style={{ color: "#0f766e", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.75rem", letterSpacing: "0.04em" }}>{cr.code}</strong>
                      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0f766e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {cr.classes?.[0]?.class?.name && (
                      <>
                        {cr.classes[0].class.name}
                        <span style={{ margin: "0 6px", color: 'var(--text-muted, #64748b)' }}>
                          |
                        </span>
                      </>
                    )}
                    {cr.mode === 'group' || cr.mode === 'advanced'
                      ? `${cr.participantCount ?? (cr._count?.students || 0)} 个小组 · ${cr.realStudentCount ?? 0} 名学生`
                      : `${cr.realStudentCount ?? (cr._count?.students || 0)} 名学生`}
                    <span style={{ margin: "0 6px", color: 'var(--text-muted, #64748b)' }}>|</span>
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
                      color: "var(--state-healthy)",
                    },
                    {
                      label: "离线",
                      value: Math.max(
                        0,
                        (cr.participantCount ?? (cr._count?.students || 0)) - (onlineMap[cr.id] || 0),
                      ),
                      color: "var(--text-muted)",
                    },
                    // 2026-09-25：第三格「互动」（`totalRounds` 求和）已按教师要求**去掉**。
                    // ⇒ 卡片上只剩「在线 / 离线」两格，它们是一对（离线 = 参与者数 − 在线），
                    //   而「互动」是另一个量纲的累计值，去掉之后这一行反而是自洽的。
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
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
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

                const chip = (key: string, icon: ReactNode, name: string, groupNames: string[]) => (
                  <span key={key} className="classroom-resource-item">
                    {icon}
                    <span className="classroom-resource-copy">
                      <span className="classroom-resource-name">{name}</span>
                      {groupNames.length > 0 && (
                        <span className="classroom-resource-groups">{groupNames.join("、")}</span>
                      )}
                    </span>
                  </span>
                );

                const iconBox = (background: string, content: ReactNode) => (
                  <span className="classroom-resource-icon" style={{ background }}>{content}</span>
                );

                const section = (kind: string, label: string, chips: ReactNode[]) => chips.length === 0 ? null : (
                  <div key={kind} className="classroom-resource-section" data-resource-kind={kind}>
                    <div className="classroom-resource-heading">
                      <span>{label}</span>
                      <span className="classroom-resource-count">{chips.length}</span>
                    </div>
                    <div className="classroom-resource-items">{chips}</div>
                  </div>
                );

                return (
                  <div className="active-classroom-agent-row classroom-resource-row">
                    {/* 顺序 = 三件套本身（学习单 / 探究空间 / 智能学伴）。 */}
                    {section("worksheet", "学习单", materials.worksheets.map(({ material, groupNames }) => chip(
                      material.id,
                      iconBox("#365F91", <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
                      material.title,
                      groupNames,
                    )))}
                    {section("webapp", "探究网页", materials.webapps.map(({ material, groupNames }) => chip(
                      material.id,
                      iconBox("var(--primary)", <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>),
                      material.name,
                      groupNames,
                    )))}
                    {section("agent", "智能学伴", materials.agents.map(({ material: agt, groupNames }) => chip(
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
                <span className={`teacher-state is-${cr.status === "paused" ? "warning" : "healthy"}`} style={{ marginRight: 'auto' }}>
                  {cr.status === "paused" ? "已暂停" : "进行中"}
                </span>

                <div className="active-classroom-actions">
                {/* 编辑 + 互动码 */}
                <button onClick={() => openSettings(cr)} title="修改课堂设置"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.875rem", background: "transparent", color: 'var(--text-secondary, #475569)', border: "1px solid var(--card-border)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#475569"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  编辑
                </button>
                <button onClick={() => void openQrCode(cr)} disabled={loadingQrClassroomId !== null} title="显示互动码"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.875rem", background: "transparent", color: 'var(--text-secondary, #475569)', border: "1px solid var(--card-border)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "var(--primary)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="17" y="2" width="5" height="5" rx="1"/><rect x="2" y="17" width="5" height="5" rx="1"/><path d="M11 2h2"/><path d="M11 22h2"/><path d="M2 11v2"/><path d="M22 11v2"/><path d="M15 15h2v2h-2z"/><path d="M17 15v-1a2 2 0 0 0-2-2h-1"/><path d="M15 19v1a2 2 0 0 0 2 2h1"/><path d="M19 17h2v2h-2z"/></svg>
                  {loadingQrClassroomId === cr.id ? "加载中..." : "互动码"}
                </button>

                {/* 结束课堂 — 红字轮廓，hover 加强 */}
                <button onClick={() => void endClassroom(cr)} disabled={endingClassroomId !== null}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.875rem", fontWeight: 500, background: "transparent", color: "#a85d5d", border: "1px solid #fca5a5", cursor: "pointer", lineHeight: 1, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f8eeee"; e.currentTarget.style.color = "#934e4e"; e.currentTarget.style.borderColor = "#f87171"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#a85d5d"; e.currentTarget.style.borderColor = "#fca5a5"; }}>
                  {endingClassroomId === cr.id ? "结束中..." : "结束课堂"}
                </button>

                {/* 进入课堂 — 醒目填充按钮 */}
                <button onClick={() => router.push(`/teacher/classroom?id=${cr.id}`)}
                  style={{ padding: "7px 18px", borderRadius: 8, fontSize: "0.875rem", fontWeight: 600, background: "linear-gradient(135deg, var(--primary), var(--primary-dark))", color: "white", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, transition: "all 0.15s", boxShadow: "0 2px 8px rgba(var(--primary-focus-rgb), 0.25)" }}
                  /* ★ 2026-09-30（教师）：「鼠标在上方停留颜色不对」。
                     🔴 原先是 `linear-gradient(135deg, var(--primary-dark), #1e40af)` —— 第一个色停是
                     `--primary-dark`（灰蓝），第二个却是 `#1e40af`（**另一个色相**的高饱和蓝）
                     ⇒ 悬停时按钮变成**左边灰蓝、右边亮蓝**的两截，看着像渲染坏了。
                     现在整条按同一个色相**压暗一档**：底 → 悬停 = 青蓝 → 更深的青蓝，
                     与 `.btn-primary`（`--primary` → `--primary-dark`）同一条规矩。 */
                  onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, var(--primary-dark), var(--cn-primary-pressed))"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(var(--primary-focus-rgb), 0.35)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, var(--primary), var(--primary-dark))"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(var(--primary-focus-rgb), 0.25)"; }}>
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
            border: "1px solid var(--card-border)",
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
              stroke="var(--text-muted)"
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
            {/* ★ M6b/3：加载失败时**不许**说「暂无活跃课堂」——
                那与「你确实一堂课都没有」是两件事，而失败时它们逐字相同。 */}
            {loadError ? '课堂列表加载失败' : '暂无活跃课堂'}
          </div>
          <p
            style={{
              fontSize: "0.813rem",
              color: "var(--text-muted)",
              margin: "0 0 20px",
            }}
          >
            {loadError
              ? '请确认本机的支点课堂服务正在运行，然后重试'
              : '创建新课堂后，学生通过互动码加入，即可开始互动教学'}
          </p>
          <button
            // ★ M6b/3：失败时这个按钮是**重试**，不是「去建课堂」。
            onClick={() => { if (loadError) { void loadData(); } else { router.push("/teacher/classroom/new"); } }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 24px",
              borderRadius: 8,
              fontSize: "0.875rem",
              fontWeight: 600,
              background: "var(--primary)",
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
            {loadError ? '重试' : '创建第一个课堂'}
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
                    color: "var(--primary)",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    transition: "all 0.15s",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#f2f5f8";
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
                          background: "rgba(var(--primary-focus-rgb), 0.15)",
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
          <div className="teacher-compact-dialog" role="dialog" aria-modal="true" aria-label="课堂设置"
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
                  background: "var(--primary-tint)",
                  color: "var(--primary)",
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
                    fontSize: "0.8125rem",
                    color: "var(--text-muted)",
                    margin: "2px 0 0",
                  }}
                >
                  可修改名称、探究网页和智能学伴，学习单不可更换
                </p>
              </div>
            </div>
            {/* 弹窗内容 */}
            <div style={{ padding: "20px 28px", overflowY: "auto", maxHeight: "60vh" }}>
              {/* 课堂名称 */}
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{
                    fontSize: "0.875rem",
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
                    border: "1px solid var(--card-border)",
                    fontSize: "0.875rem",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.15s",
                    background: "#fafbfc",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--primary)";
                    e.currentTarget.style.background = "white";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#e2e8f0";
                    e.currentTarget.style.background = "#fafbfc";
                  }}
                />
              </div>

              {choicesError && <p role="alert" style={{ color: "#b45309", fontSize: "0.813rem" }}>{choicesError}</p>}
              {/* 当前关联来自课堂数据；可选材料另外加载，高级模式按组更换。 */}
              {(() => {
                const materials = classroomMaterialsInUse({
                  mode: settingsModalClassroom.mode,
                  groups: settingsModalClassroom.groups,
                  agents: settingsModalClassroom.classroomAgents.map((ca) => ca.agent).filter(Boolean),
                  webapps: settingsModalClassroom.webapps,
                  worksheets: settingsModalClassroom.worksheets,
                });
                const sections = [
                  { key: "worksheets", label: "学习单", items: materials.worksheets },
                  { key: "webapps", label: "探究网页", items: materials.webapps },
                  { key: "agents", label: "智能学伴", items: materials.agents },
                ];
                const classroomWebapps = settingsModalClassroom.webapps ?? [];
                const trimmedCount = settingsModalClassroom.mode === "advanced"
                  ? 0
                  : Math.max(0, classroomWebapps.length - 1);

                return sections.map(({ key, label, items }) => (
                  <section key={key} aria-label={label} style={{ marginTop: 20 }}>
                    <div style={{
                      fontSize: "0.875rem", fontWeight: 600, color: "#475569",
                      marginBottom: 6, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
                    }}>
                      {label}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400 }}>
                        {key === "worksheets" ? "（创建后不可更改）" : "（可更换）"}
                      </span>
                    </div>
                    {key !== "worksheets" ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {(settingsModalClassroom.mode === "advanced"
                          ? settingsModalClassroom.groups.map(g => ({ scope: g.id, name: g.name, material: key === "agents" ? g.agent : g.webapp }))
                          : [{ scope: "classroom", name: "", material: items[0]?.material }]
                        ).map(({ scope, name, material }) => {
                          const field = key === "agents" ? "agentId" : "webappId";
                          const choices = key === "agents" ? materialChoices.agents : materialChoices.webapps;
                          const value = editMaterials[scope]?.[field] ?? "";
                          return (
                            <label key={scope} style={{ display: "grid", gap: 4, fontSize: "0.813rem" }}>
                              {name && <span>{name}</span>}
                              <select aria-label={`${name ? `${name} · ` : ""}${label}`}
                                value={value} disabled={choicesLoading || savingSettings || choices.length === 0}
                                onChange={e => setEditMaterials(prev => ({ ...prev, [scope]: { ...prev[scope], [field]: e.target.value } }))}
                                style={{ width: "100%", minWidth: 0, padding: "10px 12px", borderRadius: 8,
                                  border: "1px solid var(--card-border)", background: "#f8fafc", color: "#475569" }}>
                                <option value="" disabled>未关联</option>
                                {material && !choices.some(c => c.id === material.id) && (
                                  <option value={material.id}>{"name" in material ? material.name : material.title}（当前关联）</option>
                                )}
                                {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                              </select>
                            </label>
                          );
                        })}
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                          {key === "agents" ? "更换后开始新的对话上下文，旧聊天记录保留。回答生成中暂不能更换。"
                            : "更换后学生将打开新网页，旧网页未保存的输入和操作状态会丢失，历史活动记录保留。"}
                        </span>
                      </div>
                    ) : items.length === 0 ? (
                      <span style={{ fontSize: "0.813rem", color: "var(--text-muted)" }}>
                        {settingsModalClassroom.mode === "advanced" ? `各组均未配置${label}` : "未关联"}
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {items.map(({ material, groupNames }) => (
                          <div key={material.id} style={{
                            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
                            padding: "6px 12px", borderRadius: 8,
                            border: "1px solid var(--card-border)", background: "#f8fafc",
                            fontSize: "0.813rem", color: "var(--text-secondary, #475569)",
                            maxWidth: "100%", overflowWrap: "anywhere",
                          }}>
                            <span>{"name" in material ? material.name : material.title}</span>
                            {groupNames.length > 0 && (
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                {groupNames.join("、")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {key === "webapps" && trimmedCount > 0 && (
                      <div role="alert" style={{
                        marginTop: 8, fontSize: "0.75rem", color: "#92400e", background: "#faf4eb",
                        border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", lineHeight: 1.6,
                      }}>
                        本课堂关联了 {classroomWebapps.length} 个探究网页，只有第一个（
                        {classroomWebapps[0].name}）会生效。保存设置后，另外 {trimmedCount}{" "}
                        个关联会被自动移除（服务端日志会记录删除了哪些）。
                      </div>
                    )}
                  </section>
                ));
              })()}

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
                style={{ fontSize: "0.875rem" }}
              >
                取消
              </button>
              <button
                onClick={() => void handleSaveSettings()} disabled={savingSettings}
                className="btn btn-primary"
                style={{ fontSize: "0.875rem" }}
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
