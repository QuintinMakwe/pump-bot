import { getQueueToken } from '@nestjs/bull';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@src/app.module';
import { QUEUE } from '@src/constant';
import { TokenMonitoringService } from '@src/services/token-monitoring.service';
import { FormattedCreateEvent } from '@src/types/token.types';
import { Queue } from 'bull';

async function testTokenMonitoring() {
    try {
        const app = await NestFactory.createApplicationContext(AppModule);
        const tokenMonitoringService = app.get(TokenMonitoringService);

        console.log('Starting TokenMonitoringService tests...\n');

        // Test 1: checkEntryConditions
        console.log('Test 1: checkEntryConditions');
        const testMintAddress = 'CWy3ck2DwmHWMrsjmAVYG6yv25XUjvaearJAMtF6pump';
        const entryConditions = await tokenMonitoringService.checkEntryConditions(testMintAddress);
        console.log('Entry Conditions Check Result:', entryConditions);
        console.log('----------------------------------------\n');

        // Test 2: checkExitConditions
        console.log('Test 2: checkExitConditions');
        const testEntryPrice = 0.00000006550033577824522;
        const exitConditions = await tokenMonitoringService.checkExitConditions(testMintAddress, testEntryPrice);
        console.log('Exit Conditions Check Result:', exitConditions);
        console.log('----------------------------------------\n');

        await app.close();
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }
}


// testTokenMonitoring()
//     .then(() => process.exit(0))
//     .catch((error) => {
//         console.error('Fatal error:', error);
//         process.exit(1);
//     });


async function testQueueMonitoring() {
    try {
        const app = await NestFactory.createApplicationContext(AppModule);
        const tokenMonitoringService = app.get(TokenMonitoringService);
        const monitoringQueue = app.get<Queue>(getQueueToken(QUEUE.TOKEN_MONITORING.name));

        console.log('Starting TokenMonitoringService tests...\n');

        // Test 1: startInitialMonitoring
        console.log('Test 1: startInitialMonitoring');
        const testCreateEvent: FormattedCreateEvent = {
            mint: 'CWy3ck2DwmHWMrsjmAVYG6yv25XUjvaearJAMtF6pump',
            creator: 'BNbt2Cxct1DHvxSg5gUsuRSybFcmgP8AbYqZbQKymBnw',
            timestamp: new Date('2024-11-20T18:57:07.742+00:00'),
            bondingCurve: '5y3qAxyPYk3FSM9W4DfbZ5t9eBXGdmWPFvmRSAwVjqLB',
            name: 'HEZXXBDZ',
            symbol: 'QFDBX',
            uri: "https://ipfs.io/ipfs/QmfVNYCcThdRWRi4HfgGTUGY4VeJNboYtykyyDR6sSzwhP"
        };

        await tokenMonitoringService.startInitialMonitoring(testCreateEvent);

        // Check queue status
        const initialJobs = await monitoringQueue.getJobs(['waiting', 'active', 'delayed']);
        console.log('Initial monitoring jobs:', initialJobs.length);
        console.log('Job data:', initialJobs[0]?.data);
        console.log('----------------------------------------\n');
        
        // Test 2: startPositionMonitoring
        console.log('Test 2: startPositionMonitoring');
        await tokenMonitoringService.startPositionMonitoring(testCreateEvent.mint);

        // Check queue status again
        const positionJobs = await monitoringQueue.getJobs(['waiting', 'active', 'delayed']);
        console.log('Position monitoring jobs:', positionJobs.length);
        console.log('Job data:', positionJobs[positionJobs.length - 1]?.data);
        console.log('----------------------------------------\n');

        // Wait for a few monitoring intervals to see the periodic checks
        console.log('Waiting for monitoring intervals...');
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

        const activeJobs = await monitoringQueue.getJobs(['active']);
        console.log('Active jobs after waiting:', activeJobs.length);
        console.log('----------------------------------------\n');

        // Cleanup
        await monitoringQueue.clean(0, 'completed');
        await monitoringQueue.clean(0, 'failed');
        
        await app.close();
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }
}

testQueueMonitoring()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });