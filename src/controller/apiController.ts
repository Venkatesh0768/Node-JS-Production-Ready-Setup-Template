import { NextFunction, Request, Response } from 'express';
import httpResponse from '../util/httpResponse';
import ResponseMessage from '../constant/responseMessage';
import httpError from '../util/httpError';


export default{
    self: (request :Request , response: Response , next: NextFunction) =>{
        try {
            httpResponse(request , response, 200 , ResponseMessage.SUCCESS)
        } catch (error) {
           httpError(next , error , request , 500)
        }
    }
}