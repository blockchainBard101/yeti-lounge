"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Send, Sparkles, Image as ImageIcon, BarChart2, Newspaper, Loader2, Code, Users, MessageSquare, Copy, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useZkLogin, useEnokiFlow } from "@mysten/enoki/react";
import ReactMarkdown from "react-markdown";
import { payLofi, getAuthToken } from "./sui";


interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  blobId?: string;
}

interface YetiCopilotProps {
  isOpen: boolean;
  onClose: () => void;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export const YetiCopilot: React.FC<YetiCopilotProps> = ({ isOpen, onClose }) => {
  const { address } = useZkLogin();
  const enokiFlow = useEnokiFlow();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isMultiAgent, setIsMultiAgent] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "generate">("chat");
  const [imagePrompt, setImagePrompt] = useState("");
  const [guestSessionId, setGuestSessionId] = useState<string>("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [freeChats, setFreeChats] = useState(5);
  const [freeImages, setFreeImages] = useState(1);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [requiredLofi, setRequiredLofi] = useState(0);
  const [confirmPaymentConfig, setConfirmPaymentConfig] = useState<{
    isOpen: boolean;
    cost: number;
    actionType: "chat" | "generate" | "debate";
    onConfirm: () => void;
  }>({
    isOpen: false,
    cost: 0,
    actionType: "chat",
    onConfirm: () => {},
  });
  
  const chatEndRef = useRef<HTMLDivElement>(null);




  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Initialize unique browser-specific guest session ID
  useEffect(() => {
    let gid = localStorage.getItem("yeti_co_pilot_guest_id");
    if (!gid) {
      gid = `guest-${Math.random().toString(36).substring(2, 11)}-${Date.now().toString(36)}`;
      try {
        localStorage.setItem("yeti_co_pilot_guest_id", gid);
      } catch (err) {}
    }
    setGuestSessionId(gid);
  }, []);

  const sessionId = address || guestSessionId || "global";

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load chat history from LocalStorage (fast mirror) & Walrus Memory on open
  useEffect(() => {
    if (!isOpen) return;

    let active = true;

    // Pre-populate with local storage history immediately for fast/complete rendering
    let localHistory: Message[] = [];
    try {
      const stored = localStorage.getItem(`lofi_yeti_chat_history_${sessionId}`);
      if (stored) {
        localHistory = JSON.parse(stored);
        setMessages(localHistory);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.warn("Failed to parse local chat history:", err);
    }

    const loadHistory = async () => {
      setLoadingHistory(true);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (address) {
          try {
            const token = await getAuthToken(enokiFlow, address);
            headers["Authorization"] = `Bearer ${token}`;
          } catch (authErr) {
            console.warn("Could not retrieve auth token for loadHistory:", authErr);
          }
        }
        const res = await fetch(`${BACKEND_URL}/ai/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: "", sessionId }),
        });
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          if (data.history && Array.isArray(data.history)) {
            const formatted: Message[] = data.history.map((h: any, idx: number) => {
              // Extract potential BlobId from history text (base64 URL-safe characters)
              const blobMatch = h.content.match(/\[BlobId: ([A-Za-z0-9_-]+)\]/);
              const blobId = blobMatch ? blobMatch[1] : undefined;
              return {
                id: `hist-${idx}-${Date.now()}`,
                role: h.role,
                content: h.content.replace(/\[BlobId: [A-Za-z0-9_-]+\]\s*/, ""),
                blobId,
                image: blobId ? `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}` : undefined,
              };
            });

            setMessages((currentMessages) => {
              // Merge current messages and backend history, removing duplicates by content/role
              const merged = [...currentMessages];
              for (const item of formatted) {
                const exists = merged.some(
                  (m) => m.content === item.content && m.role === item.role
                );
                if (!exists) {
                  merged.push(item);
                }
              }
              try {
                localStorage.setItem(`lofi_yeti_chat_history_${sessionId}`, JSON.stringify(merged));
              } catch (err) {}
              return merged;
            });
          }
        }
      } catch (err) {
        console.error("Failed to load chat history from Walrus Memory:", err);
      } finally {
        if (active) {
          setLoadingHistory(false);
        }
      }
    };

    const fetchLimits = async () => {
      if (!address) return;
      try {
        const res = await fetch(`${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.dbUser) {
            setFreeChats(data.dbUser.freeChatsRemaining);
            setFreeImages(data.dbUser.freeImageGensRemaining);
          }
        }
      } catch (err) {
        console.error("Failed to fetch limits:", err);
      }
    };

    loadHistory();
    fetchLimits();

    return () => {
      active = false;

    };
  }, [isOpen, sessionId]);

