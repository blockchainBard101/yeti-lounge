import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiClient } from '@mysten/sui/client';
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
  private suiClient: SuiClient;
  private sponsorKeypair: Ed25519Keypair | null = null;

  /**
   * In-memory set of addresses that have already received the welcome drip.
   * In production, replace this with a DB column or Redis SET.
   */
  private readonly dripRegistry = new Set<string>();

  constructor(private configService: ConfigService) {
    const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiClient({ url: rpcUrl });

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
    if (!this.sponsorKeypair) {
      this.logger.warn('Mocking transaction sponsorship (running with placeholder wallet).');
      return {
        success: true,
        txDigest: '0xmock_digest_' + Math.random().toString(36).substring(7),
        sponsored: true,
      };
    }

    try {
      // 1. Deserialize transaction block
      const tx = Transaction.from(txBytes);

      // 2. Set gas payment to be sponsored
      tx.setSender(sender);
      tx.setGasOwner(this.sponsorKeypair.toSuiAddress());

      // 3. Build the transaction bytes
      const builtTxBytes = await tx.build({ client: this.suiClient });

      // 4. Sign the transaction with sponsor credentials
      const sponsorSignature = await this.sponsorKeypair.signTransaction(builtTxBytes);

      return {
        success: true,
        bytes: Buffer.from(builtTxBytes).toString('base64'),
        sponsorSignature: sponsorSignature.signature,
      };
    } catch (err) {
      this.logger.error('Failed to sponsor transaction:', err);
      throw new Error(`Sponsorship failed: ${err.message}`);
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
      const balanceRes = await this.suiClient.getBalance({
        owner: recipientAddress,
        coinType: '0x2::sui::SUI',
      });
      const currentBalance = BigInt(balanceRes.totalBalance);
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
        options: { showEffects: true },
      });

      this.dripRegistry.add(recipientAddress);

      this.logger.log(
        `[WelcomeDrip] Sent ${WELCOME_DRIP_MIST} MIST to ${recipientAddress}. Digest: ${result.digest}`,
      );

      return {
        funded: true,
        digest: result.digest,
        message: `Welcome! Sent 0.05 SUI for gas to your account.`,
      };
    } catch (err) {
      this.logger.error(`[WelcomeDrip] Failed to drip to ${recipientAddress}:`, err);
      throw new Error(`Welcome drip failed: ${err.message}`);
    }
  }
}
