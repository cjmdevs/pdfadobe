// Help (B8, F1 or Help > Help topics): one page per feature, in plain language, built into
// the app (no network). Topics on the left with a filter, the page on the right.
import { useMemo, useState } from "react";
import { searchItems } from "../../app/commandSearch";
import { useWorkbench } from "../../app/workbench";
import { Modal } from "../kit/Dialog";
import { HELP_TOPICS } from "./topics";

export function HelpDialog({
  onClose,
  topic,
}: {
  onClose: () => void;
  topic?: string | undefined;
}) {
  const wb = useWorkbench();
  const [id, setId] = useState(topic ?? HELP_TOPICS[0]?.id ?? "");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    if (!q.trim()) return HELP_TOPICS;
    const hits = searchItems(
      q,
      HELP_TOPICS.map((t) => ({
        kind: "help" as const,
        id: t.id,
        label: t.title,
        where: t.summary,
        keywords: `${t.keywords} ${t.sections.map((s) => s.heading).join(" ")}`,
      })),
      50,
    );
    return hits.flatMap((h) => HELP_TOPICS.filter((t) => t.id === h.id));
  }, [q]);
  const page = HELP_TOPICS.find((t) => t.id === id) ?? HELP_TOPICS[0];
  return (
    <Modal title="Help" onClose={onClose} wide>
      <div className="help">
        <nav className="help-nav" aria-label="Help topics">
          <input
            type="search"
            aria-label="Filter help topics"
            placeholder="Filter topics"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul>
            {shown.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={t.id === page?.id ? "page" : undefined}
                  className={t.id === page?.id ? "active" : undefined}
                  onClick={() => setId(t.id)}
                >
                  {t.title}
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted pad">No topics match.</li>}
          </ul>
          <button
            type="button"
            className="link"
            onClick={() => wb.setDialog({ kind: "shortcuts" })}
          >
            Keyboard shortcuts
          </button>
        </nav>
        {page && (
          <article className="help-page" data-testid="help-page" aria-label={page.title}>
            <h3>{page.title}</h3>
            <p className="help-summary">{page.summary}</p>
            {page.sections.map((s) => (
              <section key={s.heading}>
                <h4>{s.heading}</h4>
                {s.text && <p>{s.text}</p>}
                {s.steps && (
                  <ol>
                    {s.steps.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ol>
                )}
                {s.tips && (
                  <ul>
                    {s.tips.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </article>
        )}
      </div>
    </Modal>
  );
}
