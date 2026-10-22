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
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  extract: "M6 3h8l4 4v6M14 3v4h4M6 3v18h7M15 17h6M18 14l3 3-3 3",
  duplicate: "M8 8h12v13H8zM4 16V3h12",
  blank: "M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6",
  insert: "M6 3h8l4 4v14H6zM14 3v4h4M9 14h6M12 11l3 3-3 3",
  replace: "M4 7h11M12 4l3 3-3 3M20 17H9M12 14l-3 3 3 3",
  crop: "M6 2v16h16M2 6h16v16",
  pageSize: "M5 3h14v18H5zM9 7h6M9 17h6M12 7v10",
  split: "M4 4h7v16H4zM13 4h7v16h-7",
  organize: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  save: "M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7",
  combine: "M3 4h7v7H3zM3 13h7v7H3zM14 8h7v8h-7zM10 7.5h2v9h-2",
  bookmarkAdd: "M6 3h12v18l-6-4-6 4zM12 7v6M9 10h6",
  rename: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5v1",
  deletePages: "M6 3h8l4 4v14H6zM14 3v4h4M9 12l6 6M15 12l-6 6",
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
