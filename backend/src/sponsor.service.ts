import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

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

  /**
   * In-memory set of addresses that have already received the welcome drip.
   * In production, replace this with a DB column or Redis SET.
   */
  private readonly dripRegistry = new Set<string>();

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });
    this.graphqlClient = new SuiGraphQLClient({
      network: 'testnet',
      url: 'https://graphql.testnet.sui.io/graphql',
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
  async sponsorTransaction(txBytes: string, sender: string) {
    const apiKey = this.configService.get<string>('ENOKI_API_KEY');
    try {
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
  async getUserProfile(ownerAddress: string): Promise<{ profileObjectId: string }> {
    if (!ownerAddress?.startsWith('0x') || ownerAddress.length < 10) {
      throw new Error('Invalid Sui address');
    }

    const packageId =
      process.env.PACKAGE_ID ||
      '0xee0b17b8c784f3a00fe40029e4f2992bc971acde22cf83f8799d1b9731811232';

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
      this.logger.log(`[GetUserProfile] Resolved profile ${profileObjectId} for ${ownerAddress}`);
      return { profileObjectId };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`[GetUserProfile] Failed for ${ownerAddress}:`, err);
      throw new Error(`Failed to resolve profile: ${err.message}`);
    }
  }

  async registerSubdomain(handle: string, recipientAddress: string) {
    const apiKey = this.configService.get<string>('ENOKI_API_KEY');
    try {
      const response = await fetch('https://api.enoki.mystenlabs.com/v1/subnames', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          network: 'testnet',
          domain: 'lofilounge.sui',
          subname: handle,
          address: recipientAddress,
        }),
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`Enoki subnames API returned error: ${errorMsg}`);
      }

      const json = await response.json();
      return {
        success: true,
        data: json.data,
      };
    } catch (err) {
      this.logger.error('Failed to register subdomain via Enoki:', err);
      throw new Error(`Enoki subdomain registration failed: ${err.message}`);
    }
  }
}
