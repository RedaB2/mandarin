import React, { useState, useEffect } from "react";
import { getSettings, putSettings, getModels } from "../api/client";

const PROVIDER_LABELS = {
  openai: "OpenAI (GPT)",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  tavily: "Tavily (Web Search)",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [defaultModel, setDefaultModel] = useState("");
  const [apiKeyDrafts, setApiKeyDrafts] = useState({ openai: "", anthropic: "", google: "", tavily: "" });
  const [showKeyInput, setShowKeyInput] = useState({ openai: false, anthropic: false, google: false, tavily: false });

  useEffect(() => {
    Promise.all([getSettings(), getModels()])
      .then(([settingsData, modelsData]) => {
        setSettings(settingsData);
        const available = (modelsData || []).filter((m) => m.available);
        setModels(available);
        setDefaultModel(settingsData.default_model || "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveDefaultModel = () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    putSettings({ default_model: defaultModel || null })
      .then((data) => {
        setSettings(data);
        setSuccess("Default model saved.");
        setTimeout(() => setSuccess(null), 3000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const handleSaveApiKey = (provider) => {
    const value = (apiKeyDrafts[provider] || "").trim();
    setSaving(true);
    setError(null);
    setSuccess(null);
    putSettings({
      api_keys: { [provider]: value },
    })
      .then((data) => {
        setSettings(data);
        setApiKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
        setShowKeyInput((prev) => ({ ...prev, [provider]: false }));
        setSuccess(`${PROVIDER_LABELS[provider]} API key ${value ? "saved" : "removed"}.`);
        setTimeout(() => setSuccess(null), 3000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const handleRemoveApiKey = (provider) => {
    if (!window.confirm(`Remove ${PROVIDER_LABELS[provider]} API key?`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    putSettings({ api_keys: { [provider]: "" } })
      .then((data) => {
        setSettings(data);
        setApiKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
        setShowKeyInput((prev) => ({ ...prev, [provider]: false }));
        setSuccess(`${PROVIDER_LABELS[provider]} API key removed.`);
        setTimeout(() => setSuccess(null), 3000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const revealKeyInput = (provider) => {
    setShowKeyInput((prev) => ({ ...prev, [provider]: true }));
    setApiKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-loading">Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
        <p className="settings-subtitle">Manage your API keys and default model for new chats</p>
      </header>

      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {success && (
        <div className="settings-success">
          {success}
        </div>
      )}

      <section className="settings-section">
        <h2 className="settings-section-title">Models & API keys</h2>

        <div className="settings-card">
          <div className="settings-card-header">
            <h3>Default model</h3>
            <span className="settings-hint">Used when you start a new chat</span>
          </div>
          <div className="settings-card-body">
            <select
              className="settings-select"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            >
              <option value="">First available</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="settings-btn primary"
              onClick={handleSaveDefaultModel}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save default model"}
            </button>
          </div>
        </div>

        <div className="settings-card settings-api-keys">
          <div className="settings-card-header">
            <h3>API keys</h3>
            <span className="settings-hint">Stored locally. Keys from .env take precedence.</span>
          </div>
          <div className="settings-api-key-list">
            {["openai", "anthropic", "google", "tavily"].map((provider) => {
              const keyInfo = settings?.api_keys?.[provider] || {};
              const isSet = keyInfo.set;
              const showInput = showKeyInput[provider];
              return (
                <div key={provider} className="settings-api-key-row">
                  <label className="settings-api-key-label">{PROVIDER_LABELS[provider]}</label>
                  {showInput || !isSet ? (
                    <div className="settings-api-key-input-row">
                      <input
                        type="password"
                        className="settings-input"
                        placeholder={isSet ? "Enter new key to replace" : "Paste your API key"}
                        value={apiKeyDrafts[provider]}
                        onChange={(e) =>
                          setApiKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))
                        }
                        autoComplete="off"
                        autoFocus={showInput}
                      />
                      <button
                        type="button"
                        className="settings-btn primary small"
                        onClick={() => handleSaveApiKey(provider)}
                        disabled={saving}
                      >
                        Save
                      </button>
                      {isSet && (
                        <button
                          type="button"
                          className="settings-btn small"
                          onClick={() => {
                            setShowKeyInput((prev) => ({ ...prev, [provider]: false }));
                            setApiKeyDrafts((prev) => ({ ...prev, [provider]: "" }));
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="settings-api-key-masked-row">
                      <span className="settings-api-key-masked">{keyInfo.masked || "••••••••"}</span>
                      <button
                        type="button"
                        className="settings-btn-link"
                        onClick={() => revealKeyInput(provider)}
                      >
                        Update
                      </button>
                      <button
                        type="button"
                        className="settings-btn-link danger"
                        onClick={() => handleRemoveApiKey(provider)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
