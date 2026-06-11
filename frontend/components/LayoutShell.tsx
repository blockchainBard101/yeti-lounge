"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Home, Rss, BarChart2, Calendar, BookOpen, User, Bell, Wallet, CheckCircle, Snowflake, Gift, Users, Flame, X, Copy, LogOut, Check, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import SnowFlurry from "./SnowFlurry";
import MusicPlayer from "./MusicPlayer";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { getCoinBalance, LOFI_COIN_TYPE, reverseResolveSuiAddress } from "./sui";
import YetiCopilot from "./YetiCopilot";

interface LayoutShellProps {
  children: React.ReactNode;
}

const navItems = [
  { label: "Feed",      href: "/",          icon: Rss,       emoji: "🏂" },
  { label: "Lounge",    href: "/lounge",    icon: Home,      emoji: "🏠" },
  { label: "Rewards",   href: "/quests",     icon: BarChart2, emoji: "🏆" },
  { label: "Events",    href: "/events",     icon: Calendar,  emoji: "📅" },
  { label: "Profile",   href: "/profile",    icon: User,      emoji: "👤" },
  { label: "Wallet",    href: "/wallet",     icon: Wallet,    emoji: "💳" },
];

const pageTitle: Record<string, string> = {
  "/":          "Feed",
  "/lounge":    "Lounge",
  "/quests":    "Rewards",
  "/events":    "Events",
  "/academy":   "Academy",
  "/profile":   "Profile",
  "/wallet":    "Wallet",
};

