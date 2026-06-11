"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, MessageSquare, Flame, ArrowUp, ArrowDown, Share2, BadgeCheck, Send, Loader2, Coins } from "lucide-react";
import { Transaction } from "@mysten/sui/transactions";
import { sponsorAndExecuteTransaction, PACKAGE_ID, LOFI_COIN_TYPE, getCoinObjects, getOrCreateProfileArg, cacheProfileId, warmProfileCache, BACKEND_URL, getAuthToken } from "./sui";
import { readQuiltFiles } from "./walrus";

export interface Post {
  id: number;
  objectId?: string;
  authorAddress?: string;
  user: string;
  avatar: string;
  role: string;
  time: string;
  caption: string;
  image?: string;
  /** Raw mediaBlobId from the DB — 'patches:P0|P1|...' for quilts */
  mediaBlobId?: string;
  likes: number;
  comments: number;
  commentsList?: any[];
  votes: number;
  tag: string;
  verified?: boolean;
  hasLiked?: boolean;
  tipsReceived?: string;
  isExpired?: boolean;
  expiresAt?: string;
}

interface PostCardProps {
  post: Post;
  onLike: (id: number) => void;
  onDelete?: (id: number | string) => void;
  enokiFlow: any;
  senderAddress: string;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
}

const downloadImage = async (url: string) => {
  try {
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = url;
      a.download = "lofi-lounge-image.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // Remote cross-origin URL (e.g. Walrus testnet aggregator)
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "lofi-lounge-image.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error("Failed to download image:", err);
    window.open(url, "_blank");
  }
};

