use std::fs;
use std::net::TcpStream;
use std::process::{Child, Command, Output};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[derive(Serialize, Clone)]
struct IpInfo {
    name: String,
    label: String,
    ip: String,
}

use serde::Serialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent,
};

const SERVER_PORT: u16 = 3001;
// 探究空间托管服务的端口：必须与主服务不同源，否则 sandbox 的 allow-same-origin
// 会让 iframe 能自行摘除 sandbox。这里与服务端 resolveWebappPort 的默认值保持一致
// （serverPort + 1），并显式下发给子进程，避免两边各自推算。
const WEBAPP_PORT: u16 = SERVER_PORT + 1;
static IS_STARTING: AtomicBool = AtomicBool::new(false);
struct StartGuard<'a>(&'a AtomicBool);
impl<'a> StartGuard<'a> {
    fn acquire(flag: &'a AtomicBool) -> Result<Self, String> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "服务正在启动中，请勿重复操作".to_string())?;
        Ok(Self(flag))
    }
}
impl Drop for StartGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}
static LAST_START_ERROR: Mutex<Option<String>> = Mutex::new(None);

struct ServerInfo {
    child: Child,
}

struct ServerState(Mutex<Option<ServerInfo>>);

fn friendly_name(name: &str) -> String {
    match name {
        "en0" => "Wi-Fi".to_string(),
        "en1" => "以太网".to_string(),
        n if n.starts_with("en") => format!("以太网 ({})", n),
        n if n.starts_with("eth") => "以太网".to_string(),
        n if n.starts_with("wlan") || n.starts_with("wlp") || n.starts_with("wl") => "Wi-Fi".to_string(),
        n if n.starts_with("ww") => "移动网络".to_string(),
        "Wi-Fi" | "WiFi" => "Wi-Fi".to_string(),
        "以太网" | "Ethernet" => "以太网".to_string(),
        n if n.starts_with("本地连接") => "本地连接".to_string(),
        _ => name.to_string(),
    }
}

