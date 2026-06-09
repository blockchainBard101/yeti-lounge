import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WalrusMemoryService implements OnModuleInit {
  private readonly logger = new Logger(WalrusMemoryService.name);
  private memwalClient: any = null;
  private isMock = false;

  // Simple in-memory storage for mock fallback
  private mockMemories: Array<{ text: string; timestamp: Date }> = [];

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const key = this.configService.get<string>('MEMWAL_PRIVATE_KEY');
    const accountId = this.configService.get<string>('MEMWAL_ACCOUNT_ID');
    const serverUrl = this.configService.get<string>('MEMWAL_SERVER_URL');

    if (!key || key === 'placeholder_private_key') {
      this.logger.warn('MemWal credentials not fully configured or using placeholders. Falling back to local mock memory storage.');
      this.isMock = true;
    } else {
      try {
        // Dynamic import to handle ESM package @mysten-incubation/memwal in CommonJS NestJS environment
        const { MemWal } = await import('@mysten-incubation/memwal');
        this.memwalClient = MemWal.create({
          key,
          accountId: accountId || '0xa07fef847e38ac47e4af9b76e70021e971fb6840317f8c3030b463bf7a5d0a7d',
          serverUrl: serverUrl || 'https://relayer.memory.walrus.xyz',
        });
        this.logger.log('Walrus Memory (MemWal) client initialized successfully.');
      } catch (err: any) {
        this.logger.error(`Failed to initialize MemWal client: ${err.message || err}. Falling back to mock memory storage.`, err.stack);
        this.isMock = true;
      }
    }
  }

  /**
   * Store a memory/fact in Walrus Memory.
   * If mock mode is active, stores it locally in-memory.
   */
  async remember(text: string): Promise<string> {
    if (this.isMock || !this.memwalClient) {
      this.logger.log(`[Mock WalrusMemory] Storing fact in local cache: "${text}"`);
      this.mockMemories.push({ text, timestamp: new Date() });
      return 'mock_job_id_' + Math.random().toString(36).substring(7);
    }

    try {
      this.logger.log(`[WalrusMemory] Remembering fact: "${text}"`);
      const job = await this.memwalClient.remember(text);
      this.logger.log(`[WalrusMemory] Job created: ${job.job_id}. Waiting for completion...`);
      await this.memwalClient.waitForRememberJob(job.job_id);
      this.logger.log(`[WalrusMemory] Job ${job.job_id} completed successfully.`);
      return job.job_id;
    } catch (err: any) {
      this.logger.error(`Failed to store memory: ${err.message || err}. Saving to local mock fallback.`, err.stack);
      this.mockMemories.push({ text, timestamp: new Date() });
      return 'fallback_mock_job_id_' + Math.random().toString(36).substring(7);
    }
  }

  /**
   * Retrieve memories based on a semantic query.
   * In mock mode, performs a simple keyword match over stored local memories.
   */
  async recall(query: string): Promise<any[]> {
    if (this.isMock || !this.memwalClient) {
      this.logger.log(`[Mock WalrusMemory] Recalling query: "${query}" (keyword scan over ${this.mockMemories.length} facts)`);
      const queryLower = query.toLowerCase();
      
      // Simple substring and word stem match
      const matched = this.mockMemories
        .filter((mem) => {
          const textLower = mem.text.toLowerCase();
          if (textLower.includes(queryLower)) return true;
          
          const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
          const memWords = textLower.split(/\s+/).filter(w => w.length > 2);
          
          return queryWords.some(qw => 
            memWords.some(mw => {
              const minLen = Math.min(qw.length, mw.length);
              const checkLen = Math.max(3, Math.min(5, minLen));
              return qw.substring(0, checkLen) === mw.substring(0, checkLen);
            })
          );
        })
        .map((mem) => ({
          text: mem.text,
          score: 1.0, // mock score
        }));

      return matched;
    }

    try {
      this.logger.log(`[WalrusMemory] Recalling query: "${query}"`);
      const result = await this.memwalClient.recall(query);
      return result?.results || [];
    } catch (err: any) {
      this.logger.error(`Failed to recall memories: ${err.message || err}. Falling back to local keyword scan.`, err.stack);
      
      const queryLower = query.toLowerCase();
      return this.mockMemories
        .filter((mem) => mem.text.toLowerCase().includes(queryLower))
        .map((mem) => ({
          text: mem.text,
          score: 0.5,
        }));
    }
  }

  /**
   * Expose the raw MemWal client instance if needed (e.g. for withMemWal AI integration).
   * Returns null if running in mock mode.
   */
  getMemWalClient(): any {
    return this.memwalClient;
  }

  /**
   * Check if running in mock fallback mode.
   */
  isMockMode(): boolean {
    return this.isMock;
  }
}