export const PostCard: React.FC<PostCardProps> = ({ post, onLike, onDelete, enokiFlow, senderAddress }) => {
  const [voteType, setVoteType] = useState<"up" | "down" | null>(null);
  const [localVotes, setLocalVotes] = useState(post.votes);
  const [isZoomed, setIsZoomed] = useState(false);
  const [yeeerrrrs, setYeeerrrrs] = useState(0);
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [showShareTooltip, setShowShareTooltip] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [localComments, setLocalComments] = useState<any[]>(post.commentsList || []);

  const [tipAmount, setTipAmount] = useState<number>(1);
  const [isTipping, setIsTipping] = useState(false);
  const [localTipsReceived, setLocalTipsReceived] = useState<string>(post.tipsReceived || "0");

  const [images, setImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    if (!post.expiresAt || !post.mediaBlobId) return;

    const updateTimer = () => {
      const target = new Date(post.expiresAt!).getTime();
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft("Expired");
      } else {
        const days = Math.floor(diff / (24 * 60 * 60 * 1000));
        const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

        let display = "";
        if (days > 0) {
          display += `${days}d `;
        }
        if (hours > 0 || days > 0) {
          display += `${hours}h `;
        }
        display += `${mins}m`;
        setTimeLeft(display);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [post.expiresAt, post.mediaBlobId]);

  const [extending, setExtending] = useState(false);

  const handleExtend = async () => {
    if (!post.objectId) return;
    setExtending(true);
    try {
      const res = await fetch(`${BACKEND_URL}/feed/${post.objectId}/renew`, {
        method: "POST",
      });
      if (res.ok) {
        // Optimistically update local post expiry (10 minutes lease)
        const newExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        post.expiresAt = newExpiry;
        post.isExpired = false;
        setTimeLeft("10m 0s");
        alert("Storage lease successfully extended by 5 epochs! ❄️");
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to extend storage: ${errData.message || "Unknown error"}`);
      }
    } catch (err: any) {
      console.error(err);
      alert("Error extending storage.");
    } finally {
      setExtending(false);
    }
  };

  // True when the logged-in user is the author of this post
  const isOwner = !!(senderAddress && post.objectId &&
    senderAddress === post.authorAddress);

  useEffect(() => {
    if (!post.image) {
      setImages([]);
      return;
    }

    if (post.image.startsWith("blob:") || post.image.startsWith("data:")) {
      setImages([post.image]);
      return;
    }

    // ── FASTEST PATH: by-quilt-patch-id ──────────────────────────────────────
    // When mediaBlobId is encoded as "patches:P0|P1|P2", resolveImageUrl()
    // returns the URL for the first patch. We reconstruct ALL patch URLs
    // directly from the image URL by stripping /by-quilt-patch-id/<patchId>
    // and replacing with each sibling patchId — ZERO network requests.
    const patchMatch = post.image.match(/\/by-quilt-patch-id\/([^/?#]+)/);
    if (patchMatch) {
      // The patch IDs for all siblings are encoded in post.mediaBlobId
      // as "patches:P0|P1|...". We can reconstruct them from the URL base.
      // Since we only have image-0's URL here, check if there are siblings
      // by looking at the original mediaBlobId via the image URL pattern.
      // Strategy: set image-0 immediately, then build rest from patchId list
      // embedded by MemeFeed. Since PostCard only gets post.image (not mediaBlobId),
      // we read them out of the URL itself — the base aggregator + patch ID.
      const aggregatorBase = post.image.replace(/\/by-quilt-patch-id\/.+$/, "");

      // Peek at mediaBlobId if available on the post object
      if (post.mediaBlobId?.startsWith("patches:")) {
        const patchIds = post.mediaBlobId.slice("patches:".length).split("|").filter(Boolean);
        setImages(patchIds.map(pid => `${aggregatorBase}/by-quilt-patch-id/${pid}`));
        return;
      }

      // Fallback: just show the single patch image we have
      setImages([post.image]);
      return;
    }

    // ── LEGACY PATH: by-quilt-id (parallel HEAD probing) ─────────────────────
    const quiltMatch = post.image.match(/\/by-quilt-id\/([A-Za-z0-9_-]+)\/image-(\d+)$/);
    if (quiltMatch) {
      const quiltBlobId = quiltMatch[1];
      let active = true;
      readQuiltFiles(quiltBlobId, [
        "image-0","image-1","image-2","image-3","image-4",
        "image-5","image-6","image-7","image-8","image-9"
      ]).then(found => {
        if (!active) return;
        const keys = Object.keys(found).sort((a,b) =>
          parseInt(a.replace("image-",""),10) - parseInt(b.replace("image-",""),10)
        );
        setImages(keys.length > 0 ? keys.map(k => found[k]) : [post.image!]);
      }).catch(() => {
        if (active) setImages([post.image!]);
      });
      return () => { active = false; };
    }

    // ── Mock fallbacks ────────────────────────────────────────────────────────
    if (post.image.includes("0xmock_quilt_")) {
      setImages(["/lofi-img/yeti-lofi-study.jpeg", "/lofi-img/yeti-igloo.jpeg"]);
      return;
    }
    if (post.image.includes("0xmock_blob_")) {
      setImages(["/lofi-img/yeti-mascot.png"]);
      return;
    }

    // ── Regular single blob — NO network requests ─────────────────────────────
    setImages([post.image]);
  }, [post.image, post.mediaBlobId]);


  useEffect(() => {
    setLocalTipsReceived(post.tipsReceived || "0");
  }, [post.tipsReceived]);

  // Load vote type from localStorage on mount/senderAddress change
  useEffect(() => {
    if (!post.objectId || !senderAddress) return;
    try {
      const votesMap = JSON.parse(localStorage.getItem("lofi_yeti_post_votes") || "{}");
      const key = `${senderAddress}_${post.objectId}`;
      if (votesMap[key]) {
        setVoteType(votesMap[key]);
      }
    } catch {}
  }, [post.objectId, senderAddress]);

  const handleVote = async (type: "up" | "down") => {
    if (!senderAddress || !post.objectId) {
      alert("Please sign in to vote!");
      return;
    }

    // Already voted this way; block double voting
    if (voteType === type) {
      return;
    }

    const currentVoteType = voteType;
    const currentLocalVotes = localVotes;

    // Apply local updates immediately for better UX
    const diff = voteType ? 2 : 1;
    if (type === "up") {
      setLocalVotes((prev) => prev + diff);
      setVoteType("up");
    } else {
      setLocalVotes((prev) => prev - diff);
      setVoteType("down");
    }

    // Save vote in localStorage
    if (typeof window !== "undefined") {
      try {
        const votesMap = JSON.parse(localStorage.getItem("lofi_yeti_post_votes") || "{}");
        const key = `${senderAddress}_${post.objectId}`;
        votesMap[key] = type;
        localStorage.setItem("lofi_yeti_post_votes", JSON.stringify(votesMap));
      } catch {}
    }

    try {
      const tx = new Transaction();
      const { profileArg, isNew } = await getOrCreateProfileArg(tx, senderAddress);

      tx.moveCall({
        target: `${PACKAGE_ID}::post::${type === "up" ? "upvote_post_entry" : "downvote_post_entry"}`,
        arguments: [tx.object(post.objectId)],
      });

      if (isNew) {
        tx.transferObjects([profileArg], senderAddress);
      }

      await sponsorAndExecuteTransaction(tx, enokiFlow, senderAddress);
      // Warm the profile cache in the background so the next action doesn't
      // hit the GraphQL indexing lag and incorrectly inject create_profile again.
      if (isNew) warmProfileCache(senderAddress);
    } catch (err: any) {
      console.error("Failed to post vote on-chain:", err);
      // Revert local changes on failure
      setLocalVotes(currentLocalVotes);
      setVoteType(currentVoteType);
      
      // Revert localStorage
      if (typeof window !== "undefined") {
        try {
          const votesMap = JSON.parse(localStorage.getItem("lofi_yeti_post_votes") || "{}");
          const key = `${senderAddress}_${post.objectId}`;
          if (currentVoteType) {
            votesMap[key] = currentVoteType;
          } else {
            delete votesMap[key];
          }
          localStorage.setItem("lofi_yeti_post_votes", JSON.stringify(votesMap));
        } catch {}
      }
    }
  };

  const handleYeeerrrrClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!senderAddress) {
      alert("Please sign in using Google zkLogin to YEEERRRR and tip!");
      return;
    }
    if (!post.objectId) return;

    setIsTipping(true);
    setYeeerrrrs((prev) => prev + 1);
    
    // Spawn floating text
    const newText: FloatingText = {
      id: Date.now() + Math.random(),
      x: Math.random() * 60 - 30,
      y: -20,
      text: `YEEERRRR! 📢 -${tipAmount} LOFI`
    };
    
    setFloatingTexts((prev) => [...prev, newText]);
    
    setTimeout(() => {
      setFloatingTexts((prev) => prev.filter((t) => t.id !== newText.id));
    }, 1000);

    try {
      const tx = new Transaction();
      const { profileArg, isNew } = await getOrCreateProfileArg(tx, senderAddress);
      const amountMist = BigInt(Math.floor(tipAmount * 1_000_000_000));

      let coinArg;
      if (LOFI_COIN_TYPE === "0x2::sui::SUI") {
        const coins = await getCoinObjects(senderAddress, "0x2::sui::SUI");
        if (coins.length === 0) {
          throw new Error("No SUI coins found in wallet to tip.");
        }
        const coinInputs = coins.map(c => tx.object(c));
        if (coinInputs.length > 1) {
          tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        }
        const [coin] = tx.splitCoins(coinInputs[0], [amountMist]);
        coinArg = coin;
      } else {
        const coins = await getCoinObjects(senderAddress, LOFI_COIN_TYPE);
        if (coins.length === 0) {
          throw new Error("No LOFI coins found in wallet to tip.");
        }
        const coinInputs = coins.map(c => tx.object(c));
        if (coinInputs.length > 1) {
          tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        }
        const [splitCoin] = tx.splitCoins(coinInputs[0], [amountMist]);
        coinArg = splitCoin;
      }

      tx.moveCall({
        target: `${PACKAGE_ID}::post::yerr_post_with_tip_entry`,
        typeArguments: [LOFI_COIN_TYPE],
        arguments: [tx.object(post.objectId), coinArg],
      });

      if (isNew) {
        tx.transferObjects([profileArg], senderAddress);
      }

      await sponsorAndExecuteTransaction(tx, enokiFlow, senderAddress);
      if (isNew) warmProfileCache(senderAddress);

      // Optimistically update the UI tip total
      setLocalTipsReceived((prev) => (BigInt(prev) + amountMist).toString());
    } catch (err: any) {
      console.error("Failed to YEEERRRR with tip on-chain:", err);
      alert(`Tipping failed: ${err.message || err}`);
    } finally {
      setIsTipping(false);
    }
  };

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/?post=${post.objectId || post.id}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        setShowShareTooltip(true);
        setTimeout(() => setShowShareTooltip(false), 2000);
      })
      .catch((err) => {
        console.error("Failed to copy link: ", err);
      });
  };

  const handleLikeClick = async () => {
    if (post.hasLiked) return; // Prevent liking again
    onLike(post.id);
    if (senderAddress && post.objectId) {
      try {
        const tx = new Transaction();
        const { profileArg, isNew } = await getOrCreateProfileArg(tx, senderAddress);

        tx.moveCall({
          target: `${PACKAGE_ID}::post::like_post_entry`,
          arguments: [tx.object(post.objectId)],
        });

        if (isNew) {
          tx.transferObjects([profileArg], senderAddress);
        }

        await sponsorAndExecuteTransaction(tx, enokiFlow, senderAddress);
        if (isNew) warmProfileCache(senderAddress);
      } catch (err) {
        console.error("Failed to like post on-chain:", err);
      }
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !senderAddress || !post.objectId) return;

    setCommenting(true);
    try {
      const tx = new Transaction();
      const { profileArg, isNew } = await getOrCreateProfileArg(tx, senderAddress);

      tx.moveCall({
        target: `${PACKAGE_ID}::post::add_comment_entry`,
        arguments: [
          tx.object(post.objectId),
          tx.pure.string(commentText.trim()),
          tx.object("0x6"), // Clock object
        ],
      });

      if (isNew) {
        tx.transferObjects([profileArg], senderAddress);
      }

      await sponsorAndExecuteTransaction(tx, enokiFlow, senderAddress);
      if (isNew) warmProfileCache(senderAddress);
      
      const newComment = {
        id: Date.now(),
        authorAddress: senderAddress,
        textContent: commentText.trim(),
        createdAt: new Date().toISOString(),
      };
      setLocalComments((prev) => [...prev, newComment]);
      setCommentText("");
    } catch (err) {
      console.error("Failed to add comment on-chain:", err);
      alert("Failed to submit comment on-chain.");
    } finally {
      setCommenting(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!onDelete || !post.objectId) return;

    setIsDeleting(true);
    setShowDeleteConfirm(false);
    try {
      // Call backend to delete with authentication
      const headers: Record<string, string> = {};
      if (senderAddress) {
        try {
          const token = await getAuthToken(enokiFlow, senderAddress);
          headers["Authorization"] = `Bearer ${token}`;
        } catch (authErr) {
          console.warn("Could not retrieve auth token for post delete:", authErr);
        }
      }
      const res = await fetch(`${BACKEND_URL}/feed/${post.objectId}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok) {
        throw new Error("Failed to delete post from database");
      }

      onDelete(post.objectId);
    } catch (err: any) {
      console.error("Failed to delete post:", err);
      alert(`Failed to delete post: ${err.message || err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Calculate estimated Flurries reward based on votes and YEEERRRRs
  const estimatedFlurry = Math.max(0, (localVotes * 10) + (yeeerrrrs * 5));

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-3xl p-4 md:p-5 space-y-4 hover:border-accent/40 hover:shadow-ice-glow transition-all duration-300 relative group"
    >
      {/* Top Header Row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar frame with glow */}
          <div className="relative h-10 w-10 rounded-xl bg-surface-secondary flex items-center justify-center border border-border-ice/65 text-xl select-none group-hover:scale-105 transition-transform">
            {post.avatar}
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-mint border border-surface-secondary" />
          </div>
          
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs md:text-sm font-bold text-text-primary tracking-wide">
                {post.user}
              </span>
              {post.verified && (
                <span title="Verified Yeti">
                  <BadgeCheck className="h-4 w-4 text-accent fill-accent/10" />
                </span>
              )}
              <span className="text-[9px] bg-surface-secondary text-text-secondary px-1.5 py-0.2 rounded font-semibold border border-border-ice/50">
                {post.role}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-text-secondary/60">{post.time}</span>
              {post.mediaBlobId && post.expiresAt && timeLeft && (
                <>
                  <span className="text-text-secondary/40 text-[9px]">•</span>
                  <span className={`text-[10px] font-mono font-semibold flex items-center gap-1 ${
                    timeLeft === "Expired" ? "text-red-400" : "text-amber-500 animate-pulse"
                  }`}>
                    ⏱️ {timeLeft === "Expired" ? "Expired" : `${timeLeft} left`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tag Pill + Owner Actions */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-heading font-bold text-purple bg-purple/10 border border-purple/20 px-2 py-0.5 rounded-lg uppercase tracking-wider">
            {post.tag}
          </span>
          {isOwner && (
            <div className="flex items-center gap-1.5">
              {post.mediaBlobId && timeLeft && timeLeft !== "Expired" && (
                <button
                  onClick={handleExtend}
                  disabled={extending}
                  title="Extend storage lease on Walrus"
                  className="px-2 py-0.5 rounded-lg text-[9px] font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  {extending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span>Extend Lease</span>
                  )}
                </button>
              )}
              <button
                onClick={handleDeleteClick}
                disabled={isDeleting}
              title="Delete post"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-500/15 text-text-secondary/50 hover:text-red-400 disabled:opacity-30"
            >
              {isDeleting ? (
                <span className="h-3.5 w-3.5 block border-2 border-red-400/50 border-t-red-400 rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              )}
            </button>
            </div>
          )}
        </div>
      </div>

      {/* Caption Content */}
      <p className="text-xs md:text-sm text-text-primary/95 leading-relaxed font-sans whitespace-pre-wrap">
        {post.caption}
      </p>

      {/* Embedded Meme Image(s) — grid layout */}
      {images.length > 0 && (() => {
        const visibleCount = Math.min(images.length, 4);
        const extraCount = images.length - 4;
        const visible = images.slice(0, visibleCount);

        // Grid layout classes based on count
        const gridClass =
          visible.length === 1 ? "grid-cols-1" :
          visible.length === 2 ? "grid-cols-2" :
          "grid-cols-2";

        return (
          <div className={`grid gap-1 rounded-2xl overflow-hidden border border-border-ice/60 group-hover:border-accent/30 transition-colors ${gridClass}`}>
            {visible.map((src, idx) => {
              const isLast = idx === visibleCount - 1;
              const hasExtra = extraCount > 0 && isLast;
              // For 3 images: first image spans 2 rows
              const spanClass =
                visible.length === 3 && idx === 0 ? "row-span-2" : "";

              return (
                <div
                  key={idx}
                  className={`relative overflow-hidden cursor-zoom-in ${spanClass} ${
                    visible.length === 1 ? "aspect-[4/3]" : "aspect-square"
                  }`}
                  onClick={() => {
                    setCurrentImageIndex(idx);
                    setIsZoomed(true);
                  }}
                >
                  <img
                    src={src}
                    alt={`Media ${idx + 1}`}
                    className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-500"
                  />
                  {/* +N more overlay on last visible image */}
                  {hasExtra && (
                    <div className="absolute inset-0 bg-bg-primary/70 backdrop-blur-sm flex items-center justify-center">
                      <span className="text-2xl font-heading font-bold text-text-primary">
                        +{extraCount + 1}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}


      {/* Footer Interactive Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border-ice/40 pt-3 text-xs text-text-secondary font-semibold">
        {/* Voting controls */}
        <div className="flex items-center gap-1.5 bg-bg-primary/50 border border-border-ice/60 px-2.5 py-1 rounded-xl">
          <button
            onClick={() => handleVote("up")}
            className={`p-1 rounded hover:bg-surface-secondary transition-colors ${
              voteType === "up" ? "text-mint" : "hover:text-text-primary"
            }`}
            title="Upvote"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          
          <span className={`text-[11px] min-w-[20px] text-center font-heading font-bold ${
            localVotes > 0 ? "text-accent" : localVotes < 0 ? "text-text-secondary" : "text-text-secondary"
          }`}>
            {localVotes}
          </span>
          
          <button
            onClick={() => handleVote("down")}
            className={`p-1 rounded hover:bg-surface-secondary transition-colors ${
              voteType === "down" ? "text-red-400" : "hover:text-text-primary"
            }`}
            title="Downvote"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          
          {/* Reward preview */}
          <div className="border-l border-border-ice/50 h-4 mx-1" />
          <span className="text-[10px] text-accent/70 cursor-help flex items-center gap-1" title="Estimated Flurries reward based on community reactions">
            💎 +{estimatedFlurry} <span className="hidden sm:inline">FLURRY</span>
          </span>
        </div>

        {/* Reaction block */}
        <div className="flex items-center gap-4">
          {/* Like */}
          <button
            onClick={handleLikeClick}
            className={`flex items-center gap-1.5 hover:text-red-400 transition-colors ${
              post.hasLiked ? "text-red-500 fill-red-500" : ""
            }`}
          >
            <Heart className="h-4 w-4" />
            <span>{post.likes}</span>
          </button>

          {/* Comment */}
          <button
            onClick={() => setShowComments(!showComments)}
            className={`flex items-center gap-1.5 hover:text-accent transition-colors ${
              showComments ? "text-accent" : ""
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            <span>{localComments.length}</span>
          </button>

          {/* Share */}
          <div className="relative">
            <button 
              onClick={handleShare}
              className="flex items-center gap-1 hover:text-accent transition-colors"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {showShareTooltip && (
                <motion.span
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: -25 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-bg-primary border border-border-ice/70 text-[9px] text-accent px-2 py-0.5 rounded shadow-lg whitespace-nowrap"
                >
                  Copied link!
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Tips Received */}
          <div className="flex items-center gap-1.5 text-mint" title="Total tips received">
            <Coins className="h-3.5 w-3.5" />
            <span>{(Number(localTipsReceived) / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} LOFI</span>
          </div>
        </div>

        {/* YEEERRRR — with custom tip input */}
        <div className="flex items-center gap-1.5 bg-bg-primary/30 border border-border-ice/30 px-2 py-1 rounded-xl relative">
          <span className="text-[10px] text-text-secondary select-none">Tip:</span>
          <input
            type="number"
            value={tipAmount}
            onChange={(e) => setTipAmount(Math.max(0.1, Number(e.target.value)))}
            min="0.1"
            step="1"
            className="w-10 text-center bg-transparent border-b border-accent/20 text-xs font-bold text-accent focus:outline-none focus:border-accent"
            title="Tip amount in LOFI"
            disabled={isTipping}
          />
          <span className="text-[10px] text-text-secondary/70 mr-1 select-none">LOFI</span>
          <div className="border-l border-border-ice/40 h-4 mx-0.5" />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleYeeerrrrClick}
            disabled={isTipping}
            className="flex items-center gap-1 text-accent font-fun font-bold text-xs hover:text-accent-hover transition-colors disabled:opacity-50"
          >
            {isTipping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flame className="h-3.5 w-3.5" />
            )}
            <span>YEEERRRR!</span>
            {yeeerrrrs > 0 && (
              <span className="text-[10px] text-text-secondary font-sans ml-1">
                +{yeeerrrrs}
              </span>
            )}
          </motion.button>
          
          {/* Floating texts — accent instead of orange */}
          <AnimatePresence>
            {floatingTexts.map((txt) => (
              <motion.span
                key={txt.id}
                initial={{ opacity: 1, y: 0, x: txt.x, scale: 0.8 }}
                animate={{ opacity: 0, y: -45, scale: 1.1, rotate: txt.x }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute text-[10px] font-fun font-bold text-accent select-none pointer-events-none whitespace-nowrap"
                style={{ top: txt.y }}
              >
                {txt.text}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapsible Comments Section */}
      <AnimatePresence>
        {showComments && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border-ice/40 pt-4 mt-2 space-y-3"
          >
            {/* Comments List */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {localComments.length === 0 ? (
                <p className="text-[10px] text-text-secondary/50 italic">No comments yet. Be the first to shill a comment!</p>
              ) : (
                localComments.map((comment) => (
                  <div key={comment.id} className="bg-bg-primary/30 border border-border-ice/20 rounded-xl p-2.5 text-xs">
                    <div className="flex justify-between items-center text-[10px] text-text-secondary/70 mb-1">
                      <span className="font-bold text-accent">
                        {comment.authorAddress.slice(0, 6)}…{comment.authorAddress.slice(-4)}
                      </span>
                      <span>
                        {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-text-primary/90">{comment.textContent}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Form */}
            {senderAddress ? (
              <form onSubmit={handleCommentSubmit} className="flex gap-2 items-center">
                <input
                  type="text"
                  placeholder="Shill a reply..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="flex-1 glass-input rounded-xl px-3 py-2 text-xs placeholder-text-secondary/40 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || commenting}
                  className="bg-accent text-bg-primary p-2 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center"
                >
                  {commenting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </form>
            ) : (
              <p className="text-[10px] text-text-secondary/70 italic text-center">Please sign in to write comments.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen Zoomed Image Modal */}
      <AnimatePresence>
        {isZoomed && images.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsZoomed(false)}
            className="fixed inset-0 z-50 bg-bg-primary/95 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-zoom-out"
          >
            {/* Top Bar for close and download */}
            <div className="absolute top-4 right-4 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              {images.length > 1 && (
                <span className="text-xs text-text-secondary font-mono bg-surface-secondary border border-border-ice/50 px-2 py-1 rounded-lg">
                  {currentImageIndex + 1} / {images.length}
                </span>
              )}
              <button
                onClick={() => downloadImage(images[currentImageIndex])}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-accent text-bg-primary shadow-ice-glow hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                Download Image
              </button>
              <button
                onClick={() => setIsZoomed(false)}
                className="h-8 w-8 rounded-full bg-surface-secondary border border-border-ice flex items-center justify-center hover:bg-bg-primary transition-colors text-text-primary cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Large centered image container */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative max-w-4xl w-full h-[70vh] sm:h-[80vh] rounded-3xl overflow-hidden border border-border-ice/60"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={images[currentImageIndex]}
                alt="Zoomed media"
                fill
                sizes="(max-width: 768px) 100vw, 896px"
                className="object-contain"
              />
            </motion.div>

            {/* Left / Right navigation in modal */}
            {images.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setCurrentImageIndex((p) => (p === 0 ? images.length - 1 : p - 1)); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-bg-primary/80 border border-border-ice flex items-center justify-center hover:bg-surface-secondary text-text-primary text-lg transition-colors cursor-pointer"
                >
                  ‹
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setCurrentImageIndex((p) => (p === images.length - 1 ? 0 : p + 1)); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-bg-primary/80 border border-border-ice flex items-center justify-center hover:bg-surface-secondary text-text-primary text-lg transition-colors cursor-pointer"
                >
                  ›
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glassmorphic Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel max-w-sm w-full p-6 space-y-5 rounded-3xl relative border border-border-ice shadow-ice-glow"
            >
              <div className="space-y-2 text-center">
                <div className="mx-auto h-12 w-12 rounded-2xl bg-red-500/10 flex items-center justify-center border border-red-500/20 text-red-400 text-xl select-none">
                  ❄️
                </div>
                <h3 className="text-sm font-heading font-bold text-text-primary">
                  Melt This Post?
                </h3>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  Are you sure you want to permanently delete this post? This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 bg-surface-secondary hover:bg-bg-primary border border-border-ice text-text-primary text-xs font-bold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="flex-1 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(239,68,68,0.15)]"
                >
                  Melt Post
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
export default PostCard;