fn get_local_ips() -> Vec<IpInfo> {
    let virtual_patterns = [
        "utun", "awdl", "llw", "anpi", "ap",
        "docker", "veth", "virbr", "vmnet",
        "vEthernet", "vmware", "virtualbox", "bridge",
    ];
    if_addrs::get_if_addrs()
        .map(|ifaces| {
            ifaces
                .iter()
                .filter(|i| !virtual_patterns.iter().any(|p| i.name.to_lowercase().starts_with(p)))
                .filter_map(|i| match &i.addr {
                    if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() => Some(IpInfo {
                        name: i.name.clone(),
                        label: friendly_name(&i.name),
                        ip: v4.ip.to_string(),
                    }),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_menu(app: &AppHandle, running: bool) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let status_text = if running {
        "状态: 运行中".to_string()
    } else {
        "状态: 已停止".to_string()
    };

    let status = MenuItem::with_id(app, "status", &status_text, true, None::<&str>)?;
    status.set_enabled(false)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let start = MenuItem::with_id(app, "start", "启动服务", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::new(app)?;
    menu.append(&status)?;
    menu.append(&sep1)?;
    menu.append(&start)?;
    menu.append(&stop)?;
    menu.append(&sep2)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn tray_icon_bytes(running: bool) -> &'static [u8] {
    match (running, cfg!(target_os = "windows")) {
        (true, false) => include_bytes!("../icons/tray-running.png"),
        (false, false) => include_bytes!("../icons/tray-stopped.png"),
        (true, true) => include_bytes!("../icons/tray-running-windows.png"),
        (false, true) => include_bytes!("../icons/tray-stopped-windows.png"),
    }
}

fn set_tray_icon(app: &AppHandle, running: bool) {
    match Image::from_bytes(tray_icon_bytes(running)) {
        Ok(icon) => {
            if let Some(tray) = app.tray_by_id("dashboard") {
                if let Err(e) = tray.set_icon(Some(icon)) {
                    eprintln!("设置托盘图标失败: {}", e);
                }
                if let Err(e) = tray.set_icon_as_template(true) {
                    eprintln!("设置托盘图标模板模式失败: {}", e);
                }
            }
        }
        Err(e) => {
            eprintln!("加载图标图片失败: {}", e);
        }
    }
}

fn update_tray(app: &AppHandle, running: bool) {
    set_tray_icon(app, running);

    let tooltip = if running {
        format!("支点课堂 - 运行中 (端口: {SERVER_PORT})")
    } else {
        "支点课堂 - 已停止".to_string()
    };
    if let Some(tray) = app.tray_by_id("dashboard") {
        let _ = tray.set_tooltip(Some(&tooltip));
        match build_menu(app, running) {
            Ok(menu) => {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    eprintln!("设置托盘菜单失败: {}", e);
                }
            }
            Err(e) => {
                eprintln!("构建菜单失败: {}", e);
            }
        }
    }
}

/// Node 22/24 on Windows can fail to resolve a JavaScript entry point when a
/// Tauri path carries the Win32 verbatim prefix (`\\?\C:\...`). Convert it
/// back to the equivalent regular drive or UNC path before spawning Node.
fn node_compatible_path(path: &std::path::Path) -> std::path::PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return std::path::PathBuf::from(format!(r"\\{}", rest));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return std::path::PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn get_server_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    Ok(node_compatible_path(&resource_dir.join("server")))
}

fn find_node(app: &AppHandle) -> String {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let server_dir = node_compatible_path(&resource_dir.join("server"));
        let node_path = if cfg!(target_os = "windows") {
            server_dir.join("node.exe")
        } else {
            server_dir.join("node")
        };
        if node_path.exists() {
            return node_path.to_string_lossy().to_string();
        }
    }

    let common_paths: &[&str] = if cfg!(target_os = "macos") {
        &[
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
    } else if cfg!(target_os = "windows") {
        &[r"C:\Program Files\nodejs\node.exe"]
    } else {
        &["/usr/bin/node", "/usr/local/bin/node"]
    };
    for p in common_paths {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    "node".to_string()
}

fn ensure_port_free(port: u16) -> Result<(), String> {
    if TcpStream::connect(format!("127.0.0.1:{port}")).is_err() {
        return Ok(());
    }
    Err(format!("端口 {port} 已被其他程序占用。请关闭占用端口的程序，或在系统设置中调整支点课堂端口后重试。"))
}

fn process_output_details(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let details = format!("{}\n{}", stdout.trim(), stderr.trim());
    let details = details.trim();
    if details.is_empty() {
        "命令没有返回详细信息".to_string()
    } else {
        details.to_string()
    }
}

/// Prefer a path relative to the child process working directory. On Windows,
/// passing a JavaScript entry point below Program Files as an absolute path can
/// be truncated to `C:` by the Node command-line parsing chain.
fn child_script_arg<'a>(script: &'a std::path::Path, cwd: &std::path::Path) -> &'a std::path::Path {
    script.strip_prefix(cwd).unwrap_or(script)
}

fn run_database_upgrade(
    node: &str,
    script: &std::path::Path,
    server_dir: &std::path::Path,
    db_url: &str,
    data_dir: &std::path::Path,
) -> Result<Output, String> {
    let mut cmd = Command::new(node);
    cmd.arg(child_script_arg(script, server_dir))
        .current_dir(server_dir)
        .env("DATABASE_URL", db_url)
        .env("CLASSNODE_DATA_DIR", data_dir);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    cmd.output().map_err(|e| format!("执行安全数据库升级失败: {}", e))
}

fn spawn_server_inner(app: &AppHandle) -> Result<(), String> {
    // 主端口绑不上，服务端根本起不来 —— 硬失败是对的，保持不变。
    ensure_port_free(SERVER_PORT)?;
    // 托管端口**只警告**：它与主服务是同一个进程里的两个监听，服务端自己遇到 EADDRINUSE
    // 也只是 warn（见 webapp-host.ts）。这里若用 `?`，一个无关进程占了 3002 就会让整节课
    // 开不了 —— 那是拿「探究空间不可用」换「完全无法上课」，与「该端口故障不影响主服务」
    // 的承诺自相矛盾。宁可少一个模块，不可整节课停摆。
    if let Err(e) = ensure_port_free(WEBAPP_PORT) {
        eprintln!("⚠️ 探究空间托管端口预检失败，主服务照常启动，该模块将无法加载: {e}");
    }

    let server_dir = get_server_dir(app)?;
    let server_script = server_dir.join("dist").join("index.js");
    let node = find_node(app);

    if !server_script.exists() {
        return Err(format!("服务端脚本未找到: {:?}", server_script));
    }

    let data_dir = node_compatible_path(
        &app.path()
            .app_data_dir()
            .map_err(|e| format!("无法获取用户数据目录: {}", e))?,
    );
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("创建用户数据目录失败: {}", e))?;

    for sub in &["uploads/chat", "uploads/logos", "uploads/temp", "backups", "webapps"] {
        fs::create_dir_all(data_dir.join(sub))
            .map_err(|e| format!("创建目录 {} 失败: {}", sub, e))?;
    }

    let db_path = data_dir.join("dev.db");
    if !db_path.exists() {
        let builtin_db = server_dir.join("prisma").join("dev.db");
        if builtin_db.exists() {
            fs::copy(&builtin_db, &db_path)
                .map_err(|e| format!("复制数据库失败: {}", e))?;
            eprintln!("数据库已复制到: {:?}", db_path);
        } else {
            return Err(format!("内置数据库文件未找到: {:?}", builtin_db));
        }
    }

    let data_dir_str = data_dir.to_string_lossy().to_string();
    let db_url = format!("file:{}", db_path.to_string_lossy().replace('\\', "/"));

    // Both desktop and source startup use the same ordered, candidate-based migration.
    // A schema hash alone cannot prove that legacy data migration completed.
    let upgrade_script = server_dir.join("dist").join("upgrade-database.js");
    if !upgrade_script.exists() {
        return Err("安全数据库升级入口缺失，已取消启动；请重新安装完整版本".to_string());
    }
    let output = run_database_upgrade(&node, &upgrade_script, &server_dir, &db_url, &data_dir)?;
    if !output.status.success() {
        return Err(format!("数据库升级失败（退出码 {:?}），服务未启动。\n{}", output.status.code(), process_output_details(&output)));
    }
    eprintln!("{}", process_output_details(&output));

    let mut child = {
        let mut cmd = Command::new(&node);
        cmd.arg(child_script_arg(&server_script, &server_dir))
            .current_dir(&server_dir)
            .env("CLASSNODE_DATA_DIR", &data_dir_str)
            .env("DATABASE_URL", &db_url)
            .env("CLASSNODE_WEBAPP_PORT", WEBAPP_PORT.to_string());
        #[cfg(unix)]
        cmd.process_group(0);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.spawn()
            .map_err(|e| format!("启动服务失败: {} (node路径: {})", e, node))?
    };

    let mut ready = false;
    for _ in 0..120 {
        let exit = match child.try_wait() {
            Ok(exit) => exit,
            Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(format!("检查服务进程失败: {error}")); }
        };
        if let Some(status) = exit {
            return Err(format!("服务进程在启动时退出: {status}"));
        }
        if TcpStream::connect(format!("127.0.0.1:{SERVER_PORT}")).is_ok() { ready = true; break; }
        std::thread::sleep(Duration::from_millis(250));
    }
    if !ready {
        let _ = child.kill();
        let _ = child.wait();
        return Err("服务启动超时，已回收子进程".to_string());
    }
    *app.state::<ServerState>().0.lock().unwrap() = Some(ServerInfo { child });

    Ok(())
}

