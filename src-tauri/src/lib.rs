mod app_windows;
mod docstore;
mod fileio;
mod launch;
mod print;
mod qpdf_job;
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
        // Only the main window's size and place are remembered; extra windows open where a
        // tab was dropped (backlog B1).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(launch::PendingPaths::default())
        .manage(docstore::DocStore::default())
        .manage(app_windows::Windows::default())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                window
                    .state::<app_windows::Windows>()
                    .focused(window.label());
            }
            tauri::WindowEvent::Destroyed => {
                window
                    .state::<app_windows::Windows>()
                    .destroyed(window.label());
                window
                    .state::<docstore::DocStore>()
                    .release_window(window.label());
            }
            _ => {}
        })
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
            fileio::save_pdf,
            fileio::discard_backup,
            fileio::list_folder,
            fileio::write_new_file,
            qpdf_job::qpdf_run,
            launch::take_launch_paths,
            settings::get_settings,
            settings::set_settings,
            repair::repair_pdf,
            print::print_pdf,
            docstore::doc_create,
            docstore::doc_push,
            docstore::doc_info,
            docstore::doc_current,
            docstore::doc_step,
            docstore::doc_mark_saved,
            docstore::doc_accept_signature,
            docstore::doc_clear_trimmed,
            docstore::doc_release,
            docstore::doc_set_markup_pending,
            docstore::doc_dirty,
            docstore::doc_find_path,
            docstore::doc_save,
            app_windows::tab_drop,
            app_windows::move_to_new_window,
            app_windows::take_window_docs,
            app_windows::focus_doc,
            app_windows::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// WebView2 handles Ctrl+P, Ctrl+F, F5, Ctrl+R etc. itself before the page sees them.
/// Turn those off so the Acrobat-compatible shortcuts in `src/app/shortcuts.ts` work.
/// Tauri does not expose this setting, so reach the controller directly.
#[cfg(windows)]
pub(crate) fn disable_browser_accelerators(window: &tauri::WebviewWindow) {
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
