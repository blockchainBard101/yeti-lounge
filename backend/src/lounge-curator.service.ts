import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { WalrusService } from './walrus.service';

const CURATOR_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000c01';

@Injectable()
export class LoungeCuratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoungeCuratorService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walrusService: WalrusService,
  ) {}

  onModuleInit() {
    this.logger.log('Lounge Curator background agent initialized (autonomous curation cycles are currently disabled).');
    // Run curation check once after startup, then run every 120 seconds
    // setTimeout(() => {
    //   this.runCuration().catch((err) => this.logger.error('Failed to run initial curation check:', err));
    // }, 15000); // 15s delay after start to allow startup/indexing to settle

    // this.timer = setInterval(() => {
    //   this.runCuration().catch((err) => this.logger.error('Failed to run periodic curation check:', err));
    // }, 120000); // 120 seconds cycle
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Run curation check, build a markdown report, upload it to Walrus,
   * and post a community digest link in the feed.
   */
  async runCuration() {
    this.logger.log('Starting autonomous curation cycle...');
    try {
      // 1. Ensure Curator user profile exists in database
      await this.prisma.user.upsert({
        where: { suiAddress: CURATOR_ADDRESS },
        update: { suinsHandle: 'Yeti Curator 🏔️' },
        create: {
          suiAddress: CURATOR_ADDRESS,
          suinsHandle: 'Yeti Curator 🏔️',
          bio: 'Autonomous curator agent for Yeti Lounge.',
          flurriesBalance: 10000,
          isVerified: true,
        },
      });

      // 2. Fetch recent posts from feed (excluding curator's own previous digests)
      const recentPosts = await this.prisma.post.findMany({
        where: {
          authorAddress: {
            not: CURATOR_ADDRESS,
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { author: true },
      });

      if (recentPosts.length === 0) {
        this.logger.log('No recent community posts found to curate. Skipping cycle.');
        return;
      }

      // 3. Draft a beautiful markdown ledger/artifact
      const dateStr = new Date().toUTCString();
      let ledger = `# Yeti Lounge Verified Ledger\n\n`;
      ledger += `*Generated autonomously by the Lounge Curator Agent on ${dateStr}*\n\n`;
      
      ledger += `## 🏂 Active Lounge Members\n`;
      const authors = Array.from(
        new Set(recentPosts.map((p) => p.author?.suinsHandle || p.authorAddress)),
      );
      ledger += authors.map((a) => `- ${a}`).join('\n') + '\n\n';

      ledger += `## 🔥 Hot Topics & Trending Content\n`;
      const highlights = recentPosts
        .map((p) => {
          const snippet = p.textContent.length > 70 ? p.textContent.slice(0, 70) + '...' : p.textContent;
          const authorName = p.author?.suinsHandle || `${p.authorAddress.slice(0, 6)}...${p.authorAddress.slice(-4)}`;
          return `- **${authorName}**: "${snippet}" (Likes: ${p.likes}, Tips: ${p.tipsReceived.toString()} MIST)`;
        })
        .join('\n');
      ledger += highlights + '\n\n';

      // Compute statistics
      const totalLikes = recentPosts.reduce((sum, p) => sum + p.likes, 0);
      const totalTipsMist = recentPosts.reduce((sum, p) => sum + Number(p.tipsReceived), 0);
      const totalTipsSui = totalTipsMist / 1_000_000_000;
      
      ledger += `## 📊 Lounge Stats (Last ${recentPosts.length} posts)\n`;
      ledger += `- Total Likes: ${totalLikes}\n`;
      ledger += `- Total Tips: ${totalTipsSui.toFixed(2)} SUI\n\n`;
      ledger += `*Note: The authenticity of this ledger is verifiably backed by decentralized storage on Walrus.*\n`;

      // 4. Upload markdown ledger to Walrus
      this.logger.log('Uploading markdown ledger to Walrus...');
      const base64Bytes = Buffer.from(ledger).toString('base64');
      const uploadRes = await this.walrusService.registerBlob(base64Bytes, CURATOR_ADDRESS);
      
      this.logger.log(`Ledger uploaded successfully. Blob ID: ${uploadRes.blobId}`);

      // 5. Curation ledger created and logged (no community feed post)
      this.logger.log(`Curated ledger created successfully. Verification Blob ID: ${uploadRes.blobId}`);
    } catch (err: any) {
      this.logger.error(`Curation cycle failed: ${err.message || err}`, err.stack);
    }
  }
}