/// 使用多项式哈希计算 schema 内容的确定性哈希值


fn stop_server(app: &AppHandle) -> Result<(), String> {
    if IS_STARTING.load(Ordering::Acquire) { return Err("服务仍在启动，请稍后再停止".to_string()); }
    if let Some(info) = app.state::<ServerState>().0.lock().unwrap().take() {
        let mut child = info.child;
        let pid = child.id();

        let _ = child.kill();
        let _ = child.wait();

        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-9", &format!("-{}", pid)])
                .spawn();
        }
    }
    Ok(())
}

fn open_browser_url(url: &str) {
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/c", "start", url]).spawn()
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };
    if let Err(e) = result {
        eprintln!("打开浏览器失败: {}", e);
    }
}

// ─── Tauri Commands ──────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerStatus {
    running: bool,
    starting: bool,
    last_error: Option<String>,
    port: u16,
    ips: Vec<String>,
    interfaces: Vec<IpInfo>,
}

#[tauri::command]
fn get_server_status(app: tauri::AppHandle) -> ServerStatus {
    let running = TcpStream::connect(format!("127.0.0.1:{SERVER_PORT}")).is_ok();
    if !running {
        let server_state = app.state::<ServerState>();
        let mut server = server_state.0.lock().unwrap();
        let exited = match server.as_mut() {
            Some(info) => info.child.try_wait().ok().flatten(),
            None => None,
        };
        if let Some(status) = exited {
            *server = None;
            let message = match status.code() {
                Some(code) => format!("服务进程已退出（退出码 {code}）"),
                None => "服务进程已异常退出".to_string(),
            };
            *LAST_START_ERROR.lock().unwrap() = Some(message);
        }
    }
    let interfaces = get_local_ips();
    let ips: Vec<String> = interfaces.iter().map(|i| i.ip.clone()).collect();
    ServerStatus {
        running,
        starting: IS_STARTING.load(Ordering::Relaxed),
        last_error: LAST_START_ERROR.lock().unwrap().clone(),
        port: SERVER_PORT,
        ips,
        interfaces,
    }
}

