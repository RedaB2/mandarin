const BASE = "";

export async function getChats() {
  const r = await fetch(`${BASE}/api/chats`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function createChat(contextIds = []) {
  const r = await fetch(`${BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context_ids: contextIds }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getChat(chatId) {
  const r = await fetch(`${BASE}/api/chats/${chatId}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getModels() {
  const r = await fetch(`${BASE}/api/models`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getContexts() {
  const r = await fetch(`${BASE}/api/contexts`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getContext(id) {
  const r = await fetch(`${BASE}/api/contexts/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.text();
}

export async function putContext(id, body) {
  const r = await fetch(`${BASE}/api/contexts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteContext(id) {
  const r = await fetch(`${BASE}/api/contexts/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function updateChat(chatId, data) {
  const r = await fetch(`${BASE}/api/chats/${chatId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteChat(chatId) {
  const r = await fetch(`${BASE}/api/chats/${chatId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function patchMessage(chatId, messageId, content) {
  const r = await fetch(`${BASE}/api/chats/${chatId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getMemory(tag) {
  const url = tag ? `${BASE}/api/memory?tag=${encodeURIComponent(tag)}` : `${BASE}/api/memory`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function postMemory(content, tags = []) {
  const r = await fetch(`${BASE}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, tags }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function patchMemory(id, data) {
  const r = await fetch(`${BASE}/api/memory/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteMemory(id) {
  const r = await fetch(`${BASE}/api/memory/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

// ----- Rules -----

export async function getRules() {
  const r = await fetch(`${BASE}/api/rules`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getRule(id) {
  const r = await fetch(`${BASE}/api/rules/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function putRule(id, data) {
  const r = await fetch(`${BASE}/api/rules/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteRule(id) {
  const r = await fetch(`${BASE}/api/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

// ----- Commands -----

export async function getCommands() {
  const r = await fetch(`${BASE}/api/commands`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCommand(id) {
  const r = await fetch(`${BASE}/api/commands/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function putCommand(id, data) {
  const r = await fetch(`${BASE}/api/commands/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteCommand(id) {
  const r = await fetch(`${BASE}/api/commands/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

/**
 * Send message and stream assistant reply. Calls onStarted() when request accepted, onChunk(text) for each chunk, onDone(fullContent, payload) when finished.
 * On 4xx, throws with message from body.error.
 */
export async function addMessageStream(chatId, content, modelId, { onStarted, onChunk, onDone, onStatus }) {
  const r = await fetch(`${BASE}/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, model_id: modelId }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || await r.text() || "Failed to send");
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.t === "started") onStarted?.();
          if (obj.t === "executing" && obj.msg) onStatus?.(obj.msg);
          if (obj.t === "evaluating") onStatus?.("Evaluating response...");
          if (obj.t === "retrying") onStatus?.(`Retrying (attempt ${obj.attempt || 2}/3)...`);
          if (obj.t === "passed") onStatus?.(null);
          if (obj.t === "chunk" && obj.c) {
            fullContent += obj.c;
            onChunk(obj.c);
          }
          if (obj.t === "done") onDone(fullContent, obj);
          if (obj.t === "error") throw new Error(obj.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}

/**
 * Regenerate assistant reply for an existing user message. Does not add a new user message.
 * Same callbacks as addMessageStream.
 */
export async function regenerateMessageStream(chatId, userMessageId, modelId, { onStarted, onChunk, onDone }) {
  const r = await fetch(`${BASE}/api/chats/${chatId}/messages/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message_id: userMessageId, model_id: modelId }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || await r.text() || "Failed to regenerate");
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.t === "started") onStarted?.();
          if (obj.t === "chunk" && obj.c) {
            fullContent += obj.c;
            onChunk(obj.c);
          }
          if (obj.t === "done") onDone(fullContent, obj);
          if (obj.t === "error") throw new Error(obj.error);
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
}
