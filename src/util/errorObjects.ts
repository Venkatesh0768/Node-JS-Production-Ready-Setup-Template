import config from '../config/config';
import { EApplicationEnvironment } from '../constant/application';
import responseMessage from '../constant/responseMessage'
import { THttpError } from '../types/types';
import { Request } from 'express';
import logger from './logger';

export default (err : Error | unknown , req: Request , errorStatusCode: number  = 500) => {
    
    const errorObj: THttpError = {
        success: false,
        status_code: errorStatusCode,
        request: {
            ip: req.ip  ?? null,
            method: req.method,
            url: req.url
        },
        message: err instanceof Error ? err.message || responseMessage.SOMETHING_WENT_WRONG : responseMessage.SOMETHING_WENT_WRONG,
        data: null,
        trace: err instanceof Error ? {error: err.stack} : null
    }
    logger.error(`ERROR_OBJECT` , { meta: errorObj});

    if(config.ENV === EApplicationEnvironment.PRODUCTION){
        delete errorObj.trace;
        delete errorObj.request.ip;
    }

    return errorObj;
    
}