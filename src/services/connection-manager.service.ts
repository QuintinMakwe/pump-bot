import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Connection } from "@solana/web3.js";
import { ConnectionProvider, ConnectionStatus, RPConnection } from "@src/types/connection.types";

@Injectable()
export class ConnectionManagerService {
    private connections: RPConnection[] = [];
    private currentIndex = 0;
    private readonly REQUEST_WINDOW = 1000; // 1 second window for rate limiting

    constructor(private configService: ConfigService) {
        this.initializeConnections();
    }

    private initializeConnections() {
        // Initialize QuickNode connections
        for (let i = 1; i <= 9; i++) {
            const connection = new Connection(
                this.configService.get(`QUICKNODE_RPC_URL_${i}`),
                'confirmed'
            );
            this.connections.push({
                id: `quicknode-${i}`,
                provider: ConnectionProvider.QUICKNODE,
                url: this.configService.get(`QUICKNODE_RPC_URL_${i}`),
                connection,
                subscription: null,
                requestCount: 0,
                lasRequestTime: 0,
                status: ConnectionStatus.ACTIVE,
                rateLimit: 15,
                cooldownPeriod: 60000 // 1 minute cooldown
            });
        }

        const connection = new Connection(
            this.configService.get('ANKR_RPC_URL'),
            'confirmed'
        );
        // Initialize Ankr connection
        this.connections.push({
            id: 'ankr-1',
            provider: ConnectionProvider.ANKR,
            url: this.configService.get('ANKR_RPC_URL'),
            connection,
            subscription: null,
            requestCount: 0,
            lasRequestTime: 0,
            status: ConnectionStatus.ACTIVE,
            rateLimit: 1500,
            cooldownPeriod: 60000
        });
    }

    public getCurrentConnection(connectionId: string): RPConnection | null {
        return this.connections.find(c => c.id === connectionId) || null;
    }
    
    public isNearRateLimit(connectionId: string): boolean {
        const conn = this.getCurrentConnection(connectionId);
        if (!conn) return true;
    
        const now = Date.now();
        if (now - conn.lasRequestTime >= this.REQUEST_WINDOW) {
            conn.requestCount = 0;
            conn.lasRequestTime = now;
        }
    
        return conn.requestCount > (conn.rateLimit * 0.8);
    }

    public getNextHealthyConnection(): RPConnection {
        const startIndex = this.currentIndex;
        do {
            const conn = this.connections[this.currentIndex];
            if (this.isConnectionHealthy(conn)) {
                this.currentIndex = (this.currentIndex + 1) % this.connections.length;
                return conn;
            }
            this.currentIndex = (this.currentIndex + 1) % this.connections.length;
        } while (this.currentIndex !== startIndex);

        throw new Error('No healthy connections available');
    }

    private isConnectionHealthy(conn: RPConnection): boolean {
        if (conn.status !== ConnectionStatus.ACTIVE) return false;

        const now = Date.now();
        if (now - conn.lasRequestTime >= this.REQUEST_WINDOW) {
            conn.requestCount = 0;
            conn.lasRequestTime = now;
        }

        return conn.requestCount < conn.rateLimit;
    }

    public async handleRequest(connectionId: string) {
        const conn = this.connections.find(c => c.id === connectionId);
        if (!conn) return;

        conn.requestCount++;
        conn.lasRequestTime = Date.now();

        if (conn.requestCount >= conn.rateLimit) {
            this.cooldownConnection(conn);
        }
    }

    private cooldownConnection(conn: RPConnection) {
        conn.status = ConnectionStatus.COOLING;
        setTimeout(() => {
            conn.status = ConnectionStatus.ACTIVE;
            conn.requestCount = 0;
        }, conn.cooldownPeriod);
    }
}