import { Controller, Get, Post, Delete, Param, Query, NotFoundException, ForbiddenException, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { WalrusService } from './walrus.service';
import { AuthGuard } from './auth/auth.guard';
import { RedisService } from './redis.service';

@Controller('feed')
export class FeedController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walrusService: WalrusService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async getFeed(
    @Query('author') authorAddress?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    const cacheKey = `feed:${authorAddress || 'all'}:${includeExpired === 'true'}`;
    const cachedData = await this.redisService.get(cacheKey);
    if (cachedData) {
      try {
        return JSON.parse(cachedData);
      } catch (err) {
        // Fallback to fresh db lookup if JSON is malformed
      }
    }

    const posts = await this.prisma.post.findMany({
      where: authorAddress ? { authorAddress } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        author: true,
        comments: {
          include: {
            author: true,
          },
        },
      },
    });

    // Bulk resolve media blob mappings to retrieve registered storage epochs
    const mediaBlobIds = posts.map((p) => p.mediaBlobId).filter(Boolean) as string[];
    const lookupKeysMap = new Map<string, string[]>();
    const allLookupKeys: string[] = [];

    for (const blobId of mediaBlobIds) {
      const keys = this.getLookupKeys(blobId);
      lookupKeysMap.set(blobId, keys);
      allLookupKeys.push(...keys);
    }

    const mappings = await this.prisma.walrusBlob.findMany({
      where: {
        blobId: { in: allLookupKeys },
      },
    });

    const mappingByBlobId = new Map<string, any>();
    for (const m of mappings) {
      mappingByBlobId.set(m.blobId, m);
    }

    const getPostExpiry = (p: any) => {
      if (!p.mediaBlobId) return { isExpired: false, expiresAt: null };
      
      let epochs = 20; // default 20 epochs
      const keys = lookupKeysMap.get(p.mediaBlobId) || [];
      for (const key of keys) {
        const mapping = mappingByBlobId.get(key);
        if (mapping) {
          epochs = mapping.epochs;
          break;
        }
      }

      // 1 epoch on testnet is 1 day (24 hours)
      const lifespanMs = epochs * 24 * 60 * 60 * 1000;
      const expiresAtDate = new Date(p.createdAt.getTime() + lifespanMs);
      const isExpired = expiresAtDate.getTime() < Date.now();

      return { isExpired, expiresAt: expiresAtDate.toISOString() };
    };

    const filtered = posts.filter((p) => {
      if (includeExpired === 'true') return true;
      const { isExpired } = getPostExpiry(p);
      return !isExpired;
    });

    const result = filtered.map((p) => {
      const { isExpired, expiresAt } = getPostExpiry(p);
      return {
        ...p,
        tipsReceived: p.tipsReceived.toString(),
        isExpired,
        expiresAt,
        author: p.author ? {
          ...p.author,
          tipsReceived: p.author.tipsReceived.toString(),
        } : null,
        comments: p.comments.map((c) => ({
          ...c,
          author: c.author ? {
            ...c.author,
            tipsReceived: c.author.tipsReceived.toString(),
          } : null,
        })),
      };
    });

    await this.redisService.set(cacheKey, JSON.stringify(result), 60); // cache for 60 seconds
    return result;
  }

  private getLookupKeys(mediaBlobId: string): string[] {
    if (!mediaBlobId) return [];
    const keys: string[] = [mediaBlobId];

    if (mediaBlobId.startsWith('patches:')) {
      const patchIds = mediaBlobId.slice('patches:'.length).split('|');
      keys.push(...patchIds);
    }

    const quiltMatch = mediaBlobId.match(/^([A-Za-z0-9_-]+):(\d+)$/);
    if (quiltMatch) {
      keys.push(quiltMatch[1]);
    }

    return keys;
  }

  @Post(':objectId/renew')
  async renewPost(@Param('objectId') objectId: string) {
    const post = await this.prisma.post.findUnique({ where: { objectId } });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Really extend the media walrus storage object if the post has a media blob
    let extendResult: any = null;
    if (post.mediaBlobId) {
      const lookupKeys = this.getLookupKeys(post.mediaBlobId);
      let targetObjectId: string | null = null;

      for (const key of lookupKeys) {
        const mapping = await this.prisma.walrusBlob.findUnique({
          where: { blobId: key },
        });
        if (mapping?.blobObjectId) {
          targetObjectId = mapping.blobObjectId;
          break;
        }
      }

      const queryKey = targetObjectId || lookupKeys[0] || post.mediaBlobId;
      try {
        extendResult = await this.walrusService.extendBlob(queryKey, 5, post.authorAddress);
      } catch (err: any) {
        throw new BadRequestException(`Failed to extend Walrus storage on-chain: ${err.message || err}`);
      }
    }

    const updatedPost = await this.prisma.post.update({
      where: { objectId },
      data: { createdAt: new Date() },
    });

    await this.redisService.delPattern('feed:*');

    return {
      success: true,
      objectId: updatedPost.objectId,
      newCreatedAt: updatedPost.createdAt,
      walrusExtend: extendResult,
    };
  }

  @Delete(':objectId')
  @UseGuards(AuthGuard)
  async deletePost(
    @Req() req: any,
    @Param('objectId') objectId: string,
  ) {
    const callerAddress = req.user.suiAddress;
    const post = await this.prisma.post.findUnique({ where: { objectId } });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorAddress.toLowerCase() !== callerAddress.toLowerCase()) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.prisma.post.delete({ where: { objectId } });

    await this.redisService.delPattern('feed:*');

    return { success: true, deletedObjectId: objectId };
  }
}
