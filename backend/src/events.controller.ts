import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getEvents() {
    const events = await this.prisma.event.findMany({
      orderBy: { eventDate: 'asc' },
      include: {
        rsvps: true,
      },
    });

    return events;
  }
}
