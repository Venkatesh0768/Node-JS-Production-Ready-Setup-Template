import express, { Application, NextFunction, Request, Response } from 'express';
import path from 'path';
import router from './router/apiRouter';
import gobalErrorHandler from './middlerware/gobalErrorHandler';
import responseMessage from './constant/responseMessage';
import httpError from './util/httpError';

const app: Application = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../', 'public')));



app.use('/api/v1/' , router)
app.use(gobalErrorHandler)

//not found
app.use((req : Request , _: Response , next: NextFunction) => {
    try{
        throw new Error(responseMessage.NOT_FOUND('route'));

    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    }catch(error: Error | unknown ){
        httpError(next , error , req , 404)
    }
})

export default app;
