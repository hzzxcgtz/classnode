use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
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
    let icon = if running {
        Image::from_bytes(include_bytes!("../icons/tray-running.png"))
    } else {
        Image::from_bytes(include_bytes!("../icons/tray-stopped.png"))
    };
    if let Ok(icon) = icon {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_icon(Some(icon));
        }
    }
}

fn update_tray(app: &AppHandle, running: bool) {
    set_tray_icon(app, running);

    let tooltip = if running {
        format!("ClassNode - 运行中 (端口: {SERVER_PORT})")
    } else {
        "ClassNode - 已停止".to_string()
    };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(&tooltip));
        if let Ok(menu) = build_menu(app, running) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState(Mutex::new(None)))
        .setup(|app| {
            let icon = Image::from_bytes(include_bytes!("../icons/tray-stopped.png"))
                .expect("无法加载托盘图标");

            let handle = app.handle();
            let menu = build_menu(&handle, false)?;

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("ClassNode - 已停止")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "start" => {
                        if let Err(e) = start_server(app) {
                            eprintln!("启动服务失败: {}", e);
                        }
                    }
                    "stop" => {
                        if let Err(e) = stop_server(app) {
                            eprintln!("停止服务失败: {}", e);
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

            // 启动后自动运行服务
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if let Err(e) = start_server(&handle) {
                    eprintln!("自动启动服务失败: {}", e);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 ClassNode 失败");
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
    "node".to_string()
}

fn start_server(app: &AppHandle) -> Result<(), String> {
    let server_dir = get_server_dir(app)?;
    let server_script = server_dir.join("dist").join("index.js");
    let node = find_node(app);

    if !server_script.exists() {
        return Err(format!("服务端脚本未找到: {:?}", server_script));
    }

    let child = Command::new(&node)
        .arg(&server_script)
        .current_dir(&server_dir)
        .spawn()
        .map_err(|e| format!("启动服务失败: {}", e))?;

    *app.state::<ServerState>().0.lock().unwrap() = Some(ServerInfo { child });

    update_tray(app, true);

    Ok(())
}

fn stop_server(app: &AppHandle) -> Result<(), String> {
    if let Some(info) = app.state::<ServerState>().0.lock().unwrap().take() {
        let mut child = info.child;
        child.kill().map_err(|e| format!("停止服务失败: {}", e))?;
        let _ = child.wait();

        update_tray(app, false);
    }
    Ok(())
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
