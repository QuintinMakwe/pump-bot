import { Injectable } from '@nestjs/common';
import { QuickNodeStreamData } from "@src/types/quicknode.types";
import { ConfigService } from '@nestjs/config';

@Injectable()
export class QuickNodeGuard {
    private readonly PUMP_PROGRAM_ID: string;

    constructor(private configService: ConfigService) {
        this.PUMP_PROGRAM_ID = this.configService.get('PUMP_PROGRAM_ID');
    }

    isQuickNodeStreamData(data: any): data is QuickNodeStreamData[] {
        console.log('Validating QuickNode stream data:', data?.length);
        
        if (!Array.isArray(data)) {
            console.error('Data is not an array:', data);
            return false;
        }


        const relevantTransactions = data.filter(tx => 
            tx?.programInvocations?.some(inv => 
                inv.programId === this.PUMP_PROGRAM_ID
            )
        );

        if (relevantTransactions.length === 0) {
            return true;
        }

        const isValid = relevantTransactions.every((tx, index) => {
            const validationChecks = {
                signature: typeof tx.signature === 'string',
                slot: typeof tx.slot === 'number',
                blockTime: typeof tx.blockTime === 'number',
                programInvocations: Array.isArray(tx.programInvocations),
                logs: Array.isArray(tx.logs),
                success: typeof tx.success === 'boolean'
            };

            const isValidTx = Object.values(validationChecks).every(check => check);

            if (!isValidTx) {
                const errorData = {
                    error: 'Invalid PUMP transaction',
                    transactionIndex: index,
                    transaction: tx,
                    validationResults: validationChecks,
                    failedChecks: Object.entries(validationChecks)
                        .filter(([_, valid]) => !valid)
                        .map(([field]) => field)
                };
                
                this.logInvalidData(errorData);
            }

            return isValidTx;
        });

        return isValid;
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

            // Append to file with newline
            fs.appendFileSync(logPath, logEntry + '\n');
        } catch (error) {
            console.error('Error logging invalid data:', error);
        }
    }
}