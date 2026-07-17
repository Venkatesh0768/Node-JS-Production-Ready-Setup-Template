/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { NextFunction, Request } from 'express';
import errorObject from './errorObjects';

export default(nextFunc: NextFunction , err: Error | unknown , req: Request , errorStatusCode: number  = 500 ) : void => {
    
    const errorObj = errorObject(err , req , errorStatusCode);
    return nextFunc(errorObj)
    
}