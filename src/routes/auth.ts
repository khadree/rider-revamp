import express from 'express';
import { RiderController } from '../controllers/riderController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

router.get('/google', RiderController.googleAuth);
router.get('/google/callback', RiderController.googleAuthCallback);

export default router;