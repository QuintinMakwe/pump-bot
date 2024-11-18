import { Injectable } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TokenService {
    private connection: Connection;

    constructor(private configService: ConfigService) {
        this.connection = new Connection(
            this.configService.get('SOLANA_RPC_URL'),
            'confirmed'
        );
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
}