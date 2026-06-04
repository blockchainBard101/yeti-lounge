import { Controller, Get, Delete, Param, Query, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getFeed(@Query('author') authorAddress?: string) {
    const posts = await this.prisma.post.findMany({
      where: authorAddress ? { authorAddress } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        author: true,
        comments: true,
      },
    });

    return posts.map(p => ({
      ...p,
      tipsReceived: p.tipsReceived.toString(),
      author: p.author ? {
        ...p.author,
        tipsReceived: p.author.tipsReceived.toString(),
      } : null,
    }));
  }

  @Delete(':objectId')
  async deletePost(
    @Param('objectId') objectId: string,
    @Query('callerAddress') callerAddress: string,
  ) {
    const post = await this.prisma.post.findUnique({ where: { objectId } });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.authorAddress !== callerAddress) {
      throw new ForbiddenException('You can only delete your own posts');
    }

    await this.prisma.post.delete({ where: { objectId } });

    return { success: true, deletedObjectId: objectId };
  }
}
