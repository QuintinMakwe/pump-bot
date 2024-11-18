import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE } from '@src/constant';
import { BullBoardAuthMiddleware } from '@src/middleware/bullboard-auth.middleware';
import { RequestLogger } from './middleware/request-logger.middleware';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);
    const config = app.get(ConfigService);

    app.use(RequestLogger);
    app.useGlobalPipes(new ValidationPipe({whitelist: true}));

    const monitoringQueue = app.get<Queue>(getQueueToken(QUEUE.TOKEN_MONITORING.name));
    const analyticsQueue = app.get<Queue>(getQueueToken(QUEUE.TOKEN_ANALYTICS.name));
    const notificationsQueue = app.get<Queue>(getQueueToken(QUEUE.NOTIFICATIONS.name));


    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    const bullBoard = createBullBoard({
      queues: [
        new BullAdapter(monitoringQueue),
        new BullAdapter(analyticsQueue),
        new BullAdapter(notificationsQueue)
      ],
      serverAdapter
    });

    console.log('Bull Board created 🎯');

    app.use('/admin/queues', (req, res, next) => {
      const bullBoardAuthMiddleware = app.get(BullBoardAuthMiddleware);
      bullBoardAuthMiddleware.use(req, res, next);
    });

    app.use('/admin/queues', serverAdapter.getRouter());

    await app.listen(config.get('PORT'));
    console.log(`Application running on port ${config.get('PORT')} 🚀`);
    console.log(`Bull Board available at 💻: http://localhost:${config.get('PORT')}/admin/queues`);
  } catch (error) {
    console.error('Bootstrap error:', error);
    process.exit(1);
  }
}

bootstrap();
