"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { 
  Play, Pause, SkipForward, Volume2, Sparkles, 
  Heart, Radio, Music, ArrowUpRight, Users, Gift, TrendingUp
} from "lucide-react";

export default function Home() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.4);
  const [trackIndex, setTrackIndex] = useState(0);
  const [activeYetis, setActiveYetis] = useState(420);
  const [lofiDonated, setLofiDonated] = useState("16,500");
  const [flurriesPool, setFlurriesPool] = useState("10,000");

  const tracks = [
    { title: "Frosty Bach Toccata", url: "https://upload.wikimedia.org/wikipedia/commons/2/21/J.S._Bach_-_Toccata_and_Fugue_in_D_Minor_BWV_565.mp3" },
    { title: "Igloo Debussy Moonlight", url: "https://upload.wikimedia.org/wikipedia/commons/c/c4/Debussy_-_Clair_de_Lune.mp3" },
    { title: "Sui Sugar Plum Fairy", url: "https://upload.wikimedia.org/wikipedia/commons/4/40/Tchaikovsky_-_Nutcracker_-_Dance_of_the_Sugar_Plum_Fairy.mp3" },
    { title: "Blizzard Bach Gigue", url: "https://upload.wikimedia.org/wikipedia/commons/e/e0/J.S._Bach_-_Gigue_from_Suite_in_E_minor.mp3" },
    { title: "Glacier Bach Presto", url: "https://upload.wikimedia.org/wikipedia/commons/5/5a/J.S._Bach_-_Presto_from_Sonata_in_G_minor.mp3" }
  ];

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    audioRef.current = new Audio(tracks[0].url);
    audioRef.current.loop = true;
    audioRef.current.volume = 0.4;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await fetch(`${backendUrl}/dashboard-stats`);
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setActiveYetis(statsData.activeYetis);
          setFlurriesPool(statsData.dailyPoolClaimed.toLocaleString());
        }
      } catch (err) {
        console.error("Failed to load dashboard stats on homepage:", err);
      }

      try {
        const fundRes = await fetch(`${backendUrl}/glacier-fund`);
        if (fundRes.ok) {
          const fundData = await fundRes.json();
          const num = Number(BigInt(fundData.totalDonated) / BigInt(1_000_000_000));
          setLofiDonated(num.toLocaleString());
        }
      } catch (err) {
        console.error("Failed to load glacier fund on homepage:", err);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-6 pb-16">

      {/* ── HERO BANNER ─────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl glass-panel p-6 md:p-8">
        <div className="absolute top-0 right-0 h-48 w-48 bg-accent/8 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row gap-6 items-center">
          <div className="space-y-4 max-w-xl flex-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-accent/12 text-accent border border-accent/20 tracking-wider">
              <Sparkles className="h-3 w-3" />
              <span>LOFI THE YETI COMMUNITY</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight text-text-primary leading-tight">
              Thaw In. Hang Out.<br />
              <span className="text-accent">Chill on Sui.</span>
            </h1>
            <p className="text-text-secondary text-sm leading-relaxed max-w-md">
              Step into the Yeti Lounge. Claim your daily flurries, read alpha, and level up with fellow Yeti builders on Sui.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <Link 
                href="/dashboard"
                className="px-5 py-2.5 bg-accent text-bg-primary font-bold text-sm rounded-xl hover:brightness-110 transition-all shadow-ice-glow"
              >
                Claim Flurries 💎
              </Link>
              <Link 
                href="/feed"
                className="px-5 py-2.5 bg-surface border border-border-ice text-text-secondary font-semibold text-sm rounded-xl hover:text-text-primary hover:border-accent/30 transition-all"
              >
                Browse Feed
              </Link>
            </div>
          </div>
          
          {/* Mascot image */}
          <div className="relative w-full md:w-64 h-48 rounded-2xl overflow-hidden border border-border-ice shadow-card shrink-0">
            <Image 
              src="/lofi-img/yeti-lofi-study.jpeg" 
              alt="Yeti Lofi Study Scene" 
              fill 
              sizes="(max-width: 768px) 100vw, 256px"
              className="object-cover hover:scale-105 transition-transform duration-500"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <span className="absolute bottom-2.5 left-2.5 text-[10px] font-bold text-white bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-lg flex items-center gap-1">
              <Radio className="h-3 w-3 text-red-400 animate-pulse" /> Live Beats
            </span>
          </div>
        </div>
      </section>

      {/* ── STATS ROW ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active Yetis", value: activeYetis.toLocaleString(), icon: "🏂", color: "text-accent" },
          { label: "LOFI Donated", value: `${lofiDonated}`, icon: "💧", color: "text-accent" },
          { label: "Flurries Pool", value: `${flurriesPool} 💎`, icon: "❄️", color: "text-accent" },
        ].map((stat) => (
          <div key={stat.label} className="glass-panel rounded-2xl p-4 text-center">
            <div className="text-2xl mb-1">{stat.icon}</div>
            <div className={`text-lg font-heading font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-[10px] text-text-secondary font-medium mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* ── MAIN GRID: Player + Lounge ──────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Lofi Music Player */}
        <div className="glass-panel rounded-3xl p-5 flex flex-col justify-between h-[260px] relative overflow-hidden">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] uppercase font-bold text-text-secondary/60 tracking-widest mb-1">Now Vibing To</p>
              <h3 className="text-lg font-heading font-bold text-text-primary">{tracks[trackIndex].title}</h3>
              <p className="text-xs text-text-secondary">Vol. 2 — Cozy Cave beats</p>
            </div>
            <div className="h-10 w-10 rounded-2xl bg-surface-secondary border border-border-ice flex items-center justify-center">
              <Music className="h-5 w-5 text-accent" />
            </div>
          </div>

          {/* Waveform */}
          <div className="flex items-end gap-0.5 h-10">
            {Array.from({ length: 28 }).map((_, i) => (
              <motion.div
                key={i}
                animate={isPlaying ? { height: [6, Math.random() * 28 + 6, 6] } : { height: 6 }}
                transition={{ duration: 0.8 + (i % 5) * 0.12, repeat: Infinity, ease: "easeInOut" }}
                className="flex-1 bg-accent/35 rounded-full"
              />
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border-ice/50 pt-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (!audioRef.current) return;
                  if (isPlaying) {
                    audioRef.current.pause();
                  } else {
                    audioRef.current.play().catch((e) => console.error("Audio playback failed:", e));
                  }
                  setIsPlaying(!isPlaying);
                }}
                className="h-10 w-10 rounded-full bg-accent text-bg-primary flex items-center justify-center hover:brightness-110 active:scale-95 transition-all shadow-ice-glow"
              >
                {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current translate-x-0.5" />}
              </button>
              <button
                onClick={() => {
                  if (!audioRef.current) return;
                  const nextIndex = (trackIndex + 1) % tracks.length;
                  setTrackIndex(nextIndex);
                  
                  audioRef.current.src = tracks[nextIndex].url;
                  audioRef.current.load();
                  if (isPlaying) {
                    audioRef.current.play().catch((e) => console.error("Skip playback failed:", e));
                  }
                }}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-text-secondary select-none">
              <button
                onClick={() => {
                  if (!audioRef.current) return;
                  audioRef.current.muted = !isMuted;
                  setIsMuted(!isMuted);
                }}
                className="hover:text-text-primary transition-colors"
              >
                {isMuted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-red-400"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="22" y1="9" x2="16" y2="15"></line><line x1="16" y1="9" x2="22" y2="15"></line></svg>
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </button>
              <div className="flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const newVol = parseFloat(e.target.value);
                    setVolume(newVol);
                    if (audioRef.current) {
                      audioRef.current.volume = newVol;
                      audioRef.current.muted = newVol === 0;
                    }
                    if (newVol > 0 && isMuted) {
                      setIsMuted(false);
                    }
                  }}
                  className="w-16 h-1 bg-border-ice rounded-full appearance-none cursor-pointer accent-accent focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Igloo Lobby */}
        <div className="glass-panel rounded-3xl p-5 flex flex-col justify-between h-[260px] relative overflow-hidden">
          <div className="absolute top-0 right-0 h-24 w-24 bg-accent/5 rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10">
            <p className="text-[10px] uppercase font-bold text-text-secondary/60 tracking-widest mb-1">Lounge Corner</p>
            <h3 className="text-lg font-heading font-bold text-text-primary">The Igloo Lobby</h3>
            <p className="text-xs text-text-secondary mt-2 leading-relaxed">
              Need a study partner? Hop into live voice channels, share screens, and vibe to synchronized lounge music.
            </p>
          </div>

          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-3 bg-surface-secondary border border-border-ice/50 p-3 rounded-2xl">
              <div className="flex -space-x-2">
                {["🏂", "🤖", "🎧"].map((e, i) => (
                  <div key={i} className="h-7 w-7 rounded-full bg-surface border border-border-ice flex items-center justify-center text-xs">{e}</div>
                ))}
              </div>
              <div className="text-[10px] text-text-secondary">
                <span className="text-accent font-bold">12 Yetis</span> chilling right now
              </div>
            </div>
            <button className="w-full py-2.5 bg-surface border border-border-ice text-text-secondary font-semibold text-xs rounded-xl hover:border-accent/30 hover:text-text-primary transition-all flex items-center justify-center gap-1.5">
              Enter Voice Chill Room <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── QUICK GUIDE ─────────────────────────────── */}
      <section className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-heading font-bold text-text-primary">🏂 Quick Guide to the Lounge</h3>
          <span className="text-[10px] text-text-secondary font-medium">3 steps</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: "💎", step: "1. Claim Flurries", desc: "Head to the Dashboard to collect daily claim tokens on Sui.", href: "/dashboard" },
            { icon: "📢", step: "2. Shill Memes", desc: "Post hot takes, Sui alpha, and lofi art in the Community Feed.", href: "/feed" },
            { icon: "🎓", step: "3. Learn Move", desc: "Visit the Academy for coding lessons and builder challenges.", href: "/academy" },
          ].map((item) => (
            <Link
              key={item.step}
              href={item.href}
              className="p-4 rounded-2xl bg-surface-secondary border border-border-ice/60 hover:border-accent/30 transition-all group"
            >
              <span className="text-2xl block mb-2">{item.icon}</span>
              <h4 className="text-xs font-bold text-text-primary mb-1 group-hover:text-accent transition-colors">{item.step}</h4>
              <p className="text-[10px] text-text-secondary leading-relaxed">{item.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── TRENDING TOPICS (desktop bonus) ─────────── */}
      <section className="glass-panel rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" /> Trending in the Lounge
          </h3>
          <button className="text-[10px] text-accent font-semibold hover:underline">See All →</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { tag: "#YEEERRRR", count: "4.2K", trend: "+24%" },
            { tag: "#SuiLofi", count: "1.8K", trend: "+12%" },
            { tag: "#IceCapSui", count: "932", trend: "+55%" },
            { tag: "#DailyFlurry", count: "740", trend: "-3%" },
          ].map((topic) => (
            <div key={topic.tag} className="p-3 rounded-xl bg-surface-secondary border border-border-ice/50 hover:border-accent/25 transition-all cursor-pointer">
              <p className="text-xs font-bold text-text-primary">{topic.tag}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{topic.count} shills</p>
              <span className={`text-[9px] font-bold ${topic.trend.startsWith("+") ? "text-accent" : "text-text-secondary"}`}>{topic.trend}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
