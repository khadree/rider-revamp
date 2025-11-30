import express from 'express';
import { RiderController } from '../controllers/riderController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

router.post('/auth/register', RiderController.register);
router.post('/auth/login', RiderController.login);
router.post('/auth/verify-email', RiderController.verifyEmail);
router.post('/auth/forgot-password', RiderController.forgotPassword);
router.post('/auth/reset-password', RiderController.resetPassword);

router.get('/auth/google', RiderController.googleAuth);
router.get('/auth/google/callback', RiderController.googleAuthCallback);

router.get('/profile', authenticateToken, RiderController.getCurrentRider);
router.get('/:id', RiderController.getRider); 

router.post('/ride-requests', authenticateToken, RiderController.createRideRequest);
router.get('/ride-requests/history', authenticateToken, RiderController.getRiderRideRequests);
router.get('/ride-requests/:id', RiderController.getRideRequest);
router.delete('/ride-requests/:id', RiderController.cancelRideRequest);

export default router;