import { Injectable, OnModuleInit } from '@nestjs/common';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Keypair, Commitment } from '@solana/web3.js';
import { BorshEventCoder, eventDiscriminator } from "@coral-xyz/anchor";
import { IDL } from "@root/pump.idl";
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@src/redis/redis.service';
import bs58 from 'bs58';
import { DatabaseService } from './database.service';
import { FormattedTradeEvent, FormattedCreateEvent, TradeEvent, CreateEvent } from '@src/types/token.types';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { Program } from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import { AccountBalance, QuickNodeStreamData } from '@src/types/quicknode.types';
import { createHash } from 'crypto';
import { ConnectionManagerService } from './connection-manager.service';
import { RPConnection } from '@src/types/connection.types';
import { LoggingService } from './logging.service';

@Injectable()
export class BlockchainService implements OnModuleInit {
    private eventCoder: BorshEventCoder;
    private readonly PUMP_PROGRAM_ID: PublicKey;
    private monitoringSubscription: number | null = null;
    private isMonitoring: boolean = false;
    private readonly REDIS_MONITORING_KEY = 'monitoring:status';
    private program: Program;
    private currentConnection: RPConnection | null = null;
    private wallet: Keypair;

    constructor(
        private configService: ConfigService,
        private databaseService: DatabaseService,
        private redisService: RedisService,
        private tokenMonitoringService: TokenMonitoringService,
        private connectionManager: ConnectionManagerService,
        private loggingService: LoggingService
    ) {
        const privateKeyString = this.configService.get('WALLET_PRIVATE_KEY');

        const privateKeyUint8 = bs58.decode(privateKeyString);
        this.wallet = Keypair.fromSecretKey(privateKeyUint8);
        this.PUMP_PROGRAM_ID = new PublicKey(this.configService.get('PUMP_PROGRAM_ID'));
        this.eventCoder = new BorshEventCoder(IDL as any);
        this.updateConnection();
    }

    private updateConnection() {
        this.currentConnection = this.connectionManager.getNextHealthyConnection();
        this.program = new Program(
            IDL as any,
            this.PUMP_PROGRAM_ID,
            { connection: this.currentConnection.connection }
        );
    }

    private async restartMonitoring() {
        console.log('Restarting monitoring due to connection issues...');
        this.loggingService.log('INFO', 'Restarting monitoring due to connection issues...');
        
        if (this.monitoringSubscription !== null && this.currentConnection) {
            try {
                await this.currentConnection.connection.removeAccountChangeListener(
                    this.monitoringSubscription
                );
            } catch (error) {
                console.error('Error removing old subscription:', error);
                this.loggingService.log('ERROR', 'Error removing old subscription', { error });
            }
        }

        this.monitoringSubscription = null;
        this.isMonitoring = false;
        this.updateConnection();
        await this.startMonitoring();
    }

    async startMonitoring(): Promise<boolean> {
        if (this.isMonitoring) return false;

        try {
            if (!this.currentConnection) {
                this.updateConnection();
            }

            this.monitoringSubscription = await this.monitorProgram(async (event) => {
                if (event.name === 'CreateEvent') {
                    const formattedEvent = this.formatCreateEvent(event.data);
                    await this.databaseService.storeCreateEvent(formattedEvent);
                    // await this.tokenMonitoringService.startInitialMonitoring(formattedEvent);
                } else if (event.name === 'TradeEvent') {
                    const formattedEvent = await this.formatTradeEvent(event.data);
                    await this.databaseService.storeTradeEvent(formattedEvent);
                    await this.databaseService.updateTokenHolder(formattedEvent);
                }
            });

            this.isMonitoring = true;
            await this.updateMonitoringState();
            return true;
        } catch (error) {
            console.error('Error in startMonitoring:', error);
            await this.restartMonitoring();
            return false;
        }
    }

