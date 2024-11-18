// src/services/slack-notification.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { NotificationType, NotificationPayload } from '@src/types/notification.types';
import { TokenState, TokenMonitoringStage } from '@src/types/token.types';

@Injectable()
export class SlackNotificationService {
    private client: WebClient;
    private readonly channelId: string;

    constructor(private configService: ConfigService) {
        this.client = new WebClient(this.configService.get('SLACK_TOKEN'));
        this.channelId = this.configService.get('SLACK_CHANNEL_ID');
    }

    private getEmoji(type: NotificationType): string {
        switch (type) {
            case NotificationType.ENTRY_SIGNAL:
                return '📈';
            case NotificationType.EXIT_SIGNAL:
                return '🚨';
            default:
                return '🤷🏽‍♂️';
        }
    }

    private formatMessage(payload: NotificationPayload): string {
        const emoji = this.getEmoji(payload.type);
        const header = `${emoji} *${payload.type}* ${emoji}`;
        const timestamp = new Date(payload.timestamp).toLocaleString();
        
        let details = '';
        switch (payload.type) {
            case NotificationType.ENTRY_SIGNAL:
                details = this.formatNewTokenMessage(payload.data);
                break;
            case NotificationType.EXIT_SIGNAL:
                details = this.formatExitSignalMessage(payload.data);
                break;
        }

        return `${header}\n*Mint:* \`${payload.mintAddress}\`\n*Time:* ${timestamp}\n${details}`;
    }

    private formatNewTokenMessage(data: any): string {
        return `*Entry Signal:*\n` +
               `• Name: ${data.name}\n` +
               `• Symbol: ${data.symbol}\n` +
               `• Creator: \`${data.creator}\`` +
               `• Mint: \`${data.mint}\``;
    }

    private formatExitSignalMessage(data: any): string {
        return `*Exit Signal:*\n` +
               `• Name: ${data.name}\n` +
               `• Symbol: ${data.symbol}\n` +
               `• Creator: \`${data.creator}\`` +
               `• Mint: \`${data.mint}\``;
    }

    async notify(payload: NotificationPayload): Promise<void> {
        try {
            const message = this.formatMessage(payload);
            await this.client.chat.postMessage({
                channel: this.channelId,
                text: message,
                parse: 'full'
            });
        } catch (error) {
            console.error('Failed to send Slack notification:', error);
        }
    }
}