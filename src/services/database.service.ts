import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db, Collection } from 'mongodb';
import { CreateEvent, FormattedCreateEvent, FormattedTradeEvent, TradeEvent } from '@src/types/token.types';

@Injectable()
export class DatabaseService implements OnModuleInit {
    private client: MongoClient;
    private db: Db;
    private createEventsCollection: Collection;
    private tradeEventsCollection: Collection;
    private tokenHoldersCollection: Collection;

    constructor(private configService: ConfigService) {
        const uri = this.configService.get<string>('MONGODB_URI');
        this.client = new MongoClient(uri);
    }

    async onModuleInit() {
        try {
            await this.client.connect();
            this.db = this.client.db(this.configService.get('MONGODB_DB_NAME'));
            
            // Create time series collections if they don't exist
            await this.setupTimeSeriesCollections();
            
            console.log('Connected to MongoDB');
        } catch (error) {
            console.error('MongoDB connection error:', error);
            throw error;
        }
    }

    private async setupTimeSeriesCollections() {
        const collections = await this.db.listCollections().toArray();
        
        if (!collections.find(c => c.name === 'create_events')) {
            await this.db.createCollection('create_events', {
                timeseries: {
                    timeField: 'timestamp',
                    metaField: 'mint',
                    granularity: 'seconds'
                }
            });
        }
        
        if (!collections.find(c => c.name === 'trade_events')) {
            await this.db.createCollection('trade_events', {
                timeseries: {
                    timeField: 'timestamp',
                    metaField: 'mint',
                    granularity: 'seconds'
                }
            });
        }

        if (!collections.find(c => c.name === 'token_holders')) {
            await this.db.createCollection('token_holders');
            const tokenHolders = this.db.collection('token_holders');
            await tokenHolders.createIndexes([
                { key: { mint: 1, holder: 1 }, unique: true },
                { key: { mint: 1, balance: -1 } },
                { key: { mint: 1, isCreator: 1 } }
            ]);
        }

        this.createEventsCollection = this.db.collection('create_events');
        this.tradeEventsCollection = this.db.collection('trade_events');
        this.tokenHoldersCollection = this.db.collection('token_holders');
    }

    async storeCreateEvent(event: FormattedCreateEvent) {
        return this.createEventsCollection.insertOne(event);
    }

    async storeTradeEvent(event: FormattedTradeEvent) {
        return this.tradeEventsCollection.insertOne(event);
    }

    getDb(): Db {
        return this.db;
    }

    async onModuleDestroy() {
        await this.client.close();
    }

    async updateTokenHolder(tradeEvent: FormattedTradeEvent) {
        const amount = tradeEvent.isBuy ? tradeEvent.tokenAmount : -tradeEvent.tokenAmount;
        
        await this.tokenHoldersCollection.updateOne(
            { 
                mint: tradeEvent.mint, 
                holder: tradeEvent.user 
            },
            {
                $inc: { balance: amount },
                $setOnInsert: {
                    firstSeen: tradeEvent.timestamp,
                    isCreator: false
                }
            },
            { upsert: true }
        );
    }

    async getTokenHolders(mintAddress: string) {
        return this.tokenHoldersCollection
            .find({ 
                mint: mintAddress,
                balance: { $gt: 0 }
            })
            .sort({ balance: -1 })
            .toArray();
    }

    async getCreatorHolding(mintAddress: string, creatorAddress: string) {
        const [creatorHolding] = await Promise.all([
            this.tokenHoldersCollection.findOne({ 
                mint: mintAddress, 
                holder: creatorAddress 
            })
        ]);

        if (!creatorHolding) return 0;
        return creatorHolding.balance
    }
}
