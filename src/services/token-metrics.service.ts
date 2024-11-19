import { Injectable } from '@nestjs/common';
import { COINGECKO_SOL_PRICE_URL } from '@src/constant';
import { DatabaseService } from '@src/services/database.service';
import { TokenMetrics } from '@src/types/token.types';
import { firstValueFrom } from 'rxjs';
import { Utils } from '@src/services/util.service';
import { TokenService } from '@src/services/token.service';
import { RedisService } from '@src/redis/redis.service';

@Injectable()
export class TokenMetricsService {
    constructor(
        private databaseService: DatabaseService,
        private utils: Utils,
        private tokenService: TokenService,
        private redisService: RedisService
    ) {}

    private async getSolPrice(): Promise<number> {
        const CACHE_KEY = 'sol_price'; 
        const CACHE_DURATION = 1800; // 30 minutes

        try {
            const cachedPrice = await this.redisService.get(CACHE_KEY);
            if (cachedPrice) {
                return parseFloat(cachedPrice);
            }

            const response = await firstValueFrom(
                this.utils.getHttpservice().get(COINGECKO_SOL_PRICE_URL)
            );

            //@ts-ignore
            const price = response.data.solana.usd;
            
            await this.redisService.set(
                CACHE_KEY, 
                price.toString(), 
                { exp: CACHE_DURATION }
            );

            return price;
        } catch (error) {
            console.error('Error fetching SOL price:', error)
            return 243;
        }
    }

    async getTokenMetrics(mintAddress: string): Promise<TokenMetrics> {
        const [solPrice, db, now] = await Promise.all([
            this.getSolPrice(),
            this.databaseService.getDb(),
            Promise.resolve(Date.now())
        ]);

        const [transactionCounts] = await db.collection('trade_events').aggregate([
            { $match: { mint: mintAddress } },
            {
                $group: {
                    _id: null,
                    buys: { $sum: { $cond: [{ $eq: ['$isBuy', true] }, 1, 0] } },
                    sells: { $sum: { $cond: [{ $eq: ['$isBuy', false] }, 1, 0] } },
                    totalVolume: { $sum: '$solAmount' }
                }
            }
        ]).toArray();

        const latestTrade = await db.collection('trade_events')
            .findOne({ mint: mintAddress }, { sort: { timestamp: -1 } });

        const createEvent = await db.collection('create_events').findOne({ mint: mintAddress });
        
        if (!createEvent) {
            throw new Error(`No create event found for mint ${mintAddress}`);
        }

        const priceInSol = latestTrade ? 
            latestTrade.virtualTokenReserves / latestTrade.virtualSolReserves : 
            0;
        
        // Convert SOL values to USD
        const priceInUSD = priceInSol * solPrice;
        const volumeUSD = transactionCounts.totalVolume * solPrice;

        const topHolders = await this.getTopHolders(mintAddress);
        const devHoldingPercentage = await this.calculateDevHolding(
            mintAddress, 
            createEvent.creator
        ); 

        const totalHolders = await this.databaseService.getTokenHolders(mintAddress);

        return {
            transactionCount: { buys: transactionCounts.buys, sells: transactionCounts.sells },
            devHoldingPercentage,
            marketCapUSD: priceInUSD * volumeUSD,
            ageInSeconds: Math.floor((now - createEvent.timestamp.getTime()) / 1000),
            volumeUSD,
            topHolders,
            currentPrice: priceInUSD, 
            totalHolders: totalHolders.length
        };
    }

    private async getTopHolders(mintAddress: string) {
        const [holders, totalSupply] = await Promise.all([
            this.databaseService.getTokenHolders(mintAddress),
            this.tokenService.getTokenSupply(mintAddress)
        ]);
        
        if (totalSupply === 0) return [];
        
        return holders.slice(0, 10).map(holder => ({
            address: holder.holder,
            percentage: (holder.balance / totalSupply) * 100
        }));
    }

    private async calculateDevHolding(mintAddress: string, creatorAddress: string): Promise<number> {
        const [creatorHolding, totalSupply] = await Promise.all([
            this.databaseService.getCreatorHolding(mintAddress, creatorAddress),
            this.tokenService.getTokenSupply(mintAddress)
        ]);

        if (!creatorHolding || totalSupply === 0) return 0;
        return (creatorHolding / totalSupply) * 100;
    }
}
