import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('quests')
export class QuestsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getQuests(@Query('userAddress') userAddress?: string) {
    const quests = await this.prisma.quest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        completions: userAddress ? {
          where: { suiAddress: userAddress },
        } : false,
      },
    });

    return quests;
  }
}
