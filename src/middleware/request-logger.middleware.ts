import { Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export function RequestLogger(req: Request, res: Response, next: NextFunction) {
  const logger = new Logger('HTTP');
  const client_ip = (req.ip || req.ips[0]).split(':').pop() || '';

  res.on('finish', () => {
    logger.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} -  ${client_ip}`,
    );
  });
  next();
}
