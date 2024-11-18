import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class BullBoardAuthMiddleware implements NestMiddleware {
    constructor(private configService: ConfigService) { }

    use(req: Request, res: Response, next: NextFunction) {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
            return res.status(401).send('Authentication required');
        }

        const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
        const user = auth[0];
        const pass = auth[1];

        const configUser = this.configService.get<string>('BULL_BOARD_ADMIN_USER');
        const configPass = this.configService.get<string>('BULL_BOARD_ADMIN_PASS');

        if (user === configUser && pass === configPass) {
            next();
        } else {
            res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
            res.status(401).send('Authentication required');
        }
    }
}