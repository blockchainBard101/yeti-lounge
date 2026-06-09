"use client";

import React, { useEffect, useRef } from "react";

interface SnowFlurryProps {
  enabled?: boolean;
}

export const SnowFlurry: React.FC<SnowFlurryProps> = ({ enabled = true }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    class Flurry {
      x: number = 0;
      y: number = 0;
      radius: number = 0;
      density: number = 0;
      opacity: number = 0;
      color: string = "";

      constructor() {
        this.reset();
        // Spread flakes initially across the screen height
        this.y = Math.random() * height;
      }

      reset() {
        this.x = Math.random() * width;
        this.y = -10;
        this.radius = Math.random() * 2.5 + 1.5; // 1.5px to 4.0px
        this.density = Math.random() * 0.6 + 0.3; // Clear fall speed
        this.opacity = Math.random() * 0.3 + 0.7; // 0.7 to 1.0 high opacity
        
        // High visibility contrasting colors: Yeti accent blue or clean white
        this.color = Math.random() > 0.4 
          ? `rgba(255, 255, 255, ${this.opacity})` 
          : `rgba(0, 184, 230, ${this.opacity})`;
      }

      update() {
        this.y += this.density;
        // Natural gentle wind sway
        this.x += Math.sin(this.y * 0.01) * 0.25;

        // Reset if goes off screen
        if (this.y > height || this.x < -10 || this.x > width + 10) {
          this.reset();
        }
      }

      draw() {
        if (!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    }

    const flakeCount = 80; // Performance friendly & visible
    const flakes: Flurry[] = [];
    for (let i = 0; i < flakeCount; i++) {
      flakes.push(new Flurry());
    }

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      flakes.forEach((flake) => {
        flake.update();
        flake.draw();
      });
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-40 h-full w-full opacity-70"
    />
  );
};

export default SnowFlurry;
