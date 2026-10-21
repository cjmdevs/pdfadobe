import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Throwaway Phase 0 spike route. Remove with the spike.
const SpikePage = lazy(() => import("./spike/SpikePage"));

function Root() {
  const [hash, setHash] = React.useState(window.location.hash);
  React.useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  if (hash === "#/spike") {
    return (
      <Suspense fallback={<p>Loading spike…</p>}>
        <SpikePage />
      </Suspense>
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
