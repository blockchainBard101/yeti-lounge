"use client";

import React, { useState, useEffect } from "react";
import { Search, Trophy, Flame, Sparkles, ChevronRight } from "lucide-react";
import { useZkLogin } from "@mysten/enoki/react";

interface LeaderboardUser {
  rank: number;
  name: string;
  avatar: string;
  level: number;
  streak: number;
  flurries: number;
  isSelf?: boolean;
}

export const Leaderboard: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [selfUser, setSelfUser] = useState<LeaderboardUser | null>(null);
  const { address } = useZkLogin();

  useEffect(() => {
    const fetchLeaderboard = async () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
      try {
        const res = await fetch(`${backendUrl}/leaderboard`);
        if (res.ok) {
          const raw = await res.json();
          const mapped: LeaderboardUser[] = raw.map((u: any, idx: number) => ({
            rank: idx + 1,
            name: u.suinsHandle || `${u.suiAddress.slice(0, 6)}…${u.suiAddress.slice(-4)}`,
            avatar: u.avatarBlobId && u.avatarBlobId.length < 32 ? u.avatarBlobId : "🏂",
            level: Math.max(1, Math.floor((u.flurriesBalance - 100) / 100) + 1),
            streak: u.streakCount,
            flurries: u.flurriesBalance,
            isSelf: address && u.suiAddress.toLowerCase() === address.toLowerCase(),
          }));
          setUsers(mapped);
        }
      } catch (err) {
        console.error("Failed to load leaderboard:", err);
      }
    };
    fetchLeaderboard();
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const fetchSelf = async () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
      try {
        const res = await fetch(`${backendUrl}/user/profile?address=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.dbUser) {
            const u = data.dbUser;
            setSelfUser({
              rank: users.find(x => x.isSelf)?.rank || 42,
              name: u.suinsHandle || `${u.suiAddress.slice(0, 6)}…${u.suiAddress.slice(-4)}`,
              avatar: u.avatarBlobId && u.avatarBlobId.length < 32 ? u.avatarBlobId : "🏂",
              level: Math.max(1, Math.floor((u.flurriesBalance - 100) / 100) + 1),
              streak: u.streakCount,
              flurries: u.flurriesBalance,
              isSelf: true
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch self user for leaderboard:", err);
      }
    };
    fetchSelf();
  }, [address, users]);

  const filteredUsers = users.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => a.rank - b.rank);

  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return <span className="text-xl">🥇</span>;
      case 2:
        return <span className="text-xl">🥈</span>;
      case 3:
        return <span className="text-xl">🥉</span>;
      default:
        return <span className="text-xs font-bold text-text-secondary/80 font-heading">#{rank}</span>;
    }
  };

  const currentUser = users.find((u) => u.isSelf) || selfUser;

  return (
    <div className="glass-panel rounded-3xl p-5 space-y-4">
      {/* Header with Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-heading font-bold text-text-primary flex items-center gap-1.5">
            <Trophy className="h-4 w-4 text-accent" /> Leaderboard
          </h3>
          <p className="text-[10px] text-text-secondary">
            Top Yetis ranked by Flurries tokens generated in the lounge.
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-48">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Yetis..."
            className="w-full pl-8 pr-3 py-1 text-xs rounded-xl glass-input placeholder-text-secondary/50"
          />
          <Search className="absolute left-2.5 top-1.8 h-3.5 w-3.5 text-text-secondary/50" />
        </div>
      </div>

      {/* Table Stream */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-text-secondary/50 font-bold border-b border-border-ice/30 pb-2">
              <th className="py-2 pl-2">Rank</th>
              <th className="py-2">Yeti</th>
              <th className="py-2 text-center">Level</th>
              <th className="py-2 text-center">Streak</th>
              <th className="py-2 text-right pr-2">Flurries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-ice/30">
            {filteredUsers.map((user) => (
              <tr
                key={user.rank}
                className={`transition-colors duration-200 ${
                  user.isSelf 
                    ? "bg-accent/5 font-semibold text-accent border border-accent/20" 
                    : "hover:bg-surface-secondary/20"
                }`}
              >
                <td className="py-3 pl-2.5 align-middle">
                  {getRankBadge(user.rank)}
                </td>
                <td className="py-3 align-middle">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{user.avatar}</span>
                    <span className="truncate max-w-[120px]">{user.name}</span>
                    {user.isSelf && (
                      <span className="text-[8px] bg-accent/20 border border-accent/35 text-accent font-bold px-1 py-0.2 rounded uppercase">
                        YOU
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 text-center align-middle font-semibold text-text-secondary">
                  Lvl {user.level}
                </td>
                <td className="py-3 text-center align-middle">
                  <span className="inline-flex items-center gap-0.5 text-orange font-bold font-heading">
                    <Flame className="h-3.5 w-3.5 fill-current" />
                    {user.streak}d
                  </span>
                </td>
                <td className="py-3 text-right pr-2.5 align-middle font-bold font-heading text-purple">
                  {user.flurries.toLocaleString()} 💎
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Your Rank Footer Banner */}
      {currentUser && (
        <div className="bg-bg-primary/50 border border-border-ice/65 p-3 rounded-2xl flex items-center justify-between text-xs mt-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 h-16 w-16 bg-accent/5 rounded-full blur-xl pointer-events-none" />
          
          <div className="flex items-center gap-3">
            <span className="text-xl">🏂</span>
            <div>
              <div className="font-bold text-text-primary flex items-center gap-1.5">
                <span>{currentUser.name}</span>
                <span className="text-[9px] bg-accent/15 border border-accent/20 text-accent font-bold px-1.5 py-0.2 rounded">
                  RANK #{currentUser.rank}
                </span>
              </div>
              <div className="text-[9px] text-text-secondary">
                Generate more flurries to climb the glacier ranking.
              </div>
            </div>
          </div>
          
          <div className="text-right">
            <span className="font-bold font-heading text-purple block">
              {currentUser.flurries.toLocaleString()} 💎
            </span>
            <span className="text-[8px] text-text-secondary">Total flurries</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
