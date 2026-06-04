import { Controller, Get, Query } from '@nestjs/common';
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
}