  const executeSend = async (text: string, txDigest?: string) => {
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: isMultiAgent ? `👥 [Multi-Agent Vibe Check] ${text}` : text,
    };

    const newMsgs = [...messages, userMessage];
    setMessages(newMsgs);
    try {
      localStorage.setItem(`lofi_yeti_chat_history_${sessionId}`, JSON.stringify(newMsgs));
    } catch {}
    setInput("");

    try {
      const endpoint = isMultiAgent ? "/ai/multi-agent" : "/ai/chat";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (address) {
        try {
          const token = await getAuthToken(enokiFlow, address);
          headers["Authorization"] = `Bearer ${token}`;
        } catch (authErr) {
          console.warn("Could not retrieve auth token:", authErr);
        }
      }
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          message: text, 
          sessionId,
          suiAddress: address || undefined,
          txDigest,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to communicate with Yeti.");
      }

      const data = await res.json();
      
      const assistantMessage: Message = {
        id: `yeti-${Date.now()}`,
        role: "assistant",
        content: data.response,
        blobId: data.blobId,
      };

      const finalMsgs = [...newMsgs, assistantMessage];
      setMessages(finalMsgs);
      try {
        localStorage.setItem(`lofi_yeti_chat_history_${sessionId}`, JSON.stringify(finalMsgs));
      } catch {}

      // Update remaining free count from database
      if (address) {
        const profileRes = await fetch(`${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.dbUser) {
            setFreeChats(profileData.dbUser.freeChatsRemaining);
          }
        }
      }
    } catch (err: any) {
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `🥶 Yeti is having a brain freeze: ${err.message || err}. Let's try again!`,
      };
      const finalMsgs = [...newMsgs, errorMessage];
      setMessages(finalMsgs);
      try {
        localStorage.setItem(`lofi_yeti_chat_history_${sessionId}`, JSON.stringify(finalMsgs));
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  // Send message
  const handleSend = async (text: string) => {
    if (!text.trim() || loading) return;

    if (freeChats <= 0 && address) {
      const cost = isMultiAgent ? 2.0 : 0.1;
      setConfirmPaymentConfig({
        isOpen: true,
        cost,
        actionType: isMultiAgent ? "debate" : "chat",
        onConfirm: async () => {
          setConfirmPaymentConfig(prev => ({ ...prev, isOpen: false }));
          setLoading(true);
          try {
            const txDigest = await payLofi(cost, enokiFlow, address);
            await executeSend(text, txDigest);
          } catch (payErr: any) {
            if (payErr.message?.includes("Insufficient $LOFI") || payErr.message?.includes("No LOFI coins") || payErr.message?.includes("No SUI coins")) {
              setRequiredLofi(cost);
              setShowTopUpModal(true);
            } else {
              alert(`Payment failed: ${payErr.message || payErr}`);
            }
          }
        }
      });
    } else {
      setLoading(true);
      await executeSend(text);
    }
  };
  const executeGenerateImage = async (customPrompt?: string, txDigest?: string) => {
    const promptText = customPrompt || "Generate a cozy snowboarder Yeti drawing";
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: customPrompt ? `🎨 Mascot Image: ${customPrompt}` : "🎨 Mascot Image: Cozy Yeti snowboarder",
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (address) {
        try {
          const token = await getAuthToken(enokiFlow, address);
          headers["Authorization"] = `Bearer ${token}`;
        } catch (authErr) {
          console.warn("Could not retrieve auth token:", authErr);
        }
      }

      const res = await fetch(`${BACKEND_URL}/ai/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          prompt: promptText,
          suiAddress: address || undefined,
          txDigest,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Image generation failed");
      }

      const data = await res.json();
      
      // 1. Log the user's generation command to memory
      await fetch(`${BACKEND_URL}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          message: userMessage.content, 
          sessionId,
          role: "user"
        }),
      });

