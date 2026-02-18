import React from "react";
import { createRoot } from "react-dom/client";
import ChatPage from "./pages/ChatPage";
import ContextsPage from "./pages/ContextsPage";
import RulesCommandsPage from "./pages/RulesCommandsPage";
import "./index.css";

const page = window.__PAGE__ || "chat";

function App() {
  return (
    <div className="app">
      <nav className="nav">
        <img src="/mandarin-logo.png" alt="Mandarin" className="app-title" />
        <a href="/">Chat</a>
        <a href="/contexts">Contexts</a>
        <a href="/rules">Rules &amp; Commands</a>
      </nav>
      <main className="main">
        {page === "chat" && <ChatPage />}
        {page === "contexts" && <ContextsPage />}
        {page === "rules" && <RulesCommandsPage />}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
