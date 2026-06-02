import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getFeed() {
    const posts = await this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        author: true,
        comments: true,
      },
    });

    return posts;
  }
}
