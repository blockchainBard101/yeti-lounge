"use client";

import React, { useRef, useState, useEffect } from "react";
import { Edit2, Check, Sparkles, Award, Upload, Loader2, CloudUpload, BadgeCheck } from "lucide-react";
import { useEnokiFlow, useZkLogin } from "@mysten/enoki/react";
import { Transaction } from "@mysten/sui/transactions";
import { sponsorAndExecuteTransaction, getOrCreateProfileArg, cacheProfileId, warmProfileCache, PACKAGE_ID, REGISTRY_ID, BACKEND_URL, resolveSuiNSAddress, reverseResolveSuiAddress, payLofi, getAuthToken, suiClient, fromBase64 } from "./sui";
import { uploadFileToWalrus, walrusBlobUrl } from "./walrus";

interface Badge {
  title: string;
  emoji: string;
  desc: string;
  color: string;
}

// Walrus upload steps in order
const UPLOAD_STEPS = ["encoding", "registered", "uploaded", "certified"] as const;
type UploadStep = (typeof UPLOAD_STEPS)[number];

const STEP_LABELS: Record<UploadStep, string> = {
  encoding: "Encoding blob...",
  registered: "Registering on Sui...",
  uploaded: "Uploading to storage nodes...",
  certified: "Certified on Walrus ✅",
};

