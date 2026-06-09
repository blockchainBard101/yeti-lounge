"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface ThawingYetiLoaderProps {
  onComplete?: () => void;
  duration?: number; // in ms
}

export const ThawingYetiLoader: React.FC<ThawingYetiLoaderProps> = ({ 
  onComplete, 
  duration = 3500 
}) => {
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);

  const statuses = [
    "Shoveling snow from the servers... ❄️",
    "Tuning the lofi tape decks... 🎧",
    "Thawing out the Yeti mascot... 🧊",
    "Sponsoring transactions on Sui... 💧",
    "Ready to chill! 🥶"
  ];

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const calculatedProgress = Math.min(100, Math.round((elapsed / duration) * 100));
      setProgress(calculatedProgress);

      // Rotate statuses
      const nextIndex = Math.min(
        statuses.length - 1,
        Math.floor((calculatedProgress / 100) * statuses.length)
      );
      setStatusIndex(nextIndex);

      if (elapsed >= duration) {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [duration, onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-bg-primary flex flex-col items-center justify-center p-6">
      {/* Decorative blurred backgrounds */}
      <div className="absolute h-96 w-96 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
      
      <div className="relative z-10 flex flex-col items-center max-w-sm w-full space-y-8 text-center select-none">
        
        {/* Loading mascot thawing animation */}
        <div className="relative h-28 w-28 flex items-center justify-center">
          {/* Outer rotating/pulsing freeze ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full border-2 border-dashed border-accent/35"
          />
          
          {/* Ice melting transition */}
          <motion.div
            animate={progress < 70 ? {
              scale: [1, 1.05, 1],
              rotate: [0, -3, 3, 0]
            } : {
              scale: [1, 1.15, 1],
              y: [0, -5, 0]
            }}
            transition={{
              duration: progress < 70 ? 1.5 : 0.8,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="text-6xl filter drop-shadow-[0_0_15px_rgba(0,212,255,0.4)]"
          >
            {progress < 35 ? "🧊" : progress < 70 ? "💧" : "🏂"}
          </motion.div>
        </div>

        {/* Text Details */}
        <div className="space-y-2">
          <h3 className="font-heading font-bold text-lg text-text-primary uppercase tracking-widest">
            {progress < 70 ? "Thawing Lounge..." : "Vibes Loaded"}
          </h3>
          <p className="text-xs text-text-secondary h-4 font-mono">
            {statuses[statusIndex]}
          </p>
        </div>

        {/* Progress bar container */}
        <div className="w-full space-y-1.5">
          <div className="w-full bg-surface h-2.5 rounded-full overflow-hidden border border-border-ice/60 p-0.5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeInOut" }}
              className="bg-accent h-full rounded-full"
            />
          </div>
          <div className="flex justify-between text-[10px] text-text-secondary font-bold font-mono">
            <span>{progress}%</span>
            <span>-15°C</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ThawingYetiLoader;
