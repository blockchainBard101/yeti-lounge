"use client";

import React from "react";
import { motion } from "framer-motion";
import { LucideIcon, TrendingUp } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description: string;
  trend?: string;
  trendType?: "positive" | "neutral" | "negative";
  /* glowColor is retained for API compat but all use accent styling now */
  glowColor?: "mint" | "accent" | "purple";
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon: Icon,
  description,
  trend,
  trendType = "positive",
}) => {
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.01 }}
      transition={{ duration: 0.2 }}
      className="glass-panel rounded-3xl p-5 flex flex-col justify-between h-[155px] relative overflow-hidden transition-all duration-300 border border-border-ice/40 hover:border-accent/35 hover:shadow-ice-glow"
    >
      {/* Very subtle accent highlight top-right */}
      <div className="absolute top-0 right-0 h-12 w-12 rounded-full blur-xl pointer-events-none opacity-10 bg-accent" />

      {/* Header */}
      <div className="flex justify-between items-start">
        <span className="text-[10px] text-text-secondary/70 uppercase font-bold tracking-wider block">
          {title}
        </span>
        <div className="h-8 w-8 rounded-xl flex items-center justify-center border border-accent/20 bg-accent/8 text-accent">
          <Icon className="h-4 w-4" />
        </div>
      </div>

      {/* Value */}
      <div className="my-2">
        <span className="text-2xl md:text-3xl font-bold font-heading tracking-tight text-text-primary">
          {value}
        </span>
      </div>

      {/* Footer Info & Trend */}
      <div className="flex items-center justify-between text-[10px] text-text-secondary">
        <span className="truncate max-w-[70%]">{description}</span>
        {trend && (
          <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold border ${
            trendType === "positive"
              ? "bg-accent/10 text-accent border-accent/15"
              : trendType === "negative"
              ? "bg-surface-secondary text-text-secondary border-border-ice/60"
              : "bg-surface-secondary text-text-secondary border-border-ice/60"
          }`}>
            {trendType === "positive" && <TrendingUp className="h-3 w-3" />}
            {trend}
          </span>
        )}
      </div>
    </motion.div>
  );
};

export default StatCard;
