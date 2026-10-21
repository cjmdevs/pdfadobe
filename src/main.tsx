import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getEngine } from "./app/engine";
import { sanitizeSettings } from "./app/settings";
import { platform } from "./platform";
import "./styles.css";

// Load settings before the first render so the initial zoom, theme and layout are right.
const settings = sanitizeSettings(await platform.loadSettings().catch(() => null));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App engine={getEngine()} settings={settings} />
  </React.StrictMode>,
);
