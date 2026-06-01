use std::fs;
use std::mem;
use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent,
};

const SERVER_PORT: u16 = 3001;

struct ServerInfo {
    child: Child,
}

struct ServerState(Mutex<Option<ServerInfo>>);

fn get_local_ips() -> Vec<String> {
    if_addrs::get_if_addrs()
        .map(|ifaces| {
            ifaces
                .iter()
                .filter_map(|i| match &i.addr {
                    if_addrs::IfAddr::V4(v4) if !v4.ip.is_loopback() => Some(format!("IP: {}", v4.ip)),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn build_menu(app: &AppHandle, running: bool) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let status_text = if running {
        format!("状态: 运行中 (端口: {SERVER_PORT})")
    } else {
        "状态: 已停止".to_string()
    };

    let status = MenuItem::with_id(app, "status", &status_text, true, None::<&str>)?;
    status.set_enabled(false)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let start = MenuItem::with_id(app, "start", "启动服务", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开教师端", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::new(app)?;
    menu.append(&status)?;

    if running {
        for ip in get_local_ips() {
            let item = MenuItem::with_id(app, &format!("ip_{}", ip), &ip, true, None::<&str>)?;
            item.set_enabled(false)?;
            menu.append(&item)?;
        }
    }

    menu.append(&sep1)?;
    menu.append(&start)?;
    menu.append(&stop)?;
    menu.append(&open)?;
    menu.append(&sep2)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn set_tray_icon(app: &AppHandle, running: bool) {
    let data: &[u8] = if running {
        include_bytes!("../icons/tray-running.png")
    } else {
        include_bytes!("../icons/tray-stopped.png")
    };
    match Image::from_bytes(data) {
        Ok(icon) => {
            if let Some(tray) = app.tray_by_id("main") {
                if let Err(e) = tray.set_icon(Some(icon)) {
                    eprintln!("设置托盘图标失败: {}", e);
                }
            } else {
                eprintln!("未找到托盘对象 main");
            }
        }
        Err(e) => {
            eprintln!("加载图标图片失败: {}", e);
        }
    }
}

fn update_tray(app: &AppHandle, running: bool) {
    eprintln!("update_tray(running={}) 被调用", running);
    set_tray_icon(app, running);

    let tooltip = if running {
        format!("ClassNode - 运行中 (端口: {SERVER_PORT})")
    } else {
        "ClassNode - 已停止".to_string()
    };
    if let Some(tray) = app.tray_by_id("main") {
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
    } else {
        eprintln!("update_tray: 未找到托盘对象 main");
    }
}

fn get_server_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    Ok(resource_dir.join("server"))
}

fn find_node(app: &AppHandle) -> String {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let server_dir = resource_dir.join("server");
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

/// 检查并清理占用指定端口的旧进程（防止上次退出遗留的孤儿进程）
fn ensure_port_free(port: u16) {
    if TcpStream::connect(format!("127.0.0.1:{port}")).is_err() {
        return; // 端口空闲，无需处理
    }

    eprintln!("端口 {port} 已被占用，正在清理旧进程...");

    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Ok(pid) = line.trim().parse::<i32>() {
                    eprintln!("杀死旧进程 PID={}", pid);
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).spawn();
                }
            }
            // 等待进程释放端口
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("cmd")
            .args(["/c", &format!("netstat -ano | findstr :{}", port)])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let line = line.trim();
                if line.contains("LISTENING") {
                    if let Some(pid_str) = line.rsplit_whitespace().next() {
                        if let Ok(pid) = pid_str.parse::<i32>() {
                            eprintln!("杀死旧进程 PID={}", pid);
                            let _ = Command::new("taskkill")
                                .args(["/F", "/PID", &pid.to_string()])
                                .spawn();
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

fn spawn_server(app: &AppHandle) -> Result<(), String> {
    // 先清理可能遗留的旧进程
    ensure_port_free(SERVER_PORT);

    let server_dir = get_server_dir(app)?;
    let server_script = server_dir.join("dist").join("index.js");
    let node = find_node(app);

    if !server_script.exists() {
        return Err(format!("服务端脚本未找到: {:?}", server_script));
    }

    // 使用用户数据目录存放数据库和上传文件，避免 Windows Program Files 只读问题
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取用户数据目录: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("创建用户数据目录失败: {}", e))?;

    // 创建运行时所需的子目录
    for sub in &["uploads/chat", "uploads/logos", "uploads/temp"] {
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

    // 同步数据库 schema（兼容跨版本升级）
    let prisma_cli = server_dir.join("node_modules").join("prisma").join("build").join("index.js");
    if prisma_cli.exists() {
        eprintln!("同步数据库 schema...");
        let status = {
            let mut cmd = Command::new(&node);
            cmd.arg(&prisma_cli)
                .args(["db", "push", "--accept-data-loss"])
                .current_dir(&server_dir)
                .env("DATABASE_URL", &db_url);
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000);
            cmd.status()
                .map_err(|e| format!("执行数据库迁移失败: {}", e))?
        };
        if !status.success() {
            eprintln!("数据库迁移警告: 进程退出码 {:?}", status.code());
        }
    } else {
        eprintln!("Prisma CLI 未找到，跳过数据库 schema 同步");
    }

    let child = {
        let mut cmd = Command::new(&node);
        cmd.arg(&server_script)
            .current_dir(&server_dir)
            .env("CLASSNODE_DATA_DIR", &data_dir_str)
            .env("DATABASE_URL", &db_url);
        // 创建独立进程组，退出时一起清理
        #[cfg(unix)]
        cmd.process_group(0);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);
        cmd.spawn()
            .map_err(|e| format!("启动服务失败: {} (node路径: {})", e, node))?
    };

    *app.state::<ServerState>().0.lock().unwrap() = Some(ServerInfo { child });

    Ok(())
}

fn stop_server(app: &AppHandle) -> Result<(), String> {
    if let Some(info) = app.state::<ServerState>().0.lock().unwrap().take() {
        let mut child = info.child;
        let pid = child.id();

        // 先正常终止子进程
        let _ = child.kill();
        let _ = child.wait();

        // 确保整个进程组被清理（包括可能的子进程）
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-9", &format!("-{}", pid)])
                .spawn();
        }
    }
    Ok(())
}

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(format!("127.0.0.1:{port}")).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn open_browser() {
    let ips = get_local_ips();
    eprintln!("open_browser: 获取到的 IP 列表: {:?}", ips);
    let host = ips
        .first()
        .map(|s| s.trim_start_matches("IP: "))
        .unwrap_or("localhost");
    let url = format!("http://{}:{SERVER_PORT}/teacher", host);
    eprintln!("open_browser: 最终打开 URL: {}", url);
    let result = if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).spawn()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/c", "start", &url]).spawn()
    } else {
        Command::new("xdg-open").arg(&url).spawn()
    };
    if let Err(e) = result {
        eprintln!("打开浏览器失败: {}", e);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ServerState(Mutex::new(None)))
        .setup(|app| {
            let icon = Image::from_bytes(include_bytes!("../icons/tray-stopped.png").as_slice())
                .expect("无法加载托盘图标");

            let handle = app.handle();
            let menu = build_menu(&handle, false)?;

            let tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("ClassNode - 已停止")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "start" => {
                        if let Err(e) = spawn_server(app) {
                            eprintln!("启动服务失败: {}", e);
                        } else {
                            update_tray(app, true);
                        }
                    }
                    "stop" => {
                        if let Err(e) = stop_server(app) {
                            eprintln!("停止服务失败: {}", e);
                        } else {
                            update_tray(app, false);
                        }
                    }
                    "open" => open_browser(),
                    "quit" => {
                        let _ = stop_server(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            mem::forget(tray);

            // 延迟到事件循环就绪后启动服务
            let handle = app.handle().clone();
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Err(e) = spawn_server(&h) {
                    eprintln!("自动启动服务失败: {}", e);
                } else {
                    update_tray(&h, true);
                    // 后台线程等待服务就绪后再打开浏览器，不阻塞主线程
                    std::thread::spawn(|| {
                        if wait_for_server(SERVER_PORT, Duration::from_secs(15)) {
                            open_browser();
                        } else {
                            eprintln!("等待服务启动超时，请手动打开管理页面");
                        }
                    });
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 ClassNode 失败");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let _ = stop_server(app_handle);
        }
    });
}
