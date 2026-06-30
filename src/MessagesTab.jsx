// MessagesTab.jsx
// Drop this into your coach portal src/ folder and import it in App.jsx
// Requires: @supabase/supabase-js already installed, supabase client passed as prop

import { useState, useEffect, useRef, useCallback } from "react";

const COACH_NAME_KEY = "belles_coach_name";

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  } else {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

function formatFullTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Avatar({ name, size = 36 }) {
  const initials = name
    ? name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, #00ffbb22, #00ffbb44)",
        border: "1.5px solid #00ffbb55",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Orbitron', monospace",
        fontSize: size * 0.35,
        color: "#00ffbb",
        flexShrink: 0,
        fontWeight: 700,
      }}
    >
      {initials}
    </div>
  );
}

export default function MessagesTab({ supabase }) {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [coachName, setCoachName] = useState(
    () => localStorage.getItem(COACH_NAME_KEY) || ""
  );
  const [namePrompt, setNamePrompt] = useState(
    !localStorage.getItem(COACH_NAME_KEY)
  );
  const [nameInput, setNameInput] = useState("");
  const [newPhoneModal, setNewPhoneModal] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneName, setNewPhoneName] = useState("");
  const [search, setSearch] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from("sms_conversations")
      .select("*")
      .order("last_message_at", { ascending: false });
    if (!error && data) setConversations(data);
  }, [supabase]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Realtime subscription for conversations list
  useEffect(() => {
    const channel = supabase
      .channel("sms_conversations_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_conversations" },
        () => loadConversations()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [supabase, loadConversations]);

  // Load messages for active conversation
  const loadMessages = useCallback(
    async (convId) => {
      if (!convId) return;
      setLoadingMessages(true);
      const { data, error } = await supabase
        .from("sms_messages")
        .select("*")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      if (!error && data) setMessages(data);
      setLoadingMessages(false);

      // Mark as read
      await supabase
        .from("sms_conversations")
        .update({ unread_count: 0 })
        .eq("id", convId);
    },
    [supabase]
  );

  // Realtime subscription for active conversation messages
  useEffect(() => {
    if (!activeConv) return;
    loadMessages(activeConv.id);

    const channel = supabase
      .channel(`sms_messages_${activeConv.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sms_messages",
          filter: `conversation_id=eq.${activeConv.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [activeConv, supabase, loadMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectConv = (conv) => {
    setActiveConv(conv);
    setMessages([]);
    setDraft("");
    setError(null);
  };

  const handleSend = async () => {
    if (!draft.trim() || !activeConv || sending) return;
    setSending(true);
    setError(null);

    const body = draft.trim();
    setDraft("");

    try {
      const res = await fetch("/.netlify/functions/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activeConv.phone,
          body,
          coachName,
          conversationId: activeConv.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send. Check Twilio config.");
        setDraft(body); // restore draft
      }
    } catch (err) {
      setError("Network error. Try again.");
      setDraft(body);
    }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSaveCoachName = () => {
    if (!nameInput.trim()) return;
    const name = nameInput.trim();
    localStorage.setItem(COACH_NAME_KEY, name);
    setCoachName(name);
    setNamePrompt(false);
  };

  const handleStartNewConversation = async () => {
    let phone = newPhone.trim().replace(/\D/g, "");
    if (phone.length === 10) phone = "+1" + phone;
    else if (phone.length === 11 && phone.startsWith("1")) phone = "+" + phone;
    else phone = "+" + phone;

    // Check if conv already exists
    const existing = conversations.find((c) => c.phone === phone);
    if (existing) {
      setActiveConv(existing);
      setNewPhoneModal(false);
      setNewPhone("");
      setNewPhoneName("");
      return;
    }

    const { data } = await supabase
      .from("sms_conversations")
      .insert({
        phone,
        parent_name: newPhoneName || null,
        last_message_at: new Date().toISOString(),
        last_message_preview: "",
        unread_count: 0,
      })
      .select("*")
      .single();

    if (data) {
      setActiveConv(data);
      await loadConversations();
    }
    setNewPhoneModal(false);
    setNewPhone("");
    setNewPhoneName("");
  };

  const filteredConvs = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.parent_name || "").toLowerCase().includes(q) ||
      (c.player_name || "").toLowerCase().includes(q) ||
      (c.phone || "").includes(q)
    );
  });

  const displayName = (conv) =>
    conv.parent_name || conv.player_name || conv.phone;

  // Coach name prompt overlay
  if (namePrompt) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "60vh",
        }}
      >
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #00ffbb33",
            borderRadius: 12,
            padding: "32px 40px",
            maxWidth: 400,
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "'Orbitron', monospace",
              color: "#00ffbb",
              fontSize: 18,
              marginBottom: 8,
            }}
          >
            Who's texting?
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: "#888",
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            Your name will be logged with every message you send.
          </div>
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveCoachName()}
            placeholder="Your name (e.g. Coach Josh)"
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "#0d0d1a",
              border: "1px solid #00ffbb44",
              borderRadius: 8,
              color: "#fff",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              marginBottom: 16,
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          <button
            onClick={handleSaveCoachName}
            disabled={!nameInput.trim()}
            style={{
              width: "100%",
              padding: "10px 0",
              background: nameInput.trim() ? "#00ffbb" : "#00ffbb44",
              color: "#0d0d1a",
              border: "none",
              borderRadius: 8,
              fontFamily: "'Orbitron', monospace",
              fontWeight: 700,
              fontSize: 13,
              cursor: nameInput.trim() ? "pointer" : "not-allowed",
              letterSpacing: 1,
            }}
          >
            CONTINUE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 160px)",
        minHeight: 500,
        background: "#0d0d1a",
        borderRadius: 12,
        border: "1px solid #1e1e3a",
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {/* LEFT: Conversation List */}
      <div
        style={{
          width: 300,
          minWidth: 260,
          borderRight: "1px solid #1e1e3a",
          display: "flex",
          flexDirection: "column",
          background: "#0d0d1a",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: "1px solid #1e1e3a",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontFamily: "'Orbitron', monospace",
                color: "#00ffbb",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              MESSAGES
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span
                style={{ color: "#555", fontSize: 11, cursor: "pointer" }}
                onClick={() => setNamePrompt(true)}
                title="Change coach name"
              >
                {coachName}
              </span>
              <button
                onClick={() => setNewPhoneModal(true)}
                title="New conversation"
                style={{
                  background: "#00ffbb22",
                  border: "1px solid #00ffbb44",
                  borderRadius: 6,
                  color: "#00ffbb",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                +
              </button>
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parents..."
            style={{
              width: "100%",
              padding: "7px 10px",
              background: "#13132a",
              border: "1px solid #1e1e3a",
              borderRadius: 7,
              color: "#ccc",
              fontSize: 12,
              boxSizing: "border-box",
              outline: "none",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
        </div>

        {/* Conversation list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {filteredConvs.length === 0 && (
            <div
              style={{ color: "#444", padding: 24, textAlign: "center", fontSize: 12 }}
            >
              {search ? "No matches" : "No conversations yet"}
            </div>
          )}
          {filteredConvs.map((conv) => {
            const isActive = activeConv?.id === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  cursor: "pointer",
                  background: isActive ? "#131330" : "transparent",
                  borderLeft: isActive
                    ? "3px solid #00ffbb"
                    : "3px solid transparent",
                  transition: "background 0.15s",
                  borderBottom: "1px solid #13132a",
                }}
              >
                <Avatar name={displayName(conv)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        color: conv.unread_count > 0 ? "#fff" : "#aaa",
                        fontSize: 13,
                        fontWeight: conv.unread_count > 0 ? 700 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 140,
                      }}
                    >
                      {displayName(conv)}
                    </span>
                    <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>
                      {formatTime(conv.last_message_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        color: "#555",
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 170,
                      }}
                    >
                      {conv.last_message_preview || "No messages yet"}
                    </span>
                    {conv.unread_count > 0 && (
                      <span
                        style={{
                          background: "#00ffbb",
                          color: "#0d0d1a",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 6px",
                          flexShrink: 0,
                        }}
                      >
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                  {conv.player_name && (
                    <div style={{ color: "#00ffbb88", fontSize: 10, marginTop: 1 }}>
                      {conv.player_name}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: Message Thread */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#0a0a18",
        }}
      >
        {!activeConv ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#333",
              fontSize: 13,
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 32 }}>💬</div>
            <div>Select a conversation</div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid #1e1e3a",
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "#0d0d1a",
              }}
            >
              <Avatar name={displayName(activeConv)} size={38} />
              <div>
                <div
                  style={{
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    fontFamily: "'Orbitron', monospace",
                  }}
                >
                  {displayName(activeConv)}
                </div>
                <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>
                  {activeConv.phone}
                  {activeConv.player_name &&
                    ` · Player: ${activeConv.player_name}`}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 20px 8px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {loadingMessages && (
                <div style={{ color: "#333", fontSize: 12, textAlign: "center" }}>
                  Loading...
                </div>
              )}
              {messages.map((msg) => {
                const isOut = msg.direction === "outbound";
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isOut ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "72%",
                        padding: "9px 14px",
                        borderRadius: isOut
                          ? "16px 16px 4px 16px"
                          : "16px 16px 16px 4px",
                        background: isOut ? "#00ffbb" : "#1a1a2e",
                        color: isOut ? "#0a0a18" : "#ddd",
                        fontSize: 13,
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                        border: isOut ? "none" : "1px solid #1e1e3a",
                      }}
                    >
                      {msg.body}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#444",
                        marginTop: 3,
                        paddingLeft: 4,
                        paddingRight: 4,
                      }}
                    >
                      {formatFullTime(msg.created_at)}
                      {isOut && msg.sent_by && ` · ${msg.sent_by}`}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  background: "#ff444422",
                  border: "1px solid #ff444444",
                  color: "#ff8888",
                  fontSize: 12,
                  padding: "8px 20px",
                }}
              >
                {error}
              </div>
            )}

            {/* Compose */}
            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid #1e1e3a",
                background: "#0d0d1a",
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
              }}
            >
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                rows={2}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  background: "#13132a",
                  border: "1px solid #1e1e3a",
                  borderRadius: 10,
                  color: "#fff",
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', monospace",
                  resize: "none",
                  outline: "none",
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!draft.trim() || sending}
                style={{
                  padding: "10px 18px",
                  background:
                    draft.trim() && !sending ? "#00ffbb" : "#00ffbb44",
                  color: "#0a0a18",
                  border: "none",
                  borderRadius: 10,
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: draft.trim() && !sending ? "pointer" : "not-allowed",
                  letterSpacing: 1,
                  flexShrink: 0,
                  height: 42,
                }}
              >
                {sending ? "..." : "SEND"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* New conversation modal */}
      {newPhoneModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000000bb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
          onClick={() => setNewPhoneModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a2e",
              border: "1px solid #00ffbb33",
              borderRadius: 12,
              padding: "28px 32px",
              width: 360,
            }}
          >
            <div
              style={{
                fontFamily: "'Orbitron', monospace",
                color: "#00ffbb",
                fontSize: 15,
                marginBottom: 20,
              }}
            >
              New Conversation
            </div>
            <input
              autoFocus
              value={newPhoneName}
              onChange={(e) => setNewPhoneName(e.target.value)}
              placeholder="Parent name (optional)"
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "#0d0d1a",
                border: "1px solid #1e1e3a",
                borderRadius: 7,
                color: "#fff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                marginBottom: 10,
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && newPhone.trim() && handleStartNewConversation()
              }
              placeholder="Phone number (e.g. 8175551234)"
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "#0d0d1a",
                border: "1px solid #1e1e3a",
                borderRadius: 7,
                color: "#fff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                marginBottom: 16,
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setNewPhoneModal(false)}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: "transparent",
                  border: "1px solid #333",
                  borderRadius: 7,
                  color: "#666",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleStartNewConversation}
                disabled={!newPhone.trim()}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  background: newPhone.trim() ? "#00ffbb" : "#00ffbb44",
                  border: "none",
                  borderRadius: 7,
                  color: "#0a0a18",
                  cursor: newPhone.trim() ? "pointer" : "not-allowed",
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                START
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
