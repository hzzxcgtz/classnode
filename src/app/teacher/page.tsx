"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { platformColors } from "@/lib/constants";
import { getApiBaseUrl, getClassroomPort } from "@/lib/api-base";
import { QRCodeSVG } from "qrcode.react";
import QRCode from "qrcode";
import { FieldError, Toast } from "@/lib/components";

const SOCKET_URL = getApiBaseUrl();

export default function TeacherDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeClassrooms, setActiveClassrooms] = useState<any[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, number>>({});
  const [settingsModalClassroom, setSettingsModalClassroom] =
    useState<any>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGroups, setEditGroups] = useState<any[]>([]);
  const [allAgents, setAllAgents] = useState<any[]>([]);
  const [settingsDropdownGroupId, setSettingsDropdownGroupId] = useState<
    string | null
  >(null);
  const [editAgentId, setEditAgentId] = useState("");
  const [qrCodeClassroom, setQrCodeClassroom] = useState<any>(null);
  const [availableIPs, setAvailableIPs] = useState<
    { name: string; label: string; ip: string }[]
  >([]);
  const [selectedIP, setSelectedIP] = useState("");
  const [studentUrl, setStudentUrl] = useState("");
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const socketRef = useRef<any>(null);
  // 用 ref 跟踪最新的 classroom 列表，避免 socket connect 闭包中的 stale 值
  const activeClassroomsRef = useRef(activeClassrooms);
  activeClassroomsRef.current = activeClassrooms;

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
          crs.forEach((cr: any) => {
            sk.emit("listen-classroom-status", cr.id);
          });
        }
      });

      sk.on("online-students", (data: any) => {
        if (!cancelled) {
          setOnlineMap((prev: Record<string, number>) => ({
            ...prev,
            [data.classroomId]: data.studentIds?.length || 0,
          }));
        }
      });

      sk.on("nic-changed", () => {
        fetch(`${getApiBaseUrl()}/api/server-info`).then(r => r.json()).then(d => {
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
    activeClassrooms.forEach((cr: any) => {
      sk.emit("listen-classroom-status", cr.id);
    });
  }, [activeClassrooms]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getActiveClassrooms();
      setActiveClassrooms(data);
    } catch {}
    setLoading(false);
  };

  const openSettings = async (cr: any) => {
    setSettingsModalClassroom(cr);
    setEditTitle(cr.title || "");
    const groups = (cr.groups || []).map((g: any) => ({
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
    } catch {}
  };

  const handleSaveSettings = async () => {
    if (!settingsModalClassroom) return;
    try {
      await api.updateClassroomSettings(settingsModalClassroom.id, {
        title: editTitle,
      });
      setSettingsModalClassroom(null);
      loadData();
    } catch (e: any) {
      setToast({ msg: e.message, type: "error" });
    }
  };

  /** 生成并下载带 Logo 的二维码图片 */
  const downloadQRCode = async (cr: any) => {
    const host =
      selectedIP ||
      (typeof window !== "undefined" ? window.location.hostname : "");
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
    await new Promise<void>((resolve, reject) => {
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

  if (loading) {
    return (
      <div
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
      {/* 页面标题 */}
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: "1.375rem",
            fontWeight: 700,
            margin: 0,
            color: "#0f172a",
          }}
        >
          课堂管理
        </h1>
        <p style={{ color: "#64748b", fontSize: "0.813rem", marginTop: 4 }}>
          管理课堂、监控互动进度
        </p>
      </div>

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
        <button
          className="btn btn-primary"
          onClick={() => router.push("/teacher/classroom/new")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "0.813rem",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          创建新课堂
        </button>
      </div>

      {/* 课堂列表 */}
      {activeClassrooms.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {activeClassrooms.map((cr: any) => (
            <div
              key={cr.id}
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px 20px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
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
                          icon: ReactNode;
                        }
                      > = {
                        standard: {
                          label: "标准模式",
                          bg: "#eef2ff",
                          color: "#2563eb",
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
                          bg: "#f5f3ff",
                          color: "#7c3aed",
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
                          bg: "#fef3c7",
                          color: "#d97706",
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
                            gap: 3,
                            padding: "1px 7px",
                            borderRadius: 4,
                            fontSize: "0.688rem",
                            fontWeight: 600,
                            verticalAlign: "middle",
                            lineHeight: "14px",
                            background: cfg.bg,
                            color: cfg.color,
                          }}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      );
                    })()}
                    <span
                      style={{
                        display: "inline-block",
                        padding: "1px 7px",
                        borderRadius: 4,
                        background: "#f0fdf4",
                        color: "#16a34a",
                        fontSize: "0.688rem",
                        fontWeight: 600,
                        fontFamily: "monospace",
                      }}
                    >
                      {cr.code}
                    </span>
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
                    {cr._count?.students || 0} 名学生
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
                        (cr._count?.students || 0) - (onlineMap[cr.id] || 0),
                      ),
                      color: "#94a3b8",
                    },
                    {
                      label: "互动",
                      value: (cr.students || []).reduce(
                        (sum: number, s: any) => sum + (s.totalRounds || 0),
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
              {/* 中间部分：智能体信息 */}
              {(() => {
                // 收集智能体（从 classroomAgents 和 groups 去重）
                const agentMap = new Map<string, any>();
                (cr.classroomAgents || []).forEach((ca: any) => {
                  if (ca.agent) agentMap.set(ca.agent.id, ca.agent);
                });
                (cr.groups || []).forEach((g: any) => {
                  if (g.agent) agentMap.set(g.agent.id, g.agent);
                });
                const agents = [...agentMap.values()];
                if (agents.length === 0) return null;
                return (
                  <div
                    style={{
                      padding: "8px 20px",
                      borderTop: "1px solid #f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.688rem",
                        color: "#94a3b8",
                        fontWeight: 500,
                        marginRight: 2,
                      }}
                    >
                      智能体
                    </span>
                    {agents.map((agt: any) => {
                      const pc = platformColors[agt.platform] || "#64748b";
                      return (
                        <span
                          key={agt.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "3px 10px 3px 4px",
                            borderRadius: 6,
                            background: "#f8fafc",
                            border: "1px solid #eef2f6",
                            fontSize: "0.75rem",
                            color: "#475569",
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              flexShrink: 0,
                              background: pc,
                              color: "white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "0.563rem",
                              fontWeight: 700,
                              overflow: "hidden",
                            }}
                          >
                            {agt.logo ? (
                              <img
                                src={
                                  agt.logo.startsWith("/")
                                    ? `${getApiBaseUrl()}${agt.logo}`
                                    : agt.logo
                                }
                                alt=""
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              agt.name[0]
                            )}
                          </span>
                          {agt.name}
                        </span>
                      );
                    })}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.688rem' }}>
                      <span style={{ color: '#64748b', fontWeight: 500 }}>学生状态：</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, background: cr.status !== 'paused' ? '#eff6ff' : '#f1f5f9', border: `1px solid ${cr.status !== 'paused' ? '#bfdbfe' : '#e2e8f0'}`, color: cr.status !== 'paused' ? '#3b82f6' : '#94a3b8' }}>
                        {cr.status !== 'paused' ? '允许提问' : '禁止提问'}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, background: cr.allowStudentStop !== false ? '#fffbeb' : '#f1f5f9', border: `1px solid ${cr.allowStudentStop !== false ? '#fde68a' : '#e2e8f0'}`, color: cr.allowStudentStop !== false ? '#d97706' : '#94a3b8' }}>
                        {cr.allowStudentStop !== false ? '允许中断' : '禁止中断'}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, background: cr.allowStudentExport !== false ? '#ecfeff' : '#f1f5f9', border: `1px solid ${cr.allowStudentExport !== false ? '#a5f3fc' : '#e2e8f0'}`, color: cr.allowStudentExport !== false ? '#0891b2' : '#94a3b8' }}>
                        {cr.allowStudentExport !== false ? '允许导出' : '禁止导出'}
                      </span>
                    </span>
                  </div>
                );
              })()}
              {/* 下半部分：操作栏 */}
              <div
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

                {/* 编辑 + 互动码 */}
                <button onClick={() => openSettings(cr)} title="修改课堂设置"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#475569"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  编辑
                </button>
                <button onClick={() => { fetch(`${getApiBaseUrl()}/api/server-info`).then(r => r.json()).then(d => setStudentUrl(d.studentUrl || '')).catch(() => {}).finally(() => setQrCodeClassroom(cr)); }} title="显示互动码"
                  style={{ padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f1f5f9"; e.currentTarget.style.color = "#7c3aed"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="17" y="2" width="5" height="5" rx="1"/><rect x="2" y="17" width="5" height="5" rx="1"/><path d="M11 2h2"/><path d="M11 22h2"/><path d="M2 11v2"/><path d="M22 11v2"/><path d="M15 15h2v2h-2z"/><path d="M17 15v-1a2 2 0 0 0-2-2h-1"/><path d="M15 19v1a2 2 0 0 0 2 2h1"/><path d="M19 17h2v2h-2z"/></svg>
                  互动码
                </button>

                {/* 结束课堂 — 红字轮廓，hover 加强 */}
                <button onClick={async () => { if (confirm(`确定结束课堂「${cr.title || "未命名课堂"}」？\n结束后学生端将停止互动，数据自动保存至历史记录。`)) { await api.endClassroom(cr.id); loadData(); } }}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 500, background: "transparent", color: "#ef4444", border: "1px solid #fca5a5", cursor: "pointer", lineHeight: 1, transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.borderColor = "#f87171"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#fca5a5"; }}>
                  结束课堂
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
            setSettingsDropdownGroupId(null);
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
                          (a: any) => a.id === editAgentId,
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
                      {editGroups.map((g: any, idx: number) => {
                        const agent = allAgents.find(
                          (a: any) => a.id === g.agentId,
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
                onClick={() => setSettingsModalClassroom(null)}
                className="btn"
                style={{ fontSize: "0.813rem" }}
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                className="btn btn-primary"
                style={{ fontSize: "0.813rem" }}
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
