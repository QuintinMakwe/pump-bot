import { Module } from '@nestjs/common';
import { AppController } from '@src/controllers/app.controller';
import { AppService } from '@src/app.service';
import { QueueModule } from '@src/queue/queue.module';
import { DatabaseService } from '@src/services/database.service';
import { BlockchainService } from '@src/services/blockchain.service';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { Utils } from '@src/services/util.service';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { BullBoardAuthMiddleware } from '@src/middleware/bullboard-auth.middleware';
import { AuthGuard } from '@src/guard/auth.guard';
import { MonitoringController } from '@src/controllers/monitoring.controller';
import { RedisModule } from '@src/redis/redis.module';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { TokenMetricsService } from '@src/services/token-metrics.service';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@src/redis/redis.service';
import { QUEUE } from './constant';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    QueueModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({  
        PUMP_PROGRAM_ID: Joi.string().required(),
        SOLANA_RPC_URL: Joi.string().required(),
        MONGODB_URI: Joi.string().required(),
        MONGODB_DB_NAME: Joi.string().required(),
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.string().required(),
        REDIS_PASSWORD: Joi.string().required(),
        PORT: Joi.string().required(),
        SLACK_TOKEN: Joi.string().required(),
        SLACK_CHANNEL_ID: Joi.string().required(),
        BULL_BOARD_ADMIN_USER: Joi.string().required(),
        BULL_BOARD_ADMIN_PASS: Joi.string().required(),
        WALLET_PRIVATE_KEY: Joi.string().required(),
      }),
    }),
    RedisModule,
    BullModule.registerQueue({
      name: QUEUE.TOKEN_MONITORING.name,
    }),
  ],
  controllers: [AppController, MonitoringController],
  providers: [
    AppService,
    BlockchainService,
    DatabaseService,
    Utils,
    SlackNotificationService,
    BullBoardAuthMiddleware,
    AuthGuard,
    TokenMetricsService,
    ConfigService,
    RedisService,
    TokenMonitoringService, 
    TokenService
  ]
})
export class AppModule {}
