// Shown when the UI itself fails (React render error), Phase 10a. A report was saved
// locally (src/app/crash.ts). Every open file can still be opened in Acrobat.
import { Component, type ReactNode } from "react";
import { getOpenFiles } from "../app/crash";
import { baseName, platform } from "../platform";
import { AcrobatButton } from "./kit/AcrobatButton";

export class CrashBoundary extends Component<
  { children: ReactNode; onCrash: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onCrash(error);
  }

  override render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

function CrashScreen() {
  const files = getOpenFiles();
  return (
    <div className="center-message crash-screen" role="alert" data-testid="crash-screen">
      <h2>PDF Workbench ran into a problem</h2>
      <p>
        A crash report was saved on this computer (it holds no document text and was not sent
        anywhere). Changes you had not saved may be lost; your files on disk were not changed.
      </p>
      {files.length > 0 && (
        <>
          <p>Open a file in Adobe Acrobat to keep working:</p>
          <ul className="crash-files">
            {files.map((f) => (
              <li key={f}>
                <span title={f}>{baseName(f)}</span> <AcrobatButton path={f} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="button-row">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Restart PDF Workbench
        </button>
        <button type="button" onClick={() => void platform.app.openCrashFolder()}>
          Show crash reports
        </button>
      </div>
    </div>
  );
}
