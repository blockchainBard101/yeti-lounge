import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient } from "@mysten/suins";

export const suiClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});

export const suinsClient = new SuinsClient({
  client: suiClient as any,
  network: "testnet",
});

export async function getCoinBalance(owner: string, coinType: string): Promise<string> {
  try {
    const res = await fetch("https://graphql.testnet.sui.io/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query GetCoinBalance($owner: SuiAddress!, $coinType: String!) {
            address(address: $owner) {
              balance(coinType: $coinType) {
                totalBalance
              }
            }
          }
        `,
        variables: {
          owner,
          coinType,
        },
      }),
    });
    if (!res.ok) throw new Error("GraphQL request failed");
    const json = await res.json();
    if (json.errors) {
      throw new Error(json.errors.map((e: any) => e.message).join(", "));
    }
    return json.data?.address?.balance?.totalBalance || "0";
  } catch (err) {
    console.error("getCoinBalance failed via GraphQL:", err);
    return "0";
  }
}

export async function resolveSuiNSAddress(domain: string): Promise<string | null> {
  try {
    // Format input (ensure it is lowercase and ends with .sui)
    let formatted = domain.toLowerCase().trim();
    if (formatted.includes("@")) {
      const parts = formatted.split("@");
      formatted = `${parts[0]}.${parts[1]}`;
    }
    if (!formatted.endsWith(".sui")) {
      formatted += ".sui";
    }

    const record = await suinsClient.getNameRecord(formatted);
    return record?.targetAddress || null;
  } catch (err) {
    console.error("SuiNS resolution failed:", err);
    return null;
  }
}

export async function reverseResolveSuiAddress(owner: string): Promise<string | null> {
  try {
    const res = await fetch("https://graphql.testnet.sui.io/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query GetDefaultName($owner: SuiAddress!) {
            address(address: $owner) {
              defaultName
            }
          }
        `,
        variables: {
          owner,
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors) return null;
    return json.data?.address?.defaultName || null;
  } catch (err) {
    console.error("SuiNS reverse resolution failed:", err);
    return null;
  }
}

export async function getCoinObjects(owner: string, coinType: string): Promise<string[]> {
  try {
    const coinsRes = await suiClient.listCoins({
      owner,
      coinType,
    });
    const coinsList = (coinsRes as any).objects || (coinsRes as any).data || [];
    return coinsList.map((c: any) => c.coinObjectId || c.objectId);
  } catch (err) {
    console.error("getCoinObjects failed:", err);
    return [];
  }
}

import { fromBase64, toBase64 } from "@mysten/sui/utils";

export { fromBase64, toBase64 };

/**
 * Builds a transaction block, requests gas sponsorship from the NestJS backend,
 * signs it using the user's Enoki zkLogin keypair, and executes it.
 */
