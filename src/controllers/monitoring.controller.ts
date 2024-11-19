import { Controller, Post, UseGuards, Get, Body } from '@nestjs/common';
import { BlockchainService } from '@src/services/blockchain.service';
import { AuthGuard } from '@src/guard/auth.guard';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { NotificationType } from '@src/types/notification.types';
import { Utils } from '@src/services/util.service';
import {  QuickNodeStreamData } from '@src/types/quicknode.types';
import { isQuickNodeStreamData } from '@src/guard/quicknode.guard';

@Controller('monitoring')
export class MonitoringController {
    constructor(
        private blockchainService: BlockchainService,
        private slackNotificationService: SlackNotificationService,
        private utils: Utils
    ) {}

    @Post('start')
    @UseGuards(AuthGuard)
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
    @UseGuards(AuthGuard)
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

    @Post('stream')
    async handleQuicknodeStream(@Body() body: [QuickNodeStreamData[]]) {
        if (body[0] !== null && !isQuickNodeStreamData(body[0])) {
            console.error('Invalid stream data format:!!');
            return { success: false, error: 'Invalid stream data format' };
        }
        console.log('Processing QuickNode stream data:');
        const [err, data] = await this.utils.makeAsyncCall(
            this.blockchainService.processQuicknodeStreamData(body[0])
        );

        if (err) {
            console.error('Error processing QuickNode stream data:', err);
            return { success: false, error: err?.message };
        }

        return { success: true };
    }

    @Get('status')
    @UseGuards(AuthGuard)
    getStatus() {
        return {
            isMonitoring: this.blockchainService.getMonitoringStatus()
        };
    }
}
