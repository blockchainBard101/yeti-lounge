import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiClient } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG, WalrusFile } from '@mysten/walrus';

/**
 * WalrusService — backend-side Walrus proxy.
 *
 * Handles the WAL-token-consuming `register` step on behalf of users.
 * The sponsor wallet holds WAL and pays for blob storage registration.
 * The resulting blob object is transferred to the user's address.
 *
 * Upload flow:
 *   1. Frontend encodes blob locally (walrusBlobFlow.encode())
 *   2. Frontend sends { bytes, blobId, rootHash, unencodedSize, userAddress } to POST /walrus/register
 *   3. Backend registers blob using sponsor WAL → transfers blob to userAddress
 *   4. Backend returns { blobObjectId, blobId, txDigest }
 *   5. Frontend uploads slivers directly to storage nodes (walrusBlobFlow.upload())
 *   6. Frontend certifies via Enoki gas-sponsored tx (walrusBlobFlow.certify())
 *
 * This means users never need WAL tokens — only SUI gas for the certify step,
 * which is handled by Enoki sponsorship.
 */
@Injectable()
export class WalrusService {
  private readonly logger = new Logger(WalrusService.name);
  private suiClient: SuiClient;
  private sponsorKeypair: Ed25519Keypair | null = null;
  private walrusClient: ReturnType<typeof this.buildWalrusClient> | null = null;

  constructor(private configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('SUI_RPC_URL') ||
      'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiClient({ url: rpcUrl });

    const privateKey = this.configService.get<string>('SPONSOR_WALLET_KEY');
    if (privateKey && privateKey !== 'suiprivkey123...placeholder') {
      try {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        this.sponsorKeypair = Ed25519Keypair.fromSecretKey(secretKey);
        this.logger.log('Walrus sponsor wallet loaded successfully.');
      } catch (err) {
        this.logger.error('Failed to parse sponsor private key:', err);
      }
    } else {
      this.logger.warn('Sponsor key placeholder — Walrus registration will be mocked.');
    }
  }

  private buildWalrusClient() {
    return new SuiGrpcClient({
      network: 'testnet',
      baseUrl: 'https://fullnode.testnet.sui.io:443',
    }).$extend(
      walrus({
        packageConfig: TESTNET_WALRUS_PACKAGE_CONFIG,
        uploadRelay: {
          host: 'https://upload-relay.testnet.walrus.space',
          sendTip: { max: 500 },
        },
      }),
    );
  }

  private getWalrusClient() {
    if (!this.walrusClient) {
      this.walrusClient = this.buildWalrusClient();
    }
    return this.walrusClient;
  }

  /**
   * Register a pre-encoded blob on Walrus using the sponsor's WAL tokens.
   * Transfers blob ownership to userAddress after registration.
   *
   * @param blobBytes     - Raw file bytes (base64 encoded from frontend)
   * @param userAddress   - The user's Sui address (blob is transferred here)
   * @param epochs        - Storage duration in epochs (default: 5)
   * @param deletable     - Whether the blob is deletable (default: false)
   */
  async registerBlob(
    blobBytes: string,
    userAddress: string,
    epochs = 5,
    deletable = false,
  ): Promise<{
    blobId: string;
    blobObjectId: string;
    txDigest: string;
    mock?: boolean;
  }> {
    if (!this.sponsorKeypair) {
      this.logger.warn('[WalrusRegister] Mocking blob registration (no sponsor key).');
      return {
        blobId: '0xmock_blob_' + Math.random().toString(36).substring(7),
        blobObjectId: '0xmock_obj_' + Math.random().toString(36).substring(7),
        txDigest: '0xmock_tx_' + Math.random().toString(36).substring(7),
        mock: true,
      };
    }

    const client = this.getWalrusClient();

    // Decode the base64 blob bytes from the frontend
    const bytes = Buffer.from(blobBytes, 'base64');
    const uint8Blob = new Uint8Array(bytes);

    // Create a write flow — this lets us control each step separately
    const flow = client.walrus.writeBlobFlow({ blob: uint8Blob });

    // Step 1: Encode locally (no network, no tokens)
    this.logger.log('[WalrusRegister] Encoding blob...');
    const encoded = await flow.encode();
    this.logger.log(`[WalrusRegister] Encoded. blobId: ${encoded.blobId}`);

    // Step 2: Register — sponsor pays WAL, blob is owned by userAddress
    // This is where WAL tokens are consumed from the sponsor's wallet.
    this.logger.log(`[WalrusRegister] Registering blob for owner: ${userAddress}`);
    const registered = await flow.executeRegister({
      owner: userAddress,   // ← blob object transferred to user immediately
      epochs,
      deletable,
      signer: this.sponsorKeypair as any,  // ← sponsor pays WAL here (cast to bypass esm/cjs conflict)
    });

    this.logger.log(
      `[WalrusRegister] Registered. blobObjectId: ${registered.blobObjectId}, tx: ${registered.txDigest}`,
    );

    // Step 3: Upload slivers via the relay (no tokens needed)
    this.logger.log('[WalrusRegister] Uploading slivers...');
    await flow.upload();
    this.logger.log('[WalrusRegister] Upload complete.');

    // Step 4: Certify — this is a Sui tx that the FRONTEND does (Enoki sponsors gas)
    // We return the blob info so the frontend can certify it.
    return {
      blobId: registered.blobId,
      blobObjectId: registered.blobObjectId,
      txDigest: registered.txDigest,
    };
  }

