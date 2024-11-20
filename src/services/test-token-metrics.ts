import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TokenMetricsService } from '../services/token-metrics.service';

async function testTokenMetrics() {
    try {
        // Create a NestJS application context
        const app = await NestFactory.createApplicationContext(AppModule);
        
        // Get the TokenMetricsService instance
        const tokenMetricsService = app.get(TokenMetricsService);

        console.log('Starting TokenMetricsService tests...\n');

        // Test 1: getSolPrice
        console.log('Test 1: getSolPrice');
        const solPrice = await tokenMetricsService['getSolPrice']();
        console.log('SOL Price:', solPrice);
        console.log('----------------------------------------\n');
        
        // Test 2: getTokenMetrics
        console.log('Test 2: getTokenMetrics');
        const testMintAddress = 'Fjg5NUYUmArMDgLUnWDG9eVFcAmz9divakZkwiH6pump';
        const metrics = await tokenMetricsService.getTokenMetrics(testMintAddress);
        console.log('Token Metrics:', JSON.stringify(metrics, null, 2));
        console.log('----------------------------------------\n');
      
        await app.close();
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }
}

// Run the tests
testTokenMetrics()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });