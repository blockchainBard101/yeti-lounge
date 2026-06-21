import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isAvailable = false;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    this.logger.log(`Initializing Redis client with connection: ${redisUrl}`);

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          // Retry at most 3 times, then stop and fail gracefully
          if (times > 3) {
            this.isAvailable = false;
            this.logger.warn('Redis connection failed permanently. Falling back to DB directly.');
            return null;
          }
          return Math.min(times * 100, 2000);
        },
      });

      this.client.on('connect', () => {
        this.isAvailable = true;
        this.logger.log('Connected to Redis successfully.');
      });

      this.client.on('error', (err) => {
        this.isAvailable = false;
        this.logger.warn(`Redis connection error: ${err.message}`);
      });
    } catch (err: any) {
      this.isAvailable = false;
      this.logger.error(`Failed to initialize Redis client: ${err.message}`);
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable || !this.client) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (err: any) {
      this.logger.warn(`Redis GET failed for key "${key}": ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable || !this.client) {
      return;
    }
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: any) {
      this.logger.warn(`Redis SET failed for key "${key}": ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable || !this.client) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (err: any) {
      this.logger.warn(`Redis DEL failed for key "${key}": ${err.message}`);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.isAvailable || !this.client) {
      return;
    }
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
        this.logger.log(`Invalidated ${keys.length} cache keys matching pattern "${pattern}"`);
      }
    } catch (err: any) {
      this.logger.warn(`Redis DEL pattern "${pattern}" failed: ${err.message}`);
    }
  }
}
