import { Injectable, OnModuleInit } from '@nestjs/common';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import { BorshEventCoder, eventDiscriminator } from "@coral-xyz/anchor";
import { IDL } from "@root/pump.idl";
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@src/redis/redis.service';
import bs58 from 'bs58';
import { DatabaseService } from './database.service';
import { FormattedTradeEvent, FormattedCreateEvent, TradeEvent, CreateEvent } from '@src/types/token.types';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

@Injectable()
export class BlockchainService implements OnModuleInit {
    private connection: Connection;
    private wallet: Keypair;
    private eventCoder: BorshEventCoder;
    private readonly PUMP_PROGRAM_ID: PublicKey;
    private monitoringSubscription: number | null = null;
    private isMonitoring: boolean = false;
    private readonly REDIS_MONITORING_KEY = 'monitoring:status';

    constructor(
        private configService: ConfigService,
        private databaseService: DatabaseService,
        private redisService: RedisService,
        private tokenMonitoringService: TokenMonitoringService
    ) {
        this.connection = new Connection(
            this.configService.get('SOLANA_RPC_URL'),
            'confirmed'
        );
        

        const privateKeyString = this.configService.get('WALLET_PRIVATE_KEY');
        
        const privateKeyUint8 = bs58.decode(privateKeyString);
        this.wallet = Keypair.fromSecretKey(privateKeyUint8);

        this.PUMP_PROGRAM_ID = new PublicKey(this.configService.get('PUMP_PROGRAM_ID'));
        this.eventCoder = new BorshEventCoder(IDL as any);
    }

    async onModuleInit() {
        await this.validateConnection();
        await this.syncMonitoringState();
    }

    private async syncMonitoringState() {
        const storedState = await this.redisService.get(this.REDIS_MONITORING_KEY);
        if (storedState) {
            const { isMonitoring, subscriptionId } = JSON.parse(storedState);
            this.isMonitoring = isMonitoring;
            this.monitoringSubscription = subscriptionId;
            
            if (isMonitoring && !subscriptionId) {
                // Recovery: restart monitoring if state was active but lost subscription
                await this.startMonitoring();
            }
        }
    }

    async startMonitoring(): Promise<boolean> {
        if (this.isMonitoring) return false;

        this.monitoringSubscription = await this.monitorProgram(async (event) => {
            if (event.name === 'CreateEvent') {
                const formattedEvent = this.formatCreateEvent(event.data);
                console.log('Formatted CreateEvent:', formattedEvent);
                await this.databaseService.storeCreateEvent(formattedEvent);
                await this.tokenMonitoringService.startInitialMonitoring(formattedEvent);
            } else if (event.name === 'TradeEvent') {
                const formattedEvent = await this.formatTradeEvent(event.data);
                console.log('Formatted TradeEvent:', formattedEvent);
                await this.databaseService.storeTradeEvent(formattedEvent);
                await this.databaseService.updateTokenHolder(formattedEvent);
            }
        });

        this.isMonitoring = true;
        
        await this.redisService.set(this.REDIS_MONITORING_KEY, JSON.stringify({
            isMonitoring: true,
            subscriptionId: this.monitoringSubscription,
            lastUpdated: Date.now()
        }));

        return true;
    }

    async stopMonitoring(): Promise<boolean> {
        const storedState = await this.redisService.get(this.REDIS_MONITORING_KEY);
        if (!storedState) return false;

        const { subscriptionId } = JSON.parse(storedState);
        if (subscriptionId === null || subscriptionId === undefined) return false;

        try {
            await this.connection.removeOnLogsListener(subscriptionId);
            this.monitoringSubscription = null;
            this.isMonitoring = false;

            await this.redisService.set(this.REDIS_MONITORING_KEY, JSON.stringify({
                isMonitoring: false,
                subscriptionId: null,
                lastUpdated: Date.now()
            }));

            return true;
        } catch (error) {
            console.error('Error stopping monitoring:', error);
            await this.redisService.set(this.REDIS_MONITORING_KEY, JSON.stringify({
                isMonitoring: false,
                subscriptionId: null,
                lastUpdated: Date.now()
            }));
            return false;
        }
    }

