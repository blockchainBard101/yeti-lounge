import { Controller, Post, Body, Get, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import { SponsorService } from './sponsor.service';

@Controller()
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) {}

  @Post('sponsored/sponsor')
  async sponsor(
    @Body() body: { txBytes: string; senderAddress: string; useLocalSponsor?: boolean },
  ) {
    const { txBytes, senderAddress, useLocalSponsor } = body;
    if (!txBytes || !senderAddress) {
      throw new BadRequestException('Missing txBytes or senderAddress in request body');
    }

    try {
      return await this.sponsorService.sponsorTransaction(txBytes, senderAddress, !!useLocalSponsor);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  @Post('sponsored/execute')
  async execute(
    @Body() body: { digest: string; signature: string },
  ) {
    const { digest, signature } = body;
    if (!digest || !signature) {
      throw new BadRequestException('Missing digest or signature in request body');
    }

    try {
      return await this.sponsorService.executeTransaction(digest, signature);
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

  /**
   * GET /user/profile?address=0x...
   *
   * Returns the YetiProfile object ID for the given Sui address by querying
   * the Sui GraphQL API. The frontend uses this to build the correct
   * create_post_entry transaction with the user's own profile.
   */
  @Get('user/profile')
  async getUserProfile(@Query('address') address: string) {
    if (!address) {
      throw new BadRequestException('Missing address query parameter');
    }
    try {
      return await this.sponsorService.getUserProfile(address);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err.message);
    }
  }

  @Post('user/register-subname')
  async registerSubname(
    @Body() body: { subname: string; address: string },
  ) {
    const { subname, address } = body;
    if (!subname || !address) {
      throw new BadRequestException('Missing subname or address in request body');
    }
    try {
      return await this.sponsorService.registerSubdomain(subname, address);
    } catch (err) {
      throw new BadRequestException(err.message);
    }
  }

  @Get('leaderboard')
  async getLeaderboard() {
    return await this.sponsorService.getLeaderboard();
  }

  @Get('glacier-fund')
  async getGlacierFund() {
    return await this.sponsorService.getGlacierFundDonations();
  }

  @Get('dashboard-stats')
  async getDashboardStats() {
    return await this.sponsorService.getDashboardStats();
  }
}
