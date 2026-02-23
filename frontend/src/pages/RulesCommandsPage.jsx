import React, { useEffect, useState } from "react";
import MarkdownContent from "../components/MarkdownContent";
import {
  getRules,
  getRule,
  putRule,
  deleteRule,
  getCommands,
  getCommand,
  putCommand,
  deleteCommand,
  getContexts,
} from "../api/client";

const TAB_RULES = "rules";
const TAB_COMMANDS = "commands";

function parseCommandSections(body) {
  if (!body || !body.trim()) return { task: "", success_criteria: "", guidelines: "" };
  const text = body.trim();
  const sectionRegex = /^##\s+(Task|Success\s+Criteria|Guidelines)\s*$/gim;
  const sections = { task: "", success_criteria: "", guidelines: "" };
  let match;
  const positions = [];
  while ((match = sectionRegex.exec(text)) !== null) {
    let key = match[1].toLowerCase().replace(/\s+/g, "_");
    if (key === "success_criteria") key = "success_criteria";
    else if (key === "task") key = "task";
    else if (key === "guidelines") key = "guidelines";
    else continue;
    positions.push({ key, headerStart: match.index, contentStart: match.index + match[0].length });
  }
  for (let i = 0; i < positions.length; i++) {
    const contentStart = positions[i].contentStart;
    const contentEnd = i + 1 < positions.length ? positions[i + 1].headerStart : text.length;
    const content = text.slice(contentStart, contentEnd).trim();
    sections[positions[i].key] = content;
  }
  if (!positions.length) sections.task = text;
  return sections;
}

