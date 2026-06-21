import { Controller, Post, Body, Logger, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transaction } from '@mysten/sui/transactions';
import { PrismaService } from './prisma.service';
import { TxVerifierService } from './tx-verifier.service';
import { SponsorService } from './sponsor.service';
import { AuthGuard } from './auth/auth.guard';

@Controller('profile')
export class ProfileController {
  private readonly logger = new Logger(ProfileController.name);
  private packageId: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly txVerifierService: TxVerifierService,
    private readonly sponsorService: SponsorService,
    private readonly configService: ConfigService,
  ) {
    this.packageId = this.configService.get<string>('PACKAGE_ID') || '0x50232b6e065801de6d8d56da5692b7b2aad9b00ebd2cdd026f1da8f0ff4ebbf4';
  }

  @Post('verify')
  @UseGuards(AuthGuard)
  async verifyProfile(
    @Req() req: any,
    @Body('txDigest') txDigest: string,
  ) {
    const suiAddress = req.user.suiAddress;
    this.logger.log(`Received verification request for user ${suiAddress} (txDigest: ${txDigest})`);

    if (!txDigest) {
      throw new BadRequestException('Missing txDigest.');
    }

    // 1. Verify payment of 10 LOFI
    await this.txVerifierService.verifyPayment(txDigest, suiAddress, 10, 'profile_verify');

    // 2. Fetch the user's profileObjectId from DB/SponsorService
    const { profileObjectId } = await this.sponsorService.getUserProfile(suiAddress);
    if (!profileObjectId) {
      throw new BadRequestException('No YetiProfile found. Please create a profile first.');
    }

    // 3. Update database isVerified status
    await this.prismaService.user.update({
      where: { suiAddress },
      data: { isVerified: true },
    });

    // 4. Build the on-chain transaction block to verify the profile
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::profile::verify_profile_entry`,
      arguments: [tx.object(profileObjectId)],
    });
    tx.setGasBudget(15_000_000);

    const txBytes = await tx.build();
    const base64TxBytes = Buffer.from(txBytes).toString('base64');

    this.logger.log(`Profile verified in DB and transaction block built for ${suiAddress}`);

    return {
      success: true,
      isVerified: true,
      txBytes: base64TxBytes,
    };
  }
}
