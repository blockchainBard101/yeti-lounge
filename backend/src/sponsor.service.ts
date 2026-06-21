import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { PrismaService } from './prisma.service';
import { SuinsClient, SuinsTransaction } from '@mysten/suins';

/** 0.05 SUI in MIST — covers ~50 Walrus uploads at ~0.001 SUI gas each */
const WELCOME_DRIP_MIST = 50_000_000n;

/**
 * Minimum balance (MIST) before we top up.
 * If user already has ≥ this amount we skip the drip.
 */
const MIN_BALANCE_MIST = 10_000_000n; // 0.01 SUI

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);
  private suiClient: SuiGrpcClient;
  private graphqlClient: SuiGraphQLClient;
  private sponsorKeypair: Ed25519Keypair | null = null;
  private suinsClient: SuinsClient;

  /**
   * In-memory set of addresses that have already received the welcome drip.
   * In production, replace this with a DB column or Redis SET.
   */
  private readonly dripRegistry = new Set<string>();

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {
    const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });
    this.graphqlClient = new SuiGraphQLClient({
      network: 'testnet',
      url: 'https://graphql.testnet.sui.io/graphql',
    });

    this.suinsClient = new SuinsClient({
      client: this.suiClient as any,
      network: 'testnet',
    });

    const privateKey = this.configService.get<string>('SPONSOR_WALLET_KEY');
    if (privateKey && privateKey !== 'suiprivkey123...placeholder') {
      try {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        this.sponsorKeypair = Ed25519Keypair.fromSecretKey(secretKey);
        this.logger.log('Sponsor wallet loaded successfully.');
      } catch (err) {
        this.logger.error('Failed to parse sponsor private key:', err);
      }
    } else {
      this.logger.warn('Sponsor private key is using placeholder values. Sponsorship will be mocked.');
    }
  }
  async sponsorTransaction(txBytes: string, sender: string, useLocalSponsor = false) {
    // If useLocalSponsor is true and we have a local keypair, sponsor it directly.
    // This allows arbitrary token sending without Enoki's allow-list limits.
    if (useLocalSponsor && this.sponsorKeypair) {
      try {
        const sponsorAddress = this.sponsorKeypair.getPublicKey().toSuiAddress();
        this.logger.log(`[LocalSponsor] Sponsoring transaction for ${sender} using backend wallet: ${sponsorAddress}`);

        // 1. Recreate transaction from Kind bytes
        const tx = Transaction.fromKind(Buffer.from(txBytes, 'base64'));
        tx.setSender(sender);
        tx.setGasOwner(sponsorAddress);

        // 2. Fetch sponsor's SUI coins for gas
        const coinsRes: any = await this.suiClient.listCoins({
          owner: sponsorAddress,
          coinType: '0x2::sui::SUI',
        });

        const coinsList = coinsRes?.objects || coinsRes?.data || [];
        if (coinsList.length === 0) {
          throw new Error('Sponsor wallet has no SUI coins to cover gas');
        }

        // 3. Set sponsor's gas coins as gas payment
        tx.setGasPayment(coinsList.map((c: any) => ({
          objectId: c.coinObjectId || c.objectId,
          version: c.version,
          digest: c.digest,
        })));

        tx.setGasBudget(15_000_000); // 0.015 SUI gas budget limit

        // 4. Build transaction
        const builtBytes = await tx.build({ client: this.suiClient as any });

        // 5. Sign transaction bytes with sponsor keypair
        const { signature } = await this.sponsorKeypair.signTransaction(builtBytes);
        this.logger.log(`[LocalSponsor] Signature generated: ${signature ? signature.slice(0, 15) : 'undefined'}...`);

        return {
          bytes: Buffer.from(builtBytes).toString('base64'),
          signature,
          digest: '', // not used for local execution
          localSponsor: true
        };
      } catch (localErr: any) {
        this.logger.error('[LocalSponsor] Failed local sponsorship, falling back to Enoki:', localErr);
      }
    }

    const apiKey = this.configService.get<string>('ENOKI_API_KEY');
    try {
      this.logger.log(`[EnokiSponsor] Requesting Enoki transaction sponsorship for sender: ${sender}`);
      const response = await fetch('https://api.enoki.mystenlabs.com/v1/transaction-blocks/sponsor', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          network: 'testnet',
          sender,
          transactionBlockKindBytes: txBytes,
        }),
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`Enoki sponsor API returned error: ${errorMsg}`);
      }

      const json = await response.json();
      const data = json.data;
      if (!data) {
        throw new Error(`Enoki response missing data object: ${JSON.stringify(json)}`);
      }
      this.logger.log(`[EnokiSponsor] Successfully sponsored transaction. Digest: ${data.digest}`);
      return {
        bytes: data.bytes || data.transactionBytes,
        digest: data.digest,
      };
    } catch (err) {
      this.logger.error('Failed to sponsor transaction via Enoki:', err);
      throw new Error(`Enoki sponsorship failed: ${err.message}`);
    }
  }

  async executeTransaction(digest: string, signature: string) {
    const apiKey = this.configService.get<string>('ENOKI_API_KEY');
    try {
      this.logger.log(`[EnokiExecute] Submitting user signature to execute transaction. Digest: ${digest}`);
      const response = await fetch(`https://api.enoki.mystenlabs.com/v1/transaction-blocks/sponsor/${digest}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signature,
        }),
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`Enoki execute API returned error: ${errorMsg}`);
      }

      const json = await response.json();
      const data = json.data;
      if (!data) {
        throw new Error(`Enoki response missing data object: ${JSON.stringify(json)}`);
      }
      this.logger.log(`[EnokiExecute] Transaction execution successful. Digest: ${data.digest}`);
      return {
        txDigest: data.digest,
        success: true,
      };
    } catch (err) {
      this.logger.error('Failed to execute transaction via Enoki:', err);
      throw new Error(`Enoki execution failed: ${err.message}`);
    }
  }

  /**
   * Welcome drip — sends a one-time SUI gift to a new user's zkLogin address.
   *
   * This funds gas for Walrus blob registration + certification transactions
   * which the Walrus SDK executes internally (cannot be externally sponsored).
   *
   * @param recipientAddress - The user's Sui address (from Enoki zkLogin)
   * @returns { funded: boolean, digest?: string, message: string }
   */
  async welcomeDrip(recipientAddress: string) {
    // Validate address format
    if (!recipientAddress?.startsWith('0x') || recipientAddress.length < 10) {
      throw new Error('Invalid Sui address');
    }

    if (!this.sponsorKeypair) {
      this.logger.warn(`[WelcomeDrip] Mocking drip to ${recipientAddress} (no sponsor key).`);
      this.dripRegistry.add(recipientAddress);
      return {
        funded: true,
        digest: '0xmock_drip_' + Math.random().toString(36).substring(7),
        message: 'Mock drip sent (dev mode)',
      };
    }

    // Idempotency: skip if already dripped to this address
    if (this.dripRegistry.has(recipientAddress)) {
      return { funded: false, message: 'Address already received welcome drip' };
    }

    // Balance check: skip if user already has enough SUI
    try {
      const balanceRes = await this.graphqlClient.query({
        query: `
          query GetBalance($owner: SuiAddress!) {
            address(address: $owner) {
              balance(type: "0x2::sui::SUI") {
                totalBalance
              }
            }
          }
        `,
        variables: {
          owner: recipientAddress,
        },
      });

      const totalBalanceStr = (balanceRes.data as any)?.address?.balance?.totalBalance;
      const currentBalance = totalBalanceStr ? BigInt(totalBalanceStr) : 0n;

      if (currentBalance >= MIN_BALANCE_MIST) {
        this.dripRegistry.add(recipientAddress);
        return {
          funded: false,
          message: `Address already has ${currentBalance} MIST — drip skipped`,
        };
      }
    } catch (_) {
      // If balance check fails (new address with no objects), proceed with drip
    }

    // Build and execute the transfer
    try {
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [WELCOME_DRIP_MIST]);
      tx.transferObjects([coin], recipientAddress);
      tx.setGasBudget(5_000_000); // 0.005 SUI gas budget for the transfer

      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: this.sponsorKeypair,
      });

      let digest = '';
      if ('Transaction' in result && result.Transaction?.digest) {
        digest = result.Transaction.digest;
      } else if ('FailedTransaction' in result && result.FailedTransaction?.digest) {
        digest = result.FailedTransaction.digest;
      } else if ('digest' in result) {
        digest = (result as any).digest;
      }

      this.dripRegistry.add(recipientAddress);

      this.logger.log(
        `[WelcomeDrip] Sent ${WELCOME_DRIP_MIST} MIST to ${recipientAddress}. Digest: ${digest}`,
      );

      return {
        funded: true,
        digest,
        message: `Welcome! Sent 0.05 SUI for gas to your account.`,
      };
    } catch (err) {
      this.logger.error(`[WelcomeDrip] Failed to drip to ${recipientAddress}:`, err);
      throw new Error(`Welcome drip failed: ${err.message}`);
    }
  }

  /**
   * Resolve the YetiProfile object ID for a given owner address.
   *
   * Queries the Sui GraphQL API for objects of type YetiProfile owned by the
   * address. Returns the object ID (as a 0x-prefixed string) so the frontend
   * can pass the correct profile to create_post_entry.
   *
   * @param ownerAddress - The user's Sui address
   * @returns { profileObjectId: string }
   */
  async getUserProfile(ownerAddress: string): Promise<{ profileObjectId: string; dbUser: any }> {
    if (!ownerAddress?.startsWith('0x') || ownerAddress.length < 10) {
      throw new Error('Invalid Sui address');
    }

    // ── 1. Fast path: query Postgres (populated by the event indexer) ──────────
    // The indexer listens for ProfileCreated events and stores the profile_id.
    // This is instant and avoids the GraphQL indexing lag entirely.
    const dbUser = await this.prismaService.user.findUnique({
      where: { suiAddress: ownerAddress },
    });

    if (dbUser?.profileObjectId) {
      this.logger.log(`[GetUserProfile] DB hit for ${ownerAddress} → ${dbUser.profileObjectId}`);
      const formattedDbUser = {
        ...dbUser,
        tipsReceived: dbUser.tipsReceived.toString(),
      };
      return { profileObjectId: dbUser.profileObjectId, dbUser: formattedDbUser };
    }

    // ── 2. Slow path: fall back to GraphQL for pre-existing / non-indexed users ─
    // This handles users who created their profile before this migration,
    // or the rare case where the indexer hasn't caught up yet.
    // We then back-fill the DB so future calls are instant.
    this.logger.warn(`[GetUserProfile] DB miss for ${ownerAddress} — falling back to GraphQL`);

    const packageId =
      this.configService.get<string>('PACKAGE_ID') ||
      '0x50232b6e065801de6d8d56da5692b7b2aad9b00ebd2cdd026f1da8f0ff4ebbf4';

    try {
      const response = await this.graphqlClient.query({
        query: `
          query GetUserProfile($owner: SuiAddress!, $type: String!) {
            address(address: $owner) {
              objects(
                filter: { type: $type }
                first: 1
              ) {
                nodes {
                  address
                }
              }
            }
          }
        `,
        variables: {
          owner: ownerAddress,
          type: `${packageId}::profile::YetiProfile`,
        },
      });

      const nodes = (response.data as any)?.address?.objects?.nodes || [];
      if (nodes.length === 0) {
        throw new NotFoundException(
          `No YetiProfile found for address ${ownerAddress}. Please create a profile first.`,
        );
      }

      const profileObjectId: string = nodes[0].address;
      this.logger.log(`[GetUserProfile] GraphQL resolved ${profileObjectId} for ${ownerAddress} — back-filling DB`);

      // Back-fill the DB so the next call is served from Postgres
      await this.prismaService.user.upsert({
        where: { suiAddress: ownerAddress },
        update: { profileObjectId },
        create: { suiAddress: ownerAddress, profileObjectId },
      });

      const freshDbUser = await this.prismaService.user.findUnique({
        where: { suiAddress: ownerAddress },
      });
      const formattedDbUser = freshDbUser ? {
        ...freshDbUser,
        tipsReceived: freshDbUser.tipsReceived.toString(),
      } : null;

      return { profileObjectId, dbUser: formattedDbUser };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`[GetUserProfile] Failed for ${ownerAddress}:`, err);
      throw new Error(`Failed to resolve profile: ${err.message}`);
    }
  }

  async registerSubdomain(handle: string, recipientAddress: string) {
    if (!this.sponsorKeypair) {
      this.logger.warn(`[registerSubdomain] Mocking subdomain registration for ${handle}.lofilounge.sui (no sponsor key).`);
      try {
        await this.prismaService.user.update({
          where: { suiAddress: recipientAddress },
          data: { claimedSubdomain: `${handle}@lofilounge` },
        });
      } catch (e) {
        this.logger.error('Failed to update mock claimedSubdomain in DB:', e);
      }
      return {
        success: true,
        data: {
          digest: '0xmock_subdomain_' + Math.random().toString(36).substring(7),
          subname: `${handle}.lofilounge.sui`,
        },
      };
    }

    try {
      // 1. Resolve parent domain NameRecord to get the parentNftId
      const parentRecord = await this.suinsClient.getNameRecord('lofilounge.sui');
      if (!parentRecord || !parentRecord.nftId) {
        throw new Error('Parent domain lofilounge.sui not found or has no NFT ID');
      }

      // 2. Build Transaction and SuinsTransaction
      const transaction = new Transaction();
      const suinsTransaction = new SuinsTransaction(this.suinsClient, transaction);

      // 3. Create subname NFT
      const subNameNft = suinsTransaction.createSubName({
        parentNft: parentRecord.nftId,
        name: `${handle}.lofilounge.sui`,
        expirationTimestampMs: Number(parentRecord.expirationTimestampMs),
        allowChildCreation: true,
        allowTimeExtension: true,
      });

      // 4. Transfer the subname NFT to recipient
      transaction.transferObjects([subNameNft], recipientAddress);

      // 5. Sign and execute transaction using sponsorKeypair
      const result = await this.suiClient.signAndExecuteTransaction({
        transaction,
        signer: this.sponsorKeypair,
      });

      let digest = '';
      if ('Transaction' in result && result.Transaction?.digest) {
        digest = result.Transaction.digest;
      } else if ('FailedTransaction' in result && result.FailedTransaction?.digest) {
        digest = result.FailedTransaction.digest;
      } else if ('digest' in result) {
        digest = (result as any).digest;
      }

      this.logger.log(`[registerSubdomain] Subname ${handle}.lofilounge.sui registered. Tx Digest: ${digest}`);

      // 6. Update user in DB
      try {
        await this.prismaService.user.update({
          where: { suiAddress: recipientAddress },
          data: { claimedSubdomain: `${handle}@lofilounge` },
        });
      } catch (e) {
        this.logger.error('Failed to update claimedSubdomain in DB:', e);
      }

      return {
        success: true,
        data: {
          digest,
          subname: `${handle}.lofilounge.sui`,
        },
      };
    } catch (err) {
      this.logger.error('Failed to register subdomain via SuiNS SDK:', err);
      throw new Error(`SuiNS subdomain registration failed: ${err.message}`);
    }
  }

  async getLeaderboard() {
    const users = await this.prismaService.user.findMany({
      orderBy: {
        flurriesBalance: 'desc',
      },
      take: 25,
    });
    return users.map(u => ({
      ...u,
      tipsReceived: u.tipsReceived.toString(),
    }));
  }

  async getGlacierFundDonations() {
    const funds = await this.prismaService.glacierFund.findMany();
    const sum = funds.reduce((acc, curr) => acc + curr.totalDonated, 0n);
    return {
      totalDonated: sum.toString(),
    };
  }

  async getDashboardStats() {
    const totalUsers = await this.prismaService.user.count();
    
    const sumResult = await this.prismaService.user.aggregate({
      _sum: {
        flurriesBalance: true,
      },
    });

    const totalFlurries = sumResult._sum.flurriesBalance ?? 0;
    const totalPosts = await this.prismaService.post.count();

    return {
      activeYetis: totalUsers,
      dailyPoolClaimed: totalFlurries,
      totalPosts,
    };
  }
}
