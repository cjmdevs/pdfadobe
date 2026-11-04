import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getEngine } from "./app/engine";
import { sanitizeSettings } from "./app/settings";
import { platform } from "./platform";
import { installCrashHandlers } from "./app/crash";
import { CrashBoundary } from "./ui/CrashScreen";
import "./ui/theme/tokens.css";
import "./ui/theme/base.css";
import "./styles.css";

// No native (HTML5) drag-and-drop inside the app: in the Windows app Tauri takes over
// OS drags (dragDropEnabled), so dragging a page image or selected text showed a
// "not allowed" cursor and cut off the pointer stroke (drawing, shapes). Every in-app
// drag uses pointer events instead; files dropped from Explorer still arrive.
window.addEventListener("dragstart", (e) => e.preventDefault(), true);

// Local crash reports (Phase 10a): uncaught errors and rejections, and render errors
// through CrashBoundary. Nothing leaves the computer.
const version = await platform.app.version().catch(() => "unknown");
const recordCrash = installCrashHandlers(window, version, (text) => platform.app.writeCrash(text));

// Load settings before the first render so the initial zoom, theme and layout are right.
const settings = sanitizeSettings(await platform.loadSettings().catch(() => null));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CrashBoundary onCrash={(e) => recordCrash("render", e)}>
      <App engine={getEngine()} settings={settings} />
    </CrashBoundary>
  </React.StrictMode>,
);
