import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import labels from "./config/labels.json";
import "./styles/index.css";
import App from "./components/MainContent.tsx";

document.title = labels.metadata.title;
document.querySelector('meta[name="description"]')?.setAttribute("content", labels.metadata.description);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Analytics />
    <SpeedInsights />
  </StrictMode>,
);