export const ProfileCustomizer: React.FC = () => {
  const enokiFlow = useEnokiFlow();
  const { address } = useZkLogin();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile state
  const [nickname, setNickname] = useState("Yeti #42069");
  const [status, setStatus] = useState("Chilling in the Lobby ❄️");
  const [avatarEmoji, setAvatarEmoji] = useState("🏂");

  // Custom image avatar state (Walrus)
  const [avatarBlobId, setAvatarBlobId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Verification state
  const [isVerified, setIsVerified] = useState(false);
  const [profileObjectId, setProfileObjectId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // UI state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [tipsReceived, setTipsReceived] = useState<string>("0");

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<UploadStep | null>(null);
  const [uploadError, setUploadError] = useState("");

  // On-chain save state
  const [saving, setSaving] = useState(false);
  const [txMessage, setTxMessage] = useState("");

  // SuiNS username claiming state
  const [desiredUsername, setDesiredUsername] = useState("");
  const [claimingUsername, setClaimingUsername] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState("");
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [claimedHandle, setClaimedHandle] = useState<string | null>(null);

  useEffect(() => {
    if (!desiredUsername.trim()) {
      setIsAvailable(null);
      setCheckingAvailability(false);
      return;
    }
    setCheckingAvailability(true);
    setIsAvailable(null);

    const delayDebounce = setTimeout(async () => {
      try {
        const resolved = await resolveSuiNSAddress(`${desiredUsername.trim().toLowerCase()}.lofilounge`);
        if (resolved) {
          setIsAvailable(false);
        } else {
          setIsAvailable(true);
        }
      } catch (err) {
        console.error("Availability check failed:", err);
        setIsAvailable(true); // default to available on error
      } finally {
        setCheckingAvailability(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [desiredUsername]);

  const handleClaimUsername = async () => {
    if (!address || !desiredUsername.trim()) return;
    setClaimingUsername(true);
    setUsernameMessage("");

    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

    try {
      // 1. Reserve subdomain via Enoki subnames API through backend proxy
      const registerRes = await fetch(`${BACKEND_URL}/user/register-subname`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subname: desiredUsername.trim().toLowerCase(),
          address,
        }),
      });

      if (!registerRes.ok) {
        const errText = await registerRes.text();
        throw new Error(`Subdomain reservation failed: ${errText}`);
      }

      const fullHandle = `${desiredUsername.trim().toLowerCase()}@lofilounge`;
      setUsernameMessage(`SuiNS Subdomain claimed! Handle is now ${fullHandle}.`);
      setClaimedHandle(fullHandle);
    } catch (err: any) {
      console.error(err);
      setUsernameMessage(`Claim failed: ${err.message || err}`);
    } finally {
      setClaimingUsername(false);
    }
  };

  // -----------------------------------------------------------------------
  // Walrus avatar upload
  // -----------------------------------------------------------------------
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);

    if (!address) {
      setUploadError("Connect your wallet first to upload to Walrus.");
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadStep("encoding");

    try {
      const blobId = await uploadFileToWalrus(
        file,
        address,     // passed for backend proxy WAL ownership transfer
        enokiFlow,   // passed for frontend Enoki-sponsored certification
        5,           // store for 5 epochs (~2 weeks on testnet)
        (step) => {
          if (UPLOAD_STEPS.includes(step as UploadStep)) {
            setUploadStep(step as UploadStep);
          }
        }
      );

      setAvatarBlobId(blobId);
      setUploadStep("certified");
    } catch (err: any) {
      console.error("Walrus upload failed:", err);
      setUploadError(`Upload failed: ${err.message || err}`);
      // Keep local preview so user sees their selection
    } finally {
      setUploading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Load user profile details on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!address) return;
    const loadProfile = async () => {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
      try {
        const res = await fetch(`${backendUrl}/user/profile?address=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          setProfileObjectId(data.profileObjectId);
          if (data.dbUser) {
            setNickname(data.dbUser.suinsHandle || `yeti_${address.slice(2, 8)}`);
            setStatus(data.dbUser.bio || "Chilling in the Lobby ❄️");
            setIsVerified(data.dbUser.isVerified);
            if (data.dbUser.claimedSubdomain) {
              setClaimedHandle(data.dbUser.claimedSubdomain);
            }
            if (data.dbUser.tipsReceived) {
              setTipsReceived(data.dbUser.tipsReceived);
            }
            if (data.dbUser.avatarBlobId) {
              if (data.dbUser.avatarBlobId.length >= 32) {
                setAvatarBlobId(data.dbUser.avatarBlobId);
              } else {
                setAvatarEmoji(data.dbUser.avatarBlobId);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load profile details:", err);
      }
    };
    const fetchClaimedHandle = async () => {
      try {
        const name = await reverseResolveSuiAddress(address);
        if (name && name.endsWith(".lofilounge.sui")) {
          const handle = name.replace(".lofilounge.sui", "@lofilounge");
          setClaimedHandle(handle);
        }
      } catch (err) {
        console.error("Failed to fetch claimed handle:", err);
      }
    };
    loadProfile();
    fetchClaimedHandle();
  }, [address]);

  // -----------------------------------------------------------------------
  // Self-verify profile on-chain
  // -----------------------------------------------------------------------
  const handleVerifyProfile = async () => {
    if (!address) return;
    setVerifying(true);
    setTxMessage("");
    try {
      setTxMessage("Paying 10 $LOFI verification fee... 💸");
      const txDigest = await payLofi(10.0, enokiFlow, address);
      
      setTxMessage("Verifying payment with Lounge Backend... ❄️");
      const token = await getAuthToken(enokiFlow, address);
      
      const verifyRes = await fetch(`${BACKEND_URL}/profile/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ txDigest }),
      });
      
      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(errData.message || "Backend payment verification failed.");
      }
      
      const { txBytes } = await verifyRes.json();
      
      setTxMessage("Signing on-chain verification certificate... ✍️");
      const keypair = await enokiFlow.getKeypair({ network: "testnet" });
      const tx = Transaction.from(fromBase64(txBytes));
      const execResult = await suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
      });
      
      setTxMessage(`Verification successful! Profile badge unlocked! Tx: ${(execResult as any).digest}`);
      setIsVerified(true);
    } catch (err: any) {
      console.error(err);
      setTxMessage(`Verification failed: ${err.message || err}`);
    } finally {
      setVerifying(false);
    }
  };

  // -----------------------------------------------------------------------
  // On-chain profile save (gasless via sponsor)
  // -----------------------------------------------------------------------
  const handleSaveOnChain = async () => {
    if (!address) return;
    setSaving(true);
    setTxMessage("");
    try {
      let activeProfileId = profileObjectId;

      // Check cache/backend to resolve profileObjectId if it's missing from state
      if (!activeProfileId) {
        const raw = typeof window !== "undefined" ? sessionStorage.getItem("lofi_yeti_profile_cache") : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed[address]) {
            activeProfileId = parsed[address];
            setProfileObjectId(activeProfileId);
          }
        }
      }
      if (!activeProfileId) {
        const res = await fetch(`${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          activeProfileId = data.profileObjectId;
          setProfileObjectId(activeProfileId);
          if (activeProfileId) {
            cacheProfileId(address, activeProfileId);
          }
        }
      }

      const tx = new Transaction();
      const avatarRef = avatarBlobId ?? avatarEmoji;

      if (activeProfileId) {
        // ── Existing user: update profile fields ────────────────────────────
        tx.moveCall({
          target: `${PACKAGE_ID}::profile::update_profile_entry`,
          arguments: [
            tx.object(activeProfileId),
            tx.pure.string(avatarRef),
            tx.pure.string(status),
          ],
        });
        // Update handle separately
        tx.moveCall({
          target: `${PACKAGE_ID}::profile::update_handle_entry`,
          arguments: [
            tx.object(activeProfileId),
            tx.pure.string(nickname),
          ],
        });

        const res = await sponsorAndExecuteTransaction(tx, enokiFlow, address);
        setTxMessage(`Profile updated on-chain! Tx: ${res.digest}`);
      } else {
        // ── New user: create profile atomically ─────────────────────────────
        setTxMessage("Creating your Yeti Profile... ❄️");
        const { profileArg, isNew } = await getOrCreateProfileArg(tx, address);
        if (isNew) tx.transferObjects([profileArg], address);

        const res = await sponsorAndExecuteTransaction(tx, enokiFlow, address);
        setTxMessage(`Profile created on-chain! Tx: ${res.digest}`);

        if (isNew) {
          // Warm the cache and resolve the newly created profile object ID
          warmProfileCache(address).then((newId) => {
            if (newId) setProfileObjectId(newId);
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      setTxMessage(`Failed to save profile: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const emojiAvatars = ["🏂", "🤖", "🎧", "🥶", "⛄", "🌊", "🐻", "🦄"];

  const badges: Badge[] = [
    {
      title: "Genesis Climber",
      emoji: "🏔️",
      desc: "Joined the lounge during pre-mint phase.",
      color: "border-accent/30 text-accent bg-accent/5",
    },
    {
      title: "Move Squire",
      emoji: "🛡️",
      desc: "Completed 5 lessons in Yeti Move Academy.",
      color: "border-purple/30 text-purple bg-purple/5",
    },
    {
      title: "Meme Master",
      emoji: "📢",
      desc: "Earned 500 total shills on the lounge feed.",
      color: "border-mint/30 text-mint bg-mint/5",
    },
  ];

  // Resolve current avatar display
  const avatarDisplay = avatarBlobId
    ? null // rendered as <img>
    : avatarPreview
    ? null // rendered as <img> (local preview)
    : avatarEmoji;

  const avatarImgSrc = avatarBlobId
    ? walrusBlobUrl(avatarBlobId)
    : avatarPreview ?? null;

  return (
    <div className="glass-panel rounded-3xl p-5 space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Profile Live Card Preview                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="bg-bg-primary/60 border border-border-ice/75 p-5 rounded-2xl relative overflow-hidden flex flex-col sm:flex-row gap-5 items-center">
        <div className="absolute top-0 right-0 h-24 w-24 bg-accent/5 rounded-full blur-xl pointer-events-none" />

        {/* Avatar display + upload trigger */}
        <div className="relative h-20 w-20 shrink-0 group">
          <div className="h-20 w-20 rounded-3xl bg-surface-secondary border border-border-ice flex items-center justify-center text-4xl shadow-ice-glow overflow-hidden">
            {avatarImgSrc ? (
              <img
                src={avatarImgSrc}
                alt="Avatar"
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{avatarDisplay}</span>
            )}
          </div>

          {/* Upload overlay */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 rounded-3xl bg-bg-primary/70 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-wait"
            title="Upload custom avatar to Walrus"
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 text-accent animate-spin" />
            ) : (
              <CloudUpload className="h-5 w-5 text-accent" />
            )}
            <span className="text-[8px] text-accent font-bold mt-0.5">
              {uploading ? "Uploading" : "Upload"}
            </span>
          </button>

          <span className="absolute bottom-1 right-1 h-3 w-3 rounded-full bg-mint border-2 border-surface-secondary" />

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {/* Live editing info */}
        <div className="flex-1 text-center sm:text-left space-y-1.5 w-full">
          {/* Nickname */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-center sm:justify-start gap-2">
            {isEditingName ? (
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="bg-bg-primary border border-accent/50 px-2 py-0.5 rounded-lg text-xs md:text-sm text-text-primary focus:outline-none w-full sm:w-48"
                  maxLength={15}
                  autoFocus
                />
                <button
                  onClick={() => setIsEditingName(false)}
                  className="p-1 rounded bg-mint/20 text-mint border border-mint/30"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center sm:justify-start gap-1.5">
                <h2 className="text-lg font-heading font-bold text-text-primary flex items-center gap-1.5">
                  {nickname}
                  {isVerified && (
                    <span title="Verified Yeti">
                      <BadgeCheck className="h-5 w-5 text-accent fill-accent/10" />
                    </span>
                  )}
                </h2>
                <button
                  onClick={() => setIsEditingName(true)}
                  className="p-1 rounded hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
              </div>
            )}
            <span className="text-[8px] bg-accent/15 border border-accent/25 text-accent font-bold px-1.5 py-0.2 rounded uppercase tracking-wider mx-auto sm:mx-0">
              CHILL LEVEL 42
            </span>
            <span className="text-[8px] bg-mint/15 border border-mint/25 text-mint font-bold px-1.5 py-0.2 rounded uppercase tracking-wider mx-auto sm:mx-0">
              💎 Tipped: {(Number(tipsReceived) / 1_000_000_000).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} LOFI
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-text-secondary">
            {isEditingStatus ? (
              <div className="flex items-center gap-1.5 w-full">
                <input
                  type="text"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="bg-bg-primary border border-accent/50 px-2 py-0.5 rounded-lg text-xs text-text-primary focus:outline-none w-full"
                  maxLength={30}
                  autoFocus
                />
                <button
                  onClick={() => setIsEditingStatus(false)}
                  className="p-1 rounded bg-mint/20 text-mint border border-mint/30"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center sm:justify-start gap-1.5">
                <span>Status: &ldquo;{status}&rdquo;</span>
                <button
                  onClick={() => setIsEditingStatus(true)}
                  className="p-1 rounded hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Upload progress indicator */}
          {uploading && uploadStep && (
            <div className="flex items-center gap-1.5 text-[10px] text-accent">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{STEP_LABELS[uploadStep]}</span>
            </div>
          )}
          {!uploading && avatarBlobId && (
            <p className="text-[9px] text-mint truncate">
              ✅ Walrus blob:{" "}
              <span className="font-mono opacity-70">
                {avatarBlobId.slice(0, 16)}…
              </span>
            </p>
          )}
          {uploadError && (
            <p className="text-[9px] text-red-400">{uploadError}</p>
          )}

          {/* Save actions */}
          <div className="flex flex-wrap items-center gap-3">
            {isVerified ? (
              <div className="flex items-center gap-1 text-[10px] text-mint font-bold bg-mint/10 border border-mint/20 px-2 py-0.5 rounded-full">
                <Check className="h-3 w-3" /> Verified Member
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-secondary/70">Unverified account</span>
                {address && (
                  <button
                    onClick={handleVerifyProfile}
                    disabled={verifying || saving || uploading}
                    className="px-3 py-1 rounded-xl bg-mint/20 border border-mint/30 hover:bg-mint/30 text-mint text-[10px] font-bold hover:shadow-ice-glow transition-all disabled:opacity-50 flex items-center gap-1"
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <span>Get Verified ✅</span>
                    )}
                  </button>
                )}
              </div>
            )}
            {address && (
              <button
                onClick={handleSaveOnChain}
                disabled={saving || uploading || verifying}
                className="ml-auto px-4 py-1.5 rounded-xl bg-accent text-bg-primary text-xs font-bold hover:shadow-ice-glow transition-all disabled:opacity-50"
              >
                {saving ? "Saving On-chain..." : "Save On-chain (Gasless)"}
              </button>
            )}
          </div>
          {txMessage && (
            <p className="text-[10px] text-accent mt-1">{txMessage}</p>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Avatar Customization — Emoji Picker                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-2">
        <h4 className="text-xs font-bold text-text-primary flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-accent" /> Customize Avatar Mascot
        </h4>
        <p className="text-[9px] text-text-secondary/60">
          Pick an emoji or hover your avatar above to upload a custom image to{" "}
          <span className="text-accent font-semibold">Walrus</span> decentralized storage.
        </p>
        <div className="flex flex-wrap gap-2">
          {emojiAvatars.map((av) => (
            <button
              key={av}
              onClick={() => {
                setAvatarEmoji(av);
                // Clear uploaded image when switching back to emoji
                setAvatarBlobId(null);
                setAvatarPreview(null);
              }}
              className={`h-11 w-11 text-2xl rounded-2xl border flex items-center justify-center transition-all ${
                !avatarBlobId && !avatarPreview && avatarEmoji === av
                  ? "bg-accent/15 border-accent text-text-primary shadow-ice-glow scale-105"
                  : "bg-surface-secondary/40 border-border-ice/60 text-text-secondary/60 hover:border-accent/40"
              }`}
            >
              {av}
            </button>
          ))}

          {/* Upload button in the row */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`h-11 w-11 rounded-2xl border flex items-center justify-center transition-all ${
              avatarBlobId
                ? "bg-mint/15 border-mint shadow-ice-glow scale-105"
                : "bg-surface-secondary/40 border-border-ice/60 hover:border-accent/40"
            }`}
            title="Upload image to Walrus"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 text-accent animate-spin" />
            ) : (
              <Upload className={`h-4 w-4 ${avatarBlobId ? "text-mint" : "text-text-secondary/60"}`} />
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-border-ice/45 pt-4">
        <h4 className="text-xs font-bold text-text-primary flex items-center gap-1.5">
          <Sparkles className="h-4.5 w-4.5 text-accent" /> lofilounge Username
        </h4>

        {claimedHandle ? (
          <div className="bg-mint/10 border border-mint/20 rounded-2xl p-4 flex items-center gap-2.5">
            <span className="text-xl">❄️</span>
            <div>
              <p className="text-xs font-bold text-text-primary">Handle Registered!</p>
              <p className="text-[10px] text-mint font-semibold">Your custom handle is <span className="underline">{claimedHandle}</span></p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[9px] text-text-secondary/60">
              Secure a custom subname under the lounge registry. Your username will resolve as <span className="text-accent font-semibold">username@lofilounge</span> on-chain (uses SuiNS subdomain under the hood).
            </p>

            {address ? (
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="desired_username"
                      value={desiredUsername}
                      onChange={(e) => setDesiredUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                      className="w-full glass-input rounded-xl pl-3 pr-24 py-2 text-xs placeholder-text-secondary/40 focus:outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-accent/80 font-bold pointer-events-none">
                      @lofilounge
                    </span>
                  </div>
                  <button
                    onClick={handleClaimUsername}
                    disabled={!desiredUsername.trim() || claimingUsername || checkingAvailability || isAvailable === false}
                    className="bg-accent text-bg-primary text-xs font-bold px-4 py-2.5 rounded-xl hover:shadow-ice-glow transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
                  >
                    {claimingUsername ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Claiming...</span>
                      </>
                    ) : (
                      <span>Claim Handle</span>
                    )}
                  </button>
                </div>
                {desiredUsername && (
                  <div className="text-[9px] font-bold select-none flex items-center gap-1 px-1">
                    {checkingAvailability ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-accent" />
                        <span className="text-accent">Checking availability...</span>
                      </>
                    ) : isAvailable === true ? (
                      <span className="text-mint">✓ Available</span>
                    ) : isAvailable === false ? (
                      <span className="text-red-400">✗ Already taken</span>
                    ) : null}
                  </div>
                )}
                {usernameMessage && (
                  <p className="text-[10px] text-accent">{usernameMessage}</p>
                )}
              </div>
            ) : (
              <p className="text-[10px] text-text-secondary/70 italic">Please sign in to secure your lofilounge handle.</p>
            )}
          </>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Badge Showcase                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-text-primary flex items-center gap-1.5">
          <Award className="h-4 w-4 text-purple" /> Badge Showcase
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {badges.map((badge, idx) => (
            <div
              key={idx}
              className={`border p-3 rounded-2xl flex flex-col justify-between h-[120px] transition-all hover:scale-102 ${badge.color}`}
            >
              <div className="text-2xl">{badge.emoji}</div>
              <div>
                <h5 className="text-[11px] font-bold tracking-wide truncate">
                  {badge.title}
                </h5>
                <p className="text-[8px] text-text-secondary leading-snug mt-0.5 line-clamp-2">
                  {badge.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProfileCustomizer;
