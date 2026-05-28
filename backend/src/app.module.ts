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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController, SponsorController, WalrusController],
  providers: [AppService, PrismaService, SponsorService, WalrusService, IndexerService],
})
export class AppModule {}