export const LayoutShell: React.FC<LayoutShellProps> = ({ children }) => {
  const pathname = usePathname();
  const enokiFlow = useEnokiFlow();
  const { address } = useZkLogin();

  const [isSnowEnabled, setIsSnowEnabled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [lofiBalance, setLofiBalance] = useState("0");
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suinsName, setSuinsName] = useState<string | null>(null);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [totalDonated, setTotalDonated] = useState("0");
  const [fundPercent, setFundPercent] = useState(0);

  useEffect(() => {
    if (!showDropdown) return;
    const handleClose = () => setShowDropdown(false);
    document.addEventListener("click", handleClose);
    return () => document.removeEventListener("click", handleClose);
  }, [showDropdown]);

  useEffect(() => {
    setMounted(true);
    
    // Fetch live Glacier Fund stats
    const fetchGlacierFund = async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
        const fundRes = await fetch(`${backendUrl}/glacier-fund`);
        if (fundRes.ok) {
          const fundData = await fundRes.json();
          const num = Number(BigInt(fundData.totalDonated) / BigInt(1_000_000_000));
          setTotalDonated(num.toLocaleString(undefined, { maximumFractionDigits: 0 }));
          
          // Target goal is 25,000 SUI
          const goal = 25000;
          const pct = Math.min(100, Math.round((num / goal) * 100));
          setFundPercent(pct);
        }
      } catch (err) {
        console.error("Failed to load glacier fund in LayoutShell:", err);
      }
    };
    fetchGlacierFund();
  }, []);

  useEffect(() => {
    if (!address) {
      setSuinsName(null);
      return;
    }
    const fetchBalance = async () => {
      try {
        const balanceVal = await getCoinBalance(address, LOFI_COIN_TYPE);
        const total = Number(BigInt(balanceVal) / BigInt(1_000_000_000));
        setLofiBalance(total.toLocaleString());
      } catch (err) {
        console.error("Failed to fetch LOFI balance in LayoutShell:", err);
      }
    };
    const fetchSuiNS = async () => {
      try {
        const name = await reverseResolveSuiAddress(address);
        setSuinsName(name);
      } catch (err) {
        console.error("Failed to reverse resolve address in LayoutShell:", err);
      }
    };
    fetchBalance();
    fetchSuiNS();
    
    // Poll balance every 15 seconds to keep it fresh
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [address]);

  const handleConnectWallet = async () => {
    setConnecting(true);
    try {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "google_client_id_placeholder";
      if (clientId === "google_client_id_placeholder") {
        console.warn("Enoki zkLogin: Google Client ID is placeholder. Please configure NEXT_PUBLIC_GOOGLE_CLIENT_ID.");
      }
      const redirectUrl = window.location.origin;
      const authUrl = await enokiFlow.createAuthorizationURL({
        provider: "google",
        clientId,
        redirectUrl,
        network: "testnet",
      });
      window.location.href = authUrl;
    } catch (err) {
      console.error("Error starting Google login flow:", err);
      setConnecting(false);
    }
  };

  const handleLogout = async () => {
    setConnecting(true);
    setShowDropdown(false);
    try {
      await enokiFlow.logout();
    } catch (err) {
      console.error("Error logging out:", err);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (address) {
      setShowDropdown(!showDropdown);
    } else {
      handleConnectWallet();
    }
  };

  const title = pageTitle[pathname] ?? "Yeti Lounge";

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-bg-primary text-text-primary font-body antialiased">
      <SnowFlurry enabled={isSnowEnabled} />

      {/* ── DESKTOP LEFT SIDEBAR ──────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 glass-sidebar shrink-0 z-10 select-none">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-border-ice/40">
          <div className="relative h-9 w-9 shrink-0">
            <Image src="/lofi-img/yeti-mascot.png" alt="Yeti" fill sizes="36px" className="object-contain" priority />
          </div>
          <div>
            <span className="font-heading font-bold text-sm text-text-primary tracking-wide">Yeti Lounge</span>
            <p className="text-[9px] text-text-secondary/60 font-medium tracking-widest uppercase">on Sui</p>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          <p className="text-[9px] uppercase font-bold tracking-widest text-text-secondary/40 px-3 mb-3">Menu</p>
          {navItems.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
                  isActive
                    ? "bg-accent/12 text-accent"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-secondary/50"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-accent" : "text-text-secondary group-hover:text-text-primary"}`} />
                <span>{label}</span>
                {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
          {/* Academy — separate from main nav to not crowd mobile bar */}
          <Link
            href="/academy"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group ${
              pathname === "/academy"
                ? "bg-accent/12 text-accent"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-secondary/50"
            }`}
          >
            <BookOpen className={`h-4 w-4 shrink-0 ${pathname === "/academy" ? "text-accent" : "text-text-secondary group-hover:text-text-primary"}`} />
            <span>Academy</span>
            {pathname === "/academy" && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
          </Link>
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border-ice/40 space-y-3">
          {/* Snow toggle */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-2 text-text-secondary">
              <Snowflake className={`h-3.5 w-3.5 ${isSnowEnabled ? "text-accent" : ""}`} />
              <span>Snowfall</span>
            </div>
            <button
              onClick={() => setIsSnowEnabled(!isSnowEnabled)}
              className={`relative h-5 w-9 rounded-full border-2 border-transparent transition-colors ${isSnowEnabled ? "bg-accent" : "bg-border-ice"}`}
            >
              <span className={`absolute top-0 left-0 h-4 w-4 rounded-full bg-bg-primary shadow transition-transform ${isSnowEnabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </div>

          {/* Glacier mini-widget */}
          <div className="glass-panel rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-accent">
              <Gift className="h-3 w-3" /> GLACIER FUND
            </div>
            <div className="w-full bg-bg-primary h-1 rounded-full overflow-hidden">
              <div className="bg-accent h-full transition-all duration-500" style={{ width: `${fundPercent}%` }} />
            </div>
            <p className="text-[9px] text-text-secondary">{totalDonated} SUI donated • {fundPercent}%</p>
          </div>
        </div>
      </aside>

      {/* ── MAIN COLUMN ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">

        {/* ── TOP BAR ───────────────────────────────── */}
        <header className="h-14 shrink-0 flex items-center justify-between px-4 md:px-5 border-b border-border-ice/60 bg-surface/90 backdrop-blur-md relative z-20 shadow-sm">
          {/* Left — avatar + title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-full bg-surface border border-border-ice flex items-center justify-center text-base shrink-0 select-none shadow-sm">
              🥶
            </div>
            <span className="text-sm font-heading font-bold text-text-primary truncate">{title}</span>
          </div>

          {/* Right — bell + wallet */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Copilot Toggle */}
            {mounted && address && (
              <button
                onClick={() => setIsCopilotOpen(true)}
                className="h-8 px-3 rounded-xl flex items-center gap-1.5 bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 transition-all font-bold text-xs shadow-xs"
              >
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span className="hidden sm:inline">Yeti Copilot</span>
              </button>
            )}

            {/* Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="h-8 w-8 rounded-xl flex items-center justify-center text-text-secondary hover:text-accent hover:bg-surface-secondary transition-colors"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              </button>
              <AnimatePresence>
                {showNotifications && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowNotifications(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-10 w-72 glass-panel rounded-2xl p-4 shadow-2xl z-40"
                    >
                      <p className="text-[9px] uppercase font-bold text-text-secondary/50 tracking-widest mb-3">Notifications</p>
                      <div className="space-y-2">
                        <div className="p-2.5 rounded-xl bg-surface-secondary border border-border-ice/50 text-xs">
                          <span className="text-accent font-bold">Daily claim ready!</span>
                          <span className="text-text-secondary"> Get your 100 flurries.</span>
                        </div>
                        <div className="p-2.5 rounded-xl bg-surface-secondary border border-border-ice/50 text-xs text-text-secondary">
                          <span className="text-accent font-bold">Sui Lofi NFT Mint</span> starts in 2 days.
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* LOFI balance badge */}
            {mounted && address && (
              <div className="flex items-center gap-1.5 h-8 px-3 bg-accent/10 border border-accent/25 rounded-xl text-xs font-bold text-accent select-none">
                <span className="text-[14px]">❄️</span>
                <span>{lofiBalance} LOFI</span>
              </div>
            )}

            {/* Wallet */}
            <div className="relative">
              <button
                onClick={handleButtonClick}
                disabled={connecting || !mounted}
                className={`flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  mounted && address
                    ? "bg-surface border border-border-ice/60 text-text-secondary hover:bg-surface-secondary hover:text-accent"
                    : "bg-accent text-bg-primary hover:brightness-110"
                }`}
              >
                {connecting ? (
                  <span className="h-3 w-3 rounded-full border-2 border-bg-primary border-t-transparent animate-spin" />
                ) : mounted && address ? (
                  <><CheckCircle className="h-3.5 w-3.5 text-accent" /><span className="hidden sm:inline">{suinsName || `${address.slice(0, 6)}...${address.slice(-4)}`}</span><span className="sm:hidden">✓</span></>
                ) : (
                  <><Wallet className="h-3.5 w-3.5" /><span>Google Login</span></>
                )}
              </button>

              <AnimatePresence>
                {showDropdown && address && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 mt-2 w-72 glass-panel border border-border-ice/60 rounded-2xl p-4 shadow-card z-50 text-xs space-y-4 bg-surface"
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block">Wallet Address</span>
                      {suinsName && (
                        <div className="text-[11px] font-bold text-accent mb-1">{suinsName}</div>
                      )}
                      <div className="flex items-center gap-2 bg-bg-primary/45 border border-border-ice/50 rounded-xl p-2 select-all break-all relative group">
                        <span className="font-mono text-[10px] pr-8 text-text-primary leading-normal">{address}</span>
                        <button
                          onClick={handleCopyAddress}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hover:bg-surface rounded-lg text-text-secondary hover:text-accent transition-colors"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-mint animate-scale" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={handleLogout}
                      className="w-full py-2 bg-red-500/10 hover:bg-red-500/25 border border-red-500/20 hover:border-red-500/40 text-red-500 hover:text-red-400 font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Logout</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* ── PAGE CONTENT ──────────────────────────── */}
        <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
          <div className="max-w-5xl mx-auto px-4 py-5 md:px-8 md:py-6 w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── MOBILE FLOATING BOTTOM NAV ──────────────── */}
      <div className="fixed bottom-3 left-3 right-3 md:hidden z-30">
        <div className="bg-surface/95 backdrop-blur-xl border border-border-ice rounded-2xl shadow-card flex items-center justify-around px-2 py-2">
          {navItems.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200 ${
                  isActive ? "nav-pill-active" : "text-text-secondary"
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? "text-accent" : ""}`} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={`text-[9px] font-semibold ${isActive ? "text-accent" : ""}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <MusicPlayer />
      <YetiCopilot isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} />
    </div>
  );
};

export default LayoutShell;
