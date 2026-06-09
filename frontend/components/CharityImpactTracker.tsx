"use client";

import React, { useState, useEffect } from "react";
import { Gift, Droplet, Award, ArrowUpRight, Loader2 } from "lucide-react";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { Transaction } from "@mysten/sui/transactions";
import { sponsorAndExecuteTransaction, GLACIER_FUND_ID, PACKAGE_ID, getCoinObjects } from "./sui";

export const CharityImpactTracker: React.FC = () => {
  const { address } = useZkLogin();
  const enokiFlow = useEnokiFlow();

  const [currentLofi, setCurrentLofi] = useState(16500);
  const [donateAmount, setDonateAmount] = useState("100");
  const [donating, setDonating] = useState(false);

  const targetLofi = 25000;
  const percentage = Math.min(100, Math.round((currentLofi / targetLofi) * 100));

  const fetchDonations = async () => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
    try {
      const res = await fetch(`${backendUrl}/glacier-fund`);
      if (res.ok) {
        const data = await res.json();
        // Convert MIST back to whole tokens (divide by 10^9)
        const total = Number(BigInt(data.totalDonated) / BigInt(1_000_000_000));
        setCurrentLofi(total);
      }
    } catch (err) {
      console.error("Failed to load glacier fund details:", err);
    }
  };

  useEffect(() => {
    fetchDonations();
  }, []);

  const handleDonate = async () => {
    if (!address || !donateAmount || Number(donateAmount) <= 0) return;
    setDonating(true);
    try {
      const tx = new Transaction();
      // 1 LOFI = 10^9 MIST
      const amountMist = BigInt(Math.floor(Number(donateAmount) * 1_000_000_000));
      
      // Split SUI from user wallet objects instead of gas
      const coins = await getCoinObjects(address, "0x2::sui::SUI");
      if (coins.length === 0) throw new Error("No SUI coins found in your wallet to donate.");
      const coinInputs = coins.map((c) => tx.object(c));
      if (coinInputs.length > 1) tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
      const [coin] = tx.splitCoins(coinInputs[0], [amountMist]);

      tx.moveCall({
        target: `${PACKAGE_ID}::glacier::donate_entry`,
        typeArguments: ["0x2::sui::SUI"], // Generic token parameter T
        arguments: [
          tx.object(GLACIER_FUND_ID),
          coin,
        ],
      });

      await sponsorAndExecuteTransaction(tx, enokiFlow, address);
      alert("Thank you for your donation to the glaciers! 🧊");
      setDonateAmount("100");
      fetchDonations();
    } catch (err: any) {
      console.error(err);
      alert(`Donation failed: ${err.message || err}`);
    } finally {
      setDonating(false);
    }
  };

  return (
    <div className="glass-panel rounded-3xl p-5 space-y-6 relative overflow-hidden group">
      {/* Background radial highlight */}
      <div className="absolute top-0 right-0 h-32 w-32 bg-mint/5 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-mint font-heading uppercase tracking-wider">
            <Gift className="h-4 w-4 text-mint" />
            <span>Lofi Saves The Glaciers</span>
          </div>
          <p className="text-[10px] text-text-secondary leading-relaxed max-w-sm">
            10% of Yeti Lounge royalties are donated directly to global polar ice preservation. Keep the loungers frosty!
          </p>
        </div>

        <span className="text-[10px] bg-mint/15 text-mint border border-mint/20 font-bold px-2 py-0.5 rounded-lg">
          ACTIVE INITIATIVE
        </span>
      </div>

      {/* Liquid beaker / water visual and Stats grid side-by-side */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
        
        {/* Icy beaker visual container (takes 1 col) */}
        <div className="flex justify-center">
          <div className="relative h-44 w-32 rounded-3xl border-4 border-border-ice/70 bg-bg-primary/45 overflow-hidden shadow-[inset_0_0_20px_rgba(0,212,255,0.05)] shadow-ice-glow flex items-end">
            
            {/* Background Layer Wave */}
            <div 
              className="absolute left-0 right-0 bg-accent/20 w-[200%] h-[200%] animate-wave-slow pointer-events-none rounded-[40%] origin-center"
              style={{ bottom: `${percentage - 110}%` }}
            />

            {/* Foreground Layer Wave */}
            <div 
              className="absolute left-0 right-0 bg-accent/30 w-[200%] h-[200%] animate-wave-fast pointer-events-none rounded-[38%] origin-center"
              style={{ bottom: `${percentage - 105}%` }}
            />

            {/* Liquid percentage label floating in the middle */}
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 select-none">
              <span className="text-2xl font-bold font-heading text-text-primary glow-text-accent">
                {percentage}%
              </span>
              <span className="text-[8px] uppercase tracking-wider text-text-secondary font-bold">
                OF TARGET LOFI
              </span>
            </div>
          </div>
        </div>

        {/* Impact stats grid (takes 2 cols) */}
        <div className="sm:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-primary/40 border border-border-ice/50 rounded-2xl p-3">
              <span className="text-[9px] text-text-secondary block font-bold uppercase tracking-wider">
                Total LOFI Donated
              </span>
              <span className="text-base font-bold font-heading text-mint">
                {currentLofi.toLocaleString()} LOFI
              </span>
            </div>
            <div className="bg-bg-primary/40 border border-border-ice/50 rounded-2xl p-3">
              <span className="text-[9px] text-text-secondary block font-bold uppercase tracking-wider">
                Glacier Target Goal
              </span>
              <span className="text-base font-bold font-heading text-accent">
                {targetLofi.toLocaleString()} LOFI
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[10px] text-text-secondary font-bold">
              <span>Glacier melt offset estimate:</span>
              <span className="text-mint font-heading font-bold">~4,200 metric tons 🧊</span>
            </div>
            <p className="text-[9px] text-text-secondary leading-relaxed">
              Every 100 LOFI generated on secondary trades funds real-world carbon offset and ice sheets preservation programs in partnerships with environmental Web3 foundations.
            </p>
          </div>

          {address ? (
            <div className="flex gap-2">
              <input
                type="number"
                value={donateAmount}
                onChange={(e) => setDonateAmount(e.target.value)}
                placeholder="Amount"
                className="w-24 px-3 py-2 text-xs rounded-xl glass-input placeholder-text-secondary/40 focus:outline-none"
              />
              <button
                onClick={handleDonate}
                disabled={donating || !donateAmount || Number(donateAmount) <= 0}
                className="flex-1 py-2 bg-mint hover:bg-mint-hover text-bg-primary font-bold text-xs rounded-xl hover:shadow-[0_0_15px_rgba(0,255,170,0.3)] transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {donating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Donating...</span>
                  </>
                ) : (
                  <>
                    <span>Donate $LOFI</span>
                    <ArrowUpRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="text-[10px] text-text-secondary/70 italic text-center border border-border-ice/30 rounded-xl py-2">
              Please sign in to make a donation.
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default CharityImpactTracker;