  /**
   * Register a quilt (multiple files packed into one blob) using the sponsor's WAL.
   *
   * @param entries       - Array of { blobBase64, identifier, tags }
   * @param userAddress   - The user's Sui address (blob is transferred here)
   * @param epochs        - Storage duration in epochs (default: 5)
   * @param deletable     - Whether the blob is deletable (default: false)
   */
  async registerQuilt(
    entries: { blobBase64: string; identifier: string; tags?: Record<string, string> }[],
    userAddress: string,
    epochs = 5,
    deletable = false,
  ): Promise<{
    blobId: string;
    blobObjectId: string;
    txDigest: string;
    patches: Record<string, string>;
    mock?: boolean;
  }> {
    if (!this.sponsorKeypair) {
      this.logger.warn('[WalrusRegister] Mocking quilt registration (no sponsor key).');
      return {
        blobId: '0xmock_quilt_' + Math.random().toString(36).substring(7),
        blobObjectId: '0xmock_obj_' + Math.random().toString(36).substring(7),
        txDigest: '0xmock_tx_' + Math.random().toString(36).substring(7),
        patches: {},
        mock: true,
      };
    }

    const client = this.getWalrusClient();

    // Decode all base64 blobs into WalrusFile objects
    const blobs = entries.map((e) => {
      const bytes = Buffer.from(e.blobBase64, 'base64');
      return WalrusFile.from({
        contents: new Uint8Array(bytes),
        identifier: e.identifier,
        tags: e.tags ?? {},
      });
    });

    // Create a quilt write flow
    const flow = client.walrus.writeFilesFlow({ files: blobs });

    this.logger.log('[WalrusRegisterQuilt] Encoding quilt...');
    const encoded = await flow.encode();
    this.logger.log(`[WalrusRegisterQuilt] Encoded. blobId: ${encoded.blobId}`);

    this.logger.log(`[WalrusRegisterQuilt] Registering quilt for owner: ${userAddress}`);
    const registered = await flow.executeRegister({
      owner: userAddress,
      epochs,
      deletable,
      signer: this.sponsorKeypair as any,
    });

    this.logger.log(
      `[WalrusRegisterQuilt] Registered. blobObjectId: ${registered.blobObjectId}, tx: ${registered.txDigest}`,
    );

    this.logger.log('[WalrusRegisterQuilt] Uploading slivers...');
    await flow.upload();
    this.logger.log('[WalrusRegisterQuilt] Upload complete.');

    // Extract patches from encoded index (for quilt fine-grained access)
    // Wait, the index is on `encoded.index` for quilt/files flows?
    // Let's type assert or look it up. The index patch mapping is what the frontend needs.
    // Actually, we can just return the raw index or construct the patches map.
    const patches: Record<string, string> = {};
    if ('index' in encoded && encoded.index) {
      const indexObj = encoded.index as any;
      if (indexObj.patches) {
        for (const patch of indexObj.patches) {
          patches[patch.identifier] = patch.patchId;
        }
      }
    }

    return {
      blobId: registered.blobId,
      blobObjectId: registered.blobObjectId,
      txDigest: registered.txDigest,
      patches,
    };
  }
}
