"use client";

import React, { useState, useEffect } from "react";
import { Users, Gift, Trophy, Calendar, Sparkles, AlertCircle } from "lucide-react";
import StatCard from "@/components/StatCard";
import Leaderboard from "@/components/Leaderboard";
import CharityImpactTracker from "@/components/CharityImpactTracker";
import ClaimSuccessModal from "@/components/ClaimSuccessModal";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { Transaction } from "@mysten/sui/transactions";
import { sponsorAndExecuteTransaction, getOrCreateProfileArg, cacheProfileId, warmProfileCache, BACKEND_URL } from "@/components/sui";

export default function DashboardPage() {
  const { address } = useZkLogin();
  const enokiFlow = useEnokiFlow();

  const [dbUser, setDbUser] = useState<any>(null);
  const [profileObjectId, setProfileObjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [totalDonated, setTotalDonated] = useState("16,500");
  const [totalFlurries, setTotalFlurries] = useState(4200);
  const [activeYetis, setActiveYetis] = useState(420);
  const [dailyPool, setDailyPool] = useState(10000);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);

  const daysOfWeek = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

  const fetchProfile = async () => {
    if (!address) return;
    try {
      const res = await fetch(`${backendUrl}/user/profile?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        setProfileObjectId(data.profileObjectId);
        setDbUser(data.dbUser);
        if (data.dbUser) {
          setTotalFlurries(data.dbUser.flurriesBalance);
        }
      }
    } catch (err) {
      console.error("Failed to load user profile:", err);
    }
  };

  const fetchGlacierFund = async () => {
    try {
      const res = await fetch(`${backendUrl}/glacier-fund`);
      if (res.ok) {
        const data = await res.json();
        const num = Number(data.totalDonated);
        setTotalDonated(num.toLocaleString());
      }
    } catch (err) {
      console.error("Failed to load glacier fund:", err);
    }
  };

  const fetchDashboardStats = async () => {
    try {
      const res = await fetch(`${backendUrl}/dashboard-stats`);
      if (res.ok) {
        const data = await res.json();
        setActiveYetis(data.activeYetis);
        setDailyPool(data.dailyPoolClaimed);
      }
    } catch (err) {
      console.error("Failed to load dashboard stats:", err);
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchGlacierFund();
    fetchDashboardStats();
  }, [address]);

  const lastCheckIn = dbUser?.lastCheckIn;
  const isClaimedToday = lastCheckIn && (Date.now() - new Date(lastCheckIn).getTime() < 86400000);

  const streakNum = dbUser?.streakCount || 0;
  const daysClaimedCount = streakNum % 7 === 0 && streakNum > 0 ? 7 : streakNum % 7;
  const claimedStreak = Array.from({ length: 7 }, (_, i) => i < daysClaimedCount);

  const handleClaimDay = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const tx = new Transaction();
      const PACKAGE_ID =
        process.env.NEXT_PUBLIC_PACKAGE_ID ||
        "0x50232b6e065801de6d8d56da5692b7b2aad9b00ebd2cdd026f1da8f0ff4ebbf4";
      
      const { profileArg, isNew } = await getOrCreateProfileArg(tx, address);

      tx.moveCall({
        target: `${PACKAGE_ID}::profile::claim_daily_check_in_entry`,
        arguments: [
          profileArg,
          tx.object("0x6"), // Clock object
        ],
      });

      if (isNew) {
        tx.transferObjects([profileArg], address);
      }

      await sponsorAndExecuteTransaction(tx, enokiFlow, address);
      if (isNew) warmProfileCache(address); // seed cache in background after profile creation
      await fetchProfile();
      await fetchDashboardStats(); // Refresh stats on check-in
      setIsClaimModalOpen(true);
    } catch (err) {
      console.error("Check-in failed:", err);
      alert("Failed to claim check-in on-chain.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Live Stats Row utilizing reusable StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard
          title="Active Lounge Yetis"
          value={activeYetis.toLocaleString()}
          icon={Users}
          description="Yetis currently chilling online"
          trend="+15%"
          trendType="positive"
          glowColor="accent"
        />
        <StatCard
          title="Glacier Impact Fund"
          value={`${totalDonated} LOFI`}
          icon={Gift}
          description="Total donations to carbon initiatives"
          trend="+65%"
          trendType="positive"
          glowColor="mint"
        />
        <StatCard
          title="Lounge Pool"
          value={`${dailyPool.toLocaleString()} 💎`}
          icon={Trophy}
          description="Total flurries claimed"
          trend="Stable"
          trendType="neutral"
          glowColor="purple"
        />
      </div>

      {/* Main Grid: Charity tracker & Daily check-in */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        
        {/* Left: Charity + Streak (3 cols) */}
        <div className="md:col-span-3 space-y-6">
          <CharityImpactTracker />

          {/* Daily Streak Check-in */}
          <div className="glass-panel rounded-3xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-accent" /> Daily Check-in Streak
                </h3>
                <p className="text-[10px] text-text-secondary">
                  Claim daily rewards. Build a streak to multiplier your rewards.
                </p>
              </div>
              <span className="text-[10px] bg-accent/10 text-accent border border-accent/25 px-2 py-0.5 rounded-lg font-bold">
                +5% Streak Active
              </span>
            </div>

            {address ? (
              <div className="grid grid-cols-7 gap-2">
                {daysOfWeek.map((day, idx) => {
                  const isClaimed = claimedStreak[idx];
                  const isNext = !isClaimedToday && idx === (daysClaimedCount % 7);
                  const isLocked = !isClaimed && !isNext;
                  const isClaiming = loading && isNext;
                  const rewardVal = 10 + ((idx + 1) * 5);

                  return (
                    <button
                      key={idx}
                      disabled={isClaimed || isLocked || isClaiming}
                      onClick={handleClaimDay}
                      className={`p-3 rounded-2xl flex flex-col items-center justify-between h-20 transition-all border ${
                        isClaimed
                          ? "bg-accent/10 border-accent/25 text-accent"
                          : isNext
                          ? "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 cursor-pointer shadow-ice-glow scale-102"
                          : "bg-surface-secondary/40 border-border-ice/30 text-text-secondary/40 cursor-not-allowed"
                      }`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider">{day}</span>
                      <span className="text-base">
                        {isClaimed ? "❄️" : isClaiming ? "⏳" : "💎"}
                      </span>
                      <span className="text-[8px] font-semibold">
                        {isClaimed ? "Claimed" : `+${rewardVal}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-[10px] text-text-secondary/70 italic text-center border border-border-ice/30 rounded-2xl py-6 bg-surface-secondary/20">
                Please sign in to claim daily rewards.
              </div>
            )}
          </div>
        </div>

        {/* Right: Leaderboard (2 cols) */}
        <div className="md:col-span-2">
          <Leaderboard />
        </div>
      </div>

      {/* Claim Success modal */}
      <ClaimSuccessModal
        isOpen={isClaimModalOpen}
        onClose={() => setIsClaimModalOpen(false)}
        amount={100}
      />
    </div>
  );
}
