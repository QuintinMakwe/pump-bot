import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { QUEUE } from '@src/constant';
import { NotificationType } from '@src/types/notification.types';
import { PositionData } from '@src/types/token.types';

@Processor(QUEUE.TOKEN_MONITORING.name)
export class TokenMonitoringProcessor {
    constructor(
        private tokenMonitoringService: TokenMonitoringService,
        private slackNotificationService: SlackNotificationService
    ) {}

    @Process(QUEUE.TOKEN_MONITORING.processes.INITIAL_MONITORING)
    async handleInitialMonitoring(job: Job) {
        const { mint, startTime, attempts } = job.data;
        const elapsedTime = Date.now() - startTime;

        // Check if we've exceeded monitoring duration
        if (elapsedTime >= this.tokenMonitoringService.INITIAL_MONITORING_DURATION * 1000) {
            await job.queue.removeRepeatableByKey(job.opts.repeat?.key);
            return;
        }

        const meetsConditions = await this.tokenMonitoringService.checkEntryConditions(mint);
        if (meetsConditions) {
            await job.queue.removeRepeatableByKey(job.opts.repeat?.key);
            await this.tokenMonitoringService.startPositionMonitoring(mint);
        }
    }

    @Process(QUEUE.TOKEN_MONITORING.processes.POSITION_MONITORING)
    async handlePositionMonitoring(job: Job<PositionData>) {
        const { mint, startTime, entryPrice } = job.data;
        const elapsedTime = Date.now() - startTime;

        if (elapsedTime >= this.tokenMonitoringService.POSITION_MONITORING_DURATION * 1000) {
            await this.slackNotificationService.notify({
                type: NotificationType.EXIT_SIGNAL,
                mintAddress: mint,
                timestamp: Date.now(),
                data: { message: 'Position monitoring duration exceeded - Consider closing position' }
            });
            await job.queue.removeRepeatableByKey(job.opts.repeat?.key);
            return;
        }

        const shouldExit = await this.tokenMonitoringService.checkExitConditions(mint, entryPrice);
        if (shouldExit) {
            await job.queue.removeRepeatableByKey(job.opts.repeat?.key);
        }
    }
}
