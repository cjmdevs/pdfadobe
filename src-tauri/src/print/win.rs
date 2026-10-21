//! Windows print path: PrintDlgEx (the standard Windows print dialog) + native PDFium
//! (pdfium.dll from bblanchon/pdfium-binaries, BSD-3/Apache-2.0) rendering to the
//! printer DC. Only built on Windows. Type-checked in CI with
//! `cargo check --target x86_64-pc-windows-msvc`; exercised by the manual Windows check.

use std::ffi::{c_char, c_int, c_ulong, c_void};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use libloading::Library;
use windows::Win32::Foundation::{GlobalFree, HGLOBAL, HWND};
use windows::Win32::Graphics::Gdi::{
    DeleteDC, GetDeviceCaps, HDC, HORZRES, LOGPIXELSX, LOGPIXELSY, PHYSICALHEIGHT, PHYSICALOFFSETX,
    PHYSICALOFFSETY, PHYSICALWIDTH, VERTRES,
};
use windows::Win32::Storage::Xps::{AbortDoc, DOCINFOW, EndDoc, EndPage, StartDocW, StartPage};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
use windows::Win32::UI::Controls::Dialogs::{
    PD_CURRENTPAGE, PD_NOSELECTION, PD_PAGENUMS, PD_RESULT_PRINT, PD_RETURNDC,
    PD_USEDEVMODECOPIESANDCOLLATE, PRINTDLGEXW, PRINTPAGERANGE, PrintDlgExW, START_PAGE_GENERAL,
};
use windows::core::PCWSTR;

use super::layout::{Device, expand_ranges, place};
use super::{PrintOptions, PrintOutcome};
use crate::fileio::FileError;

type Doc = *mut c_void;
type Page = *mut c_void;

const FPDF_ANNOT: c_int = 0x01;
const FPDF_PRINTING: c_int = 0x800;

/// The ten PDFium entry points printing needs. Loaded once from the bundled DLL.
struct Pdfium {
    _lib: Library,
    load_mem_document: unsafe extern "C" fn(*const c_void, c_int, *const c_char) -> Doc,
    get_last_error: unsafe extern "C" fn() -> c_ulong,
    get_page_count: unsafe extern "C" fn(Doc) -> c_int,
    load_page: unsafe extern "C" fn(Doc, c_int) -> Page,
    page_width: unsafe extern "C" fn(Page) -> f32,
    page_height: unsafe extern "C" fn(Page) -> f32,
    render_page: unsafe extern "C" fn(*mut c_void, Page, c_int, c_int, c_int, c_int, c_int, c_int),
    close_page: unsafe extern "C" fn(Page),
    close_document: unsafe extern "C" fn(Doc),
}

// SAFETY: function pointers into a loaded DLL; all calls are serialized by PDFIUM_LOCK.
unsafe impl Send for Pdfium {}
unsafe impl Sync for Pdfium {}

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();
/// PDFium is not thread-safe.
static PDFIUM_LOCK: Mutex<()> = Mutex::new(());

fn pdfium(dll: &Path) -> Result<&'static Pdfium, FileError> {
    PDFIUM
        .get_or_init(|| unsafe { load(dll) })
        .as_ref()
        .map_err(|e| FileError {
            kind: "unsupported",
            message: e.clone(),
        })
}

unsafe fn load(dll: &Path) -> Result<Pdfium, String> {
    unsafe {
        let lib = Library::new(dll).map_err(|e| format!("pdfium.dll not available: {e}"))?;
        macro_rules! sym {
            ($name:literal) => {
                *lib.get(concat!($name, "\0").as_bytes())
                    .map_err(|e| format!("{}: {e}", $name))?
            };
        }
        let init: unsafe extern "C" fn() = sym!("FPDF_InitLibrary");
        init();
        Ok(Pdfium {
            load_mem_document: sym!("FPDF_LoadMemDocument"),
            get_last_error: sym!("FPDF_GetLastError"),
            get_page_count: sym!("FPDF_GetPageCount"),
            load_page: sym!("FPDF_LoadPage"),
            page_width: sym!("FPDF_GetPageWidthF"),
            page_height: sym!("FPDF_GetPageHeightF"),
            render_page: sym!("FPDF_RenderPage"),
            close_page: sym!("FPDF_ClosePage"),
            close_document: sym!("FPDF_CloseDocument"),
            _lib: lib,
        })
    }
}

/// What the user picked in the Windows dialog.
struct Choice {
    hdc: HDC,
    pages: Vec<u32>,
}

pub fn print(
    dll: &Path,
    hwnd: isize,
    bytes: &[u8],
    options: &PrintOptions,
) -> Result<PrintOutcome, FileError> {
    let pdfium = pdfium(dll)?;
    let _guard = PDFIUM_LOCK
        .lock()
        .map_err(|_| FileError::other("printer busy"))?;

    let doc = unsafe {
        (pdfium.load_mem_document)(
            bytes.as_ptr().cast(),
            bytes.len() as c_int,
            std::ptr::null(),
        )
    };
    if doc.is_null() {
        let code = unsafe { (pdfium.get_last_error)() };
        return Err(FileError::other(format!(
            "could not prepare the document for printing (PDFium error {code})"
        )));
    }
    let page_count = unsafe { (pdfium.get_page_count)(doc) }.max(0) as u32;

    let result = (|| {
        let Some(choice) =
            show_dialog(HWND(hwnd as *mut c_void), page_count, options.current_page)?
        else {
            return Ok(PrintOutcome {
                status: "cancelled",
                pages: 0,
            });
        };
        let outcome = spool(pdfium, doc, &choice, options);
        unsafe {
            let _ = DeleteDC(choice.hdc);
        }
        outcome
    })();
    unsafe { (pdfium.close_document)(doc) };
    result
}

