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
            case NotificationType.MONITORING_STOPPED:
                return '🛑';
            case NotificationType.MONITORING_STARTED:
                return '📡';
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

        return `${header}
                Mint: \`${payload.mintAddress}\`
                Time: ${timestamp}
                ${details}`;
    }

    private formatNewTokenMessage(data: any): string {
        return `\`\`\`
                Name: ${data.name}
                Symbol: ${data.symbol}
                Creator: ${data.creator}
                Mint: ${data.mint}
                Entry Price: ${data.entryPrice}
                Message: ${data.message}
                \`\`\``;
    }

    private formatExitSignalMessage(data: any): string {
        return `\`\`\`
                Name: ${data.name}
                Symbol: ${data.symbol}
                Creator: ${data.creator}
                Mint: ${data.mint}
                Exit Price: ${data.exitPrice}
                Price Change: ${data.priceChangePercent}%
                Has Sell with High Impact: ${data.hasSellWithHighImpact}
                Message: ${data.message}
                \`\`\``;
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