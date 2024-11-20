import { Controller, Post, UseGuards, Get, Body } from '@nestjs/common';
import { BlockchainService } from '@src/services/blockchain.service';
import { AuthGuard } from '@src/guard/auth.guard';
import { SlackNotificationService } from '@src/services/slack-notification.service';
import { NotificationType } from '@src/types/notification.types';
import { Utils } from '@src/services/util.service';
import {  QuickNodeStreamData } from '@src/types/quicknode.types';
import {  QuickNodeGuard } from '@src/guard/quicknode.guard';

@Controller('monitoring')
export class MonitoringController {
    constructor(
        private blockchainService: BlockchainService,
        private slackNotificationService: SlackNotificationService,
        private utils: Utils,
        private quickNodeGuard: QuickNodeGuard
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
    async handleQuicknodeStream(@Body() body: QuickNodeStreamData[][]) {
        
        const results = await Promise.all(
            body.map(async batch => {
                if (!batch || !this.quickNodeGuard.isQuickNodeStreamData(batch)) {
                    console.error('Invalid stream data format in batch');
                    // await this.blockchainService.logInvalidData(batch);
                    return { success: false, error: 'Invalid stream data format' };
                }
                return this.blockchainService.processQuicknodeStreamData(batch);
            })
        );

        //@ts-ignore
        const errors = results.filter(result => !result.success);
        if (errors.length > 0) {
            console.error('Errors processing QuickNode stream batches:', errors);
            return { success: false, errors };
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
