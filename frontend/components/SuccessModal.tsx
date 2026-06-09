"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X } from "lucide-react";

interface SuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  amountText?: string;
  type?: "success" | "error";
}

export const SuccessModal: React.FC<SuccessModalProps> = ({
  isOpen,
  onClose,
  title,
  message,
  amountText,
  type = "success"
}) => {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; emoji: string }[]>([]);
  const isError = type === "error";

  useEffect(() => {
    if (isOpen) {
      const emojis = isError ? ["⚠️", "❌", "❄️", "💔", "🥶"] : ["❄️", "✨", "💸", "🌊", "💙"];
      const newParticles = Array.from({ length: 15 }).map((_, idx) => ({
        id: idx,
        x: Math.random() * 260 - 130,
        y: Math.random() * -240 - 40,
        emoji: emojis[Math.floor(Math.random() * emojis.length)]
      }));
      setParticles(newParticles);
    } else {
      setParticles([]);
    }
  }, [isOpen, isError]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/80 backdrop-blur-md">
        {/* Glow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className={`absolute h-96 w-96 rounded-full blur-3xl pointer-events-none ${
            isError ? "bg-red-500/10" : "bg-accent/15"
          }`}
        />

        {/* Modal content */}
        <motion.div
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 50, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 350 }}
          className={`relative max-w-sm w-full glass-panel rounded-3xl p-6 md:p-8 text-center space-y-6 bg-surface ${
            isError 
              ? "border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.12)]" 
              : "border-border-ice/60 shadow-[0_0_40px_rgba(0,212,255,0.15)]"
          }`}
        >
          {/* Confetti shards */}
          <div className="absolute inset-0 pointer-events-none overflow-visible">
            {particles.map((p) => (
              <motion.span
                key={p.id}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
                animate={{ 
                  x: p.x, 
                  y: p.y, 
                  opacity: [1, 0.8, 0], 
                  scale: [0.4, 1.2, 0.6],
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

          {/* Icon */}
          <div className={`mx-auto h-16 w-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg animate-bounce ${
            isError 
              ? "bg-red-500/10 border border-red-500/30 text-red-500 shadow-red-500/10" 
              : "bg-accent/10 border border-accent/30 text-accent shadow-ice-glow"
          }`}>
            {isError ? "⚠️" : "❄️"}
          </div>

          <div className="space-y-2">
            <div className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider border ${
              isError 
                ? "bg-red-500/10 text-red-400 border-red-500/20" 
                : "bg-accent/10 text-accent border border-accent/20"
            }`}>
              <Sparkles className="h-3 w-3 animate-pulse" />
              <span>{isError ? "TRANSACTION FAILED" : "TRANSACTION SUCCESSFUL"}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-heading font-bold text-text-primary">
              {title}
            </h2>
            <p className="text-xs text-text-secondary leading-relaxed break-words max-h-32 overflow-y-auto pr-1">
              {message}
            </p>
            {amountText && (
              <div className={`text-2xl font-bold font-heading py-2 ${
                isError ? "text-red-400" : "text-accent glow-text-accent"
              }`}>
                {amountText}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className={`w-full py-3.5 font-bold text-xs rounded-2xl active:scale-98 transition-all ${
              isError 
                ? "bg-red-500 hover:bg-red-600 text-white hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]" 
                : "bg-accent text-bg-primary hover:shadow-[0_0_20px_rgba(0,212,255,0.4)]"
            }`}
          >
            {isError ? "Dismiss" : "Awesome 🥶"}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default SuccessModal;