fn show_dialog(
    owner: HWND,
    page_count: u32,
    current_page: u32,
) -> Result<Option<Choice>, FileError> {
    // PrintDlgEx requires an STA thread; we are on a dedicated blocking thread.
    let com = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let mut ranges = [PRINTPAGERANGE {
        nFromPage: 1,
        nToPage: page_count.max(1),
    }; 32];
    let mut dlg = PRINTDLGEXW {
        lStructSize: std::mem::size_of::<PRINTDLGEXW>() as u32,
        hwndOwner: owner,
        Flags: PD_RETURNDC | PD_USEDEVMODECOPIESANDCOLLATE | PD_NOSELECTION,
        nPageRanges: 0,
        nMaxPageRanges: ranges.len() as u32,
        lpPageRanges: ranges.as_mut_ptr(),
        nMinPage: 1,
        nMaxPage: page_count.max(1),
        nCopies: 1,
        nStartPage: START_PAGE_GENERAL,
        ..Default::default()
    };
    let hr = unsafe { PrintDlgExW(&mut dlg) };
    let free = |dlg: &PRINTDLGEXW| unsafe {
        if !dlg.hDevMode.is_invalid() {
            let _ = GlobalFree(Some(HGLOBAL(dlg.hDevMode.0)));
        }
        if !dlg.hDevNames.is_invalid() {
            let _ = GlobalFree(Some(HGLOBAL(dlg.hDevNames.0)));
        }
    };
    free(&dlg);
    if com.is_ok() {
        unsafe { CoUninitialize() };
    }
    hr.map_err(|e| FileError::other(format!("the print dialog failed: {e}")))?;

    if dlg.dwResultAction != PD_RESULT_PRINT {
        if !dlg.hDC.is_invalid() {
            unsafe {
                let _ = DeleteDC(dlg.hDC);
            }
        }
        return Ok(None);
    }
    let pages = if dlg.Flags.contains(PD_PAGENUMS) {
        let picked: Vec<(u32, u32)> = ranges[..dlg.nPageRanges as usize]
            .iter()
            .map(|r| (r.nFromPage, r.nToPage))
            .collect();
        expand_ranges(&picked, page_count)
    } else if dlg.Flags.contains(PD_CURRENTPAGE) {
        vec![current_page.min(page_count.saturating_sub(1))]
    } else {
        (0..page_count).collect()
    };
    Ok(Some(Choice {
        hdc: dlg.hDC,
        pages,
    }))
}

fn spool(
    pdfium: &Pdfium,
    doc: Doc,
    choice: &Choice,
    options: &PrintOptions,
) -> Result<PrintOutcome, FileError> {
    let hdc = choice.hdc;
    let caps = |i| unsafe { GetDeviceCaps(Some(hdc), i) };
    let dev = Device {
        dpi_x: caps(LOGPIXELSX) as f64,
        dpi_y: caps(LOGPIXELSY) as f64,
        paper_w: caps(PHYSICALWIDTH),
        paper_h: caps(PHYSICALHEIGHT),
        offset_x: caps(PHYSICALOFFSETX),
        offset_y: caps(PHYSICALOFFSETY),
        printable_w: caps(HORZRES),
        printable_h: caps(VERTRES),
    };
    if dev.dpi_x <= 0.0 || dev.printable_w <= 0 {
        return Err(FileError::other("the printer did not report its page size"));
    }

    let name: Vec<u16> = options.title.encode_utf16().chain(Some(0)).collect();
    let info = DOCINFOW {
        cbSize: std::mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: PCWSTR(name.as_ptr()),
        ..Default::default()
    };
    if unsafe { StartDocW(hdc, &info) } <= 0 {
        return Err(FileError::other("the printer refused the job"));
    }
    let mut printed = 0;
    for &index in &choice.pages {
        let ok = unsafe {
            let page = (pdfium.load_page)(doc, index as c_int);
            if page.is_null() || StartPage(hdc) <= 0 {
                if !page.is_null() {
                    (pdfium.close_page)(page);
                }
                false
            } else {
                let p = place(
                    (pdfium.page_width)(page) as f64,
                    (pdfium.page_height)(page) as f64,
                    &dev,
                    options.scaling,
                    options.auto_rotate,
                );
                (pdfium.render_page)(
                    hdc.0,
                    page,
                    p.x,
                    p.y,
                    p.w,
                    p.h,
                    p.rotate,
                    FPDF_ANNOT | FPDF_PRINTING,
                );
                (pdfium.close_page)(page);
                EndPage(hdc) > 0
            }
        };
        if !ok {
            unsafe { AbortDoc(hdc) };
            return Err(FileError::other(format!(
                "printing stopped at page {}",
                index + 1
            )));
        }
        printed += 1;
    }
    unsafe { EndDoc(hdc) };
    Ok(PrintOutcome {
        status: "printed",
        pages: printed,
    })
}
