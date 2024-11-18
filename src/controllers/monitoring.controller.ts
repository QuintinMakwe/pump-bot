import { Controller, Post, UseGuards, Get } from '@nestjs/common';
import { BlockchainService } from '@src/services/blockchain.service';
import { AuthGuard } from '@src/guard/auth.guard';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { NotificationType } from '@src/types/notification.types';

@Controller('monitoring')
@UseGuards(AuthGuard)
export class MonitoringController {
    constructor(
        private blockchainService: BlockchainService,
        private slackNotificationService: SlackNotificationService
    ) {}

    @Post('start')
    async startMonitoring() {
        const started = await this.blockchainService.startMonitoring();
        if (started) {
            await this.slackNotificationService.notify({
                type: NotificationType.MONITORING_STARTED,
                mintAddress: 'SYSTEM',
                timestamp: Date.now(),
                data: { message: 'Monitoring started' }
            });
        }
        return { success: started };
    }

    @Post('stop')
    async stopMonitoring() {
        const stopped = await this.blockchainService.stopMonitoring();
        if (stopped) {
            await this.slackNotificationService.notify({
                type: NotificationType.MONITORING_STOPPED,
                mintAddress: 'SYSTEM',
                timestamp: Date.now(),
                data: { message: 'Monitoring stopped' }
            });
        }
        return { success: stopped };
    }

    @Get('status')
    getStatus() {
        return {
            isMonitoring: this.blockchainService.getMonitoringStatus()
        };
    }
}
