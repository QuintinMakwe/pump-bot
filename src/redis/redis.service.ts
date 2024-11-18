import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: RedisClientType

  constructor(private configService: ConfigService) { }

  async get(key: string): Promise<string> {
    return await this.redisClient.get(key);
  }

  async onModuleInit() {
    console.log('[debug]: redis uri ', `redis://${this.configService.get('REDIS_HOST')}:${this.configService.get('REDIS_PORT')}`)
    this.redisClient = createClient({
      url: `redis://${this.configService.get('REDIS_HOST')}:${this.configService.get('REDIS_PORT')}`,
      password: this.configService.get('REDIS_PASSWORD')
    })

    this.redisClient.on('error', (err) => console.error('❌Redis Client Error', err))

    await this.redisClient.connect();

    console.log('✅Redis client connected!')
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }

  async set(key: string, value: string, options?: { exp?: number, nx?: boolean, px?: number }): Promise<string> {
    const setArgs: any[] = [key, value];
    const redisOptions: any = {};

    if (options?.nx) {
      redisOptions.NX = true;
    }

    if (options?.px !== undefined) {
      redisOptions.PX = options.px;
    } else if (options?.exp !== undefined && options.exp >= 0) {
      redisOptions.PX = options.exp * 1000;
    }

    if (Object.keys(redisOptions).length > 0) {
      setArgs.push(redisOptions);
    }

    console.log('redis set ', setArgs, 'N/B: PX is in milliseconds');
    //@ts-ignore
    return await this.redisClient.set(...setArgs);
  }

  async del(key: string) {
    // console.log('❌ running in delete cache key ', key)
    await this.redisClient.del(key);
  }

  async getKeys(key: string) {
    return await this.redisClient.keys(key)
  }

  multi(): ReturnType<RedisClientType['multi']> {
    return this.redisClient.multi();
  }

  async lpush(key: string, value: string): Promise<number> {
    return await this.redisClient.lPush(key, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    return await this.redisClient.lTrim(key, start, stop);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.redisClient.lRange(key, start, stop);
  }
}
