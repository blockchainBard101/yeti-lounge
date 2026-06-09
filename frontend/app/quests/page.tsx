"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Target, Snowflake, Gift, CheckCircle } from "lucide-react";

interface Quest {
  id: number;
  title: string;
  description: string;
  reward: number;
  status: "available" | "in-progress" | "completed";
}

export default function QuestsPage() {
  const [quests, setQuests] = useState<Quest[]>([
    {
      id: 1,
      title: "Mint Genesis Avatar",
      description: "Secure your exclusive Yeti avatar by uploading an image to Walrus and registering it on-chain.",
      reward: 100,
      status: "completed",
    },
    {
      id: 2,
      title: "Move Academy Rookie",
      description: "Complete the first 5 interactive Move tutorials in the Yeti Lounge builder hub.",
      reward: 50,
      status: "available",
    },
    {
      id: 3,
      title: "Social Butterfly",
      description: "RSVP to at least 3 upcoming community events.",
      reward: 20,
      status: "in-progress",
    },
  ]);

  const flurriesBalance = quests
    .filter(q => q.status === "completed")
    .reduce((acc, q) => acc + q.reward, 0);

  return (
    <div className="space-y-6 pb-16">
      {/* Page Header */}
      <motion.section 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-panel rounded-3xl p-6 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 h-32 w-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />
        <h2 className="text-xl font-heading font-bold text-text-primary flex items-center gap-2">
          <Target className="h-6 w-6 text-accent" /> Bounties & Rewards
        </h2>
        <p className="text-sm text-text-secondary mt-2 max-w-2xl">
          Complete quests to earn Flurries. Climb the leaderboard, unlock premium Yeti Lounge features, and prepare for the upcoming $LOFI token launch.
        </p>

        {/* User Balance Snippet */}
        <div className="mt-4 inline-flex items-center gap-2 bg-bg-primary/50 border border-border-ice/30 px-4 py-2 rounded-xl">
          <Snowflake className="h-5 w-5 text-accent animate-[spin_4s_linear_infinite]" />
          <div>
            <div className="text-[10px] text-text-secondary uppercase tracking-wider font-bold">Your Balance</div>
            <div className="text-lg font-bold text-text-primary">{flurriesBalance} Flurries</div>
          </div>
        </div>
      </motion.section>

      {/* Quest Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {quests.map((quest, index) => (
          <motion.div
            key={quest.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className={`glass-panel rounded-3xl p-5 border-l-4 transition-all duration-300 ${
              quest.status === "completed" 
                ? "border-l-mint/60 opacity-80" 
                : quest.status === "in-progress"
                ? "border-l-accent"
                : "border-l-border-ice hover:border-l-accent/50"
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-bold text-text-primary text-sm">{quest.title}</h3>
              <div className="flex items-center gap-1 bg-accent/10 text-accent px-2 py-1 rounded-lg text-xs font-bold border border-accent/20">
                <Snowflake className="h-3 w-3" />
                +{quest.reward}
              </div>
            </div>
            
            <p className="text-xs text-text-secondary mb-4 min-h-[40px]">
              {quest.description}
            </p>

            <div className="flex items-center justify-between border-t border-border-ice/30 pt-3">
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
                quest.status === "completed" 
                  ? "bg-mint/10 text-mint" 
                  : quest.status === "in-progress"
                  ? "bg-accent/10 text-accent"
                  : "bg-surface-secondary text-text-secondary"
              }`}>
                {quest.status.replace("-", " ")}
              </span>
              
              {quest.status === "completed" ? (
                <div className="flex items-center gap-1 text-xs text-mint font-bold">
                  <CheckCircle className="h-4 w-4" /> Claimed
                </div>
              ) : (
                <button 
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                    quest.status === "available"
                      ? "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/80"
                      : "bg-accent text-bg-primary hover:shadow-ice-glow"
                  }`}
                >
                  {quest.status === "available" ? "Start Quest" : "Verify Off-chain"}
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
