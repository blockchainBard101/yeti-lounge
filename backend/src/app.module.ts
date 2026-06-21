import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { SponsorService } from './sponsor.service';
import { SponsorController } from './sponsor.controller';
import { WalrusService } from './walrus.service';
import { WalrusController } from './walrus.controller';
import { IndexerService } from './indexer.service';
import { FeedController } from './feed.controller';
import { EventsController } from './events.controller';
import { QuestsController } from './quests.controller';
import { QuestsService } from './quests.service';
import { AiController } from './ai.controller';
import { SwapController } from './swap.controller';
import { WalrusMemoryService } from './walrus-memory.service';
import { LoungeCuratorService } from './lounge-curator.service';
import { TxVerifierService } from './tx-verifier.service';
import { ProfileController } from './profile.controller';
import { AuthModule } from './auth/auth.module';
import { RedisService } from './redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
  ],
  controllers: [
    AppController,
    SponsorController,
    WalrusController,
    FeedController,
    EventsController,
    QuestsController,
    AiController,
    SwapController,
    ProfileController,
  ],
  providers: [
    AppService,
    PrismaService,
    SponsorService,
    WalrusService,
    IndexerService,
    WalrusMemoryService,
    LoungeCuratorService,
    QuestsService,
    TxVerifierService,
    RedisService,
  ],
})
export class AppModule {}

