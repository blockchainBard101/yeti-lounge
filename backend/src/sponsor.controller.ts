import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { SponsorService } from './sponsor.service';

@Controller()
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) {}

  @Post('sponsored/execute')
  async sponsor(
    @Body() body: { txBytes: string; senderAddress: string },
  ) {
    const { txBytes, senderAddress } = body;
    if (!txBytes || !senderAddress) {
      throw new BadRequestException('Missing txBytes or senderAddress in request body');
    }

    try {
      return await this.sponsorService.sponsorTransaction(txBytes, senderAddress);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * POST /user/welcome-drip
   *
   * Called by the frontend immediately after a user's first zkLogin sign-in.
   * Sends a one-time 0.05 SUI drip to the user's address to fund Walrus gas.
   * Safe to call on every login — idempotent (skips if already funded).
   */
  @Post('user/welcome-drip')
  async welcomeDrip(
    @Body() body: { address: string },
  ) {
    const { address } = body;
    if (!address) {
      throw new BadRequestException('Missing address in request body');
    }

    try {
      return await this.sponsorService.welcomeDrip(address);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }
}
