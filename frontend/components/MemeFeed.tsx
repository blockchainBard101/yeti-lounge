"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Send, Loader2, X, CloudUpload, Images, Sparkles } from "lucide-react";
import PostCard, { Post } from "./PostCard";
import { useSearchParams } from "next/navigation";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { Transaction } from "@mysten/sui/transactions";
import { sponsorAndExecuteTransaction, getOrCreateProfileArg, PACKAGE_ID, LOFI_COIN_TYPE, getCoinObjects, cacheProfileId, warmProfileCache, BACKEND_URL, payLofi, getAuthToken } from "./sui";
import {
  uploadFileToWalrus,
  uploadFilesAsQuilt,
  walrusBlobUrl,
  walrusQuiltFileUrl,
  walrusQuiltPatchUrl,
  type QuiltEntry,
} from "./walrus";
import walrusAssets from "./walrus-assets.json";
import ThawingYetiLoader from "./ThawingYetiLoader";

export const MemeFeed: React.FC = () => {
  const enokiFlow = useEnokiFlow();
  const { address } = useZkLogin();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const sharedPostId = searchParams.get("post");
  const hasScrolledToSharedPost = useRef(false);

  // Core feed states
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostText, setNewPostText] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [txMessage, setTxMessage] = useState("");
  const [loadingFeed, setLoadingFeed] = useState(true);

  // Walrus attachment states
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedPreviews, setAttachedPreviews] = useState<string[]>([]);
  const [imageBlobId, setImageBlobId] = useState<string | null>(null);
  const [isQuilt, setIsQuilt] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [uploadError, setUploadError] = useState("");

  // Sidebar stats states
  const [activeYetis, setActiveYetis] = useState(0);
  const [totalFlurries, setTotalFlurries] = useState(0);
  const [totalPosts, setTotalPosts] = useState(0);
  const [totalDonated, setTotalDonated] = useState(0);

  // AI image states
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [generatingAiImage, setGeneratingAiImage] = useState(false);
  const [aiGenerationError, setAiGenerationError] = useState("");
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [confirmPaymentConfig, setConfirmPaymentConfig] = useState<{
    isOpen: boolean;
    cost: number;
    onConfirm: () => void;
  }>({
    isOpen: false,
    cost: 0,
    onConfirm: () => {},
  });

  // Storage duration setting: default 20 epochs, max 50
  const [storageEpochs, setStorageEpochs] = useState<number>(20);



  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

  const resolveImageUrl = (mediaBlobId?: string | null): string | undefined => {
    if (!mediaBlobId) return undefined;
    if (mediaBlobId.startsWith("/") || mediaBlobId.startsWith("http") || mediaBlobId.startsWith("data:")) {
      return mediaBlobId;
    }

    // Fastest quilt format: "patches:PATCH_ID_0|PATCH_ID_1|..."
    // Each patch ID gives a direct by-quilt-patch-id URL — no HEAD probes needed
    if (mediaBlobId.startsWith("patches:")) {
      const patchIds = mediaBlobId.slice("patches:".length).split("|");
      // Return the first patch URL as the canonical preview image through the proxy
      return `${BACKEND_URL}/walrus/blob/${patchIds[0]}`;
    }

    // Legacy quilt format: "BLOB_ID:N" where N is the number of images
    const quiltMatch = mediaBlobId.match(/^([A-Za-z0-9_-]+):(\d+)$/);
    if (quiltMatch) {
      const quiltBlobId = quiltMatch[1];
      return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/by-quilt-id/${quiltBlobId}/image-0`;
    }

    return `${BACKEND_URL}/walrus/blob/${mediaBlobId}`;
  };

  const formatTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return "Some time ago";
    }
  };

  useEffect(() => {
    const fetchSidebarStats = async () => {
      try {
        const statsRes = await fetch(`${BACKEND_URL}/dashboard-stats`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setActiveYetis(statsData.activeYetis);
          setTotalFlurries(statsData.dailyPoolClaimed);
          setTotalPosts(statsData.totalPosts ?? 0);
        }
      } catch (err) {
        console.error("Failed to load dashboard stats in Feed:", err);
      }

      try {
        const fundRes = await fetch(`${BACKEND_URL}/glacier-fund`);
        if (fundRes.ok) {
          const fundData = await fundRes.json();
          const total = Number(BigInt(fundData.totalDonated) / BigInt(1_000_000_000));
          setTotalDonated(total);
        }
      } catch (err) {
        console.error("Failed to load glacier fund in Feed:", err);
      }
    };

    fetchSidebarStats();
  }, []);

  // Load feed from dynamic NestJS backend
  useEffect(() => {
    const fetchFeed = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/feed`);
        if (!res.ok) throw new Error("Failed to fetch feed");
        const rawPosts = await res.json();
        
        // Read liked list from localStorage
        let likedList: string[] = [];
        if (typeof window !== "undefined") {
          try {
            likedList = JSON.parse(localStorage.getItem("lofi_yeti_liked_posts") || "[]");
          } catch {}
        }

        // Map backend Prisma objects to frontend Post types
        const mappedPosts: Post[] = rawPosts.map((p: any, idx: number) => {
          const userHandle = p.author?.suinsHandle || (p.authorAddress ? `${p.authorAddress.slice(0, 6)}…${p.authorAddress.slice(-4)}` : "Yeti Member");
          const postKey = p.objectId || String(idx);
          const hasLiked = likedList.includes(postKey);
          
          return {
            id: p.objectId || idx,
            objectId: p.objectId,
            authorAddress: p.authorAddress,
            user: userHandle,
            avatar: p.author?.avatarBlobId || "🏂",
            role: p.authorAddress === "0xd2f1b1b155e4e9afdb8eaa3a934f8d725adaa4e0eb21f537dea3af83b797b40c" ? "Lounge Host 👑" : "Yeti Member ❄️",
            time: formatTime(p.createdAt),
            caption: p.textContent || "",
            image: resolveImageUrl(p.mediaBlobId),
            mediaBlobId: p.mediaBlobId || undefined,
            likes: p.likes || 0,
            comments: p.comments?.length || 0,
            commentsList: p.comments || [],
            votes: (p.upvotes || 0) - (p.downvotes || 0),
            tag: idx % 3 === 0 ? "Charity Impact" : idx % 3 === 1 ? "Sui Alpha" : "Lofi Vibes",
            verified: !!p.author?.isVerified || p.authorAddress === "0xd2f1b1b155e4e9afdb8eaa3a934f8d725adaa4e0eb21f537dea3af83b797b40c",
            hasLiked,
            tipsReceived: p.tipsReceived || "0",
            expiresAt: p.expiresAt,
            isExpired: !!p.isExpired,
          };
        });

        setPosts(mappedPosts);
      } catch (err) {
        console.error("Failed to fetch feed from backend:", err);
      }
    };

    fetchFeed();
    // Poll the feed every 5 seconds for live SocialFi updates
    const interval = setInterval(fetchFeed, 5000);
    return () => clearInterval(interval);
  }, []);

  // Scroll to shared post once it's loaded
  useEffect(() => {
    if (sharedPostId && posts.length > 0 && !hasScrolledToSharedPost.current) {
      const el = document.getElementById(`post-${sharedPostId}`);
      if (el) {
        // Scroll with a slight delay to ensure render is complete
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-accent", "ring-offset-2", "ring-offset-bg-primary");
          setTimeout(() => {
            el.classList.remove("ring-2", "ring-accent", "ring-offset-2", "ring-offset-bg-primary");
            // Also adding a custom animation for the pulse effect using Tailwind Arbitrary values
            el.style.transition = "box-shadow 1s ease";
            el.style.boxShadow = "0 0 25px rgba(0,212,255,0.4)";
            setTimeout(() => el.style.boxShadow = "none", 2000);
          }, 2000);
        }, 100);
        hasScrolledToSharedPost.current = true;
      }
    }
  }, [posts, sharedPostId]);

  // Simplified infinite scroll placeholder since backend returns the direct live feed
  const memeTemplates: any[] = [];

  const observerTarget = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Walrus image attachment handler — supports multiple files
  // -----------------------------------------------------------------------
  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files ?? []);
    if (!newFiles.length) return;

    // Reset prior upload state and merge new files with existing
    setImageBlobId(null);
    setIsQuilt(false);
    setUploadError("");

    const merged = [...attachedFiles, ...newFiles];
    setAttachedFiles(merged);
    const newPreviews = newFiles.map((f) => URL.createObjectURL(f));
    setAttachedPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeAttachment = (index: number) => {
    URL.revokeObjectURL(attachedPreviews[index]);
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setAttachedPreviews((prev) => prev.filter((_, i) => i !== index));
    setImageBlobId(null);
    setIsQuilt(false);
  };

  const clearAttachments = () => {
    attachedPreviews.forEach(URL.revokeObjectURL);
    setAttachedFiles([]);
    setAttachedPreviews([]);
    setImageBlobId(null);
    setIsQuilt(false);
    setUploadError("");
    setUploadStep("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  // AI Image generation — payment of 1 LOFI to Lo
  const executeGenerateAiImage = async (txDigest?: string) => {
    console.log("[MemeFeed] executeGenerateAiImage invoked. txDigest:", txDigest);
    try {
      setTxMessage(txDigest ? "Image paid! Generating lofi meme with AI… 🚀" : "Using daily free credit! Generating lofi meme with AI… 🚀");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (address) {
        try {
          const token = await getAuthToken(enokiFlow, address);
          headers["Authorization"] = `Bearer ${token}`;
        } catch (authErr) {
          console.warn("Could not retrieve auth token for AI generate:", authErr);
        }
      }
      console.log("[MemeFeed] Sending image generation request to backend. prompt:", aiPrompt.trim(), "suiAddress:", address, "txDigest:", txDigest);
      const res = await fetch(`${BACKEND_URL}/ai/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          prompt: aiPrompt.trim(),
          suiAddress: address,
          txDigest,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "AI generation server returned an error.");
      }

      const data = await res.json();
      if (!data.url) {
        throw new Error("Invalid response format from AI generation server.");
      }

      if (data.blobId) {
        setImageBlobId(data.blobId);
        const previewUrl = data.url.startsWith("/") ? `${BACKEND_URL}${data.url}` : data.url;
        setAttachedPreviews([previewUrl]);
        setAttachedFiles([]);
        setIsQuilt(false);
      } else {
        let imageFile: File;
        if (data.url.startsWith("data:")) {
          const [meta, b64] = data.url.split(",");
          const mime = meta.split(":")[1].split(";")[0];
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          imageFile = new File([bytes], "ai-generated.jpg", { type: mime });
        } else {
          const fetched = await fetch(data.url);
          const blob = await fetched.blob();
          imageFile = new File([blob], "ai-generated.png", { type: blob.type || "image/png" });
        }

        const previewUrl = URL.createObjectURL(imageFile);
        setAttachedFiles([imageFile]);
        setAttachedPreviews([previewUrl]);
        setImageBlobId(null);
        setIsQuilt(false);
      }

      setShowAiModal(false);
      setAiPrompt("");
      setTxMessage("AI image generated successfully and attached! 🏔️");
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("Insufficient $LOFI") || err.message?.includes("No LOFI coins") || err.message?.includes("No SUI coins")) {
        setShowTopUpModal(true);
      } else {
        setAiGenerationError(err.message || "Failed to generate AI image.");
      }
      setTxMessage("AI generation failed.");
    } finally {
      setGeneratingAiImage(false);
    }
  };

  const handleGenerateAiImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    if (!address) {
      alert("Please sign in using Google zkLogin to generate images!");
      return;
    }

    setGeneratingAiImage(true);
    setAiGenerationError("");

    try {
      let freeImagesRemaining = 1;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const profileRes = await fetch(`${BACKEND_URL}/ai/free-credits?address=${encodeURIComponent(address)}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (typeof profileData.freeImageGensRemaining === "number") {
            freeImagesRemaining = profileData.freeImageGensRemaining;
          }
        }
      } catch (fetchErr) {
        console.warn("Failed to fetch free image credits, defaulting to 0 free:", fetchErr);
        freeImagesRemaining = 0;
      }

      if (freeImagesRemaining <= 0) {
        setGeneratingAiImage(false);
        setShowAiModal(false); // Hide input modal to show confirm payment modal
        setConfirmPaymentConfig({
          isOpen: true,
          cost: 1.0,
          onConfirm: async () => {
            setConfirmPaymentConfig(prev => ({ ...prev, isOpen: false }));
            setGeneratingAiImage(true);
            try {
              setTxMessage("Authorizing 1 LOFI payment for AI generation… ❄️");
              const txDigest = await payLofi(1.0, enokiFlow, address);
              await executeGenerateAiImage(txDigest);
            } catch (payErr: any) {
              if (payErr.message?.includes("Insufficient $LOFI") || payErr.message?.includes("No LOFI coins") || payErr.message?.includes("No SUI coins")) {
                setShowTopUpModal(true);
              } else {
                alert(`Payment failed: ${payErr.message || payErr}`);
              }
              setGeneratingAiImage(false);
            }
          }
        });
      } else {
        await executeGenerateAiImage();
      }
    } catch (err: any) {
      console.error(err);
      setAiGenerationError(err.message || "Failed to process request.");
      setGeneratingAiImage(false);
    }
  };


  // -----------------------------------------------------------------------
  // Post submit — upload if needed, then create on-chain + local post
  // -----------------------------------------------------------------------
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText.trim()) return;

    setSaving(true);
    setTxMessage("");

    try {
      let mediaBlobId = imageBlobId ?? "";
      let quiltUpload = isQuilt;

      // Upload any pending files if not yet uploaded
      if (attachedFiles.length > 0 && !imageBlobId && address) {
        setUploadingImage(true);
        setUploadStep("encoding");
        try {
          if (attachedFiles.length === 1) {
            mediaBlobId = await uploadFileToWalrus(
              attachedFiles[0],
              address,
              enokiFlow,
              storageEpochs,
              (step) => setUploadStep(step)
            );
            quiltUpload = false;
          } else {
            const entries: QuiltEntry[] = attachedFiles.map((file, i) => ({
              file,
              identifier: `image-${i}`,
              tags: { name: file.name, type: file.type },
            }));
            const { blobId, patches } = await uploadFilesAsQuilt(
              entries,
              address,
              enokiFlow,
              storageEpochs,
              (step) => setUploadStep(step)
            );
            // Encode patch IDs as 'patches:P0|P1|P2' — enables zero-network-request
            // image loading via the fastest /v1/blobs/by-quilt-patch-id/ path
            const patchIds = entries
              .map((e) => patches[e.identifier])
              .filter(Boolean);
            mediaBlobId = patchIds.length > 0
              ? `patches:${patchIds.join("|")}`
              : `${blobId}:${attachedFiles.length}`; // fallback to old format
            quiltUpload = true;
          }
          setImageBlobId(mediaBlobId);
        } catch (err: any) {
          setUploadError(`Image upload failed: ${err.message}`);
        } finally {
          setUploadingImage(false);
        }
      }

      if (address) {
        // ── Single atomic PTB: (optionally create_profile) + create_post_entry ──
        // getOrCreateProfileArg checks if the user has a YetiProfile.
        // If not, it prepends create_profile as PTB command #0 and returns the
        // TransactionResult so create_post_entry can borrow it as &YetiProfile.
        // Everything happens in one sponsored transaction — no wait, no retry.
        const tx = new Transaction();
        const { profileArg, isNew } = await getOrCreateProfileArg(tx, address);

        if (isNew) setTxMessage("First time? Creating your Yeti Profile… ❄️");

        tx.moveCall({
          target: `${PACKAGE_ID}::post::create_post_entry`,
          arguments: [
            profileArg,
            tx.pure.string(newPostText),
            tx.pure.string(mediaBlobId),
          ],
        });

        // Transfer the newly-created profile to the user at the end of the PTB.
        // (Existing profile objects are already owned by the user — skip.)
        if (isNew) tx.transferObjects([profileArg], address);

        const res = await sponsorAndExecuteTransaction(tx, enokiFlow, address);
        if (isNew) warmProfileCache(address); // seed cache in background after first profile creation
        setTxMessage(
          isNew
            ? `Welcome to the lounge! Profile + post created 🏔️ Tx: ${res.digest}`
            : `Post shilled to the lounge! 🏔️ Tx: ${res.digest}`
        );
      }

      // Resolve the image src for the local feed post
      let postImageSrc: string | undefined;
      if (mediaBlobId && !mediaBlobId.startsWith("0xmock_")) {
        postImageSrc = resolveImageUrl(mediaBlobId);
      } else if (attachedPreviews.length > 0) {
        postImageSrc = attachedPreviews[0]; // local preview fallback
      }

      const newPost: Post = {
        id: Date.now(),
        user: "Yeti #42069",
        avatar: "🏂",
        role: "Yeti Member ❄️",
        time: "Just now",
        caption: newPostText,
        image: postImageSrc,
        mediaBlobId: mediaBlobId || undefined,
        likes: 0,
        comments: 0,
        votes: 1,
        tag: "Community",
        verified: false,
        hasLiked: false,
      };

      setPosts([newPost, ...posts]);
      setNewPostText("");
      clearAttachments();
    } catch (err: any) {
      console.error(err);
      setTxMessage(`Failed to post on-chain: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLike = (id: any) => {
    // Save liked post key in localStorage
    if (typeof window !== "undefined") {
      try {
        const likedList = JSON.parse(localStorage.getItem("lofi_yeti_liked_posts") || "[]");
        if (!likedList.includes(String(id))) {
          likedList.push(String(id));
          localStorage.setItem("lofi_yeti_liked_posts", JSON.stringify(likedList));
        }
      } catch {}
    }

    setPosts(
      posts.map((post) => {
        if (post.id === id && !post.hasLiked) {
          return {
            ...post,
            likes: post.likes + 1,
            hasLiked: true,
          };
        }
        return post;
      })
    );
  };

  // Simulated Infinite Scroll loading handler
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          loadMoreMemes();
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current);
      }
    };
  }, [posts, loadingMore]);

  if (loadingFeed) {
    return <ThawingYetiLoader duration={1800} onComplete={() => setLoadingFeed(false)} />;
  }

  const loadMoreMemes = () => {
    if (memeTemplates.length === 0) return;
    setLoadingMore(true);
    setTimeout(() => {
      // Pick 2 random memes from template database
      const addedPosts: Post[] = [];
      for (let i = 0; i < 2; i++) {
        const template = memeTemplates[Math.floor(Math.random() * memeTemplates.length)];
        addedPosts.push({
          id: Date.now() + Math.random(),
          user: template.user,
          avatar: template.avatar,
          role: template.role,
          time: "Few mins ago",
          caption: template.caption,
          image: template.image,
          likes: Math.floor(Math.random() * 50) + 10,
          comments: Math.floor(Math.random() * 15) + 1,
          votes: Math.floor(Math.random() * 20) + 2,
          tag: template.tag,
          verified: template.verified,
          hasLiked: false
        });
      }
      setPosts((prev) => [...prev, ...addedPosts]);
      setLoadingMore(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      {/* Publisher Box */}
      <div className="glass-panel rounded-3xl p-4 md:p-5">
        <form onSubmit={handleCreatePost} className="space-y-4">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-xl bg-surface-secondary flex items-center justify-center border border-border-ice shrink-0 text-xl select-none">
              🏂
            </div>
            <textarea
              value={newPostText}
              onChange={(e) => setNewPostText(e.target.value)}
              placeholder="What's the alpha today, Yeti? Shill a meme..."
              rows={3}
              className="flex-1 glass-input rounded-2xl p-3 text-xs md:text-sm placeholder-text-secondary/50 focus:outline-none resize-none min-h-[70px]"
            />
          </div>

          {/* Multi-image attachment previews */}
          {attachedPreviews.length > 0 && (
            <div className={`ml-0 sm:ml-[52px] grid gap-2 ${
              attachedPreviews.length === 1
                ? "grid-cols-1"
                : attachedPreviews.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
            }`}>
              {attachedPreviews.map((src, idx) => (
                <div key={idx} className="relative rounded-2xl overflow-hidden border border-border-ice/60 aspect-square">
                  <img src={src} alt={`Attached ${idx + 1}`} className="w-full h-full object-cover" />
                  {/* Upload overlay on all while uploading */}
                  {uploadingImage && (
                    <div className="absolute inset-0 bg-bg-primary/70 flex flex-col items-center justify-center gap-1">
                      <Loader2 className="h-4 w-4 text-accent animate-spin" />
                      <span className="text-[8px] text-accent font-semibold capitalize">{uploadStep}…</span>
                    </div>
                  )}
                  {/* Walrus/Quilt badge on first image once certified */}
                  {idx === 0 && imageBlobId && !uploadingImage && (
                    <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 bg-bg-primary/85 rounded-full px-1.5 py-0.5">
                      <CloudUpload className="h-2.5 w-2.5 text-mint" />
                      <span className="text-[7px] text-mint font-bold">
                        {isQuilt ? `Quilt ×${attachedPreviews.length}` : "Walrus"}
                      </span>
                    </div>
                  )}
                  {/* Remove individual image */}
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-bg-primary/85 border border-border-ice flex items-center justify-center hover:bg-surface-secondary transition-colors"
                  >
                    <X className="h-2.5 w-2.5 text-text-secondary" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachedPreviews.length > 0 && (
            <div className="ml-0 sm:ml-[52px] glass-panel rounded-2xl p-3 border border-border-ice/30 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-text-secondary">
                <span className="flex items-center gap-1.5 text-accent">
                  <CloudUpload className="h-3.5 w-3.5" />
                  <span>Walrus Storage Lease Duration</span>
                </span>
                <span className="text-bg-primary bg-accent/90 px-2 py-0.5 rounded-full text-[10px]">
                  {storageEpochs} {storageEpochs === 1 ? "Day" : "Days"} ({storageEpochs} {storageEpochs === 1 ? "Epoch" : "Epochs"})
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                value={storageEpochs}
                onChange={(e) => setStorageEpochs(parseInt(e.target.value))}
                className="w-full accent-accent bg-surface-secondary rounded-lg appearance-none h-1.5 cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-text-secondary/50">
                <span>1 Day (Min)</span>
                <span>20 Days (Default)</span>
                <span>50 Days (Max)</span>
              </div>
            </div>
          )}

          {uploadError && (
            <p className="text-[9px] text-red-400 ml-0 sm:ml-[52px]">{uploadError}</p>
          )}

          <div className="flex justify-between items-center border-t border-border-ice/45 pt-3">
            <div className="flex gap-2">
              {/* Hidden file input — multiple allowed */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageAttach}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
                className={`p-1.5 rounded-lg transition-colors ${
                  attachedFiles.length > 0
                    ? "bg-accent/10 text-accent border border-accent/30"
                    : "hover:bg-surface-secondary text-text-secondary hover:text-accent"
                }`}
                title={
                  imageBlobId
                    ? isQuilt
                      ? `Quilt of ${attachedPreviews.length} images on Walrus`
                      : "Image stored on Walrus"
                    : "Attach images (single → blob, multiple → quilt)"
                }
              >
                {attachedFiles.length > 1 ? (
                  <Images className="h-4 w-4" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowAiModal(true)}
                disabled={uploadingImage || generatingAiImage}
                className="p-1.5 rounded-lg transition-colors hover:bg-surface-secondary text-text-secondary hover:text-accent flex items-center justify-center"
                title="Generate AI lofi image (Cost: 1 LOFI)"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
            <button
              type="submit"
              disabled={!newPostText.trim() || saving || uploadingImage}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                newPostText.trim() && !saving && !uploadingImage
                  ? "bg-accent text-bg-primary hover:shadow-ice-glow hover:scale-105 active:scale-95"
                  : "bg-surface-secondary text-text-secondary/50 cursor-not-allowed border border-border-ice"
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Shilling...</span>
                </>
              ) : uploadingImage ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Uploading…</span>
                </>
              ) : (
                <>
                  <Send className="h-3 w-3" />
                  <span>Shill to Lounge</span>
                </>
              )}
            </button>
          </div>
          {txMessage && (
            <p className="text-[10px] text-accent mt-2 text-right">{txMessage}</p>
          )}
        </form>
      </div>

      {/* Desktop: 2-col layout. Mobile: single column */}
      <div className="flex flex-col md:flex-row gap-5 items-stretch md:items-start w-full">
        {/* Feed stream — takes up 2/3 on desktop */}
        <div className="flex-1 min-w-0 space-y-4 w-full">
          <AnimatePresence initial={false}>
            {posts
              .filter((post) => {
                if (post.mediaBlobId && post.expiresAt) {
                  return new Date(post.expiresAt).getTime() > Date.now();
                }
                return true;
              })
              .map((post) => (
                <div key={post.id} id={`post-${post.objectId || post.id}`} className="transition-all duration-1000 rounded-3xl">
                  <PostCard
                    post={post}
                    onLike={handleLike}
                    onDelete={(id) => setPosts(prev => prev.filter(p => p.id !== id))}
                    enokiFlow={enokiFlow}
                    senderAddress={address || ""}
                  />
                </div>
              ))}
          </AnimatePresence>
          <div ref={observerTarget} className="py-8 flex justify-center items-center">
            {loadingMore ? (
              <div className="flex items-center gap-2 text-xs text-accent font-semibold bg-accent/8 px-4 py-2 rounded-full border border-accent/20">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Thawing more memes...</span>
              </div>
            ) : (
              <div className="text-[10px] text-text-secondary/40 font-semibold tracking-wider uppercase">
                End of Current Wave
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — sticky, desktop only */}
        <aside className="hidden md:flex flex-col gap-4 w-64 shrink-0 sticky top-4">
          {/* Live Stats */}
          <div className="glass-panel rounded-2xl p-4 space-y-3">
            <p className="text-[9px] uppercase font-bold text-text-secondary/50 tracking-widest">Live Lounge</p>
            <div className="space-y-2">
              {[
                { label: "Active Yetis", value: `${activeYetis.toLocaleString()} 🏂`, active: true },
                { label: "Total Posts", value: totalPosts.toLocaleString() },
                { label: "Total Flurries", value: `${totalFlurries.toLocaleString()} 💎` },
              ].map((s) => (
                <div key={s.label} className="flex justify-between items-center text-xs">
                  <span className="text-text-secondary">{s.label}</span>
                  <span className={`font-bold ${s.active ? "text-accent" : "text-text-primary"}`}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Trending Tags */}
          <div className="glass-panel rounded-2xl p-4 space-y-3">
            <p className="text-[9px] uppercase font-bold text-text-secondary/50 tracking-widest">Trending</p>
            <div className="space-y-2">
              {["#YEEERRRR", "#SuiLofi", "#IceCapSui", "#DailyFlurry"].map((tag) => (
                <div key={tag} className="flex items-center justify-between text-xs">
                  <span className="text-accent font-semibold">{tag}</span>
                  <span className="text-text-secondary/60">↗</span>
                </div>
              ))}
            </div>
          </div>
          {/* Glacier */}
          <div className="glass-panel rounded-2xl p-4 space-y-2">
            <p className="text-[9px] uppercase font-bold text-accent tracking-widest">💧 Glacier Fund</p>
            <div className="w-full bg-border-ice h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-accent h-full transition-all duration-500" 
                style={{ width: `${Math.min(100, Math.round((totalDonated / 25000) * 100))}%` }}
              />
            </div>
            <p className="text-[9px] text-text-secondary">
              {totalDonated.toLocaleString()} LOFI donated • {Math.min(100, Math.round((totalDonated / 25000) * 100))}% of goal
            </p>
          </div>
        </aside>
      </div>

      {/* AI Modal Overlay */}
      <AnimatePresence>
        {showAiModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel max-w-md w-full p-6 space-y-4 rounded-3xl relative border border-border-ice"
            >
              <button
                type="button"
                onClick={() => setShowAiModal(false)}
                className="absolute top-4 right-4 text-text-secondary hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
              
              <div className="space-y-1">
                <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-accent" /> Generate AI Mascot Meme
                </h3>
                <p className="text-[10px] text-text-secondary">
                  Describe a scene (e.g. &ldquo;yeti mascot driving a retro sports car&rdquo;). Payment of 1 LOFI is sent directly to the lounge host to cover model compute.
                </p>
              </div>

              <form onSubmit={handleGenerateAiImage} className="space-y-4">
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. lofi yeti studying inside a cozy cyber igloo with neon lights..."
                  rows={3}
                  className="w-full glass-input rounded-2xl p-3 text-xs md:text-sm placeholder-text-secondary/40 focus:outline-none resize-none"
                  maxLength={100}
                  required
                />
                
                {aiGenerationError && (
                  <p className="text-[10px] text-red-400 font-medium">{aiGenerationError}</p>
                )}

                <button
                  type="submit"
                  disabled={!aiPrompt.trim() || generatingAiImage}
                  className="w-full py-2.5 bg-accent hover:bg-accent-hover text-bg-primary font-bold text-xs rounded-xl hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {generatingAiImage ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-bg-primary" />
                      <span>Generating Meme (1 LOFI)...</span>
                    </>
                  ) : (
                    <>
                      <span>Pay & Generate Image</span>
                      <Sparkles className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


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
                  You need at least <strong className="text-accent">1.0 $LOFI</strong> to proceed with this AI action. Please request Sui Testnet gas, then go to the Wallet page to convert SUI to $LOFI.
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
                  You have <span className="text-red-400 font-bold">0</span> free daily generations remaining.
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

      <AnimatePresence>
        {generatingAiImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
            <div className="absolute h-96 w-96 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 50, opacity: 0, scale: 0.95 }}
              className="relative max-w-sm w-full glass-panel rounded-3xl p-6 md:p-8 text-center space-y-6 bg-surface border-border-ice/60 shadow-[0_0_40px_rgba(0,212,255,0.15)]"
            >
              <div className="mx-auto h-20 w-20 rounded-2xl flex items-center justify-center text-4xl shadow-lg bg-accent/10 border border-accent/30 text-accent shadow-ice-glow relative overflow-hidden">
                <span className="animate-bounce">🎨</span>
                <div className="absolute inset-0 border-2 border-dashed border-accent rounded-2xl animate-spin" style={{ animationDuration: '6s' }} />
              </div>

              <div className="space-y-3">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                  <span>GENERATING AI MEME</span>
                </div>
                <h3 className="text-lg font-heading font-bold text-text-primary animate-pulse">
                  Lofi the Yeti is Painting...
                </h3>
                <p className="text-xs text-text-secondary leading-relaxed px-4">
                  Please wait while we authorize your payment and generate your customized lofi artwork. The result will be registered on Walrus storage!
                </p>
                {txMessage && (
                  <div className="mt-4 p-3 rounded-xl bg-surface-secondary border border-border-ice/40 text-[10px] font-mono text-accent break-all">
                    {txMessage}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemeFeed;

