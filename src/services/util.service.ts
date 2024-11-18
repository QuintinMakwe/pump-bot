import { Injectable } from '@nestjs/common';
const axios = require("axios").default


@Injectable()
export class Utils {
    constructor(
    ) { }

    makeAsyncCall<T, E extends new (message?: string) => Error>(
        promise: Promise<T>,
        errorsToCatch?: E[]
    ): Promise<[undefined, T] | [InstanceType<E>]> {
        return promise
            .then(data => {
                return [undefined, data] as [undefined, T];
            })
            .catch(error => {
                if (errorsToCatch === undefined) {
                    return [error];
                }

                if (errorsToCatch.some(e => error instanceof e)) {
                    return [error];
                }

                return [error];
            });
    }

    getRandomData = (length = 30, withChar = false): string => {
        let text = '';
        let possible =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

        if (withChar) {
            possible += '@#$*()&{}><!%[]/';
        }

        for (let i = 0; i < length; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));

        return text;
    };

    getHttpservice() {
        const agent = axios.create({
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': `pilot/pump.fun-${this.getRandomData(6)}`
            },
        });

        agent.interceptors.response.use(
            function (response: any) {
                // console.log('response from API call ', response);
                return response;
            },
            function (error: any) {
                console.log('error from API call ', error);
                return Promise.reject(error);
            },
        );

        return agent;
    }

}