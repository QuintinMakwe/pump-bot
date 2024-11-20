import { Injectable } from '@nestjs/common';
import { SlackNotificationService } from './slack-notification.service';
import { DatabaseService } from './database.service';
import { FormattedCreateEvent, PositionData, TokenMonitoringStage } from '@src/types/token.types';
import { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { NotificationType } from '@src/types/notification.types';
import { QUEUE } from '@src/constant';
import { TokenMetricsService } from './token-metrics.service';

@Injectable()
export class TokenMonitoringService {
    public readonly INITIAL_MONITORING_DURATION = 600; // 10 minutes
    public readonly POSITION_MONITORING_DURATION = 600; // 10 minutes
    private readonly MONITORING_INTERVAL = 10; // Check every 10 seconds

    constructor(
        private slackNotificationService: SlackNotificationService,
        private tokenMetricsService: TokenMetricsService,
        @InjectQueue(QUEUE.TOKEN_MONITORING.name) private monitoringQueue: Queue,
        private databaseService: DatabaseService
    ) {}

    async startInitialMonitoring(createEvent: FormattedCreateEvent) {
        await this.monitoringQueue.add(QUEUE.TOKEN_MONITORING.processes.INITIAL_MONITORING, {
            mint: createEvent.mint,
            creator: createEvent.creator,
            startTime: Date.now(),
            stage: TokenMonitoringStage.INITIAL,
            attempts: 0
        }, {
            repeat: {
                every: this.MONITORING_INTERVAL * 1000,
                limit: Math.floor(this.INITIAL_MONITORING_DURATION / this.MONITORING_INTERVAL)
            }
        });
    }

    async checkEntryConditions(mintAddress: string): Promise<boolean> {
        const metrics = await this.tokenMetricsService.getTokenMetrics(mintAddress);
        
        // 1. Minimum number of buys (10)
        const hasMinimumBuys = metrics.transactionCount.buys >= 10;
        
        // 2. Buy/Sell ratio (3:1)
        const buyToSellRatio = metrics.transactionCount.sells === 0 ? 
            metrics.transactionCount.buys : 
            metrics.transactionCount.buys / metrics.transactionCount.sells;
        const hasHealthyBuySellRatio = buyToSellRatio >= 3;

        const buySellVolumeRatio = metrics.transactionCount.sellVolume === 0 ? 
            metrics.transactionCount.buyVolume : 
            metrics.transactionCount.buyVolume / metrics.transactionCount.sellVolume;

        const hasHealthyBuySellVolumeRatio = buySellVolumeRatio >= 3;
        
        // 3. Market cap between $6k-$8k
        const hasValidMarketCap = metrics.marketCapUSD >= 6000 && metrics.marketCapUSD <= 8000;
        
        // 4. Minimum volume $3k
        const hasMinimumVolume = metrics.volumeUSD >= 3000;
        
        // 5. Age check (less than 5 minutes)
        const isNewToken = metrics.ageInSeconds <= 300; // 5 minutes
        
        // 6. Top holders concentration check
        const topHoldersPercentage = metrics.topHolders.reduce((sum, holder) => sum + holder.percentage, 0);
        const hasHealthyDistribution = topHoldersPercentage <= 20;
        
        // 7. Holder to volume ratio check
        // Assuming $10 average position size as healthy
        const expectedMinHolders = Math.floor(metrics.volumeUSD / 10);
        const actualHolders = metrics.totalHolders;
        const hasHealthyHolderCount = actualHolders >= expectedMinHolders;


        console.log('Entry Conditions Check:', {
            mintAddress,
            hasMinimumBuys,
            buyToSellRatio,
            hasHealthyBuySellRatio,
            marketCap: metrics.marketCapUSD,
            hasValidMarketCap,
            volume: metrics.volumeUSD,
            hasMinimumVolume,
            ageInSeconds: metrics.ageInSeconds,
            isNewToken,
            topHoldersPercentage,
            hasHealthyDistribution,
            expectedMinHolders,
            actualHolders,
            hasHealthyHolderCount,
            buySellVolumeRatio,
            hasHealthyBuySellVolumeRatio
        });

        // return (
        //     hasMinimumBuys &&
        //     hasHealthyBuySellRatio &&
        //     hasValidMarketCap &&
        //     hasMinimumVolume &&
        //     isNewToken &&
        //     hasHealthyDistribution &&
        //     hasHealthyHolderCount &&
        //     hasHealthyBuySellVolumeRatio
        // );
        return (
            hasMinimumBuys &&
            hasHealthyBuySellRatio
        );
    }

    async startPositionMonitoring(mintAddress: string) {
        const metrics = await this.tokenMetricsService.getTokenMetrics(mintAddress);
        
        await this.monitoringQueue.add(QUEUE.TOKEN_MONITORING.processes.POSITION_MONITORING, {
            mint: mintAddress,
            startTime: Date.now(),
            entryPrice: metrics.currentPrice,
            stage: TokenMonitoringStage.ACTIVE,
            attempts: 0
        } as PositionData, {
            repeat: {
                every: this.MONITORING_INTERVAL * 1000,
                limit: Math.floor(this.POSITION_MONITORING_DURATION / this.MONITORING_INTERVAL)
            }
        });

        await this.slackNotificationService.notify({
            type: NotificationType.ENTRY_SIGNAL,
            mintAddress,
            timestamp: Date.now(),
            data: { 
                message: 'Entry conditions met - Consider entering position',
                entryPrice: metrics.currentPrice, 
                mint: mintAddress,
                creator: metrics.tokenInfo.creator,
                symbol: metrics.tokenInfo.symbol,
                name: metrics.tokenInfo.name
            }
        });
    }

    async checkExitConditions(mintAddress: string, entryPrice: number): Promise<boolean> {
        const metrics = await this.tokenMetricsService.getTokenMetrics(mintAddress);
        const db = await this.databaseService.getDb();
        
        // Get recent trades to check for significant price impact
        const recentTrades = await db.collection('trade_events')
            .find({ 
                mint: mintAddress,
                isBuy: false,
                priceImpact: { $gt: 5 } // 5% or more price impact
            })
            .sort({ timestamp: -1 })
            .limit(1)
            .toArray();

        const hasSellWithHighImpact = recentTrades.length > 0;
        
        // Calculate price change percentage
        const priceChangePercent = ((metrics.currentPrice - entryPrice) / entryPrice) * 100;
        
        // Exit conditions
        const hasReachedProfitTarget = priceChangePercent >= 45;
        const hasReachedStopLoss = priceChangePercent <= -20;

        console.log('Exit condition check: ', {
            hasReachedProfitTarget,
            hasReachedStopLoss,
            hasSellWithHighImpact
        })
        
        if (hasReachedProfitTarget || hasReachedStopLoss || hasSellWithHighImpact) {
            await this.slackNotificationService.notify({
                type: NotificationType.EXIT_SIGNAL,
                mintAddress,
                timestamp: Date.now(),
                data: { 
                    message: `Exit signal triggered:${
                        hasReachedProfitTarget ? ' Profit target reached.' :
                        hasReachedStopLoss ? ' Stop loss triggered.' :
                        ' Large sell detected.'
                    }`,
                    exitPrice: metrics.currentPrice,
                    priceChangePercent,
                    hasSellWithHighImpact, 
                    mint: mintAddress,
                    creator: metrics.tokenInfo.creator,
                    symbol: metrics.tokenInfo.symbol,
                    name: metrics.tokenInfo.name
                }
            });
        }

        return (
            hasReachedProfitTarget ||
            hasReachedStopLoss ||
            hasSellWithHighImpact ||
            metrics.transactionCount.sells > metrics.transactionCount.buys * 1.5 ||
            metrics.devHoldingPercentage > 80 ||
            metrics.volumeUSD < 0.05
        );
    }
}
