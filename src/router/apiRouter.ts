import { Router } from 'express';
import apiController from '../controller/apiController';
import flightRouter from './flightRouter';

const router = Router();

// Health / self check
router.route('/self').get(apiController.self);

// Flight booking API — all routes under /api/v1/flights/
router.use('/flights', flightRouter);

export default router;
