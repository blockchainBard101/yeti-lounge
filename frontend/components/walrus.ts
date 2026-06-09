/**
 * walrus.ts — Walrus decentralized storage utilities for Yeti Lounge
 *
 * WAL Sponsorship Architecture:
 *   Walrus blob registration requires WAL tokens (not SUI). To avoid requiring
 *   users to hold WAL, uploads are proxied through the NestJS backend:
 *
 *   1. Frontend converts File → base64, sends to POST /walrus/register
 *   2. Backend uses sponsor wallet (holds WAL) to:
 *      a. Encode the blob
 *      b. Register it on Walrus (pays WAL) with owner = user's address
 *      c. Upload slivers via upload relay
 *   3. Backend returns { blobId, blobObjectId }
 *   4. Frontend certifies the blob using Enoki gas-sponsored tx (no WAL needed)
 *
 *   Result: users never need WAL tokens. Only Enoki-sponsored SUI gas for certify.
 *
 * Reading is done via the public Walrus aggregator HTTP endpoint — no SDK needed.
 *
 * Upload Relay:
 *   Backend uses the official Mysten Labs upload relay to reduce storage node
 *   requests from ~2,200 to a handful. Tip: 105 MIST per upload (negligible).
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { walrus, WalrusFile } from "@mysten/walrus";

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

/** Aggregator — used to build public read URLs from blobIds */
export const WALRUS_AGGREGATOR =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR ||
  "https://aggregator.walrus-testnet.walrus.space";

/**
 * Upload relay — offloads the ~2,200 per-node sliver requests down to a
 * single relay connection, dramatically speeding up uploads in the browser.
 *
 * Tip amount (105 MIST flat) is read live from the relay's /v1/tip-config.
 * The `max` cap of 500 MIST protects against future relay config changes.
 */
const UPLOAD_RELAY_URL = "https://upload-relay.testnet.walrus.space";

/**
 * Build a public HTTP URL to read a Walrus blob.
 * Usage: <img src={walrusBlobUrl(blobId)} />
 */
export function walrusBlobUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
}

// ---------------------------------------------------------------------------
// Walrus client — SuiGrpcClient extended with walrus() plugin + upload relay
// ---------------------------------------------------------------------------
let _walrusClient: ReturnType<typeof buildWalrusClient> | null = null;

function buildWalrusClient() {
  return new SuiGrpcClient({
    network: "testnet",
    baseUrl: "https://fullnode.testnet.sui.io:443",
  }).$extend(
    walrus({
      // Upload relay: reduces browser upload from ~2,200 requests → a few.
      // sendTip: { max } lets the SDK read the relay's /v1/tip-config and
      // pay whatever it requests (capped at `max` MIST for safety).
      uploadRelay: {
        host: UPLOAD_RELAY_URL,
        sendTip: {
          max: 500, // cap at 500 MIST (~0.0000005 SUI) — current tip is 105 MIST
        },
      },
      storageNodeClientOptions: {
        timeout: 60_000,
      },
    })
  );
}

function getWalrusClient() {
  if (!_walrusClient) {
    _walrusClient = buildWalrusClient();
  }
  return _walrusClient;
}

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Str = result.split(",")[1];
      resolve(base64Str);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Backend-proxied upload — sponsor pays WAL, user only certifies with Enoki gas
// ---------------------------------------------------------------------------

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

/**
 * Upload a File to Walrus via the backend sponsor proxy.
 *
 * The backend (NestJS) holds WAL tokens and handles:
 *   - Blob encoding
 *   - WAL-token-consuming registration (with owner = userAddress)
 *   - Sliver upload to storage nodes via the upload relay
 *
 * The frontend only needs to certify the blob, which is Enoki gas-sponsored.
 *
 * @param file        - The browser File object
 * @param userAddress - The user's Sui address (blob ownership transferred here)
 * @param enokiFlow   - Enoki flow (for certify gas sponsorship)
 * @param epochs      - Storage duration in epochs (default: 5)
 * @param onProgress  - Optional step callback
 * @returns           - The Walrus blobId
 */
