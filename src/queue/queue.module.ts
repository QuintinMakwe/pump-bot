import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { QUEUE } from '@src/constant';
import { TokenMonitoringProcessor } from '@src/queue/processors/token-monitoring.processor';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { TokenMetricsService } from '@src/services/token-metrics.service';
import { DatabaseService } from '@src/services/database.service';
import { Utils } from '@src/services/util.service';
import { TokenService } from '@src/services/token.service';
import { RedisModule } from '@src/redis/redis.module';

@Module({
    imports: [
        BullModule.forRootAsync({
            useFactory: (configService: ConfigService) => ({
                redis: {
                    host: configService.get('REDIS_HOST'),
                    port: configService.get('REDIS_PORT'),
                    password: configService.get('REDIS_PASSWORD'),
                },
            }),
            inject: [ConfigService],
        }),
        BullModule.registerQueue(
            { name: QUEUE.TOKEN_MONITORING.name },
            { name: QUEUE.TOKEN_ANALYTICS.name },
            { name: QUEUE.NOTIFICATIONS.name }
        ),
        RedisModule
    ],
    providers: [
        TokenMonitoringProcessor,
        TokenMonitoringService,
        SlackNotificationService,
        TokenMetricsService,
        DatabaseService,
        Utils,
        ConfigService, 
        TokenService
    ],
    exports: [
        BullModule, 
        TokenMonitoringProcessor,
        TokenMonitoringService
    ]   
})
export class QueueModule {}
