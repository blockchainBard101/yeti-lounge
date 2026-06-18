import {
  Controller,
  Post,
  Get,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

/** 1 SUI = 1.25 LOFI (fixed rate for hackathon — replace with AMM later) */
const EXCHANGE_RATE = 1.25;

@Controller('swap')
export class SwapController {
  private readonly logger = new Logger(SwapController.name);
  private suiClient: SuiGrpcClient;
  private treasuryKeypair: Ed25519Keypair | null = null;
  private treasuryAddress: string = '';

  constructor(private configService: ConfigService) {
    const rpcUrl =
      this.configService.get<string>('SUI_RPC_URL') ||
      'https://fullnode.testnet.sui.io:443';

    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });

    const privateKey = this.configService.get<string>('SPONSOR_WALLET_KEY');
    if (privateKey && privateKey !== 'suiprivkey123...placeholder') {
      try {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        this.treasuryKeypair = Ed25519Keypair.fromSecretKey(secretKey);
        this.treasuryAddress = this.treasuryKeypair.getPublicKey().toSuiAddress();
        this.logger.log(`[Swap] Treasury wallet: ${this.treasuryAddress}`);
      } catch (err) {
        this.logger.error('[Swap] Failed to parse treasury key:', err);
      }
    }
  }

  /**
   * Returns the treasury address (so frontend knows where to send tokens)
   * and the current exchange rate.
   */
  @Get('info')
  getSwapInfo() {
    const lofiCoinType =
      this.configService.get<string>('LOFI_COIN_TYPE') || '0x2::sui::SUI';

    return {
      treasuryAddress: this.treasuryAddress,
      exchangeRate: EXCHANGE_RATE,
      lofiCoinType,
    };
  }

  /**
   * Called after the user's on-chain tx has been submitted.
   *
   * 1. Waits briefly for finality
   * 2. Fetches and verifies the tx on-chain
   * 3. Sends return tokens (swapped) from treasury wallet to the user
   */
  @Post('execute')
  async executeSwap(
    @Body()
    body: {
      txDigest: string;
      userAddress: string;
      fromToken: 'SUI' | 'LOFI';
      amount: number;
    },
  ) {
    const { txDigest, userAddress, fromToken, amount } = body;

    if (!txDigest || !userAddress || !fromToken || !(amount > 0)) {
      throw new BadRequestException('Missing required swap fields.');
    }

    if (!this.treasuryKeypair) {
      throw new BadRequestException('Treasury wallet is not configured on the server.');
    }

    const lofiCoinType =
      this.configService.get<string>('LOFI_COIN_TYPE') || '0x2::sui::SUI';

    // ── 1. Wait for chain finality then verify tx ────────────────────────
    this.logger.log(`[Swap] Verifying tx ${txDigest} from ${userAddress}`);
    await new Promise((r) => setTimeout(r, 2500));

    let txData: any;
    try {
      txData = await this.suiClient.getTransaction({
        digest: txDigest,
        include: { effects: true, balanceChanges: true },
      });
    } catch (err) {
      throw new BadRequestException(`Could not fetch transaction from chain: ${err.message}`);
    }

    const onChainTx = txData.$kind === 'Transaction' ? txData.Transaction : txData.FailedTransaction;

    if (!onChainTx.effects?.status?.success) {
      throw new BadRequestException(
        `On-chain transaction did not succeed: ${onChainTx.effects?.status?.error?.message || 'unknown'}`,
      );
    }

    // Verify the treasury actually received something (balance change positive for treasury)
    const changes = onChainTx.balanceChanges || [];
    const treasuryGain = changes.find(
      (c: any) =>
        ((c.address || c.owner?.AddressOwner || '').toLowerCase() === this.treasuryAddress.toLowerCase()) && 
        BigInt(c.amount) > 0n,
    );
    if (!treasuryGain) {
      this.logger.warn(
        `[Swap] Could not confirm treasury received tokens for tx ${txDigest}. Proceeding anyway.`,
      );
    }

    // ── 2. Compute return amount ─────────────────────────────────────────
    const toToken = fromToken === 'SUI' ? 'LOFI' : 'SUI';
    const returnAmount =
      fromToken === 'SUI' ? amount * EXCHANGE_RATE : amount / EXCHANGE_RATE;
    const returnAmountMist = BigInt(Math.floor(returnAmount * 1_000_000_000));

    this.logger.log(
      `[Swap] Sending ${returnAmount} ${toToken} to ${userAddress}`,
    );

    // ── 3. Build and sign the return transfer from treasury ──────────────
    const tx = new Transaction();

    if (toToken === 'SUI' || lofiCoinType === '0x2::sui::SUI') {
      // Send SUI from treasury gas (covers both: LOFI→SUI and demo mode where LOFI is SUI)
      const [coin] = tx.splitCoins(tx.gas, [returnAmountMist]);
      tx.transferObjects([coin], userAddress);
    } else {
      // Send real LOFI coins from treasury wallet
      const lofiCoins = await this.suiClient.listCoins({
        owner: this.treasuryAddress,
        coinType: lofiCoinType,
      });

      if (!lofiCoins.objects.length) {
        throw new BadRequestException(
          'Treasury has no LOFI coins available. Please top up the treasury.',
        );
      }

      // Merge all LOFI coin objects into one, then split the required amount
      const [first, ...rest] = lofiCoins.objects;
      const primaryCoin = tx.object(first.objectId);
      if (rest.length > 0) {
        tx.mergeCoins(
          primaryCoin,
          rest.map((c) => tx.object(c.objectId)),
        );
      }
      const [splitCoin] = tx.splitCoins(primaryCoin, [returnAmountMist]);
      tx.transferObjects([splitCoin], userAddress);
    }

    tx.setGasBudget(10_000_000);

    // ── 4. Execute ────────────────────────────────────────────────────────
    try {
      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: this.treasuryKeypair,
      });

      const returnDigest = (result as any).digest || '';
      this.logger.log(`[Swap] Return tx executed. Digest: ${returnDigest}`);

      return {
        success: true,
        digest: returnDigest,
        returnAmount,
        toToken,
      };
    } catch (err) {
      this.logger.error('[Swap] Failed to execute return transfer:', err);
      throw new BadRequestException(
        `Return transfer failed: ${err.message}. Please contact support with tx ${txDigest}.`,
      );
    }
  }
}