export async function uploadFileToWalrus(
  file: File,
  userAddress: string,
  enokiFlow: any,
  epochs = 5,
  onProgress?: (step: string) => void
): Promise<string> {
  const client = getWalrusClient();

  // Convert File to base64 for transport to backend
  onProgress?.("encoding");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = await fileToBase64(file);

  // Backend registers blob (pays WAL) and uploads slivers
  onProgress?.("registered");
  const res = await fetch(`${BACKEND_URL}/walrus/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blobBase64: base64, userAddress, epochs }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`Backend Walrus registration failed: ${err.message}`);
  }

  const { blobId, blobObjectId, mock } = await res.json();
  onProgress?.("uploaded");

  // Certify the blob on-chain (Enoki sponsors the gas, no WAL needed)
  if (!mock && blobObjectId) {
    try {
      onProgress?.("certifying");
      const flow = client.walrus.writeBlobFlow({ blob: bytes });
      // Re-encode locally so the flow has the right state for certify
      await flow.encode();
      const certifyTx = flow.certify();
      // Use Enoki sponsorship for the certify gas
      const keypair = await enokiFlow.getKeypair({ network: "testnet" });
      if (typeof flow.executeCertify === 'function') {
        await flow.executeCertify({ signer: keypair as any });
      } else {
        await keypair.signAndExecuteTransaction?.({ transaction: certifyTx });
      }
    } catch (certErr) {
      // Certify failure is non-fatal — blob is uploaded, just pending certification
      console.warn("[Walrus] Certify step failed (non-fatal):", certErr);
    }
  }

  onProgress?.("certified");
  return blobId;
}

/**
 * Upload raw bytes (e.g. a canvas export or JSON metadata) to Walrus.
 *
 * @param bytes   - Raw Uint8Array to store
 * @param signer  - The Enoki keypair
 * @param epochs  - Storage duration in epochs
 * @returns       - The Walrus blobId string
 */
export async function uploadBytesToWalrus(
  bytes: Uint8Array,
  signer: any,
  epochs = 5
): Promise<string> {
  const client = getWalrusClient();
  const result = await client.walrus.writeBlob({
    blob: bytes,
    signer,
    epochs,
    deletable: false,
  });
  return result.blobId;
}

// ---------------------------------------------------------------------------
// Quilt helpers — batch multiple files into a single Walrus blob
// ---------------------------------------------------------------------------

/**
 * A named file entry for quilt uploads.
 */
export interface QuiltEntry {
  /** Browser File object */
  file: File;
  /**
   * Unique identifier within the quilt — used to retrieve individual files.
   * Use descriptive names like "avatar", "image-0", "image-1", "cover".
   */
  identifier: string;
  /** Optional key-value metadata tags stored alongside the file */
  tags?: Record<string, string>;
}

/**
 * The result of a quilt upload — one blobId covers all files.
 */
export interface QuiltUploadResult {
  /** Single Walrus blobId that contains all files */
  blobId: string;
  /** Map of identifier → patchId (for fine-grained reads if needed) */
  patches: Record<string, string>;
}

/**
 * Upload multiple files as a single Walrus quilt blob via the backend sponsor proxy.
 *
 * A quilt packs N files into one blob registration (one on-chain tx, one blobId).
 * The backend handles WAL-token registration and sliver uploads.
 * The frontend certifies the quilt via Enoki-sponsored SUI gas.
 *
 * @param entries    - Array of { file, identifier, tags? } entries
 * @param userAddress- The user's Sui address (blob ownership transferred here)
 * @param enokiFlow  - Enoki flow (for certify gas sponsorship)
 * @param epochs     - Storage duration in epochs (default: 5)
 * @param onProgress - Optional step callback
 * @returns          - { blobId, patches } — store blobId on-chain
 */
export async function uploadFilesAsQuilt(
  entries: QuiltEntry[],
  userAddress: string,
  enokiFlow: any,
  epochs = 5,
  onProgress?: (step: string) => void
): Promise<QuiltUploadResult> {
  const client = getWalrusClient();

  // Convert all Files to base64 for backend
  onProgress?.("encoding");
  const base64Entries = await Promise.all(
    entries.map(async ({ file, identifier, tags }) => {
      const base64 = await fileToBase64(file);
      return {
        blobBase64: base64,
        identifier,
        tags: tags ?? {},
      };
    })
  );

  // Backend registers quilt (pays WAL) and uploads slivers
  onProgress?.("registered");
  const res = await fetch(`${BACKEND_URL}/walrus/register-quilt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries: base64Entries, userAddress, epochs }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`Backend Walrus quilt registration failed: ${err.message}`);
  }

  const { blobId, blobObjectId, patches, mock } = await res.json();
  onProgress?.("uploaded");

  // Certify the quilt on-chain (Enoki sponsors gas)
  if (!mock && blobObjectId) {
    try {
      onProgress?.("certifying");
      // We need to recreate the files payload locally for certification
      const localBlobs = await Promise.all(
        entries.map(async ({ file, identifier, tags }) => {
          const arrayBuffer = await file.arrayBuffer();
          return WalrusFile.from({
            contents: new Uint8Array(arrayBuffer),
            identifier,
            tags: tags ?? {},
          });
        })
      );
      const flow = client.walrus.writeFilesFlow({ files: localBlobs });
      await flow.encode();
      const certifyTx = flow.certify();

      const keypair = await enokiFlow.getKeypair({ network: "testnet" });
      if (typeof flow.executeCertify === 'function') {
        await flow.executeCertify({ signer: keypair as any });
      } else {
        await keypair.signAndExecuteTransaction?.({ transaction: certifyTx });
      }
    } catch (certErr) {
      console.warn("[Walrus Quilt] Certify step failed (non-fatal):", certErr);
    }
  }

  onProgress?.("certified");
  return { blobId, patches: patches ?? {} };
}

