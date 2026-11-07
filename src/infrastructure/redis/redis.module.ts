import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { KYC_WEBHOOK_QUEUE_NAME } from '../../common/constants/kyc.constants';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const KYC_QUEUE = Symbol('KYC_QUEUE');
export const REDIS_CONFIG = Symbol('REDIS_CONFIG');

export interface KycRedisConfig {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CONFIG,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): KycRedisConfig => {
        const rawUrl =
          configService.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379';
        const redisUrl = new URL(rawUrl);

        return {
          host: redisUrl.hostname || '127.0.0.1',
          port: Number(redisUrl.port || 6379),
          password: redisUrl.password || undefined,
          maxRetriesPerRequest: null,
        };
      },
    },
    {
      provide: REDIS_CLIENT,
      inject: [REDIS_CONFIG],
      useFactory: (config: KycRedisConfig): Redis => {
        return new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          maxRetriesPerRequest: config.maxRetriesPerRequest,
        });
      },
    },
    {
      provide: KYC_QUEUE,
      inject: [REDIS_CONFIG],
      useFactory: (config: KycRedisConfig): Queue => {
        return new Queue(KYC_WEBHOOK_QUEUE_NAME, {
          connection: {
            host: config.host,
            port: config.port,
            password: config.password,
            maxRetriesPerRequest: config.maxRetriesPerRequest,
          },
        });
      },
    },
  ],
  exports: [REDIS_CLIENT, KYC_QUEUE, REDIS_CONFIG],
})
export class RedisModule {}
