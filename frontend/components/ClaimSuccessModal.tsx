"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Trophy, Heart } from "lucide-react";

interface ClaimSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount?: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  emoji: string;
}

export const ClaimSuccessModal: React.FC<ClaimSuccessModalProps> = ({
  isOpen,
  onClose,
  amount = 100
}) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Generate particles representing cracked ice shards and sparkle gems
      const emojis = ["❄️", "💎", "🧊", "✨", "💧"];
      const newParticles: Particle[] = Array.from({ length: 15 }).map((_, idx) => ({
        id: idx,
        x: Math.random() * 260 - 130, // shoot outward horizontally
        y: Math.random() * -240 - 40,  // shoot upward vertically
        rotation: Math.random() * 360,
        scale: Math.random() * 0.6 + 0.6,
        emoji: emojis[Math.floor(Math.random() * emojis.length)]
      }));
      setParticles(newParticles);
    } else {
      setParticles([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
      {/* Heavy Mint color burst glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        className="absolute h-96 w-96 rounded-full bg-mint/15 blur-3xl pointer-events-none"
      />

      {/* Main glass card */}
      <motion.div
        initial={{ y: 50, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 50, opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        className="relative max-w-sm w-full glass-panel-glow border-mint/45 rounded-3xl p-6 md:p-8 text-center space-y-6 shadow-[0_0_40px_rgba(0,255,170,0.15)]"
      >
        {/* Floating particles cracking effect */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          {particles.map((p) => (
            <motion.span
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
              animate={{ 
                x: p.x, 
                y: p.y, 
                opacity: [1, 0.8, 0], 
                scale: p.scale,
                rotate: p.rotation 
              }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="absolute text-xl left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              {p.emoji}
            </motion.span>
          ))}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Big Icon */}
        <div className="mx-auto h-16 w-16 rounded-2xl bg-mint/10 border border-mint/30 flex items-center justify-center text-3xl shadow-ice-glow animate-bounce">
          💎
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-mint/10 text-mint border border-mint/20 tracking-wider">
            <Sparkles className="h-3 w-3" />
            <span>ICE CRACK SUCCESS</span>
          </div>
          <h2 className="text-xl md:text-2xl font-heading font-bold text-text-primary">
            Flurries Claimed!
          </h2>
          <p className="text-xs text-text-secondary">
            You successfully thaws the frozen vault and extracted
          </p>
          <div className="text-3xl font-bold font-heading text-mint glow-text-mint py-2">
            +{amount} FLURRY
          </div>
          <p className="text-[10px] text-text-secondary/60">
            Multiplier active: +5% Streak bonus included.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3.5 bg-mint text-bg-primary font-bold text-xs rounded-2xl hover:shadow-[0_0_20px_rgba(0,255,170,0.4)] active:scale-98 transition-all"
        >
          YEEERRRR! Let's Go 🥶
        </button>
      </motion.div>
    </div>
  );
};

export default ClaimSuccessModal;
