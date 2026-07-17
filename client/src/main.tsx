import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Last-resort fallback: if anything throws before/while React mounts (a
// blocked API in a restrictive embed context, a module-init error, etc.),
// show a visible message instead of leaving a silent blank white page.
// This is deliberately dependency-free — it must work even if the rest of
// the app's module graph failed to evaluate.
function renderFatalError(detail: string) {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#f7f6f3;color:#1a1a1a;">
      <div style="max-width:420px;text-align:center;">
        <div style="font-weight:700;font-size:18px;margin-bottom:8px;">Forge couldn't load</div>
        <div style="font-size:14px;color:#666;margin-bottom:16px;">Something went wrong while starting the app. Reloading usually fixes this.</div>
        <button onclick="window.location.reload()" style="padding:8px 16px;border-radius:8px;border:none;background:#1a1a1a;color:white;font-size:14px;cursor:pointer;">Reload</button>
        <div style="font-size:11px;color:#999;margin-top:16px;word-break:break-all;">${detail}</div>
      </div>
    </div>
  `;
}

window.addEventListener("error", (e) => {
  if (!document.getElementById("root")?.hasChildNodes()) {
    renderFatalError(e.message || "Unknown error");
  }
});
window.addEventListener("unhandledrejection", (e) => {
  if (!document.getElementById("root")?.hasChildNodes()) {
    renderFatalError(String(e.reason?.message || e.reason || "Unknown error"));
  }
});

try {
  if (!window.location.hash) {
    window.location.hash = "#/";
  }
  createRoot(document.getElementById("root")!).render(<App />);
} catch (err: any) {
  renderFatalError(err?.message || String(err));
}