/**
 * Read individual named files back from a quilt blobId by probing the correct
 * Walrus aggregator REST path: /v1/blobs/by-quilt-id/<QUILT_ID>/<IDENTIFIER>
 *
 * All HEAD probes are fired in parallel via Promise.allSettled for fast resolution.
 * Returns a map of identifier → public aggregator URL (for use as <img src> etc).
 *
 * @param quiltBlobId  - The blobId returned from uploadFilesAsQuilt
 * @param identifiers  - Which files to probe (all fired in parallel)
 * @returns            - Map of identifier → aggregator URL (only existing ones)
 */
export async function readQuiltFiles(
  quiltBlobId: string,
  identifiers: string[]
): Promise<Record<string, string>> {
  const results = await Promise.allSettled(
    identifiers.map(async (identifier) => {
      const url = walrusQuiltFileUrl(quiltBlobId, identifier);
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) throw new Error(`${identifier} not found`);
      return { identifier, url };
    })
  );

  const found: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      found[r.value.identifier] = r.value.url;
    }
  }
  return found;
}

/**
 * Build a public aggregator URL for a specific file within a quilt.
 * Uses the CORRECT REST path: /v1/blobs/by-quilt-id/<quiltBlobId>/<identifier>
 *
 * @param quiltBlobId  - The quilt's blobId
 * @param identifier   - The file's identifier within the quilt
 */
export function walrusQuiltFileUrl(
  quiltBlobId: string,
  identifier: string
): string {
  return `${WALRUS_AGGREGATOR}/v1/blobs/by-quilt-id/${quiltBlobId}/${encodeURIComponent(identifier)}`;
}

/**
 * Build a public aggregator URL using a quilt patch ID.
 * This is the FASTEST retrieval path — directly addresses a single blob
 * within a quilt without any identifier lookup.
 *
 * Patch IDs are returned by the /walrus/register-quilt backend endpoint
 * in the `patches` map (identifier → quiltPatchId).
 *
 * @param patchId - The quilt patch ID for a specific file
 */
export function walrusQuiltPatchUrl(patchId: string): string {
  return `${WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/${patchId}`;
}
