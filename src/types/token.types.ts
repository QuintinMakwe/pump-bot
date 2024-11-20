// src/types/token.types.ts
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Event Layouts
export interface TradeEvent {
    mint: PublicKey;
    solAmount: BN;
    tokenAmount: BN;
    isBuy: boolean;
    user: PublicKey;
    timestamp: BN;
    virtualSolReserves: BN;
    virtualTokenReserves: BN;
}

export interface CreateEvent {
    name: string;
    symbol: string;
    uri: string;
    mint: PublicKey;
    bondingCurve: PublicKey;
    user: PublicKey;
}

export interface CompleteEvent {
    user: PublicKey;
    mint: PublicKey;
    bondingCurve: PublicKey;
    timestamp: BN;
}

export interface SetParamsEvent {
    feeRecipient: PublicKey;
    initialVirtualTokenReserves: BN;
    initialVirtualSolReserves: BN;
    initialRealTokenReserves: BN;
    tokenTotalSupply: BN;
    feeBasisPoints: BN;
}

export enum TokenMonitoringStage {
    INITIAL = 'INITIAL',      // 0-5 minutes
    ACTIVE = 'ACTIVE',        // 5-60 minutes
    MATURE = 'MATURE',        // > 60 minutes
    DROPPED = 'DROPPED',      // Failed criteria
    COMPLETED = 'COMPLETED'   // Bonding curve completed
}

export interface TokenMetrics {
    transactionCount: { buys: number; sells: number, buyVolume: number, sellVolume: number };
    devHoldingPercentage: number;
    marketCapUSD: number;
    ageInSeconds: number;
    volumeUSD: number;
    topHolders: { address: string; percentage: number }[];
    currentPrice: number;
    totalHolders: number;
    tokenInfo: CreateEvent & {creator: string}
}

export interface TokenState {
    mint: PublicKey;
    creator: PublicKey;
    stage: TokenMonitoringStage;
    createdAt: number;
    lastUpdated: number;
    metrics: TokenMetrics;
    trades: TradeEvent[];
}

export interface StageConfig {
    duration: number;  // in seconds
    criteria: {
        minBuyRatio: number;
        maxDevHolding: number;
        minVolume: number;
        maxVolume: number;
        minHolders: number;
    };
}

export interface FormattedTradeEvent {
    mint: string;
    solAmount: number;
    tokenAmount: number;
    isBuy: boolean;
    user: string;
    timestamp: Date;
    virtualSolReserves: number;
    virtualTokenReserves: number;
    priceImpact?: number;
}

export interface FormattedCreateEvent {
    name: string;
    symbol: string;
    uri: string;
    mint: string;
    bondingCurve: string;
    creator: string;
    timestamp: Date;
}

export interface PositionData {
    mint: string;
    startTime: number;
    entryPrice: number;
    stage: TokenMonitoringStage;
    attempts: number;
}

export interface BondingCurveState {
    virtualTokenReserves: BN;
    virtualSolReserves: BN;
    realTokenReserves: BN;
    realSolReserves: BN;
    tokenTotalSupply: BN;
}