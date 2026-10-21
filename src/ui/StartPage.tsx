import { baseName } from "../platform";
import { useForgetRecent, useWorkbench } from "../app/workbench";
import { Icon } from "./Icon";

export function StartPage() {
  const { settings, pickAndOpen, openPaths } = useWorkbench();
  const forget = useForgetRecent();
  return (
    <div className="start" data-testid="start-page">
      <div className="start-card">
        <h1>PDF Workbench</h1>
        <p className="muted">Open a PDF, drag files here, or pick a recent file.</p>
        <button type="button" className="primary big" onClick={() => void pickAndOpen()}>
          <Icon name="open" /> Open…
        </button>
        <h2>Recent files</h2>
        {settings.recent.length === 0 ? (
          <p className="muted">No recent files.</p>
        ) : (
          <ul className="recent" aria-label="Recent files">
            {settings.recent.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="recent-open"
                  title={p}
                  onClick={() => void openPaths([p])}
                >
                  <span className="recent-name">{baseName(p)}</span>
                  <span className="recent-path muted small">{p}</span>
                </button>
                <button
                  type="button"
                  className="tool"
                  aria-label={`Remove ${baseName(p)} from recent files`}
                  onClick={() => forget(p)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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