export default function RulesCommandsPage() {
  const [activeTab, setActiveTab] = useState(TAB_RULES);
  const [error, setError] = useState(null);

  const [rules, setRules] = useState([]);
  const [rulesBodiesById, setRulesBodiesById] = useState({});
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editingRuleDraft, setEditingRuleDraft] = useState({ name: "", always_on: false, tags: [], body: "" });
  const [creatingRule, setCreatingRule] = useState(false);

  const [commands, setCommands] = useState([]);
  const [commandsBodiesById, setCommandsBodiesById] = useState({});
  const [contexts, setContexts] = useState([]);
  const [editingCommandId, setEditingCommandId] = useState(null);
  const [editingCommandDraft, setEditingCommandDraft] = useState({
    name: "",
    description: "",
    tags: [],
    task: "",
    success_criteria: "",
    guidelines: "",
    context_ids: [],
    web_search_enabled: false,
  });
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [expandedRuleIds, setExpandedRuleIds] = useState(() => new Set());
  const [expandedCommandIds, setExpandedCommandIds] = useState(() => new Set());

  const toggleRuleExpanded = (id) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleCommandExpanded = (id) => {
    setExpandedCommandIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    getRules()
      .then((list) => {
        setRules(list);
        // Eagerly load full bodies for preview.
        return Promise.all(
          (list || []).map((r) =>
            getRule(r.id)
              .then((full) => ({ id: full.id, body: full.body || "" }))
              .catch(() => null)
          )
        );
      })
      .then((results) => {
        if (!results) return;
        setRulesBodiesById((prev) => {
          const next = { ...prev };
          results.forEach((r) => {
            if (r && r.id) next[r.id] = r.body;
          });
          return next;
        });
      })
      .catch((e) => setError(e.message));
    getContexts().then((list) => setContexts(list || [])).catch(() => {});
    getCommands()
      .then((list) => {
        setCommands(list || []);
        // Eagerly load full command data (task, success_criteria, guidelines, context_ids) for display.
        return Promise.all(
          (list || []).map((c) =>
            getCommand(c.id)
              .then((full) => {
                const task = full.task != null ? full.task : parseCommandSections(full.body || "").task || "";
                const success_criteria = full.success_criteria != null ? full.success_criteria : parseCommandSections(full.body || "").success_criteria || "";
                const guidelines = full.guidelines != null ? full.guidelines : parseCommandSections(full.body || "").guidelines || "";
                return {
                  id: full.id,
                  body: full.body,
                  task,
                  success_criteria,
                  guidelines,
                  context_ids: Array.isArray(full.context_ids) ? full.context_ids : [],
                  web_search_enabled: !!full.web_search_enabled,
                };
              })
              .catch(() => null)
          )
        );
      })
      .then((results) => {
        if (!results) return;
        setCommandsBodiesById((prev) => {
          const next = { ...prev };
          results.forEach((r) => {
            if (r && r.id) next[r.id] = r;
          });
          return next;
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  const startCreateRule = () => {
    setCreatingRule(true);
    setEditingRuleId(null);
    setEditingRuleDraft({ name: "", always_on: false, tags: [], body: "" });
  };

  const startEditRule = (id) => {
    setCreatingRule(false);
    if (rulesBodiesById[id]) {
      const meta = rules.find((r) => r.id === id) || { name: id, always_on: false, tags: [] };
      setEditingRuleId(id);
      setEditingRuleDraft({ ...meta, body: rulesBodiesById[id] });
      return;
    }
    getRule(id)
      .then((full) => {
        setRulesBodiesById((prev) => ({ ...prev, [full.id]: full.body || "" }));
        setEditingRuleId(full.id);
        setEditingRuleDraft({ name: full.name, always_on: !!full.always_on, tags: full.tags || [], body: full.body || "" });
      })
      .catch((e) => setError(e.message));
  };

  const saveRule = (id) => {
    const rid = id || (editingRuleId || "").trim();
    const targetId = id || rid;
    if (!targetId) {
      setError("Rule id is required");
      return;
    }
    const payload = {
      name: editingRuleDraft.name || targetId,
      always_on: !!editingRuleDraft.always_on,
      tags: editingRuleDraft.tags || [],
      body: editingRuleDraft.body || "",
    };
    putRule(targetId, payload)
      .then((saved) => {
        setRules((prev) => {
          const others = prev.filter((r) => r.id !== saved.id);
          return [...others, saved].sort((a, b) => a.name.localeCompare(b.name));
        });
        setRulesBodiesById((prev) => ({ ...prev, [saved.id]: payload.body }));
        setEditingRuleId(null);
        setCreatingRule(false);
        setEditingRuleDraft({ name: "", always_on: false, tags: [], body: "" });
      })
      .catch((e) => setError(e.message));
  };

  const toggleRuleAlwaysOn = (rule) => {
    const body = rulesBodiesById[rule.id] != null ? rulesBodiesById[rule.id] : "";
    const payload = {
      name: rule.name || rule.id,
      always_on: !rule.always_on,
      tags: rule.tags || [],
      body,
    };
    putRule(rule.id, payload)
      .then((saved) => {
        setRules((prev) =>
          prev
            .map((r) => (r.id === saved.id ? { ...r, always_on: saved.always_on } : r))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        // Body unchanged.
      })
      .catch((e) => setError(e.message));
  };

  const confirmDeleteRule = (id) => {
    if (!window.confirm("Delete this rule?")) return;
    deleteRule(id)
      .then(() => {
        setRules((prev) => prev.filter((r) => r.id !== id));
        setRulesBodiesById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (editingRuleId === id) {
          setEditingRuleId(null);
          setEditingRuleDraft({ name: "", always_on: false, tags: [], body: "" });
        }
      })
      .catch((e) => setError(e.message));
  };

  const startCreateCommand = () => {
    setCreatingCommand(true);
    setEditingCommandId(null);
    setEditingCommandDraft({ name: "", description: "", tags: [], task: "", success_criteria: "", guidelines: "", context_ids: [], web_search_enabled: false });
  };

  const startEditCommand = (id) => {
    setCreatingCommand(false);
    const meta = commands.find((c) => c.id === id) || { name: id, description: "", tags: [] };
    const cached = commandsBodiesById[id];
    if (cached && typeof cached === "object" && "task" in cached) {
      setEditingCommandId(id);
      setEditingCommandDraft({
        ...meta,
        task: cached.task || "",
        success_criteria: cached.success_criteria || "",
        guidelines: cached.guidelines || "",
        context_ids: Array.isArray(cached.context_ids) ? cached.context_ids : [],
        web_search_enabled: !!cached.web_search_enabled,
      });
      return;
    }
    getCommand(id)
      .then((full) => {
        const task = full.task != null ? full.task : (parseCommandSections(full.body || "").task || "");
        const success_criteria = full.success_criteria != null ? full.success_criteria : (parseCommandSections(full.body || "").success_criteria || "");
        const guidelines = full.guidelines != null ? full.guidelines : (parseCommandSections(full.body || "").guidelines || "");
        const context_ids = Array.isArray(full.context_ids) ? full.context_ids : [];
        const web_search_enabled = !!full.web_search_enabled;
        setCommandsBodiesById((prev) => ({ ...prev, [full.id]: { body: full.body, task, success_criteria, guidelines, context_ids, web_search_enabled } }));
        setEditingCommandId(full.id);
        setEditingCommandDraft({
          name: full.name || full.id,
          description: full.description || "",
          tags: full.tags || [],
          task,
          success_criteria,
          guidelines,
          context_ids,
          web_search_enabled,
        });
      })
      .catch((e) => setError(e.message));
  };

  const saveCommand = (id) => {
    const cid = id || (editingCommandId || "").trim();
    const targetId = id || cid;
    if (!targetId) {
      setError("Command id is required");
      return;
    }
    const task = (editingCommandDraft.task || "").trim();
    const success_criteria = (editingCommandDraft.success_criteria || "").trim();
    const guidelines = (editingCommandDraft.guidelines || "").trim();
    if (!task || !success_criteria || !guidelines) {
      setError("Task, Success Criteria, and Guidelines are all required.");
      return;
    }
    const context_ids = Array.isArray(editingCommandDraft.context_ids) ? editingCommandDraft.context_ids : [];
    const web_search_enabled = !!editingCommandDraft.web_search_enabled;
    const payload = {
      name: editingCommandDraft.name || targetId,
      description: editingCommandDraft.description || "",
      tags: editingCommandDraft.tags || [],
      task,
      success_criteria,
      guidelines,
      context_ids,
      web_search_enabled,
    };
    putCommand(targetId, payload)
      .then((saved) => {
        setCommands((prev) => {
          const others = prev.filter((c) => c.id !== saved.id);
          return [...others, { ...saved, web_search_enabled }].sort((a, b) => a.name.localeCompare(b.name));
        });
        setCommandsBodiesById((prev) => ({
          ...prev,
          [saved.id]: { task, success_criteria, guidelines, context_ids, web_search_enabled, body: `## Task\n\n${task}\n\n## Success Criteria\n\n${success_criteria}\n\n## Guidelines\n\n${guidelines}` },
        }));
        setEditingCommandId(null);
        setCreatingCommand(false);
        setEditingCommandDraft({ name: "", description: "", tags: [], task: "", success_criteria: "", guidelines: "", context_ids: [], web_search_enabled: false });
      })
      .catch((e) => setError(e.message));
  };

  const confirmDeleteCommand = (id) => {
    if (!window.confirm("Delete this command?")) return;
    deleteCommand(id)
      .then(() => {
        setCommands((prev) => prev.filter((c) => c.id !== id));
        setCommandsBodiesById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (editingCommandId === id) {
          setEditingCommandId(null);
          setEditingCommandDraft({ name: "", description: "", tags: [], task: "", success_criteria: "", guidelines: "", context_ids: [], web_search_enabled: false });
        }
      })
      .catch((e) => setError(e.message));
  };

  const toggleCommandContext = (ctxId) => {
    setEditingCommandDraft((prev) => {
      const ids = Array.isArray(prev.context_ids) ? prev.context_ids : [];
      const next = ids.includes(ctxId) ? ids.filter((id) => id !== ctxId) : [...ids, ctxId];
      return { ...prev, context_ids: next };
    });
  };

  const toggleCommandWebSearch = (command) => {
    const cached = commandsBodiesById[command.id];
    const buildPayload = (full) => ({
      name: full.name || full.id,
      description: full.description || "",
      tags: full.tags || [],
      task: (full.task ?? "").trim(),
      success_criteria: (full.success_criteria ?? "").trim(),
      guidelines: (full.guidelines ?? "").trim(),
      context_ids: Array.isArray(full.context_ids) ? full.context_ids : [],
      web_search_enabled: !(full.web_search_enabled ?? command.web_search_enabled),
    });
    const applySaved = (nextEnabled) => {
      setCommands((prev) =>
        prev.map((cmd) => (cmd.id === command.id ? { ...cmd, web_search_enabled: nextEnabled } : cmd))
      );
      setCommandsBodiesById((prev) => ({
        ...prev,
        [command.id]: { ...(prev[command.id] || {}), web_search_enabled: nextEnabled },
      }));
      if (editingCommandId === command.id) {
        setEditingCommandDraft((prev) => ({ ...prev, web_search_enabled: nextEnabled }));
      }
    };
    if (cached && typeof cached === "object" && (cached.task != null || cached.body != null)) {
      const full = {
        ...command,
        task: cached.task ?? "",
        success_criteria: cached.success_criteria ?? "",
        guidelines: cached.guidelines ?? "",
        context_ids: cached.context_ids ?? [],
      };
      const nextEnabled = !(command.web_search_enabled ?? false);
      putCommand(command.id, buildPayload({ ...full, web_search_enabled: command.web_search_enabled }))
        .then(() => applySaved(nextEnabled))
        .catch((e) => setError(e.message));
    } else {
      getCommand(command.id)
        .then((full) => {
          const nextEnabled = !(full.web_search_enabled ?? false);
          return putCommand(command.id, buildPayload(full)).then(() => applySaved(nextEnabled));
        })
        .catch((e) => setError(e.message));
    }
  };

  const renderRulesTab = () => (
    <section className="contexts-section contexts-tab-panel">
      <p className="hint">
        Rules are markdown snippets with metadata. Use <code>@rule-id</code> in messages, rules, or commands to include other rules.
      </p>
      <div className="contexts-section-actions">
        <button type="button" className="btn primary" onClick={startCreateRule}>
          + New rule
        </button>
      </div>
      {creatingRule && (
        <div className="edit-panel">
          <input
            placeholder="Rule id (e.g. focus_mode)"
            value={editingRuleId || ""}
            onChange={(e) => setEditingRuleId(e.target.value)}
          />
          <input
            placeholder="Rule name"
            value={editingRuleDraft.name}
            onChange={(e) => setEditingRuleDraft((prev) => ({ ...prev, name: e.target.value }))}
          />
          <div className="edit-panel-row">
            <label className="switch-inline">
              <span className="switch-label">Always on for every request</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={!!editingRuleDraft.always_on}
                  onChange={(e) => setEditingRuleDraft((prev) => ({ ...prev, always_on: e.target.checked }))}
                />
                <span className="switch-slider" />
              </span>
            </label>
          </div>
          <textarea
            value={editingRuleDraft.body}
            onChange={(e) => setEditingRuleDraft((prev) => ({ ...prev, body: e.target.value }))}
            rows={10}
          />
          <div>
            <button type="button" className="btn primary" onClick={() => saveRule(editingRuleId)}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCreatingRule(false);
                setEditingRuleId(null);
                setEditingRuleDraft({ name: "", always_on: false, tags: [], body: "" });
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="context-cards">
        {rules.length === 0 ? (
          <p className="contexts-empty">No rules yet. Click &quot;+ New rule&quot; to create one.</p>
        ) : (
          rules.map((r) => (
            <article key={r.id} className="context-card">
              <header className="context-card-header">
                <button
                  type="button"
                  className="context-card-collapse-trigger"
                  onClick={() => toggleRuleExpanded(r.id)}
                  aria-expanded={editingRuleId === r.id || expandedRuleIds.has(r.id)}
                  aria-label={expandedRuleIds.has(r.id) ? "Collapse" : "Expand"}
                  title={expandedRuleIds.has(r.id) ? "Collapse" : "Expand to view"}
                >
                  <span className={`context-card-chevron ${expandedRuleIds.has(r.id) || editingRuleId === r.id ? "expanded" : ""}`} aria-hidden>▼</span>
                </button>
                <h3 className="context-card-title">{r.name}</h3>
                <span className="context-id-pill" title={r.id}>
                  {r.id}
                </span>
                <button
                  type="button"
                  className={
                    "rule-status-pill " +
                    (r.always_on ? "rule-status-pill--always" : "rule-status-pill--conditional")
                  }
                  onClick={() => toggleRuleAlwaysOn(r)}
                  title={r.always_on ? "Click to make this conditional" : "Click to make this always on"}
                >
                  {r.always_on ? "Always on" : "Conditional"}
                </button>
                <div className="context-card-actions">
                  <button type="button" className="btn small" onClick={() => startEditRule(r.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn small danger" onClick={() => confirmDeleteRule(r.id)}>
                    Delete
                  </button>
                </div>
              </header>
              {editingRuleId === r.id ? (
                <div className="context-card-edit">
                  <textarea
                    value={editingRuleDraft.body}
                    onChange={(e) => setEditingRuleDraft((prev) => ({ ...prev, body: e.target.value }))}
                    rows={12}
                    style={{ minHeight: "16rem" }}
                    aria-label={`Edit rule ${r.id}`}
                  />
                  <div className="context-card-edit-actions">
                    <button type="button" className="btn primary" onClick={() => saveRule(r.id)}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setEditingRuleId(null);
                        setEditingRuleDraft({ name: "", always_on: false, tags: [], body: "" });
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`context-card-body-collapsible ${expandedRuleIds.has(r.id) ? "expanded" : ""}`}>
                  <div className="context-card-body">
                    {rulesBodiesById[r.id] != null && (
                      <MarkdownContent content={rulesBodiesById[r.id]} />
                    )}
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );

  const renderCommandsTab = () => (
    <section className="contexts-section contexts-tab-panel">
      <p className="hint">
        Commands are invoked with <code>/command-id</code> in chat. Each command has a <strong>Task</strong>,{" "}
        <strong>Success Criteria</strong>, and <strong>Guidelines</strong>. The assistant completes the task and is
        evaluated against the success criteria (with up to 3 attempts). Reference rules via <code>@rule-id</code> when
        needed.
      </p>
      <div className="contexts-section-actions">
        <button type="button" className="btn primary" onClick={startCreateCommand}>
          + New command
        </button>
      </div>
      {creatingCommand && (
        <div className="edit-panel command-form-sections">
          <input
            placeholder="Command id (e.g. code_review)"
            value={editingCommandId || ""}
            onChange={(e) => setEditingCommandId(e.target.value)}
          />
          <input
            placeholder="Command name"
            value={editingCommandDraft.name}
            onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, name: e.target.value }))}
          />
          <input
            placeholder="Short description"
            value={editingCommandDraft.description}
            onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, description: e.target.value }))}
          />
          <div className="command-section">
            <label className="command-section-label">Task (required)</label>
            <textarea
              placeholder="Describe what this command should accomplish..."
              value={editingCommandDraft.task}
              onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, task: e.target.value }))}
              rows={8}
            />
            <p className="command-section-hint">Main instruction the assistant will follow.</p>
          </div>
          <div className="command-section">
            <label className="command-section-label">Success Criteria (required)</label>
            <textarea
              placeholder="How will we know the task was completed correctly? Be specific and measurable."
              value={editingCommandDraft.success_criteria}
              onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, success_criteria: e.target.value }))}
              rows={6}
            />
            <p className="command-section-hint">The evaluation agent will check these.</p>
          </div>
          <div className="command-section">
            <label className="command-section-label">Guidelines (required)</label>
            <textarea
              placeholder="Constraints, style preferences, or best practices..."
              value={editingCommandDraft.guidelines}
              onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, guidelines: e.target.value }))}
              rows={6}
            />
            <p className="command-section-hint">How the task should be executed.</p>
          </div>
          <div className="command-section">
            <label className="command-section-label">Contexts to include with this command</label>
            <p className="command-section-hint">When this command is used, these contexts are automatically added to the chat context (in addition to the chat&apos;s selected contexts).</p>
            {contexts.length === 0 ? (
              <p className="contexts-empty">No contexts yet. Create contexts on the Contexts page.</p>
            ) : (
              <div className="command-context-checkboxes">
                {contexts.map((ctx) => (
                  <label key={ctx.id} className="command-context-checkbox">
                    <input
                      type="checkbox"
                      checked={(editingCommandDraft.context_ids || []).includes(ctx.id)}
                      onChange={() => toggleCommandContext(ctx.id)}
                    />
                    <span>{ctx.name || ctx.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="edit-panel-row">
            <label className="switch-inline">
              <span className="switch-label">Enable web search for this command</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={!!editingCommandDraft.web_search_enabled}
                  onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, web_search_enabled: e.target.checked }))}
                />
                <span className="switch-slider" />
              </span>
            </label>
          </div>
          <div>
            <button type="button" className="btn primary" onClick={() => saveCommand(editingCommandId)}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCreatingCommand(false);
                setEditingCommandId(null);
                setEditingCommandDraft({ name: "", description: "", tags: [], task: "", success_criteria: "", guidelines: "", context_ids: [], web_search_enabled: false });
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="context-cards">
        {commands.length === 0 ? (
          <p className="contexts-empty">No commands yet. Click &quot;+ New command&quot; to create one.</p>
        ) : (
          commands.map((c) => (
            <article key={c.id} className="context-card">
              <header className="context-card-header">
                <button
                  type="button"
                  className="context-card-collapse-trigger"
                  onClick={() => toggleCommandExpanded(c.id)}
                  aria-expanded={editingCommandId === c.id || expandedCommandIds.has(c.id)}
                  aria-label={expandedCommandIds.has(c.id) ? "Collapse" : "Expand"}
                  title={expandedCommandIds.has(c.id) ? "Collapse" : "Expand to view"}
                >
                  <span className={`context-card-chevron ${expandedCommandIds.has(c.id) || editingCommandId === c.id ? "expanded" : ""}`} aria-hidden>▼</span>
                </button>
                <h3 className="context-card-title">{c.name}</h3>
                <span className="context-id-pill" title={c.id}>
                  {c.id}
                </span>
                <button
                  type="button"
                  className={
                    "rule-status-pill " +
                    (c.web_search_enabled ? "rule-status-pill--always" : "rule-status-pill--conditional")
                  }
                  onClick={() => toggleCommandWebSearch(c)}
                  title={c.web_search_enabled ? "Click to turn web search off" : "Click to turn web search on"}
                >
                  {c.web_search_enabled ? "Web search on" : "Web search off"}
                </button>
                <div className="context-card-actions">
                  <button type="button" className="btn small" onClick={() => startEditCommand(c.id)}>
                    Edit
                  </button>
                  <button type="button" className="btn small danger" onClick={() => confirmDeleteCommand(c.id)}>
                    Delete
                  </button>
                </div>
              </header>
              {editingCommandId === c.id ? (
                <div className="context-card-edit command-form-sections">
                  <div className="command-section">
                    <label className="command-section-label">Name</label>
                    <input
                      type="text"
                      value={editingCommandDraft.name}
                      onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Display name"
                      aria-label={`Edit name for ${c.id}`}
                    />
                  </div>
                  <div className="command-section">
                    <label className="command-section-label">Description</label>
                    <input
                      type="text"
                      value={editingCommandDraft.description}
                      onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="Short description"
                      aria-label={`Edit description for ${c.id}`}
                    />
                  </div>
                  <div className="command-section">
                    <label className="command-section-label">Task (required)</label>
                    <textarea
                      value={editingCommandDraft.task}
                      onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, task: e.target.value }))}
                      rows={8}
                      aria-label={`Edit task for ${c.id}`}
                    />
                  </div>
                  <div className="command-section">
                    <label className="command-section-label">Success Criteria (required)</label>
                    <textarea
                      value={editingCommandDraft.success_criteria}
                      onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, success_criteria: e.target.value }))}
                      rows={6}
                      aria-label={`Edit success criteria for ${c.id}`}
                    />
                  </div>
                  <div className="command-section">
                    <label className="command-section-label">Guidelines (required)</label>
                    <textarea
                      value={editingCommandDraft.guidelines}
                      onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, guidelines: e.target.value }))}
                      rows={6}
                      aria-label={`Edit guidelines for ${c.id}`}
                    />
                  </div>
                  <div className="command-section">
                    <label className="command-section-label">Contexts to include with this command</label>
                    <p className="command-section-hint">When this command is used, these contexts are automatically added (in addition to the chat&apos;s selected contexts).</p>
                    {contexts.length === 0 ? (
                      <p className="contexts-empty">No contexts yet.</p>
                    ) : (
                      <div className="command-context-checkboxes">
                        {contexts.map((ctx) => (
                          <label key={ctx.id} className="command-context-checkbox">
                            <input
                              type="checkbox"
                              checked={(editingCommandDraft.context_ids || []).includes(ctx.id)}
                              onChange={() => toggleCommandContext(ctx.id)}
                              aria-label={`Include context ${ctx.name || ctx.id}`}
                            />
                            <span>{ctx.name || ctx.id}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="edit-panel-row">
                    <label className="switch-inline">
                      <span className="switch-label">Enable web search for this command</span>
                      <span className="switch">
                        <input
                          type="checkbox"
                          checked={!!editingCommandDraft.web_search_enabled}
                          onChange={(e) => setEditingCommandDraft((prev) => ({ ...prev, web_search_enabled: e.target.checked }))}
                          aria-label={`Web search for ${c.id}`}
                        />
                        <span className="switch-slider" />
                      </span>
                    </label>
                  </div>
                  <div className="context-card-edit-actions">
                    <button type="button" className="btn primary" onClick={() => saveCommand(c.id)}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setEditingCommandId(null);
                        setEditingCommandDraft({ name: "", description: "", tags: [], task: "", success_criteria: "", guidelines: "", context_ids: [], web_search_enabled: false });
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`context-card-body-collapsible ${expandedCommandIds.has(c.id) ? "expanded" : ""}`}>
                  <div className="context-card-body">
                    {(() => {
                      const cmdData = commandsBodiesById[c.id];
                      const includedContextIds = cmdData && typeof cmdData === "object" && Array.isArray(cmdData.context_ids) ? cmdData.context_ids : [];
                      const includedContexts = includedContextIds.length > 0
                        ? contexts.filter((ctx) => includedContextIds.includes(ctx.id))
                        : [];
                      return (
                        <>
                          {includedContexts.length > 0 && (
                            <div className="command-included-contexts">
                              <span className="command-included-contexts-label">Auto-includes contexts:</span>
                              <div className="command-included-contexts-list">
                                {includedContexts.map((ctx) => (
                                  <span key={ctx.id} className="command-included-context-badge" title={ctx.id}>
                                    {ctx.name || ctx.id}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {cmdData ? (
                            <MarkdownContent
                              content={
                                typeof cmdData === "string"
                                  ? cmdData
                                  : (cmdData.body || cmdData.task || "")
                              }
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => startEditCommand(c.id)}
                            >
                              Load &amp; edit
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="contexts-page">
      <h1>Rules &amp; Commands</h1>
      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      <div className="contexts-tabs">
        <button
          type="button"
          className={`contexts-tab ${activeTab === TAB_RULES ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_RULES)}
        >
          Rules
        </button>
        <button
          type="button"
          className={`contexts-tab ${activeTab === TAB_COMMANDS ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_COMMANDS)}
        >
          Commands
        </button>
      </div>
      {activeTab === TAB_RULES && renderRulesTab()}
      {activeTab === TAB_COMMANDS && renderCommandsTab()}
    </div>
  );
}

