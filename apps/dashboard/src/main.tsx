import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { dashboardFixture } from "./fixtures";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App {...(import.meta.env.DEV ? { fallbackSnapshot: dashboardFixture } : {})} />
  </StrictMode>,
);