    async getMonitoringStatus(): Promise<{isMonitoring: boolean, lastUpdated?: number}> {
        const storedState = await this.redisService.get(this.REDIS_MONITORING_KEY);
        if (storedState) {
            const state = JSON.parse(storedState);
            return {
                isMonitoring: state.isMonitoring,
                lastUpdated: state.lastUpdated
            };
        }
        return { isMonitoring: this.isMonitoring };
    }

    private async validateConnection() {
        try {
            const blockHeight = await this.connection.getBlockHeight();
            console.log(`Connected to Solana network. Block height 🧱: ${blockHeight}`);
        } catch (error) {
            console.error('Failed to connect to Solana network:', error);
            throw error;
        }
    }

    async monitorProgram(callback: (event: any) => Promise<void>) {
        const filters = [
            {
                memcmp: {
                    offset: 0,
                    bytes: bs58.encode(Buffer.from(eventDiscriminator('CreateEvent')))
                }
            }, 
            {
                memcmp: {
                    offset: 0,
                    bytes: bs58.encode(Buffer.from(eventDiscriminator('TradeEvent')))
                }
            }
        ]

        return this.connection.onLogs(
            this.PUMP_PROGRAM_ID,
            async (logs) => {
                if (logs.err) return;
                
                try {
                    const programDataLog = logs.logs.find(log => 
                        log.startsWith('Program data:')
                    );
                    
                    if (!programDataLog) return;
                    
                    const base64Data = programDataLog.split('Program data: ')[1];
                    const decodedEvent = this.eventCoder.decode(base64Data);
                    
                    if (decodedEvent) {
                        await callback(decodedEvent);
                    }
                } catch (error) {
                    console.error('Error processing program log:', error);
                }
            },
            'confirmed'
        );
    }

    getConnection(): Connection {
        return this.connection;
    }