    private async monitorProgram(callback: (event: any) => Promise<void>): Promise<number> {
        if (!this.currentConnection) throw new Error('No active connection');

        try {
            if (this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
                this.loggingService.log("INFO", "near rate limit, restarting monitoring");
                await this.restartMonitoring();
                return;
            }

            const subscription = this.currentConnection.connection.onLogs(
                this.PUMP_PROGRAM_ID,
                async (logs) => {
                    if (logs.err) {
                        console.error('Error in logs subscription:', logs.err);
                        await this.restartMonitoring();
                        return;
                    }

                    try {
                        console.log('about to handle request ', this.connectionManager.getCurrentConnection(this.currentConnection.id))
                        this.loggingService.log('INFO', 'about to handle request', this.connectionManager.getCurrentConnection(this.currentConnection.id));
                        await this.connectionManager.handleRequest(this.currentConnection.id);

                        for (const log of logs.logs) {
                            if (!log.startsWith('Program data:')) continue;
                            const base64Data = log.split('Program data: ')[1];
                            const event = this.eventCoder.decode(base64Data);
                            if (!event) continue;
                            await callback(event);
                        }

                        if (this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
                            console.log('near rate limit, restarting monitoring ', this.currentConnection)
                            this.loggingService.log('INFO', 'near rate limit, restarting monitoring');
                            await this.restartMonitoring();
                        }
                    } catch (error) {
                        console.error('Error processing log:', error);
                        this.loggingService.log('ERROR', 'Error processing log', { connectionId: this.currentConnection.id });
                        await this.restartMonitoring();
                    }
                },
                'confirmed'
            );

            return subscription;
        } catch (error) {
            console.error('Error in monitorProgram:', error);
            await this.restartMonitoring();
            throw error;
        }
    }