export async function sponsorAndExecuteTransaction(
  tx: Transaction,
  enokiFlow: any,
  senderAddress: string,
  useLocalSponsor: boolean = false
) {
  try {
    // 1. Set sender
    tx.setSender(senderAddress);

    // 2. Build transaction kind on client (no gas selection needed)
    const builtTxBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
    const txBytesBase64 = toBase64(builtTxBytes);

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

    let sponsorData;
    let useSponsorship = true;

    try {
      // 3. Request gas sponsorship from backend
      const sponsorResponse = await fetch(`${backendUrl}/sponsored/sponsor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txBytes: txBytesBase64,
          senderAddress,
          useLocalSponsor,
        }),
      });

      if (!sponsorResponse.ok) {
        const errorMsg = await sponsorResponse.text();
        throw new Error(errorMsg);
      }

      sponsorData = await sponsorResponse.json();
    } catch (sponsorErr) {
      console.warn("Gas sponsorship failed or unavailable. Falling back to self-funded execution:", sponsorErr);
      useSponsorship = false;
    }

    // 4. Retrieve user's ephemeral zkLogin keypair from Enoki
    const keypair = await enokiFlow.getKeypair({ network: "testnet" });

    if (!useSponsorship) {
      // Self-funded fallback: execute the transaction using the user's own gas coins
      tx.setGasBudget(10_000_000); // 0.01 SUI gas budget limit
      const result = await suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
      });
      const digest = (result as any).digest || 
                     (result as any).Transaction?.digest || 
                     (result as any).FailedTransaction?.digest ||
                     (result as any).transaction?.digest || 
                     (result as any).transactionBlock?.digest;
      return { digest };
    }

    // Check if the transaction was sponsored locally/mocked
    if (sponsorData.mock) {
      console.log("Transaction sponsored mock execution successful. Digest:", sponsorData.digest);
      return { digest: sponsorData.digest };
    }

    if (sponsorData.localSponsor) {
      console.log("[LocalSponsor] Executing locally-sponsored transaction on client...", sponsorData);
      const userSignature = await keypair.signTransaction(fromBase64(sponsorData.bytes));
      console.log("[LocalSponsor] userSignature:", userSignature);
      
      let executeResult;
      const clientObj = suiClient as any;
      if (typeof clientObj.executeTransactionBlock === "function") {
        executeResult = await clientObj.executeTransactionBlock({
          transactionBlock: fromBase64(sponsorData.bytes),
          signatures: [userSignature.signature, sponsorData.signature],
        });
      } else if (typeof clientObj.executeTransaction === "function") {
        executeResult = await clientObj.executeTransaction({
          transaction: fromBase64(sponsorData.bytes),
          signatures: [userSignature.signature, sponsorData.signature],
        });
      } else {
        throw new Error("No transaction execution method found on suiClient");
      }
      
      return { digest: executeResult.digest };
    }

    // 5. Sign transaction bytes with the user's keypair
    const userSignature = await keypair.signTransaction(fromBase64(sponsorData.bytes));

    // 6. Submit user's signature to the backend to execute via Enoki
    const executeResponse = await fetch(`${backendUrl}/sponsored/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        digest: sponsorData.digest,
        signature: userSignature.signature,
      }),
    });

    if (!executeResponse.ok) {
      const errorMsg = await executeResponse.text();
      throw new Error(`Execution backend returned error: ${errorMsg}`);
    }

    const executeData = await executeResponse.json();
    return { digest: executeData.txDigest };
  } catch (err) {
    console.error("Failed to sponsor and execute transaction:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Contract constants — override via env vars
// ---------------------------------------------------------------------------

export const PACKAGE_ID =
  process.env.NEXT_PUBLIC_PACKAGE_ID ||
  "0x395938a222bfd3cf39052bf6ec5b0c8db77935e71a292092dddcbcf1a9ebf2eb";

export const REGISTRY_ID =
  process.env.NEXT_PUBLIC_REGISTRY_ID ||
  "0x66ee02c4394dc8cfe5b9a043afc8d21dbfdb5ae6ed247365c27d78063a7707ac";

export const GLACIER_FUND_ID =
  process.env.NEXT_PUBLIC_GLACIER_FUND_ID ||
  "0x71669ee7a7fb96a3f50984ea406bd1ff52410e1649be661837b57d8471985849";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export const LOFI_COIN_TYPE =
  process.env.NEXT_PUBLIC_LOFI_COIN_TYPE ||
  "0xcebb6563df9fb7b59833da4bfc96dce11e3600e71e6b5e930ee1be82914dfa98::lofi::LOFI";

// ---------------------------------------------------------------------------
// Profile PTB helper — with session-level cache to handle GraphQL indexing lag
// ---------------------------------------------------------------------------

/**
 * In-memory cache: address → profileObjectId.
 * Populated the moment the backend confirms a profile exists (200 OK).
 * Also seeded from sessionStorage so it survives React re-renders without
 * persisting beyond the browser tab (avoids stale IDs across sessions).
 */
const _profileCache = new Map<string, string>();

const SESSION_KEY = "lofi_yeti_profile_cache";

/** Load any previously cached IDs from sessionStorage into the in-memory map. */
function _loadProfileCache() {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed: Record<string, string> = JSON.parse(raw);
      for (const [addr, id] of Object.entries(parsed)) {
        _profileCache.set(addr, id);
      }
    }
  } catch {}
}
_loadProfileCache();

