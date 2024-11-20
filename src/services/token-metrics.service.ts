import { Injectable } from '@nestjs/common';
import { COINGECKO_SOL_PRICE_URL } from '@src/constant';
import { DatabaseService } from '@src/services/database.service';
import { TokenMetrics } from '@src/types/token.types';
import { firstValueFrom } from 'rxjs';
import { Utils } from '@src/services/util.service';
import { TokenService } from '@src/services/token.service';
import { RedisService } from '@src/redis/redis.service';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

@Injectable()
export class TokenMetricsService {
    constructor(
        private databaseService: DatabaseService,
        private utils: Utils,
        private tokenService: TokenService,
        private redisService: RedisService
    ) { }

    private async getSolPrice(): Promise<number> {
        const CACHE_KEY = 'sol_price';
        const CACHE_DURATION = 1800; // 30 minutes

        try {
            const cachedPrice = await this.redisService.get(CACHE_KEY);
            if (cachedPrice) {
                return parseFloat(cachedPrice);
            }

            const response = await this.utils.getHttpservice().get(COINGECKO_SOL_PRICE_URL)

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
                    totalVolume: { $sum: '$solAmount' },
                    buyVolume: {
                        $sum: {
                            $cond: [
                                { $eq: ['$isBuy', true] },
                                '$solAmount',
                                0
                            ]
                        }
                    },
                    sellVolume: {
                        $sum: {
                            $cond: [
                                { $eq: ['$isBuy', false] },
                                '$solAmount',
                                0
                            ]
                        }
                    }
                }
            }
        ]).toArray();


        const createEvent = await db.collection('create_events').findOne({ mint: mintAddress });

        if (!createEvent) {
            throw new Error(`No create event found for mint ${mintAddress}`);
        }

        const [bondingCurveState, mintInfo] = await Promise.all([
            this.tokenService.getBondingCurveState(createEvent.bondingCurve),
            this.tokenService.connection.getParsedAccountInfo(new PublicKey(mintAddress))
        ]);

        const tokenDecimals = (mintInfo.value.data as any).parsed.info.decimals;

        const adjustedState = {
            virtualTokenReserves: bondingCurveState.virtualTokenReserves.div(new BN(Math.pow(10, tokenDecimals))).toNumber(),
            virtualSolReserves: bondingCurveState.virtualSolReserves.div(new BN(1e9)).toNumber(),
            realTokenReserves: bondingCurveState.realTokenReserves.div(new BN(Math.pow(10, tokenDecimals))).toNumber(),
            realSolReserves: bondingCurveState.realSolReserves.div(new BN(1e9)).toNumber(),
        };


        const priceInSol = await this.getLatestTradePrice(
            mintAddress,
            createEvent.bondingCurve,
            adjustedState
        );
        const priceInUSD = priceInSol * solPrice;

        const { holders: topHolders, circulatingSupply, totalHolders } = await this.getTopHolders(mintAddress);

        //@ts-ignore
        const marketCapUSD = priceInUSD * circulatingSupply

        const volumeUSD = transactionCounts.totalVolume * solPrice;

        const devHoldingPercentage = await this.calculateDevHolding(
            mintAddress,
            createEvent.creator
        );

        return {
            transactionCount: { buys: transactionCounts.buys, sells: transactionCounts.sells, buyVolume: transactionCounts.buyVolume, sellVolume: transactionCounts.sellVolume },
            devHoldingPercentage,
            marketCapUSD,
            ageInSeconds: Math.floor((now - createEvent.timestamp.getTime()) / 1000),
            volumeUSD,
            topHolders,
            currentPrice: priceInUSD,
            totalHolders,
            tokenInfo: {
                name: createEvent.name,
                symbol: createEvent.symbol,
                creator: createEvent.creator,
                uri: createEvent.uri,
                mint: createEvent.mint,
                bondingCurve: createEvent.bondingCurve,
                user: createEvent.creator
            }
        };
    }

    private async getTopHolders(mintAddress: string): Promise<{ 
        holders: Array<{ address: string; percentage: number }>;
        circulatingSupply: number;
        totalHolders: number;
    }> {
        try {
            const mintInfo = await this.tokenService.connection.getParsedAccountInfo(new PublicKey(mintAddress));
            const tokenDecimals = (mintInfo.value?.data as any).parsed.info.decimals;
            const totalSupply = (mintInfo.value?.data as any).parsed.info.supply / Math.pow(10, tokenDecimals);
    
            const largestAccounts = await this.tokenService.connection.getTokenLargestAccounts(
                new PublicKey(mintAddress)
            );
    
            if (!largestAccounts.value.length) {
                return { holders: [], circulatingSupply: 0, totalHolders: 0 };
            }
    
            const accountInfos = await Promise.all(
                largestAccounts.value.map(account =>
                    this.tokenService.connection.getParsedAccountInfo(account.address)
                )
            );
    
            let circulatingSupply = totalSupply;
            let totalHolders = 0;
    
            // Process all accounts first to get total holders
            const allHolders = accountInfos
                .map((info, index) => {
                    const data = (info.value?.data as any)?.parsed;
                    if (!data) return null;
    
                    const balance = Number(data.info.tokenAmount.uiAmount);
                    if (balance > 0) totalHolders++;
                    
                    const percentage = (balance / totalSupply) * 100;
                    
                    if (data.type === 'account' && data.info.state === 'frozen') {
                        circulatingSupply -= balance;
                    }
    
                    return {
                        address: largestAccounts.value[index].address.toString(),
                        percentage: Number(percentage.toFixed(2))
                    };
                })
                .filter(holder => holder !== null && holder.percentage > 0);
    

            const topHolders = [...allHolders]
                .sort((a, b) => b.percentage - a.percentage)
                .slice(0, 10);
    
            return {
                holders: topHolders,
                circulatingSupply: Math.max(0, circulatingSupply),
                totalHolders
            };
    
        } catch (error) {
            console.error('Error fetching top holders:', error);
            return { holders: [], circulatingSupply: 0, totalHolders: 0 };
        }
    }

    private async __getTopHolders(mintAddress: string) {
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

    private async _getTopHolders(mintAddress: string) {
        const db = await this.databaseService.getDb();

        const createEvent = await db.collection('create_events').findOne({ mint: mintAddress });

        if (!createEvent) {
            throw new Error(`No create event found for mint ${mintAddress}`);
        }


        const signatures = await this.tokenService.connection.getSignaturesForAddress(
            new PublicKey(createEvent.bondingCurve),
            { limit: 1000 }
        );


        const mintInfo = await this.tokenService.connection.getParsedAccountInfo(new PublicKey(mintAddress));
        const tokenDecimals = (mintInfo.value?.data as any).parsed.info.decimals;


        const holderBalances = new Map<string, number>();


        for (const sig of signatures) {
            const tx = await this.tokenService.connection.getTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0
            });

            if (!tx?.meta) continue;


            tx.meta.postTokenBalances?.forEach(balance => {
                if (balance.mint === mintAddress) {
                    const holder = balance.owner;

                    //@ts-ignore
                    const amount = Number(balance.uiAmount);

                    if (amount > 0) {
                        holderBalances.set(holder, amount);
                    } else {
                        holderBalances.delete(holder);
                    }
                }
            });
        }


        const bondingCurveState = await this.tokenService.getBondingCurveState(createEvent.bondingCurve);
        const totalSupply = bondingCurveState.tokenTotalSupply.toNumber() / Math.pow(10, tokenDecimals);


        const holders = Array.from(holderBalances.entries())
            .map(([address, balance]) => ({
                address,
                percentage: (balance / totalSupply) * 100
            }))
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 10);

        return holders;
    }

    private async calculateDevHolding(mintAddress: string, creatorAddress: string): Promise<number> {
        const [creatorHolding, totalSupply] = await Promise.all([
            this.databaseService.getCreatorHolding(mintAddress, creatorAddress),
            this.tokenService.getTokenSupply(mintAddress)
        ]);

        if (!creatorHolding || totalSupply === 0) return 0;
        return (creatorHolding / totalSupply) * 100;
    }

    private async getLatestTradePrice(
        mintAddress: string, 
        bondingCurveAddress: string,
        adjustedState: {
            virtualTokenReserves: number;
            virtualSolReserves: number;
        }
    ): Promise<number> {
        try {
            // Get the most recent signature
            const signatures = await this.tokenService.connection.getSignaturesForAddress(
                new PublicKey(bondingCurveAddress),
                { limit: 1 }
            );

            if (!signatures.length) {
                return this.calculatePriceWithSlippage(0.1, adjustedState);
            }

            const tx = await this.tokenService.connection.getTransaction(signatures[0].signature, {
                maxSupportedTransactionVersion: 0
            });

            if (!tx?.meta) {
                return this.calculatePriceWithSlippage(0.1, adjustedState);
            }

            const preTokenBalance = tx.meta.preTokenBalances?.find(b => b.mint === mintAddress);
            const postTokenBalance = tx.meta.postTokenBalances?.find(b => b.mint === mintAddress);
            
            const relevantAccount = 3  // Bonding curve account index according to the IDL
            const solChange = Math.abs(tx.meta.postBalances[relevantAccount] - tx.meta.preBalances[relevantAccount]) / 1e9;
           
            if (preTokenBalance?.uiTokenAmount && postTokenBalance?.uiTokenAmount && solChange > 0) {

                const tokenChange = Math.abs(
                    Number(postTokenBalance.uiTokenAmount.uiAmount) - 
                    Number(preTokenBalance.uiTokenAmount.uiAmount)
                );
            
                if (tokenChange > 0) {
                    return solChange / tokenChange;
                }
            }

            return this.calculatePriceWithSlippage(0.1, adjustedState);
        } catch (error) {
            console.error('Error getting latest trade price:', error);
            return this.calculatePriceWithSlippage(0.1, adjustedState);
        }
    }

    private calculatePriceWithSlippage(solAmount: number, adjustedState: {
        virtualTokenReserves: number;
        virtualSolReserves: number;
    }): number {
        const INITIAL_TOKENS = adjustedState.virtualTokenReserves;
        const K = INITIAL_TOKENS * adjustedState.virtualSolReserves;
        const B = 30;
        const FEE_BASIS_POINTS = 100;

        const currentSolReserves = adjustedState.virtualSolReserves;
        
        // Base calculation
        const currentTokens = INITIAL_TOKENS - (K / (B + currentSolReserves));
        const tokensAfterTrade = INITIAL_TOKENS - (K / (B + (currentSolReserves + solAmount)));
        const tokenDifference = tokensAfterTrade - currentTokens;

        // Apply fee
        const feeMultiplier = (10000 - FEE_BASIS_POINTS) / 10000;
        const tokenDifferenceWithFee = tokenDifference * feeMultiplier;

        return solAmount / tokenDifferenceWithFee;
    }
}
