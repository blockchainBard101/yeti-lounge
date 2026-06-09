import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QuestsService } from './quests.service';

@Controller('quests')
export class QuestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questsService: QuestsService,
  ) {}

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

  @Post('verify-code')
  async verifyCode(
    @Body('suiAddress') suiAddress: string,
    @Body('courseId') courseId: number,
    @Body('code') code: string,
  ) {
    return this.questsService.verifyCode(suiAddress, courseId, code);
  }
}