    private async getTokenDecimals(mintAddress: string): Promise<number> {
        try {
            const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mintAddress));
            // @ts-ignore
            console.log('Mint info:', mintInfo.value?.data?.parsed?.info);
            if (!mintInfo.value?.data || typeof mintInfo.value.data !== 'object') {
                return 9; // fallback to default SPL token decimals
            }
            return (mintInfo.value.data as any).parsed.info.decimals;
        } catch (error) {
            console.error(`Error fetching decimals for token ${mintAddress}:`, error);
            return 9; // fallback to default SPL token decimals
        }
    }

    private async formatTradeEvent(event: TradeEvent): Promise<FormattedTradeEvent> {
        const decimals = await this.getTokenDecimals(event.mint.toBase58());
        const solAmount = event.solAmount.toNumber() / 1e9; // SOL always has 9 decimals
        const tokenAmount = event.tokenAmount.toNumber() / Math.pow(10, decimals);
        const virtualSolReserves = event.virtualSolReserves.toNumber() / 1e9;
        const virtualTokenReserves = event.virtualTokenReserves.toNumber() / Math.pow(10, decimals);
        
        return {
            mint: event.mint.toBase58(),
            solAmount,
            tokenAmount,
            isBuy: event.isBuy,
            user: event.user.toBase58(),
            timestamp: new Date(event.timestamp.toNumber() * 1000),
            virtualSolReserves,
            virtualTokenReserves,
            priceImpact: this.calculatePriceImpact(
                solAmount,
                virtualSolReserves,
                virtualTokenReserves
            )
        };
    }

    private formatCreateEvent(event: CreateEvent): FormattedCreateEvent {
        return {
            name: event.name,
            symbol: event.symbol,
            uri: event.uri,
            mint: event.mint.toBase58(),
            bondingCurve: event.bondingCurve.toBase58(),
            creator: event.user.toBase58(),
            timestamp: new Date()
        };
    }

    private calculatePriceImpact(
        solAmount: number,
        virtualSolReserves: number,
        virtualTokenReserves: number
    ): number {
        const k = virtualSolReserves * virtualTokenReserves;
        const newSolReserves = virtualSolReserves + solAmount;
        const newTokenReserves = k / newSolReserves;
        const priceImpact = Math.abs(
            ((newTokenReserves / newSolReserves) - (virtualTokenReserves / virtualSolReserves)) /
            (virtualTokenReserves / virtualSolReserves)
        ) * 100;
        
        return Number(priceImpact.toFixed(2));
    }

    async getTokenSupply(mintAddress: string): Promise<number> {
        try {
            const mintInfo = await this.connection.getParsedAccountInfo(new PublicKey(mintAddress));
            if (!mintInfo.value?.data || typeof mintInfo.value.data !== 'object') {
                throw new Error('Invalid mint account data');
            }
            const decimals = (mintInfo.value.data as any).parsed.info.decimals;
            const supply = (mintInfo.value.data as any).parsed.info.supply;
            return supply / Math.pow(10, decimals);
        } catch (error) {
            console.error(`Error fetching supply for token ${mintAddress}:`, error);
            return 0;
        }
    }

    async buyToken(
        mintAddress: string,
        solAmount: number // in SOL
    ): Promise<string> {
        try {
            const mint = new PublicKey(mintAddress);
            const wallet = new PublicKey(this.configService.get('WALLET_PUBLIC_KEY'));
            

            const [global] = PublicKey.findProgramAddressSync(
                [Buffer.from('global')],
                this.PUMP_PROGRAM_ID
            );
            
            const [bondingCurve] = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding_curve'), mint.toBuffer()],
                this.PUMP_PROGRAM_ID
            );

            const [feeRecipient] = PublicKey.findProgramAddressSync(
                [Buffer.from('fee')],
                this.PUMP_PROGRAM_ID
            );

            const associatedBondingCurve = await getAssociatedTokenAddress(
                mint,
                bondingCurve,
                true
            );

            const associatedUser = await getAssociatedTokenAddress(
                mint,
                wallet,
                true
            );


            const tx = new Transaction();
            
            tx.add(
                new Program(
                    IDL as any,
                    this.PUMP_PROGRAM_ID,
                    { connection: this.connection }
                ).instruction.buy(
                    new BN(solAmount * LAMPORTS_PER_SOL),
                    {
                        accounts: {
                            global,
                            feeRecipient,
                            mint,
                            bondingCurve,
                            associatedBondingCurve,
                            associatedUser,
                            user: wallet,
                            systemProgram: SystemProgram.programId,
                            tokenProgram: TOKEN_PROGRAM_ID
                        }
                    }
                )
            );

            const signature = await sendAndConfirmTransaction(
                this.connection,
                tx,
                [this.wallet]
            );

            return signature;
        } catch (error) {
            console.error('Error buying token:', error);
            throw error;
        }
    }

    async sellToken(
        mintAddress: string,
        tokenAmount: number // in token units
    ): Promise<string> {
        try {
            const mint = new PublicKey(mintAddress);
            const wallet = new PublicKey(this.configService.get('WALLET_PUBLIC_KEY'));
            

            const [global] = PublicKey.findProgramAddressSync(
                [Buffer.from('global')],
                this.PUMP_PROGRAM_ID
            );
            
            const [bondingCurve] = PublicKey.findProgramAddressSync(
                [Buffer.from('bonding_curve'), mint.toBuffer()],
                this.PUMP_PROGRAM_ID
            );

            const associatedBondingCurve = await getAssociatedTokenAddress(
                mint,
                bondingCurve,
                true
            );

            const associatedUser = await getAssociatedTokenAddress(
                mint,
                wallet,
                true
            );

            const tx = new Transaction();
            
            tx.add(
                new Program(
                    IDL as any,
                    this.PUMP_PROGRAM_ID,
                    { connection: this.connection }
                ).instruction.sell(
                    new BN(tokenAmount),
                    {
                        accounts: {
                            global,
                            mint,
                            bondingCurve,
                            associatedBondingCurve,
                            associatedUser,
                            user: wallet,
                            systemProgram: SystemProgram.programId,
                            tokenProgram: TOKEN_PROGRAM_ID,
                        }
                    }
                )
            );

            const signature = await sendAndConfirmTransaction(
                this.connection,
                tx,
                [this.wallet]
            );

            return signature;
        } catch (error) {
            console.error('Error selling token:', error);
            throw error;
        }
    }

    getWallet(): Keypair {
        return this.wallet;
    }
}
