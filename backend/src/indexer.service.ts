import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SuiClient } from '@mysten/sui/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private suiClient: SuiClient;
  private intervalId: NodeJS.Timeout | null = null;
  private packageId: string = '0x_placeholder_package_id';

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {
    const rpcUrl = this.configService.get<string>('SUI_RPC_URL') || 'https://fullnode.testnet.sui.io:443';
    this.suiClient = new SuiClient({ url: rpcUrl });
  }

  async onModuleInit() {
    this.logger.log('Starting Yeti Lounge event indexer...');
    
    // Start interval-based indexing every 10 seconds
    this.intervalId = setInterval(() => {
      this.indexEvents().catch((err) => {
        this.logger.error('Failed to run index events loop:', err);
      });
    }, 10000);
  }

  async onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private async indexEvents() {
    if (this.packageId === '0x_placeholder_package_id') {
      // Mock indexing logs in terminal since no Move package is deployed yet
      this.logger.debug('Waiting for a deployed Move package ID to begin on-chain indexing.');
      return;
    }

    try {
      this.logger.log(`Querying events for package: ${this.packageId}`);
      
      // Query events emitted by our package
      const events = await this.suiClient.queryEvents({
        query: { MoveModule: { package: this.packageId, module: 'profile' } },
        limit: 20,
        order: 'ascending',
      });

      for (const event of events.data) {
        const type = event.type;
        const parsedJson = event.parsedJson as any;

        if (type.endsWith('::ProfileCreated')) {
          const { owner, suins_handle, avatar_blob_id, bio } = parsedJson;
          
          await this.prismaService.user.upsert({
            where: { suiAddress: owner },
            update: { suinsHandle: suins_handle, avatarBlobId: avatar_blob_id, bio },
            create: { suiAddress: owner, suinsHandle: suins_handle, avatarBlobId: avatar_blob_id, bio },
          });
          
          this.logger.log(`Indexed ProfileCreated for user: ${owner}`);
        }
      }
    } catch (err) {
      this.logger.error('Error fetching Sui events:', err);
    }
  }

  // Helper method to set package ID once contracts are deployed
  setPackageId(newPackageId: string) {
    this.packageId = newPackageId;
    this.logger.log(`Indexer package target updated to: ${newPackageId}`);
  }
}
