// Minimal inline SVG icon set (24x24, stroke = currentColor). No icon font, no network.
const PATHS: Record<string, string> = {
  open: "M3 7h6l2 2h10v10H3z",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  sidebar: "M3 4h18v16H3zM9 4v16",
  first: "M7 5v14M18 6l-7 6 7 6",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  last: "M17 5v14M6 6l7 6-7 6",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6",
  fitPage: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4",
  fitWidth: "M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3",
  actual: "M5 5h14v14H5zM9 15V9l-1 1M14 15V9l-1 1",
  rotateCw: "M20 11a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  rotateCcw: "M4 11a8 8 0 1 0 2.3-5.7M4 4v5h5",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM20 20l-5.5-5.5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
  theme: "M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z",
  close: "M6 6l12 12M18 6L6 18",
  keyboard: "M3 6h18v12H3zM7 10h1M11 10h1M15 10h1M7 14h10",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  paperclip:
    "M16 7l-7.5 7.5a2 2 0 0 0 2.8 2.8L19 9.6a4 4 0 0 0-5.7-5.7L5.6 11.6a6 6 0 0 0 8.5 8.5L20 14",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
