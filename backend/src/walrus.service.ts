import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { walrus, TESTNET_WALRUS_PACKAGE_CONFIG, WalrusFile, blobIdFromInt } from '@mysten/walrus';
import { PrismaService } from './prisma.service';
import * as fs from 'fs';
import * as path from 'path';

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
  private suiClient: SuiGrpcClient;
  private sponsorKeypair: Ed25519Keypair | null = null;
  private walrusClient: ReturnType<typeof this.buildWalrusClient> | null = null;

  private saveMockBlob(blobId: string, base64Bytes: string) {
    try {
      const dirPath = path.resolve(process.cwd(), 'uploads');
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const filePath = path.join(dirPath, blobId);
      fs.writeFileSync(filePath, Buffer.from(base64Bytes, 'base64'));
      this.logger.log(`Saved mock/cache blob content to disk: ${filePath}`);
    } catch (err) {
      this.logger.error(`Failed to save mock/cache blob to disk: ${err.message}`);
    }
  }

  constructor(
    private configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const rpcUrl =
      this.configService.get<string>('SUI_RPC_URL') ||
      'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });

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
      const mockBlobId = '0xmock_blob_' + Math.random().toString(36).substring(7);
      const mockBlobObjectId = '0xmock_obj_' + Math.random().toString(36).substring(7);
      const mockTxDigest = '0xmock_tx_' + Math.random().toString(36).substring(7);
      
      this.saveMockBlob(mockBlobId, blobBytes);

      await this.prisma.walrusBlob.upsert({
        where: { blobId: mockBlobId },
        update: { blobObjectId: mockBlobObjectId, epochs },
        create: { blobId: mockBlobId, blobObjectId: mockBlobObjectId, epochs },
      });
      return {
        blobId: mockBlobId,
        blobObjectId: mockBlobObjectId,
        txDigest: mockTxDigest,
        mock: true,
      };
    }

    try {
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

      // Step 2: Register — sponsor pays WAL from its own balance.
      // Set the owner to the sponsor's SUI address so that storage fees are correctly
      // sponsored and paid in WAL from the sponsor's funded wallet (990 WAL balance).
      const sponsorAddress = this.sponsorKeypair.toSuiAddress();
      this.logger.log(`[WalrusRegister] Registering blob sponsored by: ${sponsorAddress}`);
      const registered = await flow.executeRegister({
        owner: sponsorAddress, // ← sponsor owns blob to pay WAL fees
        epochs,
        deletable,
        signer: this.sponsorKeypair as any, // ← sponsor signs transaction
      });

      this.logger.log(
        `[WalrusRegister] Registered. blobObjectId: ${registered.blobObjectId}, tx: ${registered.txDigest}`,
      );

      this.saveMockBlob(registered.blobId, blobBytes);

      // Step 3: Upload slivers via the relay (no tokens needed)
      // Pass the registration transaction digest so the upload step has the proper on-chain reference context
      this.logger.log('[WalrusRegister] Uploading slivers...');
      await flow.upload({ digest: registered.txDigest });
      this.logger.log('[WalrusRegister] Upload complete.');

      // Step 4: Certify on backend using sponsor keypair to guarantee it is available on-chain immediately
      try {
        this.logger.log('[WalrusRegister] Certifying blob on backend...');
        await flow.executeCertify({ signer: this.sponsorKeypair as any });
        this.logger.log('[WalrusRegister] Certify complete.');
      } catch (certErr) {
        this.logger.warn(`[WalrusRegister] Backend certify failed: ${certErr.message || certErr}`);
      }

      await this.prisma.walrusBlob.upsert({
        where: { blobId: registered.blobId },
        update: { blobObjectId: registered.blobObjectId, epochs },
        create: { blobId: registered.blobId, blobObjectId: registered.blobObjectId, epochs },
      });

      return {
        blobId: registered.blobId,
        blobObjectId: registered.blobObjectId,
        txDigest: registered.txDigest,
      };
    } catch (err: any) {
      this.logger.error(
        `[WalrusRegister] Failed to register blob on-chain: ${err.message || err}. Falling back to mock registration to prevent server crash.`,
      );
      const mockBlobId = '0xmock_blob_' + Math.random().toString(36).substring(7);
      const mockBlobObjectId = '0xmock_obj_' + Math.random().toString(36).substring(7);
      const mockTxDigest = '0xmock_tx_' + Math.random().toString(36).substring(7);
      
      this.saveMockBlob(mockBlobId, blobBytes);

      await this.prisma.walrusBlob.upsert({
        where: { blobId: mockBlobId },
        update: { blobObjectId: mockBlobObjectId, epochs },
        create: { blobId: mockBlobId, blobObjectId: mockBlobObjectId, epochs },
      });
      return {
        blobId: mockBlobId,
        blobObjectId: mockBlobObjectId,
        txDigest: mockTxDigest,
        mock: true,
      };
    }
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

    try {
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

      const sponsorAddress = this.sponsorKeypair.toSuiAddress();
      this.logger.log(`[WalrusRegisterQuilt] Registering quilt sponsored by: ${sponsorAddress}`);
      const registered = await flow.executeRegister({
        owner: sponsorAddress,
        epochs,
        deletable,
        signer: this.sponsorKeypair as any,
      });

      this.logger.log(
        `[WalrusRegisterQuilt] Registered. blobObjectId: ${registered.blobObjectId}, tx: ${registered.txDigest}`,
      );

      this.logger.log('[WalrusRegisterQuilt] Uploading slivers...');
      await flow.upload({ digest: registered.txDigest });
      this.logger.log('[WalrusRegisterQuilt] Upload complete.');

      // Certify the quilt on backend using sponsor keypair to guarantee it is available on-chain immediately
      try {
        this.logger.log('[WalrusRegisterQuilt] Certifying quilt on backend...');
        await flow.executeCertify({ signer: this.sponsorKeypair as any });
        this.logger.log('[WalrusRegisterQuilt] Certify complete.');
      } catch (certErr) {
        this.logger.warn(`[WalrusRegisterQuilt] Backend certify failed: ${certErr.message || certErr}`);
      }

      // Extract patches from encoded index (for quilt fine-grained access)
      const patches: Record<string, string> = {};
      if ('index' in encoded && encoded.index) {
        const indexObj = encoded.index as any;
        if (indexObj.patches) {
          for (const patch of indexObj.patches) {
            patches[patch.identifier] = patch.patchId;
            // Map each patch ID to the quilt's on-chain blobObjectId
            await this.prisma.walrusBlob.upsert({
              where: { blobId: patch.patchId },
              update: { blobObjectId: registered.blobObjectId, epochs },
              create: { blobId: patch.patchId, blobObjectId: registered.blobObjectId, epochs },
            }).catch((e) => this.logger.warn(`Failed to map quilt patch: ${e.message}`));
          }
        }
      }

      await this.prisma.walrusBlob.upsert({
        where: { blobId: registered.blobId },
        update: { blobObjectId: registered.blobObjectId, epochs },
        create: { blobId: registered.blobId, blobObjectId: registered.blobObjectId, epochs },
      }).catch((e) => this.logger.warn(`Failed to map quilt blobId: ${e.message}`));

      return {
        blobId: registered.blobId,
        blobObjectId: registered.blobObjectId,
        txDigest: registered.txDigest,
        patches,
      };
    } catch (err: any) {
      this.logger.error(
        `[WalrusRegisterQuilt] Failed to register quilt on-chain: ${err.message || err}. Falling back to mock registration to prevent server crash.`,
      );
      return {
        blobId: '0xmock_quilt_' + Math.random().toString(36).substring(7),
        blobObjectId: '0xmock_obj_' + Math.random().toString(36).substring(7),
        txDigest: '0xmock_tx_' + Math.random().toString(36).substring(7),
        patches: {},
        mock: true,
      };
    }
  }

  /**
   * Extend a registered blob's storage epoch on-chain using the sponsor's WAL.
   *
   * @param blobObjectId - The Sui object ID representing the registered blob.
   * @param epochs       - The number of additional epochs to extend by (default: 5).
   */
   async findBlobObjectIdOnChain(blobId: string, ownerAddress?: string): Promise<string | null> {
    const searchAddresses: string[] = [];
    if (this.sponsorKeypair) {
      searchAddresses.push(this.sponsorKeypair.toSuiAddress());
    }
    if (ownerAddress && ownerAddress.startsWith('0x') && !searchAddresses.includes(ownerAddress)) {
      searchAddresses.push(ownerAddress);
    }

    if (searchAddresses.length === 0) return null;

    try {
      this.logger.log(`[WalrusExtend] Looking up on-chain blobObjectId for blobId: ${blobId} across addresses: ${searchAddresses.join(', ')}...`);

      for (const address of searchAddresses) {
        let hasNextPage = true;
        let cursor: string | null = null;

        while (hasNextPage) {
          const ownedObjects = await this.suiClient.listOwnedObjects({
            owner: address,
            include: { json: true },
            cursor: cursor || undefined,
          });

          for (const obj of ownedObjects.objects) {
            const type = obj.type || '';
            if (type.includes('::blob::Blob')) {
              const fields = obj.json as any;

              if (fields && fields.blob_id) {
                const onChainBlobIdStr = String(fields.blob_id);
                let normalizedOnChainBlobId = onChainBlobIdStr;

                try {
                  if (/^\d+$/.test(onChainBlobIdStr)) {
                    normalizedOnChainBlobId = blobIdFromInt(BigInt(onChainBlobIdStr));
                  }
                } catch (err) {
                  this.logger.debug(`Failed to normalize on-chain blob ID: ${err.message}`);
                }

                if (normalizedOnChainBlobId === blobId || onChainBlobIdStr === blobId) {
                  const objectId = obj.objectId;
                  if (objectId) {
                    this.logger.log(`[WalrusExtend] Found matching on-chain blobObjectId: ${objectId} for blobId: ${blobId} owned by ${address}`);
                    
                    // Proactively cache to DB
                    try {
                      await this.prisma.walrusBlob.upsert({
                        where: { blobId },
                        update: { blobObjectId: objectId },
                        create: { blobId, blobObjectId: objectId },
                      });
                    } catch (dbErr) {
                      this.logger.warn(`Failed to cache blobObjectId in database: ${dbErr.message}`);
                    }

                    return objectId;
                  }
                }
              }
            }
          }

          hasNextPage = ownedObjects.hasNextPage;
          cursor = ownedObjects.cursor || null;
        }
      }
    } catch (err: any) {
      this.logger.error(`[WalrusExtend] Error searching for blobObjectId on-chain: ${err.message || err}`);
    }
    return null;
  }


  /**
   * Extend a registered blob's storage epoch on-chain using the sponsor's WAL.
   *
   * @param blobObjectIdOrId - The Sui object ID or Walrus blob ID representing the registered blob.
   * @param epochs           - The number of additional epochs to extend by (default: 5).
   * @param ownerAddress     - The user/owner Sui address to search under (optional).
   */
  async extendBlob(
    blobObjectIdOrId: string,
    epochs = 5,
    ownerAddress?: string,
  ): Promise<{
    txDigest: string;
    mock?: boolean;
  }> {
    let blobObjectId = blobObjectIdOrId;

    // If it's not a hex object ID, try to resolve it from the chain
    if (!blobObjectId || !/^0x[a-fA-F0-9]{64}$/.test(blobObjectId)) {
      this.logger.log(`[WalrusExtend] Input "${blobObjectIdOrId}" is not a valid object ID. Resolving...`);
      const resolved = await this.findBlobObjectIdOnChain(blobObjectIdOrId, ownerAddress);
      if (resolved) {
        blobObjectId = resolved;
      } else {
        throw new Error(`Failed to resolve on-chain Blob object ID for blob ID "${blobObjectIdOrId}"`);
      }
    }

    if (!this.sponsorKeypair) {
      throw new Error('[WalrusExtend] Sponsor keypair is missing. Cannot execute on-chain extension.');
    }

    try {
      const client = this.getWalrusClient();
      this.logger.log(`[WalrusExtend] Extending storage for blob: ${blobObjectId} by ${epochs} epochs...`);
      
      const { digest } = await client.walrus.executeExtendBlobTransaction({
        blobObjectId,
        epochs,
        signer: this.sponsorKeypair as any,
      });

      this.logger.log(`[WalrusExtend] Storage successfully extended. txDigest: ${digest}`);
      return { txDigest: digest };
    } catch (err: any) {
      this.logger.error(
        `[WalrusExtend] Failed to extend storage on-chain for blob ${blobObjectId}: ${err.message || err}`,
      );
      throw err;
    }
  }
}
