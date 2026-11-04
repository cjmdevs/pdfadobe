// First-run setup (Phase 10a): author name, firm library folder, default PDF program.
// Windows does not let an app make itself the default, so step 3 opens Windows'
// Default apps page at PDF Workbench and walks the person through it, then checks.
import { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "../app/workbench";
import { LIBRARY_FILES, joinPath, libraryPaths } from "../app/firstRun";
import { platform } from "../platform";
import { readFirmTickmarks } from "./flyer/flyerFiles";
import { parseFirmLayout } from "../tools/registry";
import { Modal, ModalActions } from "./kit/Dialog";

type Step = 1 | 2 | 3;

export function FirstRunDialog({
  onClose,
  startAt = 1,
}: {
  onClose: () => void;
  /** Settings reopens the default-app step on its own. */
  startAt?: Step;
}) {
  const wb = useWorkbench();
  const [step, setStep] = useState<Step>(startAt);
  const [name, setName] = useState(wb.settings.authorName ?? wb.osUserName ?? "");
  const [library, setLibrary] = useState(wb.settings.firmLibraryPath ?? "");
  const [libNote, setLibNote] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [opened, setOpened] = useState(false);

  const finish = () => {
    wb.updateSettings({ firstRunDone: true });
    onClose();
  };

  const saveName = () => {
    const authorName = name.trim() || null;
    if (authorName !== wb.settings.authorName) wb.updateSettings({ authorName });
  };

  /** Sets the firm paths from the folder and loads what is there. */
  const saveLibrary = async (): Promise<boolean> => {
    const folder = library.trim();
    if (!folder) {
      wb.updateSettings({ firmLibraryPath: null });
      return true;
    }
    const paths = libraryPaths(folder);
    const found: string[] = [];
    const patch: Parameters<typeof wb.updateSettings>[0] = {
      firmLibraryPath: folder,
      firmFontsPath: paths.firmFontsPath,
    };
    try {
      const firm = await readFirmTickmarks(paths.firmTickmarksPath);
      Object.assign(patch, {
        firmTickmarksPath: paths.firmTickmarksPath,
        firmTickmarksCache: firm.tickmarks,
        firmStampsCache: firm.stamps,
      });
      found.push(LIBRARY_FILES.tickmarks);
    } catch {
      /* not there (yet) */
    }
    try {
      const file = await platform.readPath(paths.firmLayoutPath);
      Object.assign(patch, {
        firmLayoutPath: paths.firmLayoutPath,
        firmLayoutCache: parseFirmLayout(new TextDecoder().decode(file.bytes)),
      });
      found.push(LIBRARY_FILES.layout);
    } catch {
      /* not there (yet) */
    }
    const [fonts] = await platform.pathStatus([paths.firmFontsPath]).catch(() => ["offline"]);
    if (fonts === "ok") found.push(`${LIBRARY_FILES.fonts}\\`);
    if (found.length === 0) {
      const [dir] = await platform.pathStatus([folder]).catch(() => ["offline"]);
      setLibNote(
        dir === "ok"
          ? `That folder has none of ${LIBRARY_FILES.tickmarks}, ${LIBRARY_FILES.layout} or ${LIBRARY_FILES.fonts}\\. Check the path with your administrator, or leave it blank.`
          : "That folder can't be reached. Check the path, or leave it blank for now.",
      );
      return false;
    }
    wb.updateSettings(patch);
    setLibNote(`Found ${found.join(", ")}.`);
    return true;
  };

  const recheck = useCallback(() => {
    void platform.app.isDefaultPdfApp().then(setIsDefault);
  }, []);

  // Coming back from Settings: check again.
  useEffect(() => {
    if (step !== 3) return;
    recheck();
    const onFocus = () => recheck();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [step, recheck]);

  return (
    <Modal
      title={startAt === 3 ? "Make PDF Workbench your PDF program" : "Set up PDF Workbench"}
      onClose={finish}
      closeLabel={step === 3 ? "Done" : "Skip setup"}
    >
      <div className="first-run" data-testid="first-run" data-step={step}>
        {startAt !== 3 && <p className="hint">Step {step} of 3</p>}
        {step === 1 && (
          <>
            <h3>Your name</h3>
            <p>Comments, tickmarks and sign-off stamps you add are signed with this name.</p>
            <label className="settings-row">
              <span>Author name</span>
              <input
                aria-label="Author name"
                value={name}
                maxLength={100}
                autoFocus
                placeholder={wb.osUserName ?? "Your name"}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <ModalActions>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  saveName();
                  setStep(2);
                }}
              >
                Next
              </button>
            </ModalActions>
          </>
        )}
        {step === 2 && (
          <>
            <h3>Firm library folder</h3>
            <p>
              The folder on the firm's share that holds the firm tickmarks (
              <code>{LIBRARY_FILES.tickmarks}</code>), toolbar layout (
              <code>{LIBRARY_FILES.layout}</code>) and fonts (<code>{LIBRARY_FILES.fonts}\</code>).
              Ask your administrator if you don't know it. You can leave it blank.
            </p>
            <div className="settings-row">
              <input
                aria-label="Firm library folder"
                value={library}
                maxLength={1000}
                placeholder="\\server\share\PDF Workbench"
                onChange={(e) => {
                  setLibrary(e.target.value);
                  setLibNote(null);
                }}
              />
              <button
                type="button"
                onClick={() =>
                  void platform.pickFolder().then((p) => {
                    if (p) {
                      setLibrary(p);
                      setLibNote(null);
                    }
                  })
                }
              >
                Browse…
              </button>
            </div>
            {library.trim() && (
              <p className="hint">
                Uses {joinPath(library, LIBRARY_FILES.tickmarks)} and the files next to it.
              </p>
            )}
            {libNote && (
              <p className="hint" role="status" data-testid="library-note">
                {libNote}
              </p>
            )}
            <ModalActions>
              <button type="button" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="primary"
                onClick={() =>
                  void saveLibrary().then((ok) => {
                    if (ok) setStep(3);
                  })
                }
              >
                Next
              </button>
            </ModalActions>
          </>
        )}
        {step === 3 && (
          <>
            <h3>Open PDFs with PDF Workbench</h3>
            <p>
              Windows only lets <em>you</em> choose the program that opens PDF files, so PDF
              Workbench can't do it for you. It takes four clicks:
            </p>
            <ol className="steps">
              <li>
                Click <strong>Open Windows Settings</strong> below. The Default apps page for PDF
                Workbench opens.
              </li>
              <li>
                Next to <strong>.pdf</strong>, click the program shown there now (for example Adobe
                Acrobat or Microsoft Edge).
              </li>
              <li>
                Pick <strong>PDF Workbench</strong> in the list and click{" "}
                <strong>Set default</strong>.
              </li>
              <li>Close Settings and come back here.</li>
            </ol>
            <p data-testid="default-status" data-default={String(isDefault)}>
              {isDefault === true
                ? "Done: PDF files now open in PDF Workbench."
                : isDefault === false
                  ? opened
                    ? "PDF files still open in another program. Try the steps again, or click Done to keep it that way."
                    : "PDF files open in another program now."
                  : "Windows doesn't say which program opens PDF files."}
            </p>
            <p className="hint">
              You can change this later in Windows Settings, or from Settings in PDF Workbench.
              Adobe Acrobat stays installed and still opens from "Open in Acrobat".
            </p>
            <ModalActions>
              {startAt !== 3 && (
                <button type="button" onClick={() => setStep(2)}>
                  Back
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={isDefault === true}
                onClick={() => {
                  setOpened(true);
                  void platform.app
                    .openDefaultAppsSettings()
                    .catch((e: unknown) =>
                      wb.toast(
                        `Could not open Windows Settings: ${e instanceof Error ? e.message : String(e)}`,
                        "error",
                        { path: null },
                      ),
                    );
                }}
              >
                Open Windows Settings
              </button>
            </ModalActions>
          </>
        )}
      </div>
    </Modal>
  );
}
