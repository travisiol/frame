import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./App";
import "@frame/ui/styles.css";
import "./landing.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
