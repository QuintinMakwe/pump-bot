import { Connection } from "@solana/web3.js";

export enum ConnectionProvider {
    QUICKNODE = 'QUICKNODE',
    ANKR = 'ANKR'
}

export enum ConnectionStatus  {
    ACTIVE = 'ACTIVE',
    COOLING = 'COOLING', 
    ERROR = 'ERROR'
}

export interface RPConnection {
    id: string; 
    provider: ConnectionProvider;
    url: string;
    connection: Connection;
    subscription: number | null;
    requestCount: number;
    lasRequestTime: number;
    status: ConnectionStatus;
    rateLimit: number; // requests per second
    cooldownPeriod: number; // miliseconds
}