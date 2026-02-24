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
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ATTACHMENTS = 3;
const ALLOWED_ATTACHMENT_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".py", ".png", ".jpg", ".jpeg", ".webp"];
const SIDEBAR_WIDTH_STORAGE_KEY = "mandarin-chat-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "mandarin-chat-sidebar-collapsed";
const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 460;
const SIDEBAR_COLLAPSED_WIDTH = 68;
const CHAT_MAIN_MIN_WIDTH = 360;
const MOBILE_SIDEBAR_BREAKPOINT = 768;

function clampSidebarWidth(width) {
  const parsed = Number(width);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  if (typeof window === "undefined") {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed));
  }
  const viewportLimitedMax = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - CHAT_MAIN_MIN_WIDTH),
  );
  return Math.min(viewportLimitedMax, Math.max(SIDEBAR_MIN_WIDTH, parsed));
}

function getInitialSidebarWidth() {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (stored == null) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(stored);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function getInitialSidebarCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) ?? "false");
  } catch {
    return false;
  }
}

function getChatInitial(title) {
  const text = String(title || "").trim();
  return text ? text[0].toUpperCase() : "?";
}

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
  const [pendingWebSearchEnabled, setPendingWebSearchEnabled] = useState(false);
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
  const [expandedSourcesMessageIds, setExpandedSourcesMessageIds] = useState(new Set());
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => getInitialSidebarWidth());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => getInitialSidebarCollapsed());
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`).matches
      : false),
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const menuTriggerRef = useRef(null);
  const menuRef = useRef(null);
  const contextDropdownRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const sidebarResizeRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT_WIDTH });
  const streamingChatIdRef = useRef(null);
  const streamAbortControllerRef = useRef(null);
  const currentChatIdRef = useRef(currentChat?.id ?? null);
  useEffect(() => {
    currentChatIdRef.current = currentChat?.id ?? null;
  }, [currentChat?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT}px)`);
    const updateViewport = (event) => setIsMobileViewport(event.matches);
    setIsMobileViewport(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewport);
      return () => mediaQuery.removeEventListener("change", updateViewport);
    }
    mediaQuery.addListener(updateViewport);
    return () => mediaQuery.removeListener(updateViewport);
  }, []);

  useEffect(() => {
    const onResize = () => setSidebarWidth((prev) => clampSidebarWidth(prev));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar || isMobileViewport) return;
    const onPointerMove = (event) => {
      const delta = event.clientX - sidebarResizeRef.current.startX;
      setSidebarWidth(clampSidebarWidth(sidebarResizeRef.current.startWidth + delta));
    };
    const stopResizing = () => setIsResizingSidebar(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    document.body.classList.add("sidebar-resizing");
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      document.body.classList.remove("sidebar-resizing");
    };
  }, [isResizingSidebar, isMobileViewport]);

  useEffect(() => {
    if (isMobileViewport) setIsResizingSidebar(false);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsMobileSidebarOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileViewport) setIsMobileSidebarOpen(false);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isSidebarCollapsed) return;
    setMenuOpenForChatId(null);
    setRenamingChatId(null);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(clampSidebarWidth(sidebarWidth))));
    } catch {}
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(isSidebarCollapsed));
    } catch {}
  }, [isSidebarCollapsed]);

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
    /* Only skip loading when the selected chat is the one currently streaming and we're still sending */
    if (sending && currentChat?.id === streamingChatIdRef.current) return;
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
    setIsMobileSidebarOpen(false);
  };

  const handleSelectChat = (chat) => {
    setCurrentChat(chat);
    setIsMobileSidebarOpen(false);
  };

  const toggleSidebarCollapsed = () => {
    setIsSidebarCollapsed((prev) => !prev);
    setMenuOpenForChatId(null);
    setRenamingChatId(null);
  };

  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false);
  };

  const startSidebarResize = (event) => {
    if (isMobileViewport || isSidebarCollapsed) return;
    event.preventDefault();
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
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
          const chatIdForStream = currentChat.id;
          streamingChatIdRef.current = chatIdForStream;
          const controller = new AbortController();
          streamAbortControllerRef.current = controller;

          setSending(true);
          setError(null);
          setStreamingContent("");
          const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
          setMessages([...updatedMessages, placeholderAssistant]);
          setStreamingStatus("Regenerating...");
          regenerateMessageStream(currentChat.id, Number(editingMessageId), selectedModel, {
            signal: controller.signal,
            onChunk: (c) => setStreamingContent((prev) => prev + c),
            onStatus: (msg) => setStreamingStatus(msg),
            onCancel: () => {
              setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
              setStreamingContent("");
              setStreamingStatus(null);
              setSending(false);
              streamingChatIdRef.current = null;
              streamAbortControllerRef.current = null;
            },
            onDone: (fullContent, payload) => {
              setStreamingContent("");
              setStreamingStatus(null);
              streamingChatIdRef.current = null;
              streamAbortControllerRef.current = null;
              const titleFromPayload = payload?.title;
              if (currentChatIdRef.current === chatIdForStream) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
                  )
                );
                setSending(false);
                if (titleFromPayload != null) {
                  setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: titleFromPayload } : c)));
                  setCurrentChat((prev) => prev && prev.id === chatIdForStream ? { ...prev, title: titleFromPayload } : prev);
                }
                getChat(chatIdForStream).then((d) => setMessages(d.messages || []));
                getChats().then((chatList) => {
                  setChats(
                    chatList.map((c) =>
                      c.id === chatIdForStream && titleFromPayload != null ? { ...c, title: titleFromPayload } : c
                    )
                  );
                  const viewingId = currentChatIdRef.current;
                  const updated = chatList.find((c) => c.id === viewingId);
                  if (updated) {
                    setCurrentChat(viewingId === chatIdForStream && titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
                  } else if (!chatList.some((c) => c.id === viewingId)) {
                    setCurrentChat(null);
                    setMessages([]);
                  }
                });
              } else {
                setSending(false);
                getChat(chatIdForStream).then((data) => {
                  setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: data.title ?? c.title } : c)));
                }).catch(() => {});
              }
            },
          }).catch((e) => {
            if (e?.name === "AbortError") {
              setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
              setStreamingContent("");
              setStreamingStatus(null);
              setSending(false);
              streamingChatIdRef.current = null;
              streamAbortControllerRef.current = null;
              return;
            }
            setError(e.message);
            setSending(false);
            setStreamingContent("");
            setStreamingStatus(null);
            setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
          });
        }
      })
      .catch((e) => setError(e.message));
  };

  const copyMessage = (msg) => {
    navigator.clipboard.writeText(msg.content || "").then(() => setMenuOpenForMessageId(null)).catch(() => setError("Copy failed"));
  };

  const handleResendMessage = (m, msgIndex) => {
    if (!currentChat || !selectedModel || sending || m.role !== "user") return;
    if (!isPersistedMessage(m) || m.id == null) return;
    setMenuOpenForMessageId(null);

    const chatIdForStream = currentChat.id;
    streamingChatIdRef.current = chatIdForStream;
    const controller = new AbortController();
    streamAbortControllerRef.current = controller;

    const nextMsg = messages[msgIndex + 1];
    const hasFollowingAssistant = nextMsg && nextMsg.role === "assistant";

    const startRegenerate = (baseMessages) => {
      const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
      setMessages([...baseMessages, placeholderAssistant]);
      setStreamingStatus("Regenerating...");
      setSending(true);
      setError(null);
      setStreamingContent("");
      regenerateMessageStream(chatIdForStream, Number(m.id), selectedModel, {
        signal: controller.signal,
        onChunk: (c) => setStreamingContent((prev) => prev + c),
        onStatus: (msg) => setStreamingStatus(msg),
        onCancel: () => {
          setMessages((prev) => prev.filter((x) => x.id !== "temp-assistant"));
          setStreamingContent("");
          setStreamingStatus(null);
          setSending(false);
          streamingChatIdRef.current = null;
          streamAbortControllerRef.current = null;
        },
        onDone: (fullContent, payload) => {
          setStreamingContent("");
          setStreamingStatus(null);
          streamingChatIdRef.current = null;
          streamAbortControllerRef.current = null;
          const titleFromPayload = payload?.title;
          const stillViewingStreamingChat = currentChatIdRef.current === chatIdForStream;
          if (stillViewingStreamingChat) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === "temp-assistant" ? { ...msg, content: fullContent, id: payload?.id ?? msg.id } : msg
              )
            );
            setStreamingContent("");
            setSending(false);
            if (titleFromPayload != null) {
              setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: titleFromPayload } : c)));
              setCurrentChat((prev) => prev && prev.id === chatIdForStream ? { ...prev, title: titleFromPayload } : prev);
            }
            getChat(chatIdForStream).then((d) => setMessages(d.messages || []));
            getChats().then((chatList) => {
              setChats((prev) =>
                prev.map((c) => (c.id === chatIdForStream && titleFromPayload != null ? { ...c, title: titleFromPayload } : c))
              );
              const viewingId = currentChatIdRef.current;
              const updated = chatList.find((c) => c.id === viewingId);
              if (updated) setCurrentChat(viewingId === chatIdForStream && titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
              else if (!chatList.some((c) => c.id === viewingId)) {
                setCurrentChat(null);
                setMessages([]);
              }
            });
          } else {
            setSending(false);
            setStreamingContent("");
            getChat(chatIdForStream).then((data) => {
              setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: data.title ?? c.title } : c)));
            }).catch(() => {});
          }
        },
      }).catch((e) => {
        if (e?.name === "AbortError") {
          setMessages((prev) => prev.filter((x) => x.id !== "temp-assistant"));
          setStreamingContent("");
          setStreamingStatus(null);
          setSending(false);
          streamingChatIdRef.current = null;
          streamAbortControllerRef.current = null;
          return;
        }
        setError(e.message);
        setSending(false);
        setStreamingStatus(null);
        setStreamingContent("");
        setMessages((prev) => prev.filter((x) => x.id !== "temp-assistant"));
        streamingChatIdRef.current = null;
        streamAbortControllerRef.current = null;
      });
    };

    if (hasFollowingAssistant) {
      patchMessage(currentChat.id, m.id, m.content)
        .then((truncated) => {
          startRegenerate(truncated);
        })
        .catch((e) => setError(e.message));
    } else {
      startRegenerate(messages);
    }
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
    const chatIdForStream = currentChat.id;
    streamingChatIdRef.current = chatIdForStream;
    const controller = new AbortController();
    streamAbortControllerRef.current = controller;

    patchMessage(currentChat.id, Number(userMsg.id), userMsg.content)
      .then((truncated) => {
        const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
        setMessages([...truncated, placeholderAssistant]);
        setStreamingStatus("Regenerating...");
        return regenerateMessageStream(currentChat.id, userMsg.id, selectedModel, {
          signal: controller.signal,
          onChunk: (c) => setStreamingContent((prev) => prev + c),
          onStatus: (msg) => setStreamingStatus(msg),
          onCancel: () => {
            setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
            setStreamingContent("");
            setStreamingStatus(null);
            setSending(false);
            streamingChatIdRef.current = null;
            streamAbortControllerRef.current = null;
          },
          onDone: (fullContent, payload) => {
            setStreamingContent("");
            setStreamingStatus(null);
            streamingChatIdRef.current = null;
            streamAbortControllerRef.current = null;
            const titleFromPayload = payload?.title;
            if (currentChatIdRef.current === chatIdForStream) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
                )
              );
              setSending(false);
              if (titleFromPayload != null) {
                setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: titleFromPayload } : c)));
                setCurrentChat((prev) => prev && prev.id === chatIdForStream ? { ...prev, title: titleFromPayload } : prev);
              }
              getChat(chatIdForStream).then((d) => setMessages(d.messages || []));
              getChats().then((chatList) => {
                setChats(
                  chatList.map((c) =>
                    c.id === chatIdForStream && titleFromPayload != null ? { ...c, title: titleFromPayload } : c
                  )
                );
                const viewingId = currentChatIdRef.current;
                const updated = chatList.find((c) => c.id === viewingId);
                if (updated) {
                  setCurrentChat(viewingId === chatIdForStream && titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
                } else if (!chatList.some((c) => c.id === viewingId)) {
                  setCurrentChat(null);
                  setMessages([]);
                }
              });
            } else {
              setSending(false);
              getChat(chatIdForStream).then((data) => {
                setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: data.title ?? c.title } : c)));
              }).catch(() => {});
            }
          },
        });
      })
      .catch((e) => {
        if (e?.name === "AbortError") {
          setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
          setStreamingContent("");
          setStreamingStatus(null);
          setSending(false);
          streamingChatIdRef.current = null;
          streamAbortControllerRef.current = null;
          return;
        }
        setError(e.message);
        setSending(false);
        setStreamingStatus(null);
      });
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const ext = (name) => (name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "");
    const valid = files.filter((f) => {
      if (f.size > MAX_ATTACHMENT_SIZE) {
        setError(`File too large: ${f.name} (max 10 MB)`);
        return false;
      }
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext(f.name))) {
        setError(`File type not allowed: ${f.name}`);
        return false;
      }
      return true;
    });
    setError(null);
    setPendingAttachments((prev) => [...prev, ...valid].slice(0, MAX_ATTACHMENTS));
  };

  const removeAttachment = (index) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || !selectedModel) return;
    setSending(true);
    setError(null);
    setStreamingContent("");
    const userMsg = { id: "temp-user", role: "user", content, attachments: pendingAttachments.length ? pendingAttachments.map((f) => ({ type: "file", filename: f.name })) : [] };
    const placeholderAssistant = { id: "temp-assistant", role: "assistant", content: "" };
    setInputValue("");
    const attachmentsToSend = [...pendingAttachments];
    setPendingAttachments([]);

    if (!currentChat) {
      createChat({ context_ids: pendingContextIds, web_search_enabled: pendingWebSearchEnabled })
        .then((chat) => {
          const chatIdForStream = chat.id;
          streamingChatIdRef.current = chatIdForStream;
          const controller = new AbortController();
          streamAbortControllerRef.current = controller;

          setChats((prev) => [chat, ...prev]);
          setCurrentChat(chat);
          setMessages([userMsg, placeholderAssistant]);
          setStreamingStatus(content.trim().startsWith("/") ? "Completing task..." : "Thinking...");
          return addMessageStream(chat.id, content, selectedModel, {
            attachments: attachmentsToSend,
            signal: controller.signal,
            onChunk: (c) => setStreamingContent((prev) => prev + c),
            onStatus: (msg) => setStreamingStatus(msg),
            onCancel: () => {
              setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
              setStreamingContent("");
              setStreamingStatus(null);
              setSending(false);
              streamingChatIdRef.current = null;
              streamAbortControllerRef.current = null;
            },
            onDone: (fullContent, payload) => {
              setStreamingStatus(null);
              streamingChatIdRef.current = null;
              streamAbortControllerRef.current = null;
              const titleFromPayload = payload?.title;
              if (currentChatIdRef.current === chatIdForStream) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
                  )
                );
                setStreamingContent("");
                setSending(false);
                if (titleFromPayload != null) {
                  setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: titleFromPayload } : c)));
                  setCurrentChat((prev) => prev && prev.id === chatIdForStream ? { ...prev, title: titleFromPayload } : prev);
                }
                getChat(chatIdForStream).then((d) => setMessages(d.messages || []));
                getChats().then((chatList) => {
                  setChats((prev) =>
                    prev.map((c) => (c.id === chatIdForStream && titleFromPayload != null ? { ...c, title: titleFromPayload } : c))
                  );
                  const viewingId = currentChatIdRef.current;
                  const updated = chatList.find((c) => c.id === viewingId);
                  if (updated) setCurrentChat(viewingId === chatIdForStream && titleFromPayload != null ? { ...updated, title: titleFromPayload } : updated);
                });
              } else {
                setSending(false);
                setStreamingContent("");
                getChat(chatIdForStream).then((data) => {
                  setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: data.title ?? c.title } : c)));
                }).catch(() => {});
              }
            },
          });
        })
        .catch((e) => {
          if (e?.name === "AbortError") {
            setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
            setStreamingContent("");
            setStreamingStatus(null);
            setSending(false);
            streamingChatIdRef.current = null;
            streamAbortControllerRef.current = null;
            return;
          }
          setError(e.message);
          setSending(false);
          setStreamingStatus(null);
        });
      return;
    }

    const chatIdForStream = currentChat.id;
    streamingChatIdRef.current = chatIdForStream;
    const controller = new AbortController();
    streamAbortControllerRef.current = controller;

    setMessages((prev) => [...prev, userMsg, placeholderAssistant]);
    setStreamingStatus(content.trim().startsWith("/") ? "Completing task..." : "Thinking...");
    addMessageStream(chatIdForStream, content, selectedModel, {
      attachments: attachmentsToSend,
      signal: controller.signal,
      onChunk: (c) => setStreamingContent((prev) => prev + c),
      onStatus: (msg) => setStreamingStatus(msg),
      onCancel: () => {
        setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
        setStreamingContent("");
        setStreamingStatus(null);
        setSending(false);
        streamingChatIdRef.current = null;
        streamAbortControllerRef.current = null;
      },
      onDone: (fullContent, payload) => {
        setStreamingStatus(null);
        streamingChatIdRef.current = null;
        streamAbortControllerRef.current = null;
        const titleFromPayload = payload?.title;
        const stillViewingStreamingChat = currentChatIdRef.current === chatIdForStream;
        if (stillViewingStreamingChat) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === "temp-assistant" ? { ...m, content: fullContent, id: payload?.id ?? m.id } : m
            )
          );
          setStreamingContent("");
          setSending(false);
          if (titleFromPayload != null) {
            setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: titleFromPayload } : c)));
            setCurrentChat((prev) => prev && prev.id === chatIdForStream ? { ...prev, title: titleFromPayload } : prev);
          }
          getChat(chatIdForStream).then((d) => setMessages(d.messages || []));
          getChats().then((chatList) => {
            setChats((prev) =>
              prev.map((c) => (c.id === chatIdForStream && titleFromPayload != null ? { ...c, title: titleFromPayload } : c))
            );
            const viewingId = currentChatIdRef.current;
            const updated = chatList.find((c) => c.id === viewingId);
            if (updated) setCurrentChat(titleFromPayload != null && viewingId === chatIdForStream ? { ...updated, title: titleFromPayload } : updated);
            else if (!chatList.some((c) => c.id === viewingId)) {
              setCurrentChat(null);
              setMessages([]);
            }
          });
        } else {
          setSending(false);
          setStreamingContent("");
          getChat(chatIdForStream).then((data) => {
            setChats((prev) => prev.map((c) => (c.id === chatIdForStream ? { ...c, title: data.title ?? c.title } : c)));
          }).catch(() => {});
        }
      },
    }).catch((e) => {
      if (e?.name === "AbortError") {
        setMessages((prev) => prev.filter((m) => m.id !== "temp-assistant"));
        setStreamingContent("");
        setStreamingStatus(null);
        setSending(false);
        streamingChatIdRef.current = null;
        streamAbortControllerRef.current = null;
        return;
      }
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
      streamingChatIdRef.current = null;
      streamAbortControllerRef.current = null;
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

  const isDesktopSidebarCollapsed = !isMobileViewport && isSidebarCollapsed;
  const sidebarInlineWidth = isDesktopSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const sidebarStyle = isMobileViewport
    ? undefined
    : { "--sidebar-width": `${Math.round(sidebarInlineWidth)}px` };

  return (
    <div className={`chat-page ${isResizingSidebar ? "chat-page--sidebar-resizing" : ""}`}>
      {isMobileViewport && isMobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-mobile-backdrop"
          onClick={closeMobileSidebar}
          aria-label="Close chats sidebar"
        />
      )}
      <aside
        className={`sidebar ${isDesktopSidebarCollapsed ? "sidebar--collapsed" : ""} ${isMobileViewport ? "sidebar--mobile" : ""} ${isMobileSidebarOpen ? "sidebar--mobile-open" : ""}`}
        style={sidebarStyle}
        aria-hidden={isMobileViewport && !isMobileSidebarOpen}
      >
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={isMobileViewport ? closeMobileSidebar : toggleSidebarCollapsed}
            aria-label={
              isMobileViewport
                ? "Close sidebar"
                : isDesktopSidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
            aria-expanded={isMobileViewport ? undefined : !isDesktopSidebarCollapsed}
            title={
              isMobileViewport
                ? "Close sidebar"
                : isDesktopSidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
          >
            {isMobileViewport ? "×" : isDesktopSidebarCollapsed ? "»" : "«"}
          </button>
          <button
            className="new-chat-btn"
            onClick={() => handleNewChat()}
            title={isDesktopSidebarCollapsed ? "New chat" : undefined}
            aria-label="New chat"
          >
            {isDesktopSidebarCollapsed ? "+" : "+ New chat"}
          </button>
        </div>
        {loading ? (
          <p className="sidebar-loading">Loading...</p>
        ) : isDesktopSidebarCollapsed ? (
          <ul className="chat-list chat-list--collapsed">
            {chats.length === 0 ? (
              <li className="sidebar-empty sidebar-empty--compact">No chats</li>
            ) : (
              chats.map((c) => (
                <li key={c.id} className="chat-list-item chat-list-item--collapsed">
                  <button
                    type="button"
                    className={`chat-item chat-item--collapsed ${currentChat?.id === c.id ? "active" : ""}`}
                    onClick={() => handleSelectChat(c)}
                    title={c.title || "Untitled chat"}
                    aria-label={`Open chat: ${c.title || "Untitled chat"}`}
                  >
                    <span className="chat-item-collapsed-label">{getChatInitial(c.title)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
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
      {!isMobileViewport && !isDesktopSidebarCollapsed && (
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-label="Resize chats sidebar"
          aria-orientation="vertical"
          onPointerDown={startSidebarResize}
        />
      )}
      <section className="chat-main">
        {isMobileViewport && (
          <div className="chat-mobile-toolbar">
            <button
              type="button"
              className="sidebar-mobile-open-btn"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Open chats sidebar"
            >
              ☰ Chats
            </button>
          </div>
        )}
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
                      <>
                        {m.content}
                        {m.attachments?.length > 0 && (
                          <div className="message-attachments">
                            {m.attachments.map((att, idx) => {
                              const ext = (att.filename || "").includes(".") ? "." + (att.filename || "").split(".").pop().toLowerCase() : "";
                              const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[ext] || "image/png";
                              return (
                                <div key={idx} className="message-attachment">
                                  {att.type === "image" && att.image_data ? (
                                    <img
                                      src={`data:${mime};base64,${att.image_data}`}
                                      alt={att.filename || "Image"}
                                      className="message-attachment-img"
                                    />
                                  ) : null}
                                  <span className="message-attachment-name">Attachment: {att.filename || "file"}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {m.role === "assistant" && m.meta?.web_search?.length > 0 && (
                    <div className="message-sources">
                      <button
                        type="button"
                        className="message-sources-toggle"
                        onClick={() => setExpandedSourcesMessageIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })}
                        aria-expanded={expandedSourcesMessageIds.has(m.id)}
                      >
                        {expandedSourcesMessageIds.has(m.id) ? "▼" : "▶"} Sources
                      </button>
                      {expandedSourcesMessageIds.has(m.id) && (
                        <div className="message-sources-list">
                          {m.meta.web_search.map((item, idx) => (
                            <div key={idx} className="message-sources-item">
                              <div className="message-sources-query">“{item.query}”</div>
                              {(() => {
                                const seen = new Set();
                                return (item.results || []).filter((r) => {
                                  const url = (r.url || "").trim().toLowerCase();
                                  if (!url || seen.has(url)) return false;
                                  seen.add(url);
                                  return true;
                                });
                              })().map((r, rIdx) => (
                                <div key={rIdx} className="message-sources-result">
                                  <a href={r.url || "#"} target="_blank" rel="noopener noreferrer" className="message-sources-link">
                                    {r.title || r.url || "Link"}
                                  </a>
                                  {r.url && (
                                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="message-sources-url">
                                      {r.url}
                                    </a>
                                  )}
                                  {(r.snippet || r.content) && (
                                    <p className="message-sources-snippet">{(r.snippet || r.content).slice(0, 300)}{(r.snippet || r.content).length > 300 ? "…" : ""}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
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
                            {m.role === "user" && isPersistedMessage(m) && currentChat && selectedModel && (
                              <button
                                type="button"
                                className="message-actions-item"
                                onClick={() => handleResendMessage(m, msgIndex)}
                                role="menuitem"
                              >
                                Resend message
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
            <label className="web-search-toggle">
              <input
                type="checkbox"
                checked={currentChat ? !!currentChat.web_search_enabled : pendingWebSearchEnabled}
                onChange={() => {
                  if (currentChat) {
                    updateChat(currentChat.id, { web_search_enabled: !currentChat.web_search_enabled })
                      .then((updated) => {
                        setCurrentChat(updated);
                        setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
                      })
                      .catch((e) => setError(e.message));
                  } else {
                    setPendingWebSearchEnabled((prev) => !prev);
                  }
                }}
              />
              <span>Web search</span>
            </label>
          </div>
          {pendingAttachments.length > 0 && (
            <div className="input-attachments">
              {pendingAttachments.map((file, idx) => (
                <span key={idx} className="input-attachment-chip">
                  {file.name}
                  <button type="button" className="input-attachment-remove" onClick={() => removeAttachment(idx)} aria-label="Remove attachment">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="input-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.py,.png,.jpg,.jpeg,.webp"
              multiple
              className="input-file-hidden"
              onChange={handleFileSelect}
              aria-hidden
            />
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={pendingAttachments.length >= MAX_ATTACHMENTS || sending}
              title={`Attach file (max ${MAX_ATTACHMENTS}, 10 MB each). PDF, DOCX, text, images.`}
              aria-label="Attach file"
            >
              📎
            </button>
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
            {sending ? (
              <button
                type="button"
                className="send-btn send-btn--stop"
                onClick={() => streamAbortControllerRef.current?.abort()}
                aria-label="Stop generating"
                title="Stop"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="send-btn"
                onClick={handleSend}
                disabled={!inputValue.trim() || !selectedModel}
              >
                Send
              </button>
            )}
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