    private async updateMonitoringState() {
        await this.redisService.set(this.REDIS_MONITORING_KEY, JSON.stringify({
            isMonitoring: this.isMonitoring,
            subscriptionId: this.monitoringSubscription,
            lastUpdated: Date.now(),
            currentConnectionId: this.currentConnection?.id
        }));
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

    async stopMonitoring(): Promise<boolean> {
        const storedState = await this.redisService.get(this.REDIS_MONITORING_KEY);
        if (!storedState) return false;

        const { subscriptionId } = JSON.parse(storedState);
        if (subscriptionId === null || subscriptionId === undefined) return false;

        try {
            await this.currentConnection.connection.removeOnLogsListener(subscriptionId);
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

    async getMonitoringStatus(): Promise<{ isMonitoring: boolean, lastUpdated?: number }> {
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
            if (!this.currentConnection || 
                this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
                this.updateConnection();
            }
            const blockHeight = await this.currentConnection.connection.getBlockHeight();
            await this.connectionManager.handleRequest(this.currentConnection.id);
            console.log(`Connected to Solana network. Block height 🧱: ${blockHeight}`);
            this.loggingService.log('INFO', 'Connected to Solana network', { blockHeight });
            
            // If we're near rate limit, proactively switch
            if (this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
                this.updateConnection();
            }
        } catch (error) {
            console.error('Connection validation failed:', error);
            this.loggingService.log('ERROR', 'Connection validation failed', { error });
            this.updateConnection(); // Switch on error
            throw error;
        }
    }

    getConnection(): Connection {
        return this.currentConnection?.connection;
    }

    private async getTokenDecimals(mintAddress: string): Promise<number> {
        try {
            const mintInfo = await this.currentConnection.connection.getParsedAccountInfo(new PublicKey(mintAddress));
            await this.connectionManager.handleRequest(this.currentConnection.id);
            // @ts-ignore
            if (!mintInfo.value?.data || typeof mintInfo.value.data !== 'object') {
                return 9;
            }
            return (mintInfo.value.data as any).parsed.info.decimals;
        } catch (error) {
            console.error(`Error fetching decimals for token ${mintAddress}:`, error);
            return 9;
        }
    }

    private async formatTradeEvent(event: TradeEvent): Promise<FormattedTradeEvent> {
        const decimals = await this.getTokenDecimals(event.mint.toBase58());
        const solAmount = event.solAmount.toNumber() / 1e9; 
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
            const mintInfo = await this.currentConnection.connection.getParsedAccountInfo(new PublicKey(mintAddress));
            await this.connectionManager.handleRequest(this.currentConnection.id);
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
                    { connection: this.currentConnection.connection }
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
                this.currentConnection.connection,
                tx,
                [this.wallet]
            );

            await this.connectionManager.handleRequest(this.currentConnection.id);

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
                    { connection: this.currentConnection.connection }
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
                this.currentConnection.connection,
                tx,
                [this.wallet]
            );

            await this.connectionManager.handleRequest(this.currentConnection.id);

            return signature;
        } catch (error) {
            console.error('Error selling token:', error);
            throw error;
        }
    }

    getWallet(): Keypair {
        return this.wallet;
    }

    async processQuicknodeStreamData(transactions: QuickNodeStreamData[]): Promise<{ success: boolean, error?: string }> {
        try {
            const db = await this.databaseService.getDb();
            
            for (const tx of transactions) {
                const pumpInvocation = tx.programInvocations?.find(
                    inv => inv.programId === this.PUMP_PROGRAM_ID.toString()
                );

                if (!pumpInvocation) continue;
                console.log('pump invocation found!!');
                // Process all create events
                const isCreateEvent = await this.isCreateInstruction(pumpInvocation.instruction.data);
                if (isCreateEvent) {
                    console.log('create event found!!');
                    await this.processTransaction(tx, pumpInvocation);
                    continue;
                }

                // For other events (buy/sell), check if we're tracking this token
                const mintAddress = pumpInvocation.instruction.accounts[2].pubkey; // mint account is at index 2, reference pump.idl.ts
                const createEvent = await db.collection('create_events').findOne({ mint: mintAddress });
                
                if (!createEvent) {
                    console.log(`Skipping transaction for untracked token: ${mintAddress}`);
                    continue;
                }
                console.log('processing buy/sell event');
                await this.processTransaction(tx, pumpInvocation);
            }
            return { success: true };
        } catch (error) {
            console.error('Error processing transaction batch:', error);
            return { success: false, error: error.message };
        }
    }

    private async isCreateInstruction(data: string): Promise<boolean> {
        try {
            const ixData = Buffer.from(bs58.decode(data));
            const discriminator = ixData.slice(0, 8);
            const createIxDiscriminator = Buffer.from(
                createHash('sha256').update('global:create').digest().slice(0, 8)
            );
            return discriminator.equals(createIxDiscriminator);
        } catch {
            return false;
        }
    }

    private async processTransaction(tx: QuickNodeStreamData, pumpInvocation: any) {
        let retries = 0;
        const MAX_RETRIES = 3;
    
        while (retries < MAX_RETRIES) {
            try {
                const txStatus = await this.currentConnection.connection.getTransaction(tx.signature, {
                    maxSupportedTransactionVersion: 0
                });

                await this.connectionManager.handleRequest(this.currentConnection.id);
    
                if (!txStatus || txStatus.meta?.err !== null) return;
    
                if (tx.logs?.length) {
                    const programDataLog = tx.logs.find(log =>
                        log.startsWith('Program data:')
                    );
    
                    if (programDataLog) {
                        const base64Data = programDataLog.split('Program data: ')[1];
                        const decodedEvent = this.eventCoder.decode(base64Data);
                        await this.processDecodedEvent(decodedEvent, tx);
                        return;
                    }
                }
    
                // Fallback to instruction data decoding
                const instructionData = pumpInvocation.instruction.data;
                if (instructionData) {
                    const decodedEvent = await this.decodeInstructionData(
                        instructionData,
                        pumpInvocation.instruction.accounts,
                        tx.slot
                    );
                    await this.processDecodedEvent(decodedEvent, tx);
                }
                return;
            } catch (error) {
                console.error(`Error processing transaction (attempt ${retries + 1}):`, error);
                retries++;
                this.updateConnection();
                
                if (retries === MAX_RETRIES) {
                    throw error;
                }
            }
        }
    }

    private async processDecodedEvent(decodedEvent: any, tx: QuickNodeStreamData) {
        if (!decodedEvent) return;

        if (decodedEvent.name === 'CreateEvent') {
            const formattedEvent = {
                ...this.formatCreateEvent(decodedEvent.data as unknown as CreateEvent),
                signature: tx.signature,
                slot: tx.slot,
                blockTime: tx.blockTime
            };
            // console.log('Formatted CreateEvent:', formattedEvent);
            await this.databaseService.storeCreateEvent(formattedEvent);
            // await this.tokenMonitoringService.startInitialMonitoring(formattedEvent);
        } else if (decodedEvent.name === 'TradeEvent') {
            const formattedEvent = {
                ...(await this.formatTradeEvent(decodedEvent.data as unknown as TradeEvent)),
                signature: tx.signature,
                slot: tx.slot,
                blockTime: tx.blockTime
            };
            // console.log('Formatted TradeEvent:', formattedEvent);
            await this.databaseService.storeTradeEvent(formattedEvent);
            await this.databaseService.updateTokenHolder(formattedEvent);
        }
    }

    private async decodeInstructionData(data: string, accounts: AccountBalance[], slot: number): Promise<any> {
        try {
            // Decode the instruction using the IDL
            const ixData = Buffer.from(bs58.decode(data));
            const discriminator = ixData.slice(0, 8);
            const instruction = IDL.instructions.find(ix => {
                const ixDiscriminator = Buffer.from(
                    createHash('sha256').update(`global:${ix.name}`).digest().slice(0, 8) //Ref: this is how anchor gens discriminator
                );
                return ixDiscriminator.equals(discriminator);
            });
            const decoded = instruction ? {
                name: instruction.name,
                data: ixData.slice(8) // Remove discriminator to get actual data
            } : null;

            if (!decoded) return null;

            switch (decoded.name) {
                case 'buy':
                    let buyOffset = 0;
                    const amount = new BN(decoded.data.slice(buyOffset, buyOffset + 8), 'le');
                    buyOffset += 8;
                    const maxSolCost = new BN(decoded.data.slice(buyOffset, buyOffset + 8), 'le');

                    const buyState = await this.getBondingCurveStateAtSlot(
                        accounts[3].pubkey,
                        slot
                    );

                    return this.createTradeEvent({
                        mint: accounts[2].pubkey,
                        solAmount: await this.calculateSolAmount(
                            amount,
                            accounts[3].pubkey,
                            buyState
                        ), // Remember this is for slippage protection, so we can't trust the value from the program/instruction call, rather we ought to calculate it. 
                        tokenAmount: amount.abs(),     // This is the token amount we want to buy
                        isBuy: true,
                        user: accounts[6].pubkey,
                        timestamp: new BN(Math.floor(Date.now() / 1000)),
                        virtualSolReserves: buyState.virtualSolReserves,
                        virtualTokenReserves: buyState.virtualTokenReserves
                    });

                case 'sell':
                    let sellOffset = 0;
                    const sellAmount = new BN(decoded.data.slice(sellOffset, sellOffset + 8), 'le');
                    sellOffset += 8;
                    const minSolOutput = new BN(decoded.data.slice(sellOffset, sellOffset + 8), 'le');

                    const sellState = await this.getBondingCurveStateAtSlot(
                        accounts[3].pubkey,
                        slot
                    );

                    return this.createTradeEvent({
                        mint: accounts[2].pubkey, // mint account
                        solAmount: await this.calculateSolAmount(
                            new BN(decoded.data),
                            accounts[3].pubkey,
                            sellState
                        ),
                        tokenAmount: sellAmount,
                        isBuy: false,
                        user: accounts[6].pubkey,
                        timestamp: new BN(Math.floor(Date.now() / 1000)),
                        virtualSolReserves: sellState.virtualSolReserves,
                        virtualTokenReserves: sellState.virtualTokenReserves
                    });

                case 'create':
                    // The data buffer contains three strings (name, symbol, uri)
                    // Each string is prefixed with a u32 length
                    let offset = 0;
                    const strings = [];

                    for (let i = 0; i < 3; i++) {
                        // Read the length of the string (u32)
                        const length = decoded.data.readUInt32LE(offset);
                        offset += 4;

                        // Read the string data
                        const stringData = decoded.data.slice(offset, offset + length);
                        strings.push(stringData.toString('utf8'));
                        offset += length;
                    }

                    return {
                        name: 'CreateEvent',
                        data: {
                            name: strings[0],
                            symbol: strings[1],
                            uri: strings[2],
                            mint: new PublicKey(accounts[0].pubkey),
                            bondingCurve: new PublicKey(accounts[2].pubkey),
                            user: new PublicKey(accounts[7].pubkey)
                        }
                    };

                default:
                    return null;
            }

        } catch (error) {
            console.error('Error decoding instruction data:', error);
            return null;
        }
    }

    public async getVirtualSolReserves(bondingCurveAddress: string): Promise<BN> {
        if (!this.currentConnection || 
            this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
            this.updateConnection();
        }
        
        const bondingCurve = await this.currentConnection.connection.getAccountInfo(new PublicKey(bondingCurveAddress));
        await this.connectionManager.handleRequest(this.currentConnection.id);
        
        if (!bondingCurve) return new BN(0);

        // Decode the bonding curve account data using the IDL structure
        const decoded = this.program.coder.accounts.decode(
            'BondingCurve',
            bondingCurve.data
        );

        return new BN(decoded.virtualSolReserves.toString());
    }

    public async getVirtualTokenReserves(bondingCurveAddress: string): Promise<BN> {
        if (!this.currentConnection || 
            this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
            this.updateConnection();
        }
        const bondingCurve = await this.currentConnection.connection.getAccountInfo(new PublicKey(bondingCurveAddress));
        await this.connectionManager.handleRequest(this.currentConnection.id);
        if (!bondingCurve) return new BN(0);

        const decoded = this.program.coder.accounts.decode(
            'BondingCurve',
            bondingCurve.data
        );

        return new BN(decoded.virtualTokenReserves.toString());
    }

    private createTradeEvent(data: any) {
        return {
            name: 'TradeEvent',
            data: {
                mint: new PublicKey(data.mint),
                solAmount: new BN(data.solAmount),
                tokenAmount: new BN(data.tokenAmount),
                isBuy: data.isBuy,
                user: new PublicKey(data.user),
                timestamp: data.timestamp,
                virtualSolReserves: data.virtualSolReserves,
                virtualTokenReserves: data.virtualTokenReserves
            }
        };
    }

    private async calculateTokenAmount(
        solAmount: BN,
        bondingCurveAddress: string,
        preState?: { virtualSolReserves: BN, virtualTokenReserves: BN }
    ): Promise<BN> {
        const { virtualSolReserves, virtualTokenReserves } = preState ||
            await this.getBondingCurveStateAtSlot(bondingCurveAddress);

        if (virtualSolReserves.isZero() || virtualTokenReserves.isZero()) {
            throw new Error('Virtual reserves cannot be zero');
        }

        const deltaX = solAmount.abs();
        const x = virtualSolReserves;
        const y = virtualTokenReserves;

        return y.mul(deltaX).div(x.add(deltaX)).abs();
    }

    private async calculateSolAmount(
        tokenAmount: BN,
        bondingCurveAddress: string,
        preState?: { virtualSolReserves: BN, virtualTokenReserves: BN }
    ): Promise<BN> {
        const { virtualSolReserves, virtualTokenReserves } = preState ||
            await this.getBondingCurveStateAtSlot(bondingCurveAddress);

        if (virtualSolReserves.isZero() || virtualTokenReserves.isZero()) {
            throw new Error('Virtual reserves cannot be zero');
        }

        // Use the bonding curve formula: deltaX = x * deltaY / (y - deltaY)
        const deltaY = tokenAmount.abs();
        const x = virtualSolReserves;
        const y = virtualTokenReserves;

        if (deltaY.gte(y)) {
            throw new Error('Token amount exceeds available reserves');
        }

        return x.mul(deltaY).div(y.sub(deltaY)).abs();
    }

    private async getBondingCurveStateAtSlot(
        bondingCurveAddress: string,
        slot?: number
    ): Promise<{ virtualSolReserves: BN, virtualTokenReserves: BN }> {
        let retries = 0;
        const MAX_RETRIES = 3;

        while (retries < MAX_RETRIES) {
            try {
                if (!this.currentConnection || 
                    this.connectionManager.isNearRateLimit(this.currentConnection.id)) {
                    this.updateConnection();
                }

                const options = slot ? {
                    commitment: 'confirmed' as Commitment,
                    minContextSlot: slot - 1
                } : { commitment: 'confirmed' as Commitment };

                const bondingCurveAccountInfo = await this.currentConnection.connection.getAccountInfoAndContext(
                    new PublicKey(bondingCurveAddress),
                    options
                );

                await this.connectionManager.handleRequest(this.currentConnection.id);
                
                if (!bondingCurveAccountInfo.value) {
                    throw new Error('No bonding curve account info found');
                }

                const decoded = this.program.coder.accounts.decode(
                    'BondingCurve',
                    bondingCurveAccountInfo.value.data
                );

                return {
                    virtualSolReserves: new BN(decoded.virtualSolReserves.toString()),
                    virtualTokenReserves: new BN(decoded.virtualTokenReserves.toString())
                };
            } catch (error) {
                console.error(`Error getting bonding curve state (attempt ${retries + 1}):`, error);
                retries++;
                this.updateConnection();
                
                if (retries === MAX_RETRIES) {
                    return {
                        virtualSolReserves: new BN(0),
                        virtualTokenReserves: new BN(0)
                    };
                }
            }
        }
    }

    public async logInvalidData(data: any): Promise<void> {
        try {
            const fs = require('fs');
            const path = require('path');
            const logPath = path.join(process.cwd(), 'test.json');
            
            const logEntry = JSON.stringify({
                timestamp: new Date().toISOString(),
                data: data
            }, null, 2);

            fs.appendFileSync(logPath, logEntry + '\n');
        } catch (error) {
            console.error('Error logging invalid data:', error);
        }
    }

    
}
