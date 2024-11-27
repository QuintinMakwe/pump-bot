import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

@Injectable()
export class LoggingService implements OnModuleInit {
    private logStream: fs.WriteStream;
    private readonly logDir: string;
    private readonly maxLogSize = 10 * 1024 * 1024; // 10MB
    private readonly maxLogFiles = 5;

    constructor(private configService: ConfigService) {
        this.logDir = path.join(process.cwd(), 'logs');
        this.setupLogging();
    }

    private setupLogging() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = path.join(this.logDir, `app-${timestamp}.log`);
        this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    }

    public log(level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG', message: string, data?: any): void {
        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] ${level}: ${message}`;
        
        if (data) {
            logMessage += '\n' + util.inspect(data, { depth: null, colors: false });
        }
        
        logMessage += '\n';

        // Write to console
        switch (level) {
            case 'ERROR':
                console.error(message, data || '');
                break;
            case 'WARN':
                console.warn(message, data || '');
                break;
            case 'DEBUG':
                console.debug(message, data || '');
                break;
            default:
                console.log(message, data || '');
        }

        // Write to file
        this.writeToFile(logMessage);
    }

    private writeToFile(message: string) {
        if (this.logStream.writableLength > this.maxLogSize) {
            this.rotateLogFiles();
        }
        this.logStream.write(message);
    }

    private rotateLogFiles() {
        // Reference existing rotation logic from the original file
        // startLine: 83
        // endLine: 105
    }

    async onModuleInit() {
        process.on('beforeExit', () => {
            if (this.logStream) {
                this.logStream.end();
            }
        });
    }

    public getLogFiles(): string[] {
        return fs.readdirSync(this.logDir)
            .filter(file => file.startsWith('app-'))
            .sort((a, b) => fs.statSync(path.join(this.logDir, b)).mtime.getTime() - 
                           fs.statSync(path.join(this.logDir, a)).mtime.getTime());
    }

    public getLogContent(fileName: string): string {
        const filePath = path.join(this.logDir, fileName);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
        return '';
    }
}