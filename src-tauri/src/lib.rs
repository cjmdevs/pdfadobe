mod fileio;
mod launch;
mod print;
mod repair;
mod settings;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch (Explorer "Open with") hands its
        // files to the running window instead of opening another one.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            launch::on_second_instance(app, args, cwd);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(launch::PendingPaths::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            let paths = launch::paths_from_args(std::env::args(), &cwd);
            *app.state::<launch::PendingPaths>()
                .0
                .lock()
                .expect("pending paths lock") = paths;
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                disable_browser_accelerators(&w);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fileio::read_pdf,
            fileio::save_pdf_as,
            launch::take_launch_paths,
            settings::get_settings,
            settings::set_settings,
            repair::repair_pdf,
            print::print_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// WebView2 handles Ctrl+P, Ctrl+F, F5, Ctrl+R etc. itself before the page sees them.
/// Turn those off so the Acrobat-compatible shortcuts in `src/app/shortcuts.ts` work.
/// Tauri does not expose this setting, so reach the controller directly.
#[cfg(windows)]
fn disable_browser_accelerators(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2Settings3,
    };
    use windows::core::Interface;
    let _ = window.with_webview(|webview| unsafe {
        let controller: ICoreWebView2Controller = webview.controller();
        let Ok(core) = controller.CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}
