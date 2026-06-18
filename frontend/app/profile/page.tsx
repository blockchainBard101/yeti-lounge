"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { Sparkles, Award, FileText, Loader2 } from "lucide-react";
import ProfileCustomizer from "@/components/ProfileCustomizer";
import PostCard, { Post } from "@/components/PostCard";
import { useZkLogin, useEnokiFlow } from "@mysten/enoki/react";

interface YetiNFT {
  name: string;
  id: string;
  image: string;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
  status: "Staked" | "In Wallet";
}

export default function ProfilePage() {
  const { address } = useZkLogin();
  const enokiFlow = useEnokiFlow();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [renewing, setRenewing] = useState<string | null>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

  const nfts: YetiNFT[] = [
    {
      name: "Genesis Mascot Yeti",
      id: "#0001",
      image: "/lofi-img/yeti-mascot.png",
      rarity: "Legendary",
      status: "In Wallet",
    },
    {
      name: "Jetpack Flyer Yeti",
      id: "#0512",
      image: "/lofi-img/yeti-jetpack.jpeg",
      rarity: "Epic",
      status: "In Wallet",
    },
    {
      name: "OK Hand Chill Yeti",
      id: "#4206",
      image: "/lofi-img/yeti-hand-ok-lofi.jpeg",
      rarity: "Rare",
      status: "Staked",
    }
  ];

  const resolveImageUrl = (mediaBlobId?: string | null): string | undefined => {
    if (!mediaBlobId) return undefined;
    if (mediaBlobId.startsWith("/") || mediaBlobId.startsWith("http") || mediaBlobId.startsWith("data:")) {
      return mediaBlobId;
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

  const fetchUserPosts = async () => {
    if (!address) return;
    setLoadingPosts(true);
    try {
      const res = await fetch(`${BACKEND_URL}/feed?author=${encodeURIComponent(address)}&includeExpired=true`);
      if (res.ok) {
        const rawPosts = await res.json();
        const mappedPosts: Post[] = rawPosts.map((p: any, idx: number) => {
          const userHandle = p.author?.suinsHandle || `${address.slice(0, 6)}…${address.slice(-4)}`;
          return {
            id: p.objectId || idx,
            objectId: p.objectId,
            user: userHandle,
            avatar: p.author?.avatarBlobId || "🏂",
            role: address === "0xd2f1b1b155e4e9afdb8eaa3a934f8d725adaa4e0eb21f537dea3af83b797b40c" ? "Lounge Host 👑" : "Yeti Member ❄️",
            time: formatTime(p.createdAt),
            caption: p.textContent || "",
            image: resolveImageUrl(p.mediaBlobId),
            likes: p.likes || 0,
            comments: p.comments?.length || 0,
            commentsList: p.comments || [],
            votes: (p.upvotes || 0) - (p.downvotes || 0),
            tag: idx % 3 === 0 ? "Charity Impact" : idx % 3 === 1 ? "Sui Alpha" : "Lofi Vibes",
            verified: !!p.author?.isVerified || address === "0xd2f1b1b155e4e9afdb8eaa3a934f8d725adaa4e0eb21f537dea3af83b797b40c",
            hasLiked: false,
            tipsReceived: p.tipsReceived || "0",
            isExpired: !!p.isExpired,
            expiresAt: p.expiresAt,
          };
        });
        setPosts(mappedPosts);
      }
    } catch (err) {
      console.error("Failed to load user posts on profile:", err);
    } finally {
      setLoadingPosts(false);
    }
  };

  const handleRenewPost = async (objectId: string) => {
    setRenewing(objectId);
    try {
      const res = await fetch(`${BACKEND_URL}/feed/${objectId}/renew`, {
        method: "POST",
      });
      if (res.ok) {
        fetchUserPosts();
      } else {
        alert("Failed to renew storage.");
      }
    } catch (err) {
      console.error("Failed to renew post:", err);
      alert("Error renewing storage.");
    } finally {
      setRenewing(null);
    }
  };

  useEffect(() => {
    fetchUserPosts();
  }, [address]);

  const handleLike = (id: number) => {
    setPosts((prev) =>
      prev.map((post) => {
        if (post.id === id) {
          return {
            ...post,
            likes: post.hasLiked ? post.likes - 1 : post.likes + 1,
            hasLiked: !post.hasLiked,
          };
        }
        return post;
      })
    );
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Profile Customizer Card (includes Avatar Selection, Nickname/Status edits, and Badge Showcase) */}
      <ProfileCustomizer />

      {/* Yeti NFT Locker / Gallery */}
      <div className="glass-panel rounded-3xl p-5 space-y-4">
        <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-accent" /> Yeti NFT Locker ({nfts.length})
        </h3>
        <p className="text-[10px] text-text-secondary">
          Displaying your verified Yeti Lounge Genesis NFTs secured on the Sui blockchain network.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {nfts.map((nft, idx) => (
            <div 
              key={idx} 
              className="glass-panel bg-surface-secondary/20 rounded-2xl p-3 border border-border-ice/60 flex flex-col justify-between h-[210px] group hover:border-accent/40 transition-all"
            >
              {/* Rarity & Status tags */}
              <div className="flex justify-between items-center text-[8px] font-bold uppercase tracking-wider mb-2">
                <span className={`${
                  nft.rarity === "Legendary" 
                    ? "text-accent font-bold" 
                    : nft.rarity === "Epic" 
                    ? "text-accent" 
                    : "text-accent"
                }`}>
                  {nft.rarity}
                </span>
                <span className={`px-1.5 py-0.2 rounded ${
                  nft.status === "Staked" ? "bg-accent/10 text-accent" : "bg-surface-secondary text-text-secondary"
                }`}>
                  {nft.status}
                </span>
              </div>

              {/* NFT Image */}
              <div className="relative w-full h-[100px] rounded-xl overflow-hidden border border-border-ice/45 mb-2 bg-bg-primary/40">
                <Image
                  src={nft.image}
                  alt={nft.name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1200px) 300px, 300px"
                  className="object-contain p-1 group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              <div className="space-y-0.5 min-w-0">
                <div className="text-[10px] font-bold text-text-primary truncate">{nft.name}</div>
                <div className="text-[8px] text-text-secondary/60">{nft.id}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User's Shilled Posts */}
      <div className="glass-panel rounded-3xl p-5 space-y-4">
        <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-accent" /> Your Shilled Memes
        </h3>
        <p className="text-[10px] text-text-secondary">
          Track and manage your posts and total tipping rewards received from lounge members.
        </p>

        {loadingPosts ? (
          <div className="flex items-center justify-center py-10 gap-2 text-xs text-accent font-semibold">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Retrieving your lounge history...</span>
          </div>
        ) : !address ? (
          <p className="text-xs text-text-secondary italic text-center py-6">
            Please sign in using Google zkLogin to view your shilled memes.
          </p>
        ) : posts.length === 0 ? (
          <p className="text-xs text-text-secondary italic text-center py-6">
            You haven't shilled any memes to the lounge yet!
          </p>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <div key={post.id} className="relative space-y-2">
                {post.isExpired && (
                  <div className="glass-panel border-amber-500/30 bg-amber-500/5 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs select-none">
                    <div className="flex items-center gap-2 text-amber-600 font-semibold">
                      <span className="text-base">⚠️</span>
                      <span>Walrus decentralized storage for this image has EXPIRED!</span>
                    </div>
                    <button
                      onClick={() => handleRenewPost(post.objectId!)}
                      disabled={renewing === post.objectId}
                      className="px-4 py-1.5 rounded-xl text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {renewing === post.objectId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span>Renew Storage</span>
                      )}
                    </button>
                  </div>
                )}
                <div className={post.isExpired ? "opacity-60 pointer-events-none select-none" : ""}>
                  <PostCard 
                    post={post} 
                    onLike={handleLike} 
                    enokiFlow={enokiFlow} 
                    senderAddress={address} 
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