/** Persist a resolved profile ID into both the in-memory cache and sessionStorage. */
export function cacheProfileId(address: string, profileObjectId: string) {
  _profileCache.set(address, profileObjectId);
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed: Record<string, string> = raw ? JSON.parse(raw) : {};
    parsed[address] = profileObjectId;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  } catch {}
}

/**
 * After a brand-new profile is created on-chain, the Sui testnet GraphQL node
 * can take a few seconds to index the new object. This function polls the
 * backend (which queries GraphQL) until it sees the profile, then seeds the
 * local session cache so subsequent actions don't re-inject create_profile.
 * Returns the profileObjectId if found, or null if it times out.
 */
export async function warmProfileCache(address: string, maxRetries = 10, delayMs = 1500): Promise<string | null> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await fetch(`${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const { profileObjectId } = await res.json();
        cacheProfileId(address, profileObjectId);
        console.log(`[warmProfileCache] Profile indexed after ${i + 1} attempt(s): ${profileObjectId}`);
        return profileObjectId;
      }
    } catch {
      // Network error — keep retrying
    }
  }
  console.warn(`[warmProfileCache] Profile not indexed after ${maxRetries} retries. Cache will be seeded on next successful fetch.`);
  return null;
}

/**
 * Ensures the user has a YetiProfile within a **single atomic PTB**.
 *
 * • Existing user → returns `tx.object(profileObjectId)` so subsequent commands
 *   can pass it as `&YetiProfile`.
 *
 * • New user → prepends `profile::create_profile` as the first PTB command and
 *   returns its `TransactionResult`. Subsequent commands receive this result as
 *   `&YetiProfile` (Sui's runtime handles the borrow correctly in PTBs).
 *
 * **Caller contract when `isNew === true`:**
 *   Append `tx.transferObjects([profileArg], address)` at the END of the PTB
 *   so the freshly-created profile is transferred to the user in the same tx.
 *
 * **GraphQL lag handling:**
 *   The Sui testnet GraphQL node can lag a few seconds behind live chain state.
 *   If the backend returns 404 but we have a cached profile ID from this session,
 *   we trust the cache and skip `create_profile` to avoid `EProfileAlreadyExists`.
 *
 * Example usage (post creation):
 * ```ts
 * const tx = new Transaction();
 * const { profileArg, isNew } = await getOrCreateProfileArg(tx, address);
 * tx.moveCall({ target: '...::post::create_post_entry', arguments: [profileArg, ...] });
 * if (isNew) tx.transferObjects([profileArg], address);
 * await sponsorAndExecuteTransaction(tx, enokiFlow, address);
 * ```
 */
export async function getOrCreateProfileArg(
  tx: Transaction,
  address: string
): Promise<{ profileArg: any; isNew: boolean }> {
  const profileRes = await fetch(
    `${BACKEND_URL}/user/profile?address=${encodeURIComponent(address)}`
  );

  if (profileRes.ok) {
    const { profileObjectId } = await profileRes.json();
    // Seed / refresh the session cache with the confirmed ID.
    cacheProfileId(address, profileObjectId);
    return { profileArg: tx.object(profileObjectId), isNew: false };
  }

  if (profileRes.status === 404 || profileRes.status === 400) {
    // ── GraphQL indexing lag guard ─────────────────────────────────────────
    // If we already know this address has a profile (from earlier in this
    // browser session), the 404 is a false negative caused by the GraphQL
    // node not yet having indexed the freshly created profile object.
    // Re-using the cached ID avoids triggering a second create_profile that
    // would abort on-chain with EProfileAlreadyExists (MoveAbort 0).
    const cachedId = _profileCache.get(address);
    if (cachedId) {
      console.log(
        `[getOrCreateProfileArg] Backend returned 404 but session cache has profileId=${cachedId} — using cached ID (GraphQL indexing lag).`
      );
      return { profileArg: tx.object(cachedId), isNew: false };
    }
    // ── Genuine new user path ───────────────────────────────────────────────
    // Auto-generate a handle from the first 6 hex chars of the address.
    // Users can update their handle from their profile page later.
    const shortHandle = `yeti_${address.slice(2, 8)}`;
    const profileResult = tx.moveCall({
      target: `${PACKAGE_ID}::profile::create_profile`,
      arguments: [
        tx.object(REGISTRY_ID),
        tx.pure.string(shortHandle),
        tx.pure.string(""),                    // avatar blob — set later
        tx.pure.string("New to the lounge! ❄️"),
      ],
    });
    return { profileArg: profileResult, isNew: true };
  }

  const errBody = await profileRes.json().catch(() => ({}));
  throw new Error(errBody.message || "Failed to resolve your Yeti Profile.");
}

export async function payLofi(amount: number, enokiFlow: any, senderAddress: string): Promise<string> {
  const infoRes = await fetch(`${BACKEND_URL}/swap/info`);
  if (!infoRes.ok) throw new Error("Failed to load treasury swap info");
  const { treasuryAddress, lofiCoinType } = await infoRes.json();

  if (!treasuryAddress) throw new Error("Treasury address is not configured");

  const tx = new Transaction();
  const amountMist = BigInt(Math.round(amount * 1_000_000_000));

  if (lofiCoinType === "0x2::sui::SUI" || lofiCoinType.endsWith("::sui::SUI")) {
    const [coin] = tx.splitCoins(tx.gas, [amountMist]);
    tx.transferObjects([coin], treasuryAddress);
  } else {
    const coinsRes = await suiClient.listCoins({
      owner: senderAddress,
      coinType: lofiCoinType,
    });
    const coinsList = (coinsRes as any).objects || (coinsRes as any).data || [];
    if (coinsList.length === 0) {
      throw new Error(`Insufficient $LOFI balance. You need at least ${amount} LOFI.`);
    }
    
    const [first, ...rest] = coinsList;
    const primaryCoin = tx.object(first.coinObjectId || first.objectId);
    if (rest.length > 0) {
      tx.mergeCoins(primaryCoin, rest.map((c: any) => tx.object(c.coinObjectId || c.objectId)));
    }
    const [splitCoin] = tx.splitCoins(primaryCoin, [amountMist]);
    tx.transferObjects([splitCoin], treasuryAddress);
  }

  tx.setGasBudget(25_000_000);
  const keypair = await enokiFlow.getKeypair({ network: "testnet" });
  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  });
  console.log("[payLofi] Transaction execution result:", result);
  const digest = (result as any).digest || 
                 (result as any).Transaction?.digest || 
                 (result as any).FailedTransaction?.digest ||
                 (result as any).transaction?.digest || 
                 (result as any).transactionBlock?.digest;
  console.log("[payLofi] Extracted digest:", digest);

  return digest;
}

export async function getAuthToken(enokiFlow: any, address: string): Promise<string> {
  const cacheKey = `lofi_yeti_auth_token_${address.toLowerCase()}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const decoded = JSON.parse(atob(cached));
      if (decoded.payload && decoded.payload.expiresAt > Date.now() + 60 * 1000) {
        return cached;
      }
    } catch (err) {
      // ignore parsing errors and proceed to sign a new token
    }
  }

  const messageObj = {
    address: address,
    timestamp: Date.now(),
  };
  const message = JSON.stringify(messageObj);
  const keypair = await enokiFlow.getKeypair({ network: "testnet" });
  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(message));

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suiAddress: address, signature, message }),
  });

  if (!res.ok) {
    throw new Error("Authentication failed with backend");
  }

  const { token } = await res.json();
  localStorage.setItem(cacheKey, token);
  return token;
}

