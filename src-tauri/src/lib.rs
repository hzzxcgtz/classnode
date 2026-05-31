use std::fs;
use std::mem;
use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
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

fn build_menu(app: &AppHandle, running: bool) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let status_text = if running {
        format!("状态: 运行中 (端口: {SERVER_PORT})")
    } else {
        "状态: 已停止".to_string()
    };
    let port_text = if running {
        format!("端口: {SERVER_PORT}")
    } else {
        "端口: --".to_string()
    };

    let status = MenuItem::with_id(app, "status", &status_text, true, None::<&str>)?;
    let port = MenuItem::with_id(app, "port", &port_text, true, None::<&str>)?;
    status.set_enabled(false)?;
    port.set_enabled(false)?;

    let sep1 = PredefinedMenuItem::separator(app)?;
    let start = MenuItem::with_id(app, "start", "启动服务", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "打开管理页面", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::new(app)?;
    menu.append(&status)?;
    menu.append(&port)?;
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

fn spawn_server(app: &AppHandle) -> Result<(), String> {
    let server_dir = get_server_dir(app)?;
    let server_script = server_dir.join("dist").join("index.js");
    let node = find_node(app);

    if !server_script.exists() {
        return Err(format!("服务端脚本未找到: {:?}", server_script));
    }

    // 使用用户数据目录存放数据库，避免 Windows Program Files 只读问题
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取用户数据目录: {}", e))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("创建用户数据目录失败: {}", e))?;

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

    let db_url = format!("file:{}", db_path.to_string_lossy().replace('\\', "/"));

    let child = Command::new(&node)
        .arg(&server_script)
        .current_dir(&server_dir)
        .env("DATABASE_URL", &db_url)
        .spawn()
        .map_err(|e| format!("启动服务失败: {} (node路径: {})", e, node))?;

    *app.state::<ServerState>().0.lock().unwrap() = Some(ServerInfo { child });

    Ok(())
}

fn stop_server(app: &AppHandle) -> Result<(), String> {
    if let Some(info) = app.state::<ServerState>().0.lock().unwrap().take() {
        let mut child = info.child;
        child.kill().map_err(|e| format!("停止服务失败: {}", e))?;
        let _ = child.wait();
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
    let url = format!("http://localhost:{SERVER_PORT}");
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
