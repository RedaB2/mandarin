import React, { useState, useEffect } from "react";
import { getContexts, getContext, putContext, deleteContext, getMemory, postMemory, patchMemory, deleteMemory } from "../api/client";
import MarkdownContent from "../components/MarkdownContent";

const TAB_HUMAN = "human";
const TAB_MEMORY = "memory";

function _contentWithoutTitle(text) {
  if (!text || typeof text !== "string") return "";
  const lines = text.split("\n");
  const first = (lines[0] || "").trim();
  if (first.startsWith("#")) return lines.slice(1).join("\n").trimStart();
  return text;
}

function _memoryPreview(content, maxLen = 80) {
  if (!content || typeof content !== "string") return "—";
  const s = content.trim();
  if (!s) return "—";
  const firstLine = s.split("\n")[0]?.trim() || s;
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + "…";
}

export default function ContextsPage() {
  const [activeTab, setActiveTab] = useState(TAB_HUMAN);
  const [contexts, setContexts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createId, setCreateId] = useState("");
  const [createContent, setCreateContent] = useState("# New context\n\n");
  const [memoryList, setMemoryList] = useState([]);
  const [editingMemId, setEditingMemId] = useState(null);
  const [editMemContent, setEditMemContent] = useState("");
  const [newMemContent, setNewMemContent] = useState("");
  const [newMemTags, setNewMemTags] = useState("");
  const [contextContentById, setContextContentById] = useState({});
  const [loadingContextIds, setLoadingContextIds] = useState(new Set());
  const [expandedContextIds, setExpandedContextIds] = useState(() => new Set());
  const [expandedMemoryIds, setExpandedMemoryIds] = useState(() => new Set());

  const toggleContextExpanded = (id) => {
    setExpandedContextIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleMemoryExpanded = (id) => {
    setExpandedMemoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    getContexts()
      .then(setContexts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  /* Load all human context bodies when the Human tab is active */
  useEffect(() => {
    if (activeTab !== TAB_HUMAN || contexts.length === 0) return;
    const toLoad = contexts.filter((c) => contextContentById[c.id] == null).map((c) => c.id);
    if (toLoad.length === 0) return;
    setLoadingContextIds((prev) => new Set([...prev, ...toLoad]));
    Promise.all(toLoad.map((id) => getContext(id).then((text) => ({ id, text }))))
      .then((results) => {
        setContextContentById((prev) => {
          const next = { ...prev };
          results.forEach(({ id, text }) => { next[id] = text; });
          return next;
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingContextIds((prev) => { const s = new Set(prev); toLoad.forEach((id) => s.delete(id)); return s; }));
  }, [activeTab, contexts.map((c) => c.id).join(",")]);

  useEffect(() => {
    getMemory()
      .then(setMemoryList)
      .catch(() => setMemoryList([]));
  }, []);

  const startEdit = (id) => {
    setEditingMemId(null);
    setEditMemContent("");
    getContext(id)
      .then((text) => {
        setEditingId(id);
        setEditContent(text);
        setContextContentById((prev) => ({ ...prev, [id]: text }));
      })
      .catch((e) => setError(e.message));
  };

  const saveEdit = () => {
    if (!editingId) return;
    putContext(editingId, editContent)
      .then(() => {
        setContexts((prev) => prev.map((c) => (c.id === editingId ? { ...c, name: _nameFromFirstLine(editContent) } : c)));
        setContextContentById((prev) => ({ ...prev, [editingId]: editContent }));
        setEditingId(null);
        setEditContent("");
      })
      .catch((e) => setError(e.message));
  };

  const doDelete = (id) => {
    if (!window.confirm("Delete this context?")) return;
    deleteContext(id)
      .then(() => {
        setContexts((prev) => prev.filter((c) => c.id !== id));
        setContextContentById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (editingId === id) setEditingId(null);
      })
      .catch((e) => setError(e.message));
  };

  const startCreate = () => {
    setShowCreate(true);
    setCreateId("");
    setCreateContent("# New context\n\n");
  };

  const saveNewMemory = () => {
    const content = newMemContent.trim();
    const tags = newMemTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (!content) return;
    postMemory(content, tags)
      .then((m) => {
        setMemoryList((prev) => [m, ...prev]);
        setNewMemContent("");
        setNewMemTags("");
      })
      .catch((e) => setError(e.message));
  };

  const startEditMemory = (m) => {
    setEditingId(null);
    setEditContent("");
    setExpandedMemoryIds((prev) => { const next = new Set(prev); next.delete(m.id); return next; });
    setEditingMemId(m.id);
    setEditMemContent(m.content);
  };

  const saveEditMemory = () => {
    if (editingMemId == null) return;
    patchMemory(editingMemId, { content: editMemContent })
      .then((updated) => {
        setMemoryList((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        setEditingMemId(null);
      })
      .catch((e) => setError(e.message));
  };

  const doDeleteMemory = (id) => {
    if (!window.confirm("Delete this memory?")) return;
        deleteMemory(id)
      .then(() => {
        setMemoryList((prev) => prev.filter((m) => m.id !== id));
        if (editingMemId === id) setEditingMemId(null);
        setExpandedMemoryIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      })
      .catch((e) => setError(e.message));
  };

  const saveCreate = () => {
    const id = (createId || "newcontext").replace(/[^a-zA-Z0-9_-]/g, "") || "newcontext";
    if (!id) return;
    putContext(id, createContent)
      .then((data) => {
        setContexts((prev) => [{ id: data.id, name: data.name }, ...prev]);
        setContextContentById((prev) => ({ ...prev, [data.id]: createContent }));
        setShowCreate(false);
        setCreateId("");
        setCreateContent("");
      })
      .catch((e) => setError(e.message));
  };

  return (
    <div className="contexts-page">
      <h1>Contexts</h1>
      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <div className="contexts-tabs">
        <button
          type="button"
          className={`contexts-tab ${activeTab === TAB_HUMAN ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_HUMAN)}
        >
          Human contexts
        </button>
        <button
          type="button"
          className={`contexts-tab ${activeTab === TAB_MEMORY ? "active" : ""}`}
          onClick={() => setActiveTab(TAB_MEMORY)}
        >
          LLM memory
        </button>
      </div>

      {activeTab === TAB_HUMAN && (
        <section className="contexts-section contexts-tab-panel">
          <p className="hint">Use <code># Context Name</code> as the first line for the display name.</p>
          <div className="contexts-section-actions">
            <button type="button" className="btn primary" onClick={startCreate}>
              + New context
            </button>
          </div>
          {showCreate && (
            <div className="edit-panel">
              <input
                placeholder="Context id (e.g. work)"
                value={createId}
                onChange={(e) => setCreateId(e.target.value)}
              />
              <textarea
                value={createContent}
                onChange={(e) => setCreateContent(e.target.value)}
                rows={8}
              />
              <div>
                <button type="button" className="btn primary" onClick={saveCreate}>Save</button>
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </div>
          )}
          {loading ? (
            <p className="contexts-loading">Loading...</p>
          ) : contexts.length === 0 ? (
            <p className="contexts-empty">No contexts yet. Click &quot;+ New context&quot; to create one.</p>
          ) : (
            <div className="context-cards">
              {contexts.map((c) => (
                <article key={c.id} className="context-card">
                  <header className="context-card-header">
                    <button
                      type="button"
                      className="context-card-collapse-trigger"
                      onClick={() => toggleContextExpanded(c.id)}
                      aria-expanded={editingId === c.id || expandedContextIds.has(c.id)}
                      aria-label={expandedContextIds.has(c.id) ? "Collapse" : "Expand"}
                      title={expandedContextIds.has(c.id) ? "Collapse" : "Expand to view"}
                    >
                      <span className={`context-card-chevron ${expandedContextIds.has(c.id) || editingId === c.id ? "expanded" : ""}`} aria-hidden>▼</span>
                    </button>
                    <h3 className="context-card-title">{c.name}</h3>
                    <span className="context-id-pill" title={c.id}>{c.id}</span>
                    <div className="context-card-actions">
                      <button type="button" className="btn small" onClick={() => startEdit(c.id)}>Edit</button>
                      <button type="button" className="btn small danger" onClick={() => doDelete(c.id)}>Delete</button>
                    </div>
                  </header>
                  {editingId === c.id ? (
                    <div className="context-card-edit">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={16}
                        style={{ minHeight: "20rem" }}
                        aria-label={`Edit context ${c.id}`}
                      />
                      <div className="context-card-edit-actions">
                        <button type="button" className="btn primary" onClick={saveEdit}>Save</button>
                        <button type="button" className="btn" onClick={() => { setEditingId(null); setEditContent(""); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`context-card-body-collapsible ${expandedContextIds.has(c.id) ? "expanded" : ""}`}>
                      {loadingContextIds.has(c.id) ? (
                        <div className="context-card-loading">Loading…</div>
                      ) : contextContentById[c.id] != null ? (
                        <div className="context-card-body">
                          <div className="context-card-preview">
                            <MarkdownContent content={_contentWithoutTitle(contextContentById[c.id])} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === TAB_MEMORY && (
        <section className="memory-section contexts-tab-panel">
          <p className="hint">Facts stored during chat; add or edit here. Used for RAG in conversations.</p>
          <div className="edit-panel memory-create">
            <textarea
              placeholder="New memory (e.g. a fact to remember)"
              value={newMemContent}
              onChange={(e) => setNewMemContent(e.target.value)}
              rows={2}
            />
            <input
              placeholder="Tags, comma-separated"
              value={newMemTags}
              onChange={(e) => setNewMemTags(e.target.value)}
            />
            <button type="button" className="btn primary" onClick={saveNewMemory}>Add memory</button>
          </div>
          <ul className="context-list memory-cards">
            {memoryList.map((m) => (
              <li key={m.id} className="context-card memory-card">
                <header className="context-card-header">
                  <button
                    type="button"
                    className="context-card-collapse-trigger"
                    onClick={() => toggleMemoryExpanded(m.id)}
                    aria-expanded={editingMemId === m.id || expandedMemoryIds.has(m.id)}
                    aria-label={expandedMemoryIds.has(m.id) ? "Collapse" : "Expand"}
                    title={expandedMemoryIds.has(m.id) ? "Collapse" : "Expand to view"}
                  >
                    <span className={`context-card-chevron ${expandedMemoryIds.has(m.id) || editingMemId === m.id ? "expanded" : ""}`} aria-hidden>▼</span>
                  </button>
                  <span className="memory-preview" title={m.content}>{_memoryPreview(m.content)}</span>
                  {(m.tags || []).length > 0 && (
                    <span className="context-id memory-tags">{(m.tags || []).join(", ")}</span>
                  )}
                  <div className="context-card-actions">
                    <button type="button" className="btn small" onClick={() => startEditMemory(m)}>Edit</button>
                    <button type="button" className="btn small danger" onClick={() => doDeleteMemory(m.id)}>Delete</button>
                  </div>
                </header>
                {editingMemId === m.id ? (
                  <div className="memory-edit-inline">
                    <textarea
                      value={editMemContent}
                      onChange={(e) => setEditMemContent(e.target.value)}
                      rows={8}
                      style={{ minHeight: "10rem" }}
                      aria-label="Edit memory content"
                    />
                    <div>
                      <button type="button" className="btn primary" onClick={saveEditMemory}>Save</button>
                      <button type="button" className="btn" onClick={() => { setEditingMemId(null); setEditMemContent(""); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className={`context-card-body-collapsible ${expandedMemoryIds.has(m.id) ? "expanded" : ""}`}>
                    <div className="context-card-body">
                      <div className="context-preview-body">
                        <MarkdownContent content={m.content != null ? String(m.content) : ""} />
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function _nameFromFirstLine(text) {
  const first = (text.split("\n")[0] || "").trim();
  if (first.startsWith("#")) return first.replace(/^#+/, "").trim();
  return first || "Untitled";
}
