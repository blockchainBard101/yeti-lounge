import {
  Controller,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { WalrusService } from './walrus.service';

/**
 * WalrusController — proxies Walrus blob registration through the sponsor wallet.
 *
 * POST /walrus/register
 *   Accepts raw file bytes (base64), registers blob using sponsor's WAL tokens,
 *   uploads slivers via upload relay, and returns blob info for frontend to certify.
 */
@Controller('walrus')
export class WalrusController {
  constructor(private readonly walrusService: WalrusService) {}

  @Post('register')
  async registerBlob(
    @Body()
    body: {
      /** Base64-encoded raw file bytes */
      blobBase64: string;
      /** The user's Sui address — blob ownership is transferred here */
      userAddress: string;
      /** Number of storage epochs (default: 5) */
      epochs?: number;
      /** Whether the blob should be deletable (default: false) */
      deletable?: boolean;
    },
  ) {
    const { blobBase64, userAddress, epochs = 5, deletable = false } = body;

    if (!blobBase64) {
      throw new BadRequestException('Missing blobBase64 in request body');
    }
    if (!userAddress?.startsWith('0x')) {
      throw new BadRequestException('Missing or invalid userAddress');
    }

    try {
      return await this.walrusService.registerBlob(
        blobBase64,
        userAddress,
        epochs,
        deletable,
      );
    } catch (err) {
      throw new BadRequestException(`Walrus registration failed: ${err.message}`);
    }
  }

  @Post('register-quilt')
  async registerQuilt(
    @Body()
    body: {
      entries: { blobBase64: string; identifier: string; tags?: Record<string, string> }[];
      userAddress: string;
      epochs?: number;
      deletable?: boolean;
    },
  ) {
    const { entries, userAddress, epochs = 5, deletable = false } = body;

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      throw new BadRequestException('Missing or empty entries array in request body');
    }
    if (!userAddress?.startsWith('0x')) {
      throw new BadRequestException('Missing or invalid userAddress');
    }

    try {
      return await this.walrusService.registerQuilt(
        entries,
        userAddress,
        epochs,
        deletable,
      );
    } catch (err) {
      throw new BadRequestException(`Walrus quilt registration failed: ${err.message}`);
    }
  }
}
