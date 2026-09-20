import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DownloadPage } from "./DownloadPage";
import "@frame/ui/styles.css";
import "./landing.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
