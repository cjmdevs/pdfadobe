//! Where a PDF page lands on the printed sheet. Pure math, tested on every platform.
//!
//! Matches Acrobat's defaults: "Shrink oversized pages", auto-rotate to the paper's
//! orientation, centered. All device values are printer pixels from GetDeviceCaps.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Scaling {
    /// Scale every page up or down to fill the printable area.
    Fit,
    /// Only shrink pages that do not fit; print the rest at 100%. Acrobat's default.
    #[default]
    ShrinkOversized,
    /// Always 100%; oversized pages are clipped.
    ActualSize,
}

#[derive(Debug, Clone, Copy)]
pub struct Device {
    pub dpi_x: f64,
    pub dpi_y: f64,
    pub paper_w: i32,
    pub paper_h: i32,
    /// Top-left of the printable area on the paper (PHYSICALOFFSETX/Y).
    pub offset_x: i32,
    pub offset_y: i32,
    /// Printable area (HORZRES/VERTRES). The DC origin is its top-left corner.
    pub printable_w: i32,
    pub printable_h: i32,
}

/// Arguments for FPDF_RenderPage, in DC coordinates (origin = printable top-left).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// FPDF rotate: 0 = none, 3 = 90 degrees counter-clockwise (Windows "landscape").
    pub rotate: i32,
}

pub fn place(
    page_w_pt: f64,
    page_h_pt: f64,
    dev: &Device,
    scaling: Scaling,
    auto_rotate: bool,
) -> Placement {
    let mut w = page_w_pt / 72.0 * dev.dpi_x;
    let mut h = page_h_pt / 72.0 * dev.dpi_y;
    let page_landscape = page_w_pt > page_h_pt;
    let paper_landscape = dev.printable_w > dev.printable_h;
    let rotate = if auto_rotate && page_w_pt != page_h_pt && page_landscape != paper_landscape {
        // Swap in device units, correcting for non-square DPI.
        let (rw, rh) = (page_h_pt / 72.0 * dev.dpi_x, page_w_pt / 72.0 * dev.dpi_y);
        w = rw;
        h = rh;
        3
    } else {
        0
    };

    let fit = (dev.printable_w as f64 / w).min(dev.printable_h as f64 / h);
    let s = match scaling {
        Scaling::Fit => fit,
        Scaling::ShrinkOversized => fit.min(1.0),
        Scaling::ActualSize => 1.0,
    };
    let (w, h) = (w * s, h * s);

    // Center on the paper; if that would cut into a hardware margin, center within the
    // printable area instead (uneven margins).
    let x = center(w, dev.paper_w, dev.offset_x, dev.printable_w);
    let y = center(h, dev.paper_h, dev.offset_y, dev.printable_h);
    Placement {
        x: x.round() as i32,
        y: y.round() as i32,
        w: w.round() as i32,
        h: h.round() as i32,
        rotate,
    }
}

fn center(size: f64, paper: i32, offset: i32, printable: i32) -> f64 {
    let on_paper = (paper as f64 - size) / 2.0 - offset as f64;
    let fits_printable = size <= printable as f64;
    if fits_printable && (on_paper < 0.0 || on_paper + size > printable as f64) {
        (printable as f64 - size) / 2.0
    } else {
        on_paper
    }
}

/// "1-3,5" (1-based, as typed in a print dialog) → 0-based page indexes, clamped to the doc.
pub fn expand_ranges(ranges: &[(u32, u32)], page_count: u32) -> Vec<u32> {
    let mut out = Vec::new();
    for &(from, to) in ranges {
        let (a, b) = if from <= to { (from, to) } else { (to, from) };
        for p in a.max(1)..=b.min(page_count) {
            out.push(p - 1);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Letter paper at 600 dpi with 1/6 inch (100 px) hardware margins.
    fn letter_600() -> Device {
        Device {
            dpi_x: 600.0,
            dpi_y: 600.0,
            paper_w: 5100,
            paper_h: 6600,
            offset_x: 100,
            offset_y: 100,
            printable_w: 4900,
            printable_h: 6400,
        }
    }

    #[test]
    fn shrinks_a_letter_page_to_the_printable_area() {
        let p = place(612.0, 792.0, &letter_600(), Scaling::ShrinkOversized, true);
        assert_eq!(p.rotate, 0);
        // 5100x6600 does not fit 4900x6400: scale = min(4900/5100, 6400/6600) = 0.9608.
        assert_eq!((p.w, p.h), (4900, 6341));
        assert_eq!((p.x, p.y), (0, 29)); // (6400 - 6341.18) / 2
    }

    #[test]
    fn small_pages_stay_actual_size_and_centered_on_paper() {
        // Half-letter page on letter paper: no shrink, centered on the physical sheet.
        let p = place(396.0, 612.0, &letter_600(), Scaling::ShrinkOversized, true);
        assert_eq!((p.w, p.h), (3300, 5100));
        assert_eq!(
            (p.x, p.y),
            ((5100 - 3300) / 2 - 100, (6600 - 5100) / 2 - 100)
        );
    }

    #[test]
    fn fit_enlarges_small_pages() {
        let p = place(306.0, 396.0, &letter_600(), Scaling::Fit, true);
        assert_eq!(p.w, 4900);
    }

    #[test]
    fn auto_rotates_landscape_pages_onto_portrait_paper() {
        let p = place(792.0, 612.0, &letter_600(), Scaling::ShrinkOversized, true);
        assert_eq!(p.rotate, 3);
        assert!(p.h > p.w, "rotated output is tall: {p:?}");
        let no_rotate = place(792.0, 612.0, &letter_600(), Scaling::ShrinkOversized, false);
        assert_eq!(no_rotate.rotate, 0);
        assert!(no_rotate.w > no_rotate.h);
    }

    #[test]
    fn actual_size_never_scales() {
        let p = place(612.0, 1008.0, &letter_600(), Scaling::ActualSize, true);
        assert_eq!((p.w, p.h), (5100, 8400));
    }

    #[test]
    fn expands_page_ranges() {
        assert_eq!(expand_ranges(&[(1, 3), (5, 5)], 10), vec![0, 1, 2, 4]);
        assert_eq!(expand_ranges(&[(8, 20)], 10), vec![7, 8, 9]);
        assert_eq!(expand_ranges(&[(3, 1)], 10), vec![0, 1, 2]);
    }
}
