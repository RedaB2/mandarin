import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ChatPage from "./pages/ChatPage";
import ContextsPage from "./pages/ContextsPage";
import RulesCommandsPage from "./pages/RulesCommandsPage";
import SettingsPage from "./pages/SettingsPage";
import "./index.css";

const page = window.__PAGE__ || "chat";
const STORAGE_KEY = "mandarin-dark-mode";

function App() {
  const [dark, setDark] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "false");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dark));
    } catch {}
  }, [dark]);

  return (
    <div className="app">
      <nav className="nav">
        <a href="/" className="nav-logo-link" aria-label="Mandarin home">
          <img src="/mandarin-logo.png" alt="Mandarin" className="app-title" />
        </a>
        <a href="/">Chat</a>
        <a href="/contexts">Contexts</a>
        <a href="/rules">Rules &amp; Commands</a>
        <a href="/settings">Settings</a>
        <button
          type="button"
          className="nav-theme-toggle"
          onClick={() => setDark((d) => !d)}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? "☀️" : "🌙"}
        </button>
      </nav>
      <main className="main">
        {page === "chat" && <ChatPage />}
        {page === "contexts" && <ContextsPage />}
        {page === "rules" && <RulesCommandsPage />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
