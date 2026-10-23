//! Files passed on the command line: Explorer "Open with", double-click on a .pdf when we
//! are the default handler, or drag onto the .exe. A second launch is caught by
//! tauri-plugin-single-instance and forwarded to the running window as an event.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

/// Event the frontend listens for: payload is a list of absolute paths.
pub const OPEN_PATHS_EVENT: &str = "open-paths";

/// Paths from the first launch, held until the frontend is ready to take them.
#[derive(Default)]
pub struct PendingPaths(pub Mutex<Vec<String>>);

#[tauri::command]
pub fn take_launch_paths(pending: State<'_, PendingPaths>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().expect("pending paths lock"))
}

/// argv → PDF paths. Skips argv[0] and flags; resolves relative paths against `cwd`
/// (Explorer passes absolute paths, a terminal may not). Accepts any extension so a
/// mis-named PDF still opens; the frontend reports non-PDFs clearly.
pub fn paths_from_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            if p.is_absolute() || is_unc(&a) {
                a
            } else {
                cwd.join(p).to_string_lossy().into_owned()
            }
        })
        .collect()
}

fn is_unc(s: &str) -> bool {
    s.starts_with(r"\\") || s.starts_with("//")
}

/// single-instance callback: forward the second launch's files to the window used last
/// (any window if that one is gone) and focus it.
pub fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let paths = paths_from_args(args, Path::new(&cwd));
    let last = app.state::<crate::app_windows::Windows>().last_focused();
    let w = last
        .and_then(|l| app.get_webview_window(&l))
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().next());
    let Some(w) = w else { return };
    let _ = w.unminimize();
    let _ = w.set_focus();
    if !paths.is_empty() {
        let _ = app.emit_to(w.label(), OPEN_PATHS_EVENT, paths);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn skips_exe_and_flags() {
        let cwd = std::env::temp_dir();
        let abs = cwd.join("a.pdf").to_string_lossy().into_owned();
        let got = paths_from_args(args(&["app.exe", "--flag", &abs]), &cwd);
        assert_eq!(got, vec![abs]);
    }

    #[test]
    fn resolves_relative_paths() {
        let cwd = std::env::temp_dir();
        let got = paths_from_args(args(&["app.exe", "b.pdf"]), &cwd);
        assert_eq!(got, vec![cwd.join("b.pdf").to_string_lossy().into_owned()]);
    }

    #[test]
    fn keeps_unc_paths_untouched() {
        let cwd = std::env::temp_dir();
        let unc = r"\\server\share\Clients\Return 2025.pdf";
        assert_eq!(
            paths_from_args(args(&["app.exe", unc]), &cwd),
            vec![unc.to_string()]
        );
    }

    #[test]
    fn no_args_means_no_paths() {
        assert!(paths_from_args(args(&["app.exe"]), &std::env::temp_dir()).is_empty());
    }
}
