"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { Wallet, ArrowDownUp, RefreshCw, Loader2, Coins, ArrowUpRight, TrendingUp, Send, CheckCircle, AlertTriangle } from "lucide-react";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { Transaction } from "@mysten/sui/transactions";
import { getCoinBalance, LOFI_COIN_TYPE, sponsorAndExecuteTransaction, resolveSuiNSAddress, getCoinObjects } from "@/components/sui";
import SuccessModal from "@/components/SuccessModal";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export default function WalletPage() {
  const { address } = useZkLogin();
  const enokiFlow = useEnokiFlow();

  const [suiBalance, setSuiBalance] = useState("0");
  const [lofiBalance, setLofiBalance] = useState("0");
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Tab State
  const [activeTab, setActiveTab] = useState<"swap" | "send">("swap");

  // Swap State
  const [fromToken, setFromToken] = useState<"SUI" | "LOFI">("SUI");
  const [swapAmount, setSwapAmount] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState(1.25);

  const toToken = fromToken === "SUI" ? "LOFI" : "SUI";

  const estimatedOutput = swapAmount && Number(swapAmount) > 0
    ? fromToken === "SUI"
      ? (Number(swapAmount) * exchangeRate).toFixed(3)
      : (Number(swapAmount) / exchangeRate).toFixed(3)
    : "0";

  // Send State
  const [sendTokenType, setSendTokenType] = useState<"SUI" | "LOFI">("SUI");
  const [recipientInput, setRecipientInput] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvingNS, setResolvingNS] = useState(false);

  // Success Modal State
  const [successOpen, setSuccessOpen] = useState(false);
  const [successTitle, setSuccessTitle] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [successAmount, setSuccessAmount] = useState("");
  const [modalType, setModalType] = useState<"success" | "error">("success");
  const [showTokenDropdown, setShowTokenDropdown] = useState(false);

  const fetchBalances = async () => {
    if (!address) return;
    setLoadingBalances(true);
    try {
      // Fetch SUI
      const suiBal = await getCoinBalance(address, "0x2::sui::SUI");
      setSuiBalance((Number(BigInt(suiBal)) / 1_000_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }));

      // Fetch LOFI
      const lofiBal = await getCoinBalance(address, LOFI_COIN_TYPE);
      setLofiBalance((Number(BigInt(lofiBal)) / 1_000_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }));
    } catch (err) {
      console.error("Failed to fetch wallet balances:", err);
    } finally {
      setLoadingBalances(false);
    }
  };

  // Fetch treasury info from backend on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/swap/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.treasuryAddress) setTreasuryAddress(data.treasuryAddress);
        if (data.exchangeRate) setExchangeRate(data.exchangeRate);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchBalances();
  }, [address]);

  // Live SuiNS Name Resolution
  useEffect(() => {
    if (!recipientInput) {
      setResolvedAddress(null);
      return;
    }
    const trimmed = recipientInput.trim();
    if (trimmed.startsWith("0x") && trimmed.length === 66) {
      setResolvedAddress(trimmed);
      return;
    }
    if (trimmed.includes(".") || trimmed.includes("@")) {
      setResolvingNS(true);
      const delayDebounce = setTimeout(async () => {
        const addr = await resolveSuiNSAddress(trimmed);
        setResolvedAddress(addr);
        setResolvingNS(false);
      }, 500);
      return () => clearTimeout(delayDebounce);
    } else {
      setResolvedAddress(null);
    }
  }, [recipientInput]);

  const handleToggleDirection = () => {
    setFromToken(toToken);
    setSwapAmount("");
  };

  const handleSwap = async () => {
    if (!address || !swapAmount || Number(swapAmount) <= 0) return;
    if (!treasuryAddress) {
      setSuccessTitle("Swap Unavailable");
      setSuccessMessage("Swap service unavailable — could not load treasury address.");
      setSuccessAmount("");
      setModalType("error");
      setSuccessOpen(true);
      return;
    }
    setSwapping(true);
    setSwapStatus("");
    try {
      const tx = new Transaction();
      const amountMist = BigInt(Math.floor(Number(swapAmount) * 1_000_000_000));

      // Step 1: Transfer fromToken to treasury address
      if (fromToken === "SUI" || LOFI_COIN_TYPE === "0x2::sui::SUI") {
        const coins = await getCoinObjects(address, "0x2::sui::SUI");
        if (coins.length === 0) throw new Error("No SUI coins found in your wallet to cover the swap amount.");
        const coinInputs = coins.map((c) => tx.object(c));
        if (coinInputs.length > 1) tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        const [coin] = tx.splitCoins(coinInputs[0], [amountMist]);
        tx.transferObjects([coin], treasuryAddress);
      } else {
        // Sending real LOFI to treasury
        const coins = await getCoinObjects(address, LOFI_COIN_TYPE);
        if (coins.length === 0) throw new Error("No LOFI coins found in your wallet.");
        const coinInputs = coins.map((c) => tx.object(c));
        if (coinInputs.length > 1) tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        const [splitCoin] = tx.splitCoins(coinInputs[0], [amountMist]);
        tx.transferObjects([splitCoin], treasuryAddress);
      }

      setSwapStatus(`Sending ${swapAmount} ${fromToken} to treasury… ❄️`);
      const result = await sponsorAndExecuteTransaction(tx, enokiFlow, address);
      const txDigest = (result as any)?.digest || (result as any)?.txDigest || "";

      // Step 2: Notify backend to send back the swapped token
      setSwapStatus(`Confirming on-chain… treasury sending ${estimatedOutput} ${toToken} back 🔄`);
      const res = await fetch(`${BACKEND_URL}/swap/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txDigest,
          userAddress: address,
          fromToken,
          amount: Number(swapAmount),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Backend swap execution failed.");
      }

      const data = await res.json();
      setSwapStatus(`✅ Swap complete! Received ${data.returnAmount?.toFixed(3)} ${data.toToken}`);
      
      setSuccessTitle("Swap Complete!");
      setSuccessMessage(`Successfully converted ${swapAmount} ${fromToken} to ${data.toToken}`);
      setSuccessAmount(`${data.returnAmount?.toFixed(3)} ${data.toToken}`);
      setModalType("success");
      setSuccessOpen(true);

      setSwapAmount("");
      setTimeout(fetchBalances, 3000);
    } catch (err: any) {
      console.error(err);
      setSwapStatus(`❌ ${err.message || "Swap failed."}`);
      
      setSuccessTitle("Swap Failed");
      setSuccessMessage(err.message || "Swap execution failed.");
      setSuccessAmount("");
      setModalType("error");
      setSuccessOpen(true);
    } finally {
      setSwapping(false);
    }
  };

  const handleSend = async () => {
    if (!address || !sendAmount || Number(sendAmount) <= 0 || !resolvedAddress) return;
    setSending(true);
    try {
      const tx = new Transaction();
      const amountMist = BigInt(Math.floor(Number(sendAmount) * 1_000_000_000));
      const coinType = sendTokenType === "SUI" ? "0x2::sui::SUI" : LOFI_COIN_TYPE;

      if (coinType === "0x2::sui::SUI") {
        const coins = await getCoinObjects(address, "0x2::sui::SUI");
        if (coins.length === 0) throw new Error("No SUI coins found in your wallet to cover the transfer amount.");
        const coinInputs = coins.map((c) => tx.object(c));
        if (coinInputs.length > 1) tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        const [coin] = tx.splitCoins(coinInputs[0], [amountMist]);
        tx.transferObjects([coin], resolvedAddress);
      } else {
        const coins = await getCoinObjects(address, coinType);
        if (coins.length === 0) {
          throw new Error("No LOFI coins found in wallet to transfer.");
        }
        const coinInputs = coins.map(c => tx.object(c));
        if (coinInputs.length > 1) {
          tx.mergeCoins(coinInputs[0], coinInputs.slice(1));
        }
        const [splitCoin] = tx.splitCoins(coinInputs[0], [amountMist]);
        tx.transferObjects([splitCoin], resolvedAddress);
      }

      await sponsorAndExecuteTransaction(tx, enokiFlow, address, true);
      
      setSuccessTitle("Assets Sent!");
      setSuccessMessage(`Successfully sent ${sendAmount} ${sendTokenType} to ${recipientInput}`);
      setSuccessAmount(`${sendAmount} ${sendTokenType}`);
      setModalType("success");
      setSuccessOpen(true);

      setSendAmount("");
      setRecipientInput("");
      fetchBalances();
    } catch (err: any) {
      console.error(err);
      
      setSuccessTitle("Send Failed");
      setSuccessMessage(err.message || "Send transaction failed.");
      setSuccessAmount("");
      setModalType("error");
      setSuccessOpen(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto pb-16">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-heading font-extrabold text-text-primary flex items-center gap-2">
            <Wallet className="h-5 w-5 text-accent" /> Yeti Lounge Wallet
          </h2>
          <p className="text-xs text-text-secondary">
            Manage your lounge assets, convert, and send tokens to other builders.
          </p>
        </div>
        <button
          onClick={fetchBalances}
          disabled={loadingBalances || !address}
          className="p-2 rounded-xl bg-surface border border-border-ice hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-all disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loadingBalances ? "animate-spin" : ""}`} />
        </button>
      </div>

      {address ? (
        <>
          {/* Balance Cards Side-by-Side */}
          <div className="grid grid-cols-2 gap-4">
            {/* SUI Card */}
            <div className="glass-panel rounded-3xl p-5 relative overflow-hidden group flex justify-between items-start">
              <div className="space-y-1">
                <span className="text-[10px] text-text-secondary uppercase font-bold tracking-wider">Sui Balance</span>
                <div className="text-xl font-heading font-bold text-text-primary mt-1.5 truncate">
                  {suiBalance} <span className="text-xs text-text-secondary font-sans font-medium">SUI</span>
                </div>
                <span className="text-[9px] text-text-secondary/70 mt-3 block">Native gas token</span>
              </div>
              <div className="relative h-10 w-10 shrink-0">
                <Image src="/Logo_Sui_Droplet_Sui Blue.png" alt="SUI Logo" fill className="object-contain" />
              </div>
              <div className="absolute top-0 right-0 h-24 w-24 bg-accent/5 rounded-full blur-xl pointer-events-none" />
            </div>

            {/* LOFI Card */}
            <div className="glass-panel rounded-3xl p-5 relative overflow-hidden group border-mint/20 flex justify-between items-start">
              <div className="space-y-1">
                <span className="text-[10px] text-text-secondary uppercase font-bold tracking-wider text-mint">LOFI Balance</span>
                <div className="text-xl font-heading font-bold text-mint mt-1.5 truncate">
                  {lofiBalance} <span className="text-xs text-text-secondary font-sans font-medium">LOFI</span>
                </div>
                <span className="text-[9px] text-mint/70 mt-3 block flex items-center gap-1">
                  <Coins className="h-3 w-3" /> Lounge community token
                </span>
              </div>
              <div className="relative h-10 w-10 shrink-0">
                <Image src="/lofi-img/yeti-mascot.png" alt="LOFI Logo" fill className="object-contain" />
              </div>
              <div className="absolute top-0 right-0 h-24 w-24 bg-mint/5 rounded-full blur-xl pointer-events-none" />
            </div>
          </div>

          {/* Interactive Card with Tabs */}
          <div className="glass-panel rounded-3xl p-6 space-y-5">
            {/* Tab Headers */}
            <div className="flex bg-surface-secondary/40 p-1.5 rounded-2xl border border-border-ice/50">
              <button
                onClick={() => setActiveTab("swap")}
                className={`flex-1 py-2 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === "swap"
                    ? "bg-accent text-bg-primary shadow-ice-glow"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
                <span>Swap Tokens</span>
              </button>
              <button
                onClick={() => setActiveTab("send")}
                className={`flex-1 py-2 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === "send"
                    ? "bg-accent text-bg-primary shadow-ice-glow"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send Tokens</span>
              </button>
            </div>

            {/* TAB CONTENT: SWAP */}
            {activeTab === "swap" && (
              <div className="space-y-4">
                <div className="space-y-2 relative">
                  {/* From token input */}
                  <div className="bg-bg-primary/45 border border-border-ice/65 rounded-2xl p-4 flex justify-between items-center">
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase tracking-wider text-text-secondary font-bold">From</span>
                      <input
                        type="number"
                        value={swapAmount}
                        onChange={(e) => setSwapAmount(e.target.value)}
                        placeholder="0.00"
                        className="bg-transparent text-xl font-heading font-bold text-text-primary placeholder-text-secondary/35 focus:outline-none w-full"
                      />
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-surface border border-border-ice font-bold text-xs flex items-center gap-1.5 select-none text-text-primary">
                      <div className="relative h-4 w-4 shrink-0">
                        <Image
                          src={fromToken === "SUI" ? "/Logo_Sui_Droplet_Sui Blue.png" : "/lofi-img/yeti-mascot.png"}
                          alt={fromToken}
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span>{fromToken}</span>
                    </div>
                  </div>

                  {/* Interactive Swapper arrow button */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10">
                    <button
                      onClick={handleToggleDirection}
                      className="h-8 w-8 rounded-full bg-accent hover:bg-accent-hover text-bg-primary shadow-[0_0_15px_rgba(0,212,255,0.4)] flex items-center justify-center transition-all active:scale-95"
                    >
                      <ArrowDownUp className="h-4 w-4" />
                    </button>
                  </div>

                  {/* To token input (disabled) */}
                  <div className="bg-bg-primary/45 border border-border-ice/65 rounded-2xl p-4 flex justify-between items-center">
                    <div className="space-y-1">
                      <span className="text-[9px] uppercase tracking-wider text-text-secondary font-bold">To (Estimate)</span>
                      <div className="text-xl font-heading font-bold text-text-secondary/70">
                        {estimatedOutput}
                      </div>
                    </div>
                    <div className="px-3 py-1.5 rounded-xl bg-surface border border-border-ice font-bold text-xs flex items-center gap-1.5 select-none text-text-primary">
                      <div className="relative h-4 w-4 shrink-0">
                        <Image
                          src={toToken === "SUI" ? "/Logo_Sui_Droplet_Sui Blue.png" : "/lofi-img/yeti-mascot.png"}
                          alt={toToken}
                          fill
                          className="object-contain"
                        />
                      </div>
                      <span>{toToken}</span>
                    </div>
                  </div>
                </div>

                {/* Exchange Rate details */}
                <div className="flex justify-between items-center text-[10px] text-text-secondary/80 px-1">
                  <span>Exchange Rate</span>
                  <span>1 SUI ≈ {exchangeRate} LOFI</span>
                </div>

                {/* Action button */}
                <button
                  onClick={handleSwap}
                  disabled={swapping || !swapAmount || Number(swapAmount) <= 0}
                  className="w-full py-3 bg-accent hover:bg-accent-hover text-bg-primary font-bold text-xs rounded-xl hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {swapping ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing Swap...</span>
                    </>
                  ) : (
                    <>
                      <span>Convert Tokens</span>
                      <ArrowUpRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                {/* Swap status / progress message */}
                {swapStatus && (
                  <div className={`text-[10px] font-semibold text-center px-2 py-2 rounded-xl border ${
                    swapStatus.startsWith("✅")
                      ? "text-mint border-mint/30 bg-mint/5"
                      : swapStatus.startsWith("❌")
                      ? "text-red-400 border-red-400/30 bg-red-400/5"
                      : "text-accent border-accent/30 bg-accent/5"
                  }`}>
                    {swapStatus}
                  </div>
                )}
              </div>
            )}


            {/* TAB CONTENT: SEND */}
            {activeTab === "send" && (
              <div className="space-y-4">
                <div className="space-y-3">
                  {/* Recipient Address / SuiNS Name Input */}
                  <div className="bg-bg-primary/45 border border-border-ice/65 rounded-2xl p-4 space-y-1">
                    <span className="text-[9px] uppercase tracking-wider text-text-secondary font-bold block">Recipient</span>
                    <input
                      type="text"
                      value={recipientInput}
                      onChange={(e) => setRecipientInput(e.target.value)}
                      placeholder="Enter Sui address (0x...) or SuiNS domain name"
                      className="bg-transparent text-xs font-semibold text-text-primary placeholder-text-secondary/35 focus:outline-none w-full"
                    />

                    {/* Resolution Status Display */}
                    {recipientInput && (
                      <div className="pt-2 flex items-center gap-1.5 text-[9px] font-bold select-none border-t border-border-ice/30 mt-2">
                        {resolvingNS ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin text-accent" />
                            <span className="text-accent">Resolving SuiNS domain...</span>
                          </>
                        ) : resolvedAddress ? (
                          <>
                            <CheckCircle className="h-3.5 w-3.5 text-mint" />
                            <span className="text-mint truncate">Resolved to: {resolvedAddress}</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                            <span className="text-yellow-500">Invalid address or unresolved SuiNS name</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Token Type & Amount Input */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 bg-bg-primary/45 border border-border-ice/65 rounded-2xl p-4 flex flex-col justify-center">
                      <span className="text-[9px] uppercase tracking-wider text-text-secondary font-bold mb-1">Amount</span>
                      <input
                        type="number"
                        value={sendAmount}
                        onChange={(e) => setSendAmount(e.target.value)}
                        placeholder="0.00"
                        className="bg-transparent text-base font-heading font-bold text-text-primary placeholder-text-secondary/35 focus:outline-none w-full"
                      />
                    </div>

                    <div className="bg-bg-primary/45 border border-border-ice/65 rounded-2xl p-2 flex flex-col justify-center items-center relative">
                      <span className="text-[8px] uppercase tracking-wider text-text-secondary font-bold mb-1">Token</span>
                      <button
                        onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                        className="bg-surface border border-border-ice rounded-xl px-2 py-1.5 text-xs font-bold text-text-primary cursor-pointer w-full text-center flex items-center justify-center gap-1.5 select-none hover:bg-surface-secondary transition-all"
                      >
                        <div className="relative h-3.5 w-3.5 shrink-0">
                          <Image
                            src={sendTokenType === "SUI" ? "/Logo_Sui_Droplet_Sui Blue.png" : "/lofi-img/yeti-mascot.png"}
                            alt={sendTokenType}
                            fill
                            className="object-contain"
                          />
                        </div>
                        <span>{sendTokenType}</span>
                        <span className="text-[9px] text-text-secondary">▼</span>
                      </button>

                      {showTokenDropdown && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setShowTokenDropdown(false)} />
                          <div className="absolute right-0 top-full mt-1.5 w-28 glass-panel border border-border-ice/85 rounded-xl p-1 shadow-card z-40 text-xs bg-surface overflow-hidden">
                            <button
                              onClick={() => {
                                setSendTokenType("SUI");
                                setShowTokenDropdown(false);
                              }}
                              className={`w-full py-2 px-3 rounded-lg text-left font-bold transition-all flex items-center gap-1.5 ${
                                sendTokenType === "SUI"
                                  ? "bg-accent/12 text-accent"
                                  : "text-text-primary hover:bg-surface-secondary"
                              }`}
                            >
                              <div className="relative h-3.5 w-3.5 shrink-0">
                                <Image src="/Logo_Sui_Droplet_Sui Blue.png" alt="SUI" fill className="object-contain" />
                              </div>
                              <span>SUI</span>
                            </button>
                            <button
                              onClick={() => {
                                setSendTokenType("LOFI");
                                setShowTokenDropdown(false);
                              }}
                              className={`w-full py-2 px-3 rounded-lg text-left font-bold transition-all flex items-center gap-1.5 ${
                                sendTokenType === "LOFI"
                                  ? "bg-accent/12 text-accent"
                                  : "text-text-primary hover:bg-surface-secondary"
                              }`}
                            >
                              <div className="relative h-3.5 w-3.5 shrink-0">
                                <Image src="/lofi-img/yeti-mascot.png" alt="LOFI" fill className="object-contain" />
                              </div>
                              <span>LOFI</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action button */}
                <button
                  onClick={handleSend}
                  disabled={sending || !sendAmount || Number(sendAmount) <= 0 || !resolvedAddress}
                  className="w-full py-3 bg-accent hover:bg-accent-hover text-bg-primary font-bold text-xs rounded-xl hover:shadow-[0_0_20px_rgba(0,212,255,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {sending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Sending Tokens...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Assets</span>
                      <Send className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Quick info / guide */}
          <div className="bg-surface-secondary/25 border border-border-ice/40 rounded-2xl p-4 flex gap-3">
            <TrendingUp className="h-5 w-5 text-accent shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-text-primary">About $LOFI tokens</h4>
              <p className="text-[10px] text-text-secondary leading-relaxed">
                $LOFI is the main currency in the Yeti Lounge. Use it to purchase items from the marketplace, tip creators in the feed, or deposit into the Glacier Preservation Fund.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="glass-panel rounded-3xl p-10 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-surface-secondary border border-border-ice flex items-center justify-center mx-auto text-xl">
            🔒
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-heading font-bold text-text-primary">Wallet Disconnected</h3>
            <p className="text-xs text-text-secondary max-w-xs mx-auto">
              Please sign in using Google zkLogin at the top of the page to access your wallet balances and transfer functionality.
            </p>
          </div>
        </div>
      )}

      <SuccessModal
        isOpen={successOpen}
        onClose={() => setSuccessOpen(false)}
        title={successTitle}
        message={successMessage}
        amountText={successAmount}
        type={modalType}
      />
    </div>
  );
}
