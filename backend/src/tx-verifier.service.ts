import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { PrismaService } from './prisma.service';

@Injectable()
export class TxVerifierService {
  private readonly logger = new Logger(TxVerifierService.name);
  private suiClient: SuiGrpcClient;
  private treasuryAddress: string = '';

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });

    // Derive treasury address from SPONSOR_WALLET_KEY
    const privateKey = this.configService.get<string>('SPONSOR_WALLET_KEY');
    if (privateKey && privateKey !== 'suiprivkey123...placeholder') {
      try {
        const { secretKey } = decodeSuiPrivateKey(privateKey);
        const keypair = Ed25519Keypair.fromSecretKey(secretKey);
        this.treasuryAddress = keypair.getPublicKey().toSuiAddress();
        this.logger.log(`[TxVerifier] Derived treasury address: ${this.treasuryAddress}`);
      } catch (err) {
        this.logger.error('[TxVerifier] Failed to parse treasury key:', err);
      }
    }
  }

  async verifyPayment(
    txDigest: string,
    userAddress: string,
    requiredAmountLofi: number,
    purpose: string,
  ): Promise<boolean> {
    if (!txDigest) {
      throw new BadRequestException('Transaction digest is required for this request.');
    }

    // 1. Check double spend
    const existing = await this.prismaService.usedTransaction.findUnique({
      where: { digest: txDigest },
    });
    if (existing) {
      throw new BadRequestException('Transaction digest has already been used.');
    }

    // 2. Fetch transaction from chain
    let txData: any;
    try {
      txData = await this.suiClient.getTransaction({
        digest: txDigest,
        include: { effects: true, balanceChanges: true },
      });
    } catch (err: any) {
      throw new BadRequestException(`Could not fetch transaction from chain: ${err.message}`);
    }

    const onChainTx = txData.$kind === 'Transaction' ? txData.Transaction : txData.FailedTransaction;
    if (!onChainTx || !onChainTx.effects?.status?.success) {
      throw new BadRequestException('On-chain transaction did not succeed.');
    }

    // 3. Verify recipient and amount in balanceChanges
    const changes = onChainTx.balanceChanges || [];
    const lofiCoinType = this.configService.get<string>('LOFI_COIN_TYPE') || '0x2::sui::SUI';
    
    const treasuryChange = changes.find((c: any) => {
      const ownerAddr = c.owner?.AddressOwner || '';
      return ownerAddr.toLowerCase() === this.treasuryAddress.toLowerCase() &&
             c.coinType === lofiCoinType &&
             BigInt(c.amount) > 0n;
    });

    if (!treasuryChange) {
      throw new BadRequestException(`No valid transfer to treasury address ${this.treasuryAddress} found in transaction.`);
    }

    const amountReceived = Number(treasuryChange.amount) / 1_000_000_000;
    if (amountReceived < requiredAmountLofi - 0.001) {
      throw new BadRequestException(`Insufficient payment amount. Required: ${requiredAmountLofi} LOFI, Received: ${amountReceived} LOFI.`);
    }

    // 4. Lock transaction in database
    await this.prismaService.usedTransaction.create({
      data: {
        digest: txDigest,
        purpose,
      },
    });

    this.logger.log(`[TxVerifier] Successfully verified and locked payment of ${amountReceived} LOFI (digest: ${txDigest}) for ${purpose}`);
    return true;
  }
}
