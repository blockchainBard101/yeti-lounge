"use client";

import React, { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Music } from "lucide-react";

export default function MusicPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // We use a royalty-free lofi stream/track placeholder for the hackathon MVP
  const LOFI_STREAM_URL = "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3";

  useEffect(() => {
    audioRef.current = new Audio(LOFI_STREAM_URL);
    audioRef.current.loop = true;
    audioRef.current.volume = 0.4;
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Audio playback failed:", e));
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 glass-panel rounded-full p-2 hidden md:flex items-center gap-3 shadow-ice border border-border-ice/60 hover:border-accent/40 transition-colors">
      <div className="bg-bg-primary rounded-full p-2 text-accent">
        <Music className={`h-4 w-4 ${isPlaying ? "animate-pulse" : ""}`} />
      </div>
      
      <div className="hidden sm:flex flex-col text-left">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-primary leading-tight">Yeti Radio</span>
        <span className="text-[9px] text-text-secondary leading-tight">Chill Lofi Beats</span>
      </div>

      <div className="flex items-center gap-1 sm:ml-2 border-l border-border-ice/40 pl-2">
        <button 
          onClick={togglePlay}
          className="p-1.5 rounded-full hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button 
          onClick={toggleMute}
          className="p-1.5 rounded-full hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
