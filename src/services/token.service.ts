import { Injectable } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { BN, Program } from '@coral-xyz/anchor';
import { IDL } from '@root/pump.idl';
import { BondingCurveState } from '@src/types/token.types';

@Injectable()
export class TokenService {
    public connection: Connection;
    private PUMP_PROGRAM_ID: PublicKey;
    private program: Program;

    constructor(private configService: ConfigService) {
        this.connection = new Connection(
            this.configService.get('SOLANA_RPC_URL'),
            'confirmed'
        );

        this.PUMP_PROGRAM_ID = new PublicKey(this.configService.get('PUMP_PROGRAM_ID'));

        this.program = new Program(
            IDL as any,
            this.PUMP_PROGRAM_ID,
            { connection: this.connection }
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

    public async getVirtualSolReserves(bondingCurveAddress: string): Promise<BN> {
        const bondingCurve = await this.connection.getAccountInfo(new PublicKey(bondingCurveAddress));
        if (!bondingCurve) return new BN(0);

        const decoded = this.program.coder.accounts.decode(
            'BondingCurve',
            bondingCurve.data
        );

        return new BN(decoded.virtualSolReserves.toString());
    }

    public async getVirtualTokenReserves(bondingCurveAddress: string): Promise<BN> {
        const bondingCurve = await this.connection.getAccountInfo(new PublicKey(bondingCurveAddress));
        if (!bondingCurve) return new BN(0);

        const decoded = this.program.coder.accounts.decode(
            'BondingCurve',
            bondingCurve.data
        );

        return new BN(decoded.virtualTokenReserves.toString());
    }

    public async getBondingCurveState(bondingCurveAddress: string): Promise<BondingCurveState> {
        const bondingCurve = await this.connection.getAccountInfo(new PublicKey(bondingCurveAddress));
        if (!bondingCurve) {
            return {
                virtualTokenReserves: new BN(0),
                virtualSolReserves: new BN(0),
                realTokenReserves: new BN(0),
                realSolReserves: new BN(0),
                tokenTotalSupply: new BN(0)
            };
        }
    
        const decoded = this.program.coder.accounts.decode(
            'BondingCurve',
            bondingCurve.data
        );
    
        return {
            virtualTokenReserves: new BN(decoded.virtualTokenReserves.toString()),
            virtualSolReserves: new BN(decoded.virtualSolReserves.toString()),
            realTokenReserves: new BN(decoded.realTokenReserves.toString()),
            realSolReserves: new BN(decoded.realSolReserves.toString()),
            tokenTotalSupply: new BN(decoded.tokenTotalSupply.toString())
        };
    }
}