#[tauri::command]
fn cmd_start_server(app: tauri::AppHandle) -> Result<(), String> {
    let guard = StartGuard::acquire(&IS_STARTING)?;
    {
        let state = app.state::<ServerState>();
        let mut managed = state.0.lock().unwrap();
        if let Some(info) = managed.as_mut() {
            match info.child.try_wait().map_err(|e| format!("检查现有服务进程失败: {e}"))? {
                None => return Err("已有受控服务进程，请先停止服务".to_string()),
                Some(_) => { *managed = None; }
            }
        }
    }
    if TcpStream::connect(format!("127.0.0.1:{SERVER_PORT}")).is_ok() {
        return Err("服务已在运行中".to_string());
    }
    *LAST_START_ERROR.lock().unwrap() = None;

    // 后台线程启动（避免阻塞 IPC 线程导致窗口无响应）
    let h = app.clone();
    std::thread::spawn(move || {
        let _guard = guard;
        let result = spawn_server_inner(&h);
        match result {
            Ok(()) => {
                let h2 = h.clone();
                let _ = h.run_on_main_thread(move || update_tray(&h2, true));
            }
            Err(e) => {
                *LAST_START_ERROR.lock().unwrap() = Some(e.clone());
                eprintln!("启动服务失败: {}", e);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cmd_stop_server(app: tauri::AppHandle) -> Result<(), String> {
    stop_server(&app)?;
    *LAST_START_ERROR.lock().unwrap() = None;
    update_tray(&app, false);
    Ok(())
}

#[tauri::command]
fn cmd_open_url(url_type: String, ip: Option<String>) {
    // 优先使用传入的 IP，其次从 API 获取已保存的 IP，最后取第一块网卡
    let ip = ip.or_else(|| {
        let req = format!("GET /api/server-info HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
        if let Ok(mut stream) = std::net::TcpStream::connect(format!("127.0.0.1:{}", SERVER_PORT)) {
            use std::io::{Read, Write};
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let _ = stream.write_all(req.as_bytes());
            let mut buf = vec![0u8; 4096];
            if let Ok(n) = stream.read(&mut buf) {
                let body = String::from_utf8_lossy(&buf[..n]);
                if let Some(json_start) = body.find('{') {
                    if let Some(json_end) = body[json_start..].find("}\n").or_else(|| body[json_start..].rfind('}')) {
                        let json_str = &body[json_start..json_start + json_end + 1];
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                            let selected = json["selectedIp"].as_str().unwrap_or("").to_string();
                            if !selected.is_empty() { return Some(selected); }
                        }
                    }
                }
            }
        }
        None
    }).or_else(|| get_local_ips().first().map(|i| i.ip.clone()))
        .unwrap_or_else(|| "localhost".to_string());
    let url = match url_type.as_str() {
        "teacher" => format!("http://{}:{}/teacher", ip, SERVER_PORT),
        "student" => format!("http://{}:{}/classroom", ip, SERVER_PORT),
        "repo" | "gitcode" => "https://gitcode.com/weixin_41523975/classnode".to_string(),
        "github" => "https://github.com/hzzxcgtz/classnode".to_string(),
        _ => format!("http://{}:{}/teacher", ip, SERVER_PORT),
    };
    open_browser_url(&url);
}

// ─── App Entry ───────────────────────────────────────────

fn build_app_menu(handle: &AppHandle) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let file_menu = Submenu::with_items(handle, "文件", true, &[
        &MenuItem::with_id(handle, "show", "显示面板", true, None::<&str>)?,
        &PredefinedMenuItem::separator(handle)?,
        &MenuItem::with_id(handle, "quit", "退出支点课堂", true, Some("CmdOrCtrl+Q"))?,
    ])?;
    let server_menu = Submenu::with_items(handle, "服务", true, &[
        &MenuItem::with_id(handle, "start", "启动服务", true, Some("CmdOrCtrl+R"))?,
        &MenuItem::with_id(handle, "stop", "停止服务", true, None::<&str>)?,
    ])?;
    let help_menu = Submenu::with_items(handle, "帮助", true, &[
    ])?;
    let menu = Menu::new(handle)?;
    menu.append(&file_menu)?;
    menu.append(&server_menu)?;
    menu.append(&help_menu)?;
    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerState(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // 阻止第二个实例启动
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            cmd_start_server,
            cmd_stop_server,
            cmd_open_url,
        ])
        .setup(|app| {
            let icon = Image::from_bytes(tray_icon_bytes(false))
                .map_err(|e| format!("无法加载托盘图标: {e}"))?;

            let handle = app.handle();

            // 构建原生菜单栏（macOS 顶部菜单 / Windows 标题栏菜单）
            #[cfg(not(target_os = "linux"))]
            if let Ok(menu) = build_app_menu(&handle) {
                app.set_menu(menu).ok();
            }
            let tray_menu = build_menu(&handle, false)?;

            let _tray = TrayIconBuilder::with_id("dashboard")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("支点课堂 - 已停止")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("dashboard") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "start" => {
                        if let Err(e) = cmd_start_server(app.clone()) {
                            *LAST_START_ERROR.lock().unwrap() = Some(e.clone());
                            eprintln!("启动服务失败: {}", e);
                        } else {
                            *LAST_START_ERROR.lock().unwrap() = None;
                        }
                    }
                    "stop" => {
                        if let Err(e) = stop_server(app) {
                            eprintln!("停止服务失败: {}", e);
                        } else {
                            update_tray(app, false);
                        }
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("dashboard") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "gitcode" | "github" => {} // 已移除菜单项
                    "quit" => {
                        let _ = stop_server(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // 关闭窗口时最小化到托盘（不退出程序）
            if let Some(window) = app.get_webview_window("dashboard") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // 后台线程启动服务（避免阻塞主线程导致窗口无响应）
            let h = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(2));
                if let Err(e) = cmd_start_server(h.clone()) {
                    *LAST_START_ERROR.lock().unwrap() = Some(e.clone());
                    eprintln!("自动启动服务失败: {}", e);
                } else {
                    *LAST_START_ERROR.lock().unwrap() = None;
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动支点课堂失败");

    app.run(|app_handle, event| {
        match event {
            RunEvent::Exit => {
                let _ = stop_server(app_handle);
            }
            // macOS: Dock 图标点击时重新显示窗口
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("dashboard") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{child_script_arg, node_compatible_path, run_database_upgrade, StartGuard};
    use std::path::Path;

    #[test]
    fn start_guard_has_one_owner_and_releases_on_error_or_unwind() {
        use std::sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}};
        let flag = Arc::new(AtomicBool::new(false));
        let wins = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(std::sync::Barrier::new(9));
        let release = Arc::new(std::sync::Barrier::new(9));
        let mut threads = Vec::new();
        for _ in 0..8 {
            let (flag, wins, barrier, release) = (flag.clone(), wins.clone(), barrier.clone(), release.clone());
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                let guard = StartGuard::acquire(&flag);
                if guard.is_ok() { wins.fetch_add(1, Ordering::Relaxed); }
                release.wait();
                drop(guard);
            }));
        }
        barrier.wait();
        release.wait();
        for thread in threads { thread.join().unwrap(); }
        assert_eq!(wins.load(Ordering::Relaxed), 1);
        assert!(!flag.load(Ordering::Acquire));
        let _ = std::panic::catch_unwind(|| { let _guard = StartGuard::acquire(&flag).unwrap(); panic!("injected failure"); });
        assert!(!flag.load(Ordering::Acquire));
        assert!(StartGuard::acquire(&flag).is_ok());
    }

    #[test]
    fn executes_shared_upgrade_script_with_paths_and_failure_status() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("classnode upgrade test {stamp}"));
        let dist = root.join("dist");
        std::fs::create_dir_all(&dist).unwrap();
        let script = dist.join("upgrade-database.js");
        std::fs::write(&script, "console.log(JSON.stringify({args:process.argv.slice(2),db:process.env.DATABASE_URL,data:process.env.CLASSNODE_DATA_DIR}))").unwrap();
        let node = std::env::var("CLASSNODE_TEST_NODE").unwrap_or_else(|_| "node".to_string());
        let data_dir = root.join("user data");
        let output = run_database_upgrade(&node, &script, &root, "file:isolated.db", &data_dir).unwrap();
        assert!(output.status.success());
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["args"], serde_json::json!([]));
        assert_eq!(result["db"], "file:isolated.db");
        assert_eq!(result["data"], data_dir.to_string_lossy().as_ref());
        std::fs::write(&script, "process.exit(41)").unwrap();
        let failed = run_database_upgrade(&node, &script, &root, "file:isolated.db", &data_dir).unwrap();
        assert_eq!(failed.status.code(), Some(41));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn uses_relative_child_script_paths_below_working_directory() {
        let cwd = Path::new(r"C:\Program Files\ClassNode\resources\server");
        let script = cwd.join("node_modules").join("prisma").join("build").join("index.js");
        assert_eq!(
            child_script_arg(&script, cwd),
            Path::new("node_modules").join("prisma").join("build").join("index.js")
        );

        let external = Path::new(r"D:\tools\script.js");
        assert_eq!(child_script_arg(external, cwd), external);
    }

    #[test]
    fn removes_windows_verbatim_prefixes_before_starting_node() {
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\C:\Program Files\ClassNode\server")),
            Path::new(r"C:\Program Files\ClassNode\server")
        );
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\UNC\server\share\ClassNode")),
            Path::new(r"\\server\share\ClassNode")
        );
    }
}
