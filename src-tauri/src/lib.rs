use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

struct ServerState(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState(Mutex::new(None)))
        .setup(|app| {
            // 构建托盘菜单
            let start = MenuItem::with_id(app, "start", "启动服务", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "停止服务", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "打开管理页面", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&start, &stop, &open, &quit])?;

            // 加载托盘图标
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("无法加载托盘图标");

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

/// 获取服务端代码所在目录
fn get_server_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    Ok(resource_dir.join("server"))
}

/// 查找可用的 Node.js 二进制（优先使用捆绑版本）
fn find_node(app: &AppHandle) -> String {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let node_path = if cfg!(target_os = "windows") {
            resource_dir.join("node.exe")
        } else {
            resource_dir.join("node")
        };
        if node_path.exists() {
            return node_path.to_string_lossy().to_string();
        }
    }
    "node".to_string()
}

/// 启动后端服务
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

    *app.state::<ServerState>().0.lock().unwrap() = Some(child);

    // 更新托盘提示
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("ClassNode - 运行中"));
    }

    Ok(())
}

/// 停止后端服务
fn stop_server(app: &AppHandle) -> Result<(), String> {
    if let Some(mut child) = app.state::<ServerState>().0.lock().unwrap().take() {
        child.kill().map_err(|e| format!("停止服务失败: {}", e))?;
        let _ = child.wait();

        // 更新托盘提示
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some("ClassNode - 已停止"));
        }
    }
    Ok(())
}

/// 在默认浏览器中打开管理页面
fn open_browser() {
    let url = "http://localhost:3000";
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