      // 2. Log the assistant's generated image pointer to memory
      const assistantMessageText = data.blobId 
        ? `Generated image: [BlobId: ${data.blobId}]`
        : `Generated image: ${data.url.startsWith("data:") ? `${data.url.slice(0, 30)}... [Base64]` : data.url}`;

      await fetch(`${BACKEND_URL}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          message: assistantMessageText, 
          sessionId,
          role: "assistant"
        }),
      });

      const assistantMessage: Message = {
        id: `yeti-${Date.now()}`,
        role: "assistant",
        content: "Here is your cozy Yeti artwork! ❄️",
        image: data.url.startsWith("http") || data.url.startsWith("/") || data.url.startsWith("data:") 
          ? data.url 
          : `${BACKEND_URL}${data.url}`,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setImagePrompt(""); // Clear custom image workspace input

      if (address) {
        const profileRes = await fetch(`${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.dbUser) {
            setFreeImages(profileData.dbUser.freeImageGensRemaining);
          }
        }
      }
    } catch (err: any) {
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `🥶 Failed to generate mascot: ${err.message || err}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  // Generate image
  const handleGenerateImage = async (customPrompt?: string) => {
    if (loading) return;

    if (freeImages <= 0 && address) {
      setConfirmPaymentConfig({
        isOpen: true,
        cost: 1.0,
        actionType: "generate",
        onConfirm: async () => {
          setConfirmPaymentConfig(prev => ({ ...prev, isOpen: false }));
          setLoading(true);
          try {
            const txDigest = await payLofi(1.0, enokiFlow, address);
            await executeGenerateImage(customPrompt, txDigest);
          } catch (payErr: any) {
            if (payErr.message?.includes("Insufficient $LOFI") || payErr.message?.includes("No LOFI coins") || payErr.message?.includes("No SUI coins")) {
              setRequiredLofi(1.0);
              setShowTopUpModal(true);
            } else {
              alert(`Payment failed: ${payErr.message || payErr}`);
            }
            setLoading(false);
          }
        }
      });
    } else {
      setLoading(true);
      await executeGenerateImage(customPrompt);
    }
  };


  if (!isOpen || !address) return null;

  return (
    <>
      <style>{`
        .yeti-markdown p {
          margin-bottom: 0.5rem;
        }
        .yeti-markdown p:last-child {
          margin-bottom: 0;
        }
        .yeti-markdown strong {
          font-weight: 750;
        }
        .yeti-markdown ul, .yeti-markdown ol {
          padding-left: 1.1rem;
          margin-bottom: 0.5rem;
        }
        .yeti-markdown ul {
          list-style-type: disc;
        }
        .yeti-markdown ol {
          list-style-type: decimal;
        }
        .yeti-markdown h1, .yeti-markdown h2, .yeti-markdown h3 {
          font-weight: 700;
          margin-top: 0.5rem;
          margin-bottom: 0.25rem;
        }
      `}</style>
      {/* Drawer backdrop */}
      <div className="fixed inset-0 bg-bg-primary/20 backdrop-blur-xs z-40" onClick={onClose} />

      {/* Main Drawer Panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 24, stiffness: 220 }}
        className="fixed right-0 top-0 bottom-0 w-full sm:w-96 glass-sidebar z-50 flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-border-ice/50 flex items-center justify-between bg-surface/80">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🥶</span>
            <div>
              <h3 className="font-heading font-bold text-base text-text-primary leading-tight">Yeti Copilot</h3>
              <p className="text-[10px] text-accent font-semibold flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Persistent MemWal Active
              </p>
              <div className="text-[9px] text-text-secondary mt-1 flex gap-2 font-mono">
                <span>💬 Chats: {freeChats}/5</span>
                <span>🎨 Images: {freeImages}/1</span>
              </div>

            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Developer Inspector Trigger */}
            <button
              onClick={() => setShowInspector(!showInspector)}
              title="Inspect Agent Memory logs on Walrus"
              className={`p-1.5 rounded-lg border transition-all ${
                showInspector 
                  ? "bg-accent/15 border-accent text-accent" 
                  : "border-border-ice/50 text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
              }`}
            >
              <Code className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Mode Toggle Bar */}
        <div className="p-2 bg-surface-secondary border-b border-border-ice/30 flex justify-center gap-1.5 select-none">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              activeTab === "chat"
                ? "bg-accent text-white shadow-xs"
                : "text-text-secondary hover:bg-surface"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Chat Mode 💬</span>
          </button>
          <button
            onClick={() => setActiveTab("generate")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              activeTab === "generate"
                ? "bg-accent text-white shadow-xs"
                : "text-text-secondary hover:bg-surface"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Mascot Generator 🎨</span>
          </button>
        </div>

        {/* Message Area / Memory Inspector Overlay */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface-secondary/40 relative">
          <AnimatePresence>
            {showInspector ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="absolute inset-0 bg-bg-primary/95 p-4 z-10 flex flex-col"
              >
                <div className="flex items-center justify-between mb-3 border-b border-border-ice/60 pb-2">
                  <h4 className="font-heading font-bold text-sm text-text-primary">🔍 Developer Memory Logs</h4>
                  <button onClick={() => setShowInspector(false)} className="text-text-secondary hover:text-text-primary">
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>
                <div className="text-[10px] text-text-secondary space-y-2 mb-3 leading-relaxed">
                  <p><strong>Session ID:</strong> <span className="font-mono text-[9px] break-all bg-surface px-1 py-0.5 rounded border border-border-ice/50">{sessionId}</span></p>
                  <p>Showing state retrieved from <strong>Walrus Memory Ledger (MemWal)</strong>.</p>
                </div>
                <div className="flex-1 overflow-y-auto bg-slate-950 p-3.5 rounded-2xl border border-slate-800 shadow-inner font-mono text-[9px] text-emerald-400">
                  <pre className="whitespace-pre-wrap leading-normal">
                    {JSON.stringify(
                      messages.map((m, idx) => ({
                        index: idx,
                        role: m.role,
                        content: m.content.length > 50 ? m.content.slice(0, 50) + "..." : m.content,
                        storage: m.blobId 
                          ? `Walrus Blob (ID: ${m.blobId.slice(0, 10)}...)` 
                          : "MemWal Relayer Vector DB",
                      })),
                      null,
                      2
                    )}
                  </pre>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {loadingHistory ? (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-xs">Recalling memory logs...</span>
            </div>
          ) : activeTab === "generate" ? (
            /* mascot generator mode list view */
            (() => {
              const imageMessages = messages.filter((m) => m.image || m.blobId);
              return imageMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 text-text-secondary">
                  <span className="text-3xl mb-3">🎨</span>
                  <p className="font-semibold text-sm text-text-primary">Mascot Image Studio</p>
                  <p className="text-xs mt-1 max-w-[200px]">Describe a scene below and generate consistent Yeti mascot artwork directly on Walrus!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {imageMessages.map((msg) => (
                    <div key={msg.id} className="glass-panel p-3.5 rounded-2xl border border-border-ice/50 space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-text-secondary">
                        <span className="font-semibold">{msg.content.replace("🎨 Mascot Image: ", "")}</span>
                        {msg.blobId && (
                          <a 
                            href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${msg.blobId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent hover:underline font-bold"
                          >
                            Walrus Ledger
                          </a>
                        )}
                      </div>
                      {msg.image && (
                        <div className="rounded-xl overflow-hidden border border-border-ice/30 aspect-square relative bg-surface-secondary/40">
                          <img src={msg.image} alt="Yeti Artwork" className="w-full h-full object-cover" />
                        </div>
                      )}
                      {msg.blobId && (
                        <p className="text-[8px] font-mono text-text-secondary/70 break-all select-all">
                          ID: {msg.blobId}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-text-secondary">
              <span className="text-3xl mb-3">🏔️</span>
              <p className="font-semibold text-sm text-text-primary">Hey! I'm Lofi the Yeti.</p>
              <p className="text-xs mt-1 max-w-[200px]">Ask me about lounge updates, news on Sui, or general conversation!</p>
            </div>
          ) : (
            /* standard chat mode messages list view */
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed relative group ${
                    msg.role === "user"
                      ? "bg-accent text-white rounded-tr-none font-medium shadow-sm"
                      : "glass-panel-accent text-text-primary rounded-tl-none border-border-ice/60"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="pr-5 yeti-markdown">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="white-space-pre-wrap">{msg.content}</p>
                  )}
                  {msg.role === "assistant" && (
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      className="absolute right-2 top-2 p-1 rounded-md text-text-secondary hover:text-accent hover:bg-surface-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Copy response"
                    >
                      {copiedMessageId === msg.id ? (
                        <Check className="h-3 w-3 text-emerald-500 animate-scale" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  {msg.image && (
                    <div className="mt-2.5 rounded-lg overflow-hidden border border-border-ice/30">
                      <img src={msg.image} alt="Yeti Artwork" className="w-full h-auto object-cover max-h-48" />
                    </div>
                  )}
                  {msg.blobId && (
                    <div className="mt-2 border-t border-border-ice/20 pt-1.5 flex items-center justify-between text-[8px] text-text-secondary/70">
                      <span>Ref ID: {msg.blobId.slice(0, 12)}...</span>
                      <a 
                        href={`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${msg.blobId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent font-semibold hover:underline"
                      >
                        Inspect Ledger
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-text-secondary font-medium pl-1">
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
              <span>Yeti is drafting...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Footer Area conditional on active tab */}
        {activeTab === "generate" ? (
          <div className="p-3 border-t border-border-ice/50 bg-surface flex flex-col gap-2">
            <div className="flex justify-between items-center text-[9px] text-text-secondary/80 font-bold px-1 select-none">
              <span>Imagen 3 High-Fidelity Engine</span>
              <span className="text-accent bg-accent/10 border border-accent/25 px-1.5 py-0.2 rounded">Lease: 20 Days</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Describe a scene for Lofi the Yeti..."
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerateImage(imagePrompt)}
                disabled={loading}
                className="flex-1 glass-input px-3.5 py-2 text-xs"
              />
              <button
                onClick={() => handleGenerateImage(imagePrompt)}
                disabled={loading || !imagePrompt.trim()}
                className="px-4 py-2 rounded-xl bg-accent text-white font-fun font-bold text-xs flex items-center justify-center hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all gap-1.5 shrink-0 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span>Generate</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Quick Actions Panel */}
            <div className="p-3 border-t border-border-ice/30 bg-surface/50 grid grid-cols-2 gap-2 select-none">
              <button
                onClick={() => handleSend("Summarize recent lounge stats and activities.")}
                disabled={loading}
                className="flex items-center justify-center p-2 rounded-xl border border-border-ice/40 bg-surface/85 hover:bg-accent/8 hover:border-accent/35 text-[10px] text-text-secondary hover:text-accent font-bold transition-all gap-1.5 text-center"
              >
                <BarChart2 className="h-3.5 w-3.5" />
                <span>Lounge Stats</span>
              </button>
              <button
                onClick={() => handleSend("Tell me some cool news about the Sui blockchain ecosystem.")}
                disabled={loading}
                className="flex items-center justify-center p-2 rounded-xl border border-border-ice/40 bg-surface/85 hover:bg-accent/8 hover:border-accent/35 text-[10px] text-text-secondary hover:text-accent font-bold transition-all gap-1.5 text-center"
              >
                <Newspaper className="h-3.5 w-3.5" />
                <span>Sui News</span>
              </button>
            </div>

            {/* Input Box */}
            <div className="p-3 border-t border-border-ice/50 bg-surface flex gap-2">
              <input
                type="text"
                placeholder={isMultiAgent ? "Propose a meme idea for debate..." : "Talk to your Yeti Copilot..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend(input)}
                disabled={loading}
                className="flex-1 glass-input px-3.5 py-2 text-xs"
              />
              <button
                onClick={() => handleSend(input)}
                disabled={loading || !input.trim()}
                className="h-8.5 w-8.5 rounded-xl bg-accent text-white flex items-center justify-center hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all shrink-0 shadow-sm"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </motion.div>

      <AnimatePresence>
        {showTopUpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
            <div className="absolute h-96 w-96 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 50, opacity: 0, scale: 0.95 }}
              className="relative max-w-sm w-full glass-panel rounded-3xl p-6 md:p-8 text-center space-y-6 bg-surface border-border-ice/60 shadow-[0_0_40px_rgba(0,212,255,0.15)]"
            >
              <button
                onClick={() => setShowTopUpModal(false)}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg bg-accent/10 border border-accent/30 text-accent shadow-ice-glow animate-bounce">
                💸
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/20">
                  <span>LOFI TOKENS REQUIRED</span>
                </div>
                <h2 className="text-xl md:text-2xl font-heading font-bold text-text-primary">
                  Out of Credits!
                </h2>
                <p className="text-xs text-text-secondary leading-relaxed">
                  You need at least <strong className="text-accent">{requiredLofi} $LOFI</strong> to proceed with this AI action. Please request Sui Testnet gas, then go to the Wallet page to convert SUI to $LOFI.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowTopUpModal(false);
                    window.location.href = "/wallet";
                  }}
                  className="flex-1 py-3 font-bold text-xs rounded-2xl bg-accent text-bg-primary hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all active:scale-98"
                >
                  Go to Wallet Page 💸
                </button>
                <button
                  onClick={() => setShowTopUpModal(false)}
                  className="py-3 px-4 font-bold text-xs rounded-2xl bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmPaymentConfig.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
            <div className="absolute h-96 w-96 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 50, opacity: 0, scale: 0.95 }}
              className="relative max-w-sm w-full glass-panel rounded-3xl p-6 md:p-8 text-center space-y-6 bg-surface border-border-ice/60 shadow-[0_0_40px_rgba(0,212,255,0.15)]"
            >
              <button
                onClick={() => setConfirmPaymentConfig(prev => ({ ...prev, isOpen: false }))}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg bg-accent/10 border border-accent/30 text-accent shadow-ice-glow animate-pulse">
                ❄️
              </div>

              <div className="space-y-2">
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/20">
                  <span>CONFIRM PAYMENT</span>
                </div>
                <h2 className="text-xl md:text-2xl font-heading font-bold text-text-primary">
                  Pay with $LOFI
                </h2>
                <p className="text-xs text-text-secondary leading-relaxed">
                  You have <span className="text-red-400 font-bold">0</span> free daily {confirmPaymentConfig.actionType === "generate" ? "generations" : "chats"} remaining.
                  Sign the transaction to pay <strong className="text-accent">{confirmPaymentConfig.cost} $LOFI</strong> and execute this request.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={confirmPaymentConfig.onConfirm}
                  className="flex-1 py-3 font-bold text-xs rounded-2xl bg-accent text-bg-primary hover:shadow-[0_0_20px_rgba(0,212,255,0.4)] transition-all active:scale-98"
                >
                  Pay & Execute 💸
                </button>
                <button
                  onClick={() => setConfirmPaymentConfig(prev => ({ ...prev, isOpen: false }))}
                  className="py-3 px-4 font-bold text-xs rounded-2xl bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
export default YetiCopilot;

