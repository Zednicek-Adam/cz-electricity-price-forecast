import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { loadDashboard } from "./dashboard.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");

// The whole record arrives in one file, before the first render, so nothing on
// the page ever waits on the network after that.
try {
  const data = await loadDashboard();
  createRoot(root).render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  );
} catch (error) {
  root.textContent = "The dashboard's data could not be loaded.";
  throw error;
}
