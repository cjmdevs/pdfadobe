// Home screen (backlog B2): shown at launch, after the last tab closes, and from the
// Home tab. Open, a drop zone, quick tools from the registry, and Recent Files with a
// page-1 thumbnail, folder and last-opened time. Files on a share that cannot be reached
// show greyed out ("Offline"), not as an error.
import { useEffect, useMemo, useState } from "react";
import { baseName, platform, type PathStatus } from "../platform";
import { useWorkbench } from "../app/workbench";
import {
  clearRecent,
  displayOrder,
  folderOf,
  removeRecentFile,
  setPinned,
  MAX_PINNED,
  type RecentFile,
} from "../app/recent";
import { TOOLS, isBuilt, type ToolDef } from "../tools/registry";
import { useNoDocToolContext } from "../tools/useToolContext";
import { Icon } from "./Icon";

export function StartPage() {
  const wb = useWorkbench();
  const { settings, pickAndOpen } = wb;
  const ctx = useNoDocToolContext();
  const quick = TOOLS.filter((t) => t.home && isBuilt(t));

  const runTool = (t: ToolDef) => {
    if (t.needsDocument === false && t.open !== "toolbar") t.open(ctx);
    else void pickAndOpen({ tool: t.id });
  };

  return (
    <div className="start" data-testid="start-page">
      <div className="start-card">
        <h1>PDF Workbench</h1>
        <div className="home-open">
          <button type="button" className="primary big" onClick={() => void pickAndOpen()}>
            <Icon name="open" /> Open…
          </button>
          <button
            type="button"
            className="home-drop"
            data-testid="home-drop"
            onClick={() => void pickAndOpen()}
          >
            Drop PDF files here
          </button>
        </div>
        {quick.length > 0 && (
          <>
            <h2>Quick tools</h2>
            <ul className="home-tools" aria-label="Quick tools">
              {quick.map((t) => (
                <li key={t.id}>
                  <button type="button" title={t.description} onClick={() => runTool(t)}>
                    <span className="tool-icon" style={{ color: t.color }}>
                      <Icon name={t.icon} />
                    </span>
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <RecentFiles list={settings.recent} />
      </div>
    </div>
  );
}

function RecentFiles({ list }: { list: RecentFile[] }) {
  const wb = useWorkbench();
  const { settings, changeRecent, openPaths, confirm, toast } = wb;
  const status = usePathStatus(list.map((e) => e.path));

  const clearAll = async () => {
    const ok = await confirm({
      title: "Clear recent files?",
      message:
        "This removes every file from the list, pinned ones too, and deletes their thumbnails. The files themselves are not touched.",
      ok: "Clear all",
      danger: true,
    });
    if (ok) changeRecent(clearRecent);
  };

  // Offline: check again quietly, no error dialog. A missing file goes through the normal
  // open, whose "can't open" dialog offers to remove it from the list.
  const open = async (e: RecentFile) => {
    if (status.get(e.path) === "offline") {
      const [now] = await status.recheck(e.path);
      if (now === "offline") {
        toast(`${baseName(e.path)} is still offline. Check the network connection and try again.`);
        return;
      }
    }
    void openPaths([e.path]);
  };

  const pin = (e: RecentFile) => {
    if (!e.pinned && list.filter((x) => x.pinned).length >= MAX_PINNED) {
      toast(`Up to ${MAX_PINNED} files can be pinned. Unpin one first.`, "error");
      return;
    }
    changeRecent((l) => setPinned(l, e.path, !e.pinned));
  };

  return (
    <>
      <div className="home-recent-head">
        <h2>Recent files</h2>
        {list.length > 0 && (
          <button type="button" className="link" onClick={() => void clearAll()}>
            Clear all
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted">No recent files.</p>
      ) : (
        <ul className="recent" aria-label="Recent files">
          {displayOrder(list).map((e) => {
            const s = status.get(e.path);
            const away = s === "offline" || s === "missing";
            const name = baseName(e.path);
            return (
              <li key={e.path} className={away ? "away" : undefined} data-status={s ?? "checking"}>
                <button
                  type="button"
                  className="recent-open"
                  title={e.path}
                  aria-label={away ? `${name}, ${s === "offline" ? "offline" : "not found"}` : name}
                  onClick={() => void open(e)}
                >
                  {settings.recentThumbnails && <Thumb id={e.thumb} />}
                  <span className="recent-text">
                    <span className="recent-name">
                      {e.pinned && <Icon name="pin" size={12} />} {name}
                    </span>
                    <span className="recent-path muted small">{folderOf(e.path)}</span>
                    <span className="recent-when muted small">
                      {away ? (
                        <span className="recent-away">
                          <Icon name={s === "offline" ? "offline" : "fileMissing"} size={12} />
                          {s === "offline" ? "Offline" : "Not found"}
                        </span>
                      ) : (
                        lastOpened(e.opened)
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="tool"
                  aria-pressed={e.pinned}
                  aria-label={`${e.pinned ? "Unpin" : "Pin"} ${name}`}
                  title={e.pinned ? "Unpin" : "Pin to the top"}
                  onClick={() => pin(e)}
                >
                  <Icon name={e.pinned ? "unpin" : "pin"} size={16} />
                </button>
                <button
                  type="button"
                  className="tool"
                  aria-label={`Remove ${name} from recent files`}
                  title="Remove from the list"
                  onClick={() => changeRecent((l) => removeRecentFile(l, e.path))}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Thumbnail from the Local AppData cache; a plain page icon when there is none. */
function Thumb({ id }: { id: string | null }) {
  const [shown, setShown] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    let made: string | null = null;
    void platform.thumbs.get(id).then((bytes) => {
      if (!live || !bytes) return;
      made = URL.createObjectURL(new Blob([bytes.slice()], { type: "image/jpeg" }));
      setShown({ id, url: made });
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  const url = shown && shown.id === id ? shown.url : null;
  return (
    <span className="recent-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" /> : <Icon name="file" />}
    </span>
  );
}

/** Reachability of each recent file, checked when the list changes. */
function usePathStatus(paths: string[]) {
  const key = paths.join("\n");
  const [map, setMap] = useState<Map<string, PathStatus>>(new Map());
  useEffect(() => {
    let live = true;
    const list = key ? key.split("\n") : [];
    void platform.pathStatus(list).then((res) => {
      if (live) setMap(new Map(list.map((p, i) => [p, res[i] ?? "ok"])));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return useMemo(
    () => ({
      get: (p: string) => map.get(p),
      recheck: async (p: string) => {
        const res = await platform.pathStatus([p]);
        setMap((m) => new Map(m).set(p, res[0] ?? "ok"));
        return res;
      },
    }),
    [map],
  );
}

/** "Today, 3:14 PM", "Yesterday, 9:02 AM", "Oct 30, 2026". */
export function lastOpened(ms: number, now = new Date()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function Toasts() {
  const { toasts } = useWorkbench();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.tone}`}
          role={t.tone === "error" ? "alert" : "status"}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
