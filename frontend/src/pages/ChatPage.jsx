import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import {
  getChats,
  createChat,
  getChat,
  getModels,
  getSettings,
  addMessageStream,
  regenerateMessageStream,
  getContexts,
  updateChat,
  deleteChat,
  patchMessage,
  getRules,
  getCommands,
  getCommand,
} from "../api/client";
import MarkdownContent from "../components/MarkdownContent";

const MENU_GAP = 4;
const VIEWPORT_PADDING = 8;

export default function ChatPage() {
  const [chats, setChats] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState(null);
  const [contexts, setContexts] = useState([]);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState("");
  const [menuOpenForMessageId, setMenuOpenForMessageId] = useState(null);
  const [contextDropdownOpen, setContextDropdownOpen] = useState(false);
  const [pendingContextIds, setPendingContextIds] = useState([]);
  const [availableRules, setAvailableRules] = useState([]);
  const [availableCommands, setAvailableCommands] = useState([]);
  const [pickerType, setPickerType] = useState(null); // "rule" | "command" | null
  const [pickerQuery, setPickerQuery] = useState("");
  const [selectedPickerIndex, setSelectedPickerIndex] = useState(0);
  const [commandDetailsCache, setCommandDetailsCache] = useState({});
  const [previewCommandId, setPreviewCommandId] = useState(null);
  const [streamingStatus, setStreamingStatus] = useState(null); // "Completing task...", "Evaluating...", etc.
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renamingChatTitle, setRenamingChatTitle] = useState("");
  const [menuOpenForChatId, setMenuOpenForChatId] = useState(null);
  const menuTriggerRef = useRef(null);
  const menuRef = useRef(null);
  const contextDropdownRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    Promise.all([getChats(), getModels(), getContexts(), getRules(), getCommands(), getSettings()])
      .then(([chatsData, modelsData, contextsData, rulesData, commandsData, settingsData]) => {
        setChats(chatsData);
        setContexts(contextsData || []);
        const available = (modelsData || []).filter((m) => m.available);
        setModels(available);
        setAvailableRules(rulesData || []);
        setAvailableCommands(commandsData || []);
        if (available.length && !selectedModel) {
          const defaultId = (settingsData?.default_model || "").trim();
          const defaultAvailable = defaultId && available.some((m) => m.id === defaultId);
          setSelectedModel(defaultAvailable ? defaultId : available[0].id);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!contextDropdownOpen) return;
    const onDocClick = (e) => {
      if (contextDropdownRef.current && !contextDropdownRef.current.contains(e.target)) setContextDropdownOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [contextDropdownOpen]);

  useLayoutEffect(() => {
    if (!menuOpenForMessageId || !menuTriggerRef.current || !menuRef.current) {
      if (menuRef.current) {
        menuRef.current.style.position = "";
        menuRef.current.style.top = "";
        menuRef.current.style.left = "";
      }
      return;
    }
    const triggerRect = menuTriggerRef.current.getBoundingClientRect();
    const menuEl = menuRef.current;
    const menuRect = menuEl.getBoundingClientRect();
    let top = triggerRect.top - menuRect.height - MENU_GAP;
    let left = triggerRect.right - menuRect.width;
    if (top < VIEWPORT_PADDING) top = triggerRect.bottom + MENU_GAP;
    if (top + menuRect.height > window.innerHeight - VIEWPORT_PADDING) top = window.innerHeight - menuRect.height - VIEWPORT_PADDING;
    if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING;
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (left + menuRect.width > window.innerWidth - VIEWPORT_PADDING) left = window.innerWidth - menuRect.width - VIEWPORT_PADDING;
    menuEl.style.position = "fixed";
    menuEl.style.top = `${top}px`;
    menuEl.style.left = `${left}px`;
    menuEl.style.right = "auto";
    menuEl.style.bottom = "auto";
    menuEl.style.marginBottom = "0";
  }, [menuOpenForMessageId]);

  useEffect(() => {
    setEditingMessageId(null);
    setEditingContent("");
    setMenuOpenForMessageId(null);
    if (!currentChat) {
      setMessages([]);
      return;
    }
    /* Don't overwrite messages while streaming: we have temp-assistant in state for "Thinking…" and chunk updates */
    if (sending) return;
    getChat(currentChat.id)
      .then((data) => setMessages(data.messages || []))
      .catch((e) => setError(e.message));
  }, [currentChat?.id, sending]);

  const selectedContextIds = currentChat ? (currentChat.context_ids || []) : pendingContextIds;
  const handleContextToggle = (id) => {
    const next = selectedContextIds.includes(id)
      ? selectedContextIds.filter((x) => x !== id)
      : [...selectedContextIds, id];
    if (currentChat) {
      updateChat(currentChat.id, { context_ids: next })
        .then((updated) => {
          setCurrentChat(updated);
          setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        })
        .catch((e) => setError(e.message));
    } else {
      setPendingContextIds(next);
    }
  };

  const handleNewChat = () => {
    setCurrentChat(null);
    setMessages([]);
  };

  const handleSelectChat = (chat) => {
    setCurrentChat(chat);
  };

  const isPersistedMessage = (msg) =>
    msg.id != null && msg.id !== "temp-user" && msg.id !== "temp-assistant";

  const handleDeleteChat = (e, chatId) => {
    e.stopPropagation();
    deleteChat(chatId)
      .then(() => {
        const nextChats = chats.filter((c) => c.id !== chatId);
        setChats(nextChats);
        if (currentChat?.id === chatId) {
          setCurrentChat(nextChats[0] ?? null);
        }
      })
      .catch((err) => setError(err.message));
  };

  const startEditMessage = (msg) => {
    setEditingMessageId(msg.id);
    setEditingContent(msg.content);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingContent("");
  };

  const saveEditMessage = () => {
    if (!currentChat || editingMessageId == null || editingContent.trim() === "" || !selectedModel || sending) return;
    const editedMsg = messages.find((m) => m.id === editingMessageId);
    if (!editedMsg) return;
    const isUserMessage = editedMsg.role === "user";
    setMenuOpenForMessageId(null);
    setEditingMessageId(null);
    setEditingContent("");
    patchMessage(currentChat.id, Number(editingMessageId), editingContent.trim())
      .then((updatedMessages) => {
        setMessages(updatedMessages);
        if (isUserMessage) {
          // Regenerate response for the edited user message
          setSending(true);
          setError(null);
          setStreamingContent("");
          const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
          setMessages([...updatedMessages, placeholderAssistant]);
          regenerateMessageStream(currentChat.id, Number(editingMessageId), selectedModel, {
            onChunk: (c) => setStreamingContent((prev) => prev + c),
            onDone: (fullContent, payload) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
                )
              );
              setStreamingContent("");
              setSending(false);
              const chatId = currentChat.id;
              const titleFromPayload = payload?.title;
              if (titleFromPayload != null) {
                setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: titleFromPayload } : c)));
                setCurrentChat((prev) => prev && prev.id === chatId ? { ...prev, title: titleFromPayload } : prev);
              }
              getChat(chatId).then((d) => setMessages(d.messages || []));
              getChats().then((chatList) => {
                setChats(
                  chatList.map((c) =>
                    c.id === chatId && titleFromPayload != null ? { ...c, title: titleFromPayload } : c
                  )
                );
                const updated = chatList.find((c) => c.id === currentChat.id);
                if (updated) {
                  setCurrentChat(titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
                } else {
                  setCurrentChat(null);
                  setMessages([]);
                }
              });
            },
          }).catch((e) => {
            setError(e.message);
            setSending(false);
            setStreamingContent("");
            // Remove placeholder on error
            setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
          });
        }
      })
      .catch((e) => setError(e.message));
  };

  const copyMessage = (msg) => {
    navigator.clipboard.writeText(msg.content || "").then(() => setMenuOpenForMessageId(null)).catch(() => setError("Copy failed"));
  };

  const startRenameChat = (chat) => {
    setRenamingChatId(chat.id);
    setRenamingChatTitle(chat.title || "");
  };
  const cancelRenameChat = () => {
    setRenamingChatId(null);
    setRenamingChatTitle("");
  };
  const saveRenameChat = (chatId) => {
    const title = renamingChatTitle.trim() || "New chat";
    updateChat(chatId, { title })
      .then((updated) => {
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c)));
        if (currentChat?.id === chatId) setCurrentChat((prev) => (prev ? { ...prev, title: updated.title } : null));
        setRenamingChatId(null);
        setRenamingChatTitle("");
      })
      .catch((e) => setError(e.message));
  };

  const handleRetryAssistant = (msg, msgIndex) => {
    if (!currentChat || !selectedModel || msg.role !== "assistant" || sending) return;
    const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
    if (!userMsg || userMsg.role !== "user") return;
    setMenuOpenForMessageId(null);
    setSending(true);
    setError(null);
    setStreamingContent("");
    patchMessage(currentChat.id, Number(userMsg.id), userMsg.content)
      .then((truncated) => {
        const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
        setMessages([...truncated, placeholderAssistant]);
        return regenerateMessageStream(currentChat.id, userMsg.id, selectedModel, {
          onChunk: (c) => setStreamingContent((prev) => prev + c),
          onDone: (fullContent, payload) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
              )
            );
            setStreamingContent("");
            setSending(false);
            const chatId = currentChat.id;
            const titleFromPayload = payload?.title;
            if (titleFromPayload != null) {
              setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: titleFromPayload } : c)));
              setCurrentChat((prev) => prev && prev.id === chatId ? { ...prev, title: titleFromPayload } : prev);
            }
            getChat(chatId).then((d) => setMessages(d.messages || []));
            getChats().then((chatList) => {
              setChats(
                chatList.map((c) =>
                  c.id === chatId && titleFromPayload != null ? { ...c, title: titleFromPayload } : c
                )
              );
              const updated = chatList.find((c) => c.id === currentChat.id);
              if (updated) {
                setCurrentChat(titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
              } else {
                setCurrentChat(null);
                setMessages([]);
              }
            });
          },
        });
      })
      .catch((e) => {
        setError(e.message);
        setSending(false);
      });
  };

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || !selectedModel) return;
    setSending(true);
    setError(null);
    setStreamingContent("");
    const userMsg = { id: "temp-user", role: "user", content };
    const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
    setInputValue("");

    if (!currentChat) {
      createChat(pendingContextIds)
        .then((chat) => {
          setChats((prev) => [chat, ...prev]);
          setCurrentChat(chat);
          setMessages([userMsg, placeholderAssistant]);
          setStreamingStatus(content.trim().startsWith("/") ? "Completing task..." : "Thinking...");
          return addMessageStream(chat.id, content, selectedModel, {
            onChunk: (c) => setStreamingContent((prev) => prev + c),
            onStatus: (msg) => setStreamingStatus(msg),
            onDone: (fullContent, payload) => {
              setStreamingStatus(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
                )
              );
              setStreamingContent("");
              setSending(false);
              const chatId = chat.id;
              const titleFromPayload = payload?.title;
              if (titleFromPayload != null) {
                setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: titleFromPayload } : c)));
                setCurrentChat((prev) => prev && prev.id === chatId ? { ...prev, title: titleFromPayload } : prev);
              }
              getChat(chatId).then((d) => setMessages(d.messages || []));
              getChats().then((chatList) => {
                setChats((prev) =>
                  prev.map((c) => (c.id === chatId && titleFromPayload != null ? { ...c, title: titleFromPayload } : c))
                );
                const updated = chatList.find((c) => c.id === chatId);
                if (updated) setCurrentChat(titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
              });
            },
          });
        })
        .catch((e) => {
          setError(e.message);
          setSending(false);
          setStreamingStatus(null);
        });
      return;
    }

    setMessages((prev) => [...prev, userMsg, placeholderAssistant]);
    setStreamingStatus(content.trim().startsWith("/") ? "Completing task..." : "Thinking...");
    addMessageStream(currentChat.id, content, selectedModel, {
      onChunk: (c) => setStreamingContent((prev) => prev + c),
      onStatus: (msg) => setStreamingStatus(msg),
      onDone: (fullContent, payload) => {
        setStreamingStatus(null);
        const chatId = currentChat.id;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
          )
        );
        setStreamingContent("");
        setSending(false);
        const titleFromPayload = payload?.title;
        if (titleFromPayload != null) {
          setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: titleFromPayload } : c)));
          setCurrentChat((prev) => prev && prev.id === chatId ? { ...prev, title: titleFromPayload } : prev);
        }
        getChat(chatId).then((d) => setMessages(d.messages || []));
        getChats().then((chatList) => {
          setChats((prev) => {
            const next = chatList.map((c) => {
              if (c.id === chatId && titleFromPayload != null) return { ...c, title: titleFromPayload };
              return c;
            });
            return next;
          });
          if (currentChat && chatList.some((c) => c.id === currentChat.id)) {
            const updated = chatList.find((c) => c.id === currentChat.id);
            setCurrentChat(titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
          } else if (currentChat && !chatList.some((c) => c.id === currentChat.id)) {
            setCurrentChat(null);
            setMessages([]);
          }
        });
      },
    }).catch((e) => {
      setError(e.message);
      setSending(false);
      setStreamingStatus(null);
      setStreamingContent("");
      setMessages((prev) => {
        const kept = prev.filter((m) => m.id !== "temp-user" && m.id !== "temp-assistant");
        if (kept.length === 0 && currentChat) {
          setChats((c) => c.filter((ch) => ch.id !== currentChat.id));
          setCurrentChat(null);
        }
        return kept;
      });
    });
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
    setPreviewCommandId(null);
    const cursorIndex = e.target.selectionStart;
    const before = value.slice(0, cursorIndex);
    const match = before.match(/(^|\s)([@/])([a-zA-Z0-9_-]*)$/);
    if (!match) {
      setPickerType(null);
      setPickerQuery("");
      setSelectedPickerIndex(0);
      return;
    }
    const trigger = match[2];
    const query = match[3] || "";
    if (trigger === "/") {
      setPickerType("command");
      setPickerQuery(query);
      setSelectedPickerIndex(0);
    } else if (trigger === "@") {
      setPickerType("rule");
      setPickerQuery(query);
      setSelectedPickerIndex(0);
    }
  };

  const handlePickerKeyDown = (e) => {
    if (!pickerType) return;
    const list = pickerType === "command" ? filteredCommands : filteredRules;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedPickerIndex((i) => (i + 1) % Math.max(1, list.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedPickerIndex((i) => (i - 1 + list.length) % Math.max(1, list.length));
    } else if ((e.key === "Enter" || e.key === "Tab") && list.length > 0) {
      e.preventDefault();
      const item = list[selectedPickerIndex];
      if (item) applyPickerSelection(pickerType === "command" ? item.id : item.id, pickerType);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPickerType(null);
      setPickerQuery("");
      setSelectedPickerIndex(0);
      setPreviewCommandId(null);
    }
  };

  const handleCommandPreview = (commandId) => {
    setPreviewCommandId(commandId);
    if (commandDetailsCache[commandId]) return;
    getCommand(commandId)
      .then((full) => {
        setCommandDetailsCache((prev) => ({
          ...prev,
          [commandId]: {
            task: full.task != null ? full.task : "",
            success_criteria: full.success_criteria != null ? full.success_criteria : "",
            guidelines: full.guidelines != null ? full.guidelines : "",
            name: full.name,
            description: full.description,
          },
        }));
      })
      .catch(() => {});
  };

  const applyPickerSelection = (id, type) => {
    const textarea = inputRef.current;
    if (!textarea || textarea.tagName !== "TEXTAREA") {
      setPickerType(null);
      setPickerQuery("");
      return;
    }
    const value = inputValue;
    const cursorIndex = textarea.selectionStart;
    const before = value.slice(0, cursorIndex);
    const after = value.slice(cursorIndex);
    const match = before.match(/(^|\s)([@/])([a-zA-Z0-9_-]*)$/);
    if (!match) {
      setPickerType(null);
      setPickerQuery("");
      return;
    }
    const prefix = match[1];
    const trigger = match[2];
    const startIdx = before.length - (match[2].length + match[3].length);
    const insertion = `${trigger}${id}`;
    const newValue = before.slice(0, startIdx) + prefix + insertion + after;
    setInputValue(newValue);
    setPickerType(null);
    setPickerQuery("");
    setSelectedPickerIndex(0);
    setPreviewCommandId(null);
    // Move cursor to end of inserted token.
    window.requestAnimationFrame(() => {
      const newCursorPos = before.slice(0, startIdx).length + prefix.length + insertion.length;
      textarea.selectionStart = textarea.selectionEnd = newCursorPos;
      textarea.focus();
    });
  };

  const filteredCommands =
    pickerType === "command"
      ? availableCommands.filter((c) => {
          const q = pickerQuery.toLowerCase();
          return c.id.toLowerCase().startsWith(q) || (c.name || "").toLowerCase().startsWith(q);
        })
      : [];

  const filteredRules =
    pickerType === "rule"
      ? availableRules.filter((r) => {
          const q = pickerQuery.toLowerCase();
          return r.id.toLowerCase().startsWith(q) || (r.name || "").toLowerCase().startsWith(q);
        })
      : [];

  useEffect(() => {
    const list = pickerType === "command" ? filteredCommands : filteredRules;
    setSelectedPickerIndex((i) => (list.length ? Math.min(i, list.length - 1) : 0));
  }, [pickerType, pickerQuery, filteredCommands.length, filteredRules.length]);

  return (
    <div className="chat-page">
      <aside className="sidebar">
        <button className="new-chat-btn" onClick={() => handleNewChat()}>
          + New chat
        </button>
        {loading ? (
          <p className="sidebar-loading">Loading...</p>
        ) : (
          <>
            <ul className="chat-list">
              {chats.length === 0 ? (
                <li className="sidebar-empty">No chats yet. Send a message below to start.</li>
              ) : (
                chats.map((c) => (
                  <li key={c.id} className="chat-list-item">
                    {renamingChatId === c.id ? (
                      <>
                        <input
                          type="text"
                          className="chat-item-rename-input"
                          value={renamingChatTitle}
                          onChange={(e) => setRenamingChatTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRenameChat(c.id);
                            if (e.key === "Escape") cancelRenameChat();
                          }}
                          autoFocus
                          aria-label="Rename chat"
                        />
                        <button type="button" className="chat-item-rename-btn" onClick={() => saveRenameChat(c.id)} title="Save">✓</button>
                        <button type="button" className="chat-item-delete" onClick={cancelRenameChat} title="Cancel" aria-label="Cancel">×</button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`chat-item ${currentChat?.id === c.id ? "active" : ""}`}
                          onClick={() => handleSelectChat(c)}
                          title={c.title}
                        >
                          {c.title}
                        </button>
                        <div className="chat-item-actions">
                          <button
                            type="button"
                            className="chat-item-actions-trigger"
                            onClick={(e) => { e.stopPropagation(); setMenuOpenForChatId((prev) => (prev === c.id ? null : c.id)); }}
                            title="Chat options"
                            aria-label="Chat options"
                            aria-expanded={menuOpenForChatId === c.id}
                          >
                            ⋯
                          </button>
                          {menuOpenForChatId === c.id && (
                            <>
                              <div
                                className="chat-item-actions-backdrop"
                                onClick={() => setMenuOpenForChatId(null)}
                                aria-hidden
                              />
                              <div className="chat-item-actions-menu" role="menu">
                                <button
                                  type="button"
                                  className="chat-item-actions-item"
                                  onClick={() => { setMenuOpenForChatId(null); startRenameChat(c); }}
                                  role="menuitem"
                                >
                                  Rename chat
                                </button>
                                <button
                                  type="button"
                                  className="chat-item-actions-item chat-item-actions-item--danger"
                                  onClick={(e) => { setMenuOpenForChatId(null); handleDeleteChat(e, c.id); }}
                                  role="menuitem"
                                >
                                  Delete chat
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))
              )}
            </ul>
          </>
        )}
      </aside>
      <section className="chat-main">
        {error && (
          <div className="error-banner">
            {error}
            <button type="button" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        <div className="messages">
          {!currentChat && (
            <div className="home-welcome">
              <h1 className="home-welcome-title">Welcome back.</h1>
              <p className="home-welcome-subtitle">Your contexts and memory are ready. Type a message below to start a new chat.</p>
            </div>
          )}
          {currentChat && messages.map((m, msgIndex) => {
            const isLastMessage = msgIndex === messages.length - 1;
            const isStreamingThisMessage = sending && isLastMessage && m.role === "assistant";
            return (
            <div
              key={m.id}
              className={`message message--${m.role} ${menuOpenForMessageId === m.id ? "message--menu-open" : ""} ${editingMessageId === m.id ? "message--editing" : ""}`}
            >
              {editingMessageId === m.id ? (
                <div className="message-edit">
                  <textarea
                    className="message-edit-input"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                  />
                  <div className="message-edit-actions">
                    <button type="button" className="message-edit-save" onClick={saveEditMessage}>
                      Save
                    </button>
                    <button type="button" className="message-edit-cancel" onClick={cancelEditMessage}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`message-content ${isStreamingThisMessage && !streamingContent ? "message-thinking" : ""}`}
                  >
                    {m.role === "assistant" ? (
                      isStreamingThisMessage && !streamingContent ? (
                        <span className={streamingStatus ? "picker-status picker-status--completing" : ""}>
                          {streamingStatus || "Thinking…"}
                        </span>
                      ) : (
                        <MarkdownContent key={`msg-${msgIndex}-${m.id}`} content={isStreamingThisMessage ? (streamingContent || m.content || "") : (m.content || "")} />
                      )
                    ) : (
                      m.content
                    )}
                  </div>
                  {!sending && (
                    <div className="message-actions">
                      <button
                        ref={menuOpenForMessageId === m.id ? menuTriggerRef : null}
                        type="button"
                        className="message-actions-trigger"
                        onClick={() => setMenuOpenForMessageId((prev) => (prev === m.id ? null : m.id))}
                        title="Options"
                        aria-label="Message options"
                        aria-expanded={menuOpenForMessageId === m.id}
                      >
                        ⋯
                      </button>
                      {menuOpenForMessageId === m.id && (
                        <>
                          <div
                            className="message-actions-backdrop"
                            onClick={() => setMenuOpenForMessageId(null)}
                            aria-hidden
                          />
                          <div ref={menuRef} className="message-actions-menu" role="menu">
                            <button type="button" className="message-actions-item" onClick={() => { copyMessage(m); }} role="menuitem">
                              Copy message
                            </button>
                            {isPersistedMessage(m) && (
                              <button
                                type="button"
                                className="message-actions-item"
                                onClick={() => { setMenuOpenForMessageId(null); startEditMessage(m); }}
                                role="menuitem"
                              >
                                Edit message
                              </button>
                            )}
                            {m.role === "assistant" && isPersistedMessage(m) && msgIndex > 0 && messages[msgIndex - 1]?.role === "user" && (
                              <button
                                type="button"
                                className="message-actions-item"
                                onClick={() => handleRetryAssistant(m, msgIndex)}
                                role="menuitem"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            );
          })}
        </div>
        <div className="input-area">
          <div className="input-area-selectors">
            <select
              className="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">Select model</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
            <div className="context-selector-wrap" ref={contextDropdownRef}>
              <button
                type="button"
                className="context-selector-btn"
                onClick={(e) => { e.stopPropagation(); setContextDropdownOpen((open) => !open); }}
                aria-expanded={contextDropdownOpen}
                aria-haspopup="listbox"
              >
                Contexts{selectedContextIds.length > 0 ? ` (${selectedContextIds.length})` : ""}
              </button>
              {contextDropdownOpen && (
                <div
                  className="context-selector-dropdown"
                  role="listbox"
                  aria-label={currentChat ? "Contexts for this chat" : "Contexts for new chat"}
                >
                  {contexts.length === 0 ? (
                    <div className="context-selector-empty">No contexts yet.</div>
                  ) : (
                    contexts.map((ctx) => (
                      <label key={ctx.id} className="context-selector-option">
                        <input
                          type="checkbox"
                          checked={selectedContextIds.includes(ctx.id)}
                          onChange={() => handleContextToggle(ctx.id)}
                        />
                        <span>{ctx.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="input-row">
            <textarea
              ref={inputRef}
              className="message-input"
              placeholder={currentChat ? "Message..." : "Type a message to start a new chat..."}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (pickerType && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                  handlePickerKeyDown(e);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              disabled={sending}
            />
            <button
              type="button"
              className="send-btn"
              onClick={handleSend}
              disabled={!inputValue.trim() || !selectedModel || sending}
            >
              {sending ? "..." : "Send"}
            </button>
            {pickerType && (
              <div className="picker-dropdown-wrap">
                <div className="picker-dropdown">
                  <div className="picker-header">
                    {pickerType === "command" ? "Commands" : "Rules"}
                    <span className="picker-header-badge">
                      {pickerType === "command" ? filteredCommands.length : filteredRules.length}
                    </span>
                  </div>
                  {pickerType === "command" &&
                    (filteredCommands.length === 0 ? (
                      <div className="picker-empty">No matching commands</div>
                    ) : (
                      filteredCommands.map((c, idx) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`picker-item ${idx === selectedPickerIndex ? "picker-item--selected" : ""}`}
                          data-trigger="/"
                          onClick={() => applyPickerSelection(c.id, "command")}
                          onMouseEnter={() => {
                            setSelectedPickerIndex(idx);
                            handleCommandPreview(c.id);
                          }}
                        >
                          <span className="picker-item-label">/{c.id}</span>
                          {c.name && <span className="picker-item-name">{c.name}</span>}
                          {c.description && <span className="picker-item-desc">{c.description}</span>}
                        </button>
                      ))
                    ))}
                  {pickerType === "rule" &&
                    (filteredRules.length === 0 ? (
                      <div className="picker-empty">No matching rules</div>
                    ) : (
                      filteredRules.map((r, idx) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`picker-item ${idx === selectedPickerIndex ? "picker-item--selected" : ""}`}
                          data-trigger="@"
                          onClick={() => applyPickerSelection(r.id, "rule")}
                        >
                          <span className="picker-item-label">@{r.id}</span>
                          {r.name && <span className="picker-item-name">{r.name}</span>}
                        </button>
                      ))
                    ))}
                </div>
                {pickerType === "command" && previewCommandId && (
                  <div className="picker-preview-wrap">
                    <div className="picker-preview">
                      {commandDetailsCache[previewCommandId] ? (
                        <>
                          <div className="picker-preview-title">
                            {commandDetailsCache[previewCommandId].name || previewCommandId}
                          </div>
                          {commandDetailsCache[previewCommandId].description && (
                            <p className="picker-preview-section-content" style={{ marginBottom: "0.5rem" }}>
                              {commandDetailsCache[previewCommandId].description}
                            </p>
                          )}
                          <div className="picker-preview-section">
                            <div className="picker-preview-section-label">Task</div>
                            <div className="picker-preview-section-content">
                              {(commandDetailsCache[previewCommandId].task || "").slice(0, 300)}
                              {(commandDetailsCache[previewCommandId].task || "").length > 300 ? "…" : ""}
                            </div>
                          </div>
                          <div className="picker-preview-section">
                            <div className="picker-preview-section-label">Success Criteria</div>
                            <div className="picker-preview-section-content">
                              {(commandDetailsCache[previewCommandId].success_criteria || "").slice(0, 200)}
                              {(commandDetailsCache[previewCommandId].success_criteria || "").length > 200 ? "…" : ""}
                            </div>
                          </div>
                          <div className="picker-preview-section">
                            <div className="picker-preview-section-label">Guidelines</div>
                            <div className="picker-preview-section-content">
                              {(commandDetailsCache[previewCommandId].guidelines || "").slice(0, 200)}
                              {(commandDetailsCache[previewCommandId].guidelines || "").length > 200 ? "…" : ""}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="picker-preview-section-content">Loading…</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
