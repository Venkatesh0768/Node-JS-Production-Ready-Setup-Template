import { Request, Response } from 'express';
import { THttpResponse } from '../types/types';
import config  from '../config/config';
import { EApplicationEnvironment } from '../constant/application';

export default (req: Request, res: Response, responseStatus: number, responseMessage: string, responseData?: unknown) => {
        const response: THttpResponse = {
            success: true,
            status_code:responseStatus,
            request: {
                ip: req.ip ?? null,
                method: req.method,
                url: req.url
            },
            message:responseMessage,
            data:responseData
        }
     
        // eslint-disable-next-line no-console
        console.info(`CONTROLLER_RESPONSE` , {
            meta: response
        })

        if(config.ENV === EApplicationEnvironment.PRODUCTION){
            delete response.request.ip;
        }

        return res.status(responseStatus).json(response)
 }
