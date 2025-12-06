import { Request, Response } from 'express';
import { RiderRepository, CreateRideRequestInput } from '../models/Riders';
import { AuthUtils } from '../utils/auth';
import { EmailServiceClient } from '../utils/email-service-client';
import { redis } from '../config/redis';
import { AuthRequest } from '../middleware/auth';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from '../utils/validation';

export class RiderController {
  private static googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.RIDER_SERVICE_URL || 'http://localhost:3001'}/api/riders/auth/google/callback`
  );


  private static async logAndPublish(channel: string, data: any): Promise<void> {
    const eventData = {
      event: channel,
      timestamp: new Date().toISOString(),
      data
    };
    
    try {
      await redis.publish(channel, JSON.stringify(eventData));
      console.log(`✅ REDIS PUBLISH SUCCESS [${channel}]`);
    } catch (error) {
      console.error(`❌ REDIS PUBLISH FAILED [${channel}]:`, error);
      throw error;
    }
  }

  static googleAuth = async (req: Request, res: Response) => {
    try {
      const redirectUri = `${process.env.RIDER_SERVICE_URL || 'http://localhost:3001'}/api/riders/auth/google/callback`;

      const url = this.googleClient.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile'
        ],
        prompt: 'consent',
        redirect_uri: redirectUri
      });

      console.log('🔗 Google OAuth URL:', url);

      // Publish Google auth initiation event
      await this.logAndPublish('rider.google_auth_initiated', {
        ip: req.ip,
        user_agent: req.headers['user-agent']
      });

      res.redirect(url);

    } catch (error: any) {
      console.error('Google auth error:', error);
      
      // Publish Google auth error event
      await this.logAndPublish('rider.google_auth_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Google authentication failed'
      });
    }
  };

  static googleAuthCallback = async (req: Request, res: Response) => {
    try {
      const { code } = req.query;

      if (!code || typeof code !== 'string') {
        await this.logAndPublish('rider.google_auth_callback_error', {
          error: 'invalid_code',
          ip: req.ip
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_google_auth`);
      }

      const { tokens } = await this.googleClient.getToken(code);
      this.googleClient.setCredentials(tokens);

      const ticket = await this.googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();
      if (!payload) {
        await this.logAndPublish('rider.google_auth_callback_error', {
          error: 'invalid_payload',
          ip: req.ip
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=google_auth_failed`);
      }

      const { email, given_name, family_name, picture } = payload;

      if (!email) {
        await this.logAndPublish('rider.google_auth_callback_error', {
          error: 'email_required',
          ip: req.ip
        });
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=email_required`);
      }

      // Check if rider exists
      let rider = await RiderRepository.findRiderByEmail(email);

      if (!rider) {
        // Create new rider with Google auth
        const verificationToken = AuthUtils.generateRandomToken();

        rider = await RiderRepository.createRider({
          firstName: given_name || 'Google',
          lastName: family_name || 'User',
          email: email,
          phone: '+2340000000000',
          passwordHash: await AuthUtils.hashPassword(AuthUtils.generateRandomToken(16)),
          verificationToken: verificationToken
        });

        // Auto-verify Google users
        await RiderRepository.updateRiderVerification(rider.id, true);

        // Publish rider registered event
        await this.logAndPublish('rider.registered', {
          rider_id: rider.id,
          email: rider.email,
          name: `${rider.firstName} ${rider.lastName}`,
          phone: rider.phone,
          auth_method: 'google'
        });
      }

      // Publish Google auth success event
      await this.logAndPublish('rider.google_auth_success', {
        rider_id: rider.id,
        email: rider.email,
        auth_method: 'google'
      });

      const token = AuthUtils.generateToken({
        riderId: rider.id,
        email: rider.email,
        firstName: rider.firstName,
        lastName: rider.lastName,
        phone: rider.phone,
        rating: rider.rating || 4.8,
      });

      res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}&rider=${encodeURIComponent(JSON.stringify({
        id: rider.id,
        firstName: rider.firstName,
        lastName: rider.lastName,
        email: rider.email,
        phone: rider.phone,
        isVerified: rider.isVerified,
        rating: rider.rating,
        totalTrips: rider.totalTrips,
      }))}`);

    } catch (error: any) {
      console.error('Google callback error:', error);
      
      await this.logAndPublish('rider.google_auth_callback_error', {
        error: error.message,
        ip: req.ip
      });

      res.redirect(`${process.env.FRONTEND_URL}/login?error=google_auth_failed`);
    }
  };

  static register = async (req: Request, res: Response) => {
    try {
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        console.log('❌ VALIDATION FAILED:');
        console.log('Error details:', JSON.stringify(error.details, null, 2));
        console.log('Error message:', error.message);

        // Publish registration validation error
        await this.logAndPublish('rider.registration_validation_error', {
          error: error.details[0].message,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { email, password, firstName, lastName, phoneNumber } = value;
      
      const existingRider = await RiderRepository.findRiderByEmail(email);
      if (existingRider) {
        console.log('❌ Rider already exists with email:', email);
        
        // Publish duplicate registration attempt
        await this.logAndPublish('rider.registration_duplicate', {
          email: email,
          ip: req.ip
        });

        return res.status(409).json({
          success: false,
          error: 'Rider already exists with this email'
        });
      }

      const hashedPassword = await AuthUtils.hashPassword(password);
      const verificationToken = AuthUtils.generateRandomToken();
      const rider = await RiderRepository.createRider({
        firstName,
        lastName,
        email,
        phone: `+234${phoneNumber}`,
        passwordHash: hashedPassword,
        verificationToken
      });

      // Publish verification email sent event
      await this.logAndPublish('rider.verification_email_sent', {
        rider_id: rider.id,
        email: rider.email
      });

      EmailServiceClient.sendVerificationEmail(email, verificationToken)
        .then(success => {
          if (success) {
            console.log(`✅ Verification email sent to ${email}`);
          } else {
            console.log(`⚠️ Failed to send verification email to ${email}`);
          }
        })
        .catch(err => {
          console.error(`❌ Error sending verification email:`, err);
        });

      const token = AuthUtils.generateToken({
        riderId: rider.id,
        email: rider.email,
        firstName: rider.firstName,
        lastName: rider.lastName,
        phone: rider.phone,
        rating: rider.rating || 4.8,
      });

      await this.logAndPublish('rider.registered', {
        rider_id: rider.id,
        email: rider.email,
        name: `${rider.firstName} ${rider.lastName}`,
        phone: rider.phone,
        auth_method: 'manual'
      });

      res.status(201).json({
        success: true,
        data: {
          rider: {
            id: rider.id,
            firstName: rider.firstName,
            lastName: rider.lastName,
            email: rider.email,
            phone: rider.phone,
            isVerified: rider.isVerified,
          },
          token
        }
      });

    } catch (error: any) {
      console.error('Registration error:', error);
      
      // Publish registration error event
      await this.logAndPublish('rider.registration_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static login = async (req: Request, res: Response) => {
    try {
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        // Publish login validation error
        await this.logAndPublish('rider.login_validation_error', {
          error: error.details[0].message,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { email, password } = value;

      const rider = await RiderRepository.findRiderByEmail(email);
      if (!rider) {
        // Publish failed login attempt
        await this.logAndPublish('rider.login_failed', {
          email: email,
          reason: 'rider_not_found',
          ip: req.ip
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      if (!rider.isActive) {
        // Publish login attempt to deactivated account
        await this.logAndPublish('rider.login_failed', {
          rider_id: rider.id,
          email: rider.email,
          reason: 'account_deactivated',
          ip: req.ip
        });

        return res.status(401).json({
          success: false,
          error: 'Account is deactivated'
        });
      }

      const isPasswordValid = await AuthUtils.comparePassword(password, rider.passwordHash);
      if (!isPasswordValid) {
        // Publish failed login attempt (invalid password)
        await this.logAndPublish('rider.login_failed', {
          rider_id: rider.id,
          email: rider.email,
          reason: 'invalid_password',
          ip: req.ip
        });

        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      await RiderRepository.updateLastLogin(rider.id);

      const token = AuthUtils.generateToken({
        riderId: rider.id,
        email: rider.email,
        firstName: rider.firstName,
        lastName: rider.lastName,
        phone: rider.phone,
        rating: rider.rating || 4.8,
      });

      // Publish successful login event
      await this.logAndPublish('rider.logged_in', {
        rider_id: rider.id,
        email: rider.email,
        name: `${rider.firstName} ${rider.lastName}`,
        login_time: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      });

      res.json({
        success: true,
        data: {
          rider: {
            id: rider.id,
            firstName: rider.firstName,
            lastName: rider.lastName,
            email: rider.email,
            phone: rider.phone,
            isVerified: rider.isVerified,
            rating: rider.rating,
            totalTrips: rider.totalTrips,
          },
          token
        }
      });

    } catch (error: any) {
      console.error('Login error:', error);
      
      // Publish login error event
      await this.logAndPublish('rider.login_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static verifyEmail = async (req: Request, res: Response) => {
    try {
      const { error, value } = verifyEmailSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { token } = value;

      const rider = await RiderRepository.findRiderByVerificationToken(token);
      if (!rider) {
        // Publish invalid verification token attempt
        await this.logAndPublish('rider.verification_failed', {
          reason: 'invalid_token',
          token: token
        });

        return res.status(400).json({
          success: false,
          error: 'Invalid verification token'
        });
      }

      if (rider.isVerified) {
        // Publish already verified attempt
        await this.logAndPublish('rider.verification_failed', {
          rider_id: rider.id,
          email: rider.email,
          reason: 'already_verified'
        });

        return res.status(400).json({
          success: false,
          error: 'Email already verified'
        });
      }

      const updatedRider = await RiderRepository.updateRiderVerification(rider.id, true);

      await this.logAndPublish('rider.verified', {
        rider_id: updatedRider.id,
        email: updatedRider.email,
        verified_at: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          rider: {
            id: updatedRider.id,
            firstName: updatedRider.firstName,
            lastName: updatedRider.lastName,
            email: updatedRider.email,
            phone: updatedRider.phone,
            isVerified: updatedRider.isVerified,
          }
        }
      });

    } catch (error: any) {
      console.error('Email verification error:', error);
      
      // Publish verification error event
      await this.logAndPublish('rider.verification_error', {
        error: error.message
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static forgotPassword = async (req: Request, res: Response) => {
    try {
      const { error, value } = forgotPasswordSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { email } = value;

      const rider = await RiderRepository.findRiderByEmail(email);
      if (!rider) {
        // Don't reveal whether email exists, but still publish event
        await this.logAndPublish('rider.forgot_password_requested', {
          email: email,
          status: 'email_not_found',
          ip: req.ip
        });

        return res.json({
          success: true,
          data: { message: 'If the email exists, a password reset link has been sent' }
        });
      }

      const resetToken = AuthUtils.generateRandomToken();
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);

      await RiderRepository.updateRiderResetToken(rider.id, resetToken, resetTokenExpiry);

      // Publish reset email sent event
      await this.logAndPublish('rider.password_reset_email_sent', {
        rider_id: rider.id,
        email: rider.email
      });

      // Send password reset email
      EmailServiceClient.sendPasswordResetEmail(email, resetToken)
        .then(success => {
          if (success) {
            console.log(`✅ Password reset email sent to ${email}`);
          } else {
            console.log(`⚠️ Failed to send password reset email to ${email}`);
          }
        })
        .catch(err => {
          console.error(`❌ Error sending password reset email:`, err);
        });

      await this.logAndPublish('rider.forgot_password', {
        rider_id: rider.id,
        email: rider.email,
        reset_token_created: new Date().toISOString(),
        ip: req.ip
      });

      res.json({
        success: true,
        data: { message: 'If the email exists, a password reset link has been sent' }
      });

    } catch (error: any) {
      console.error('Forgot password error:', error);
      
      // Publish forgot password error event
      await this.logAndPublish('rider.forgot_password_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static resetPassword = async (req: Request, res: Response) => {
    try {
      const { error, value } = resetPasswordSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const { token, password } = value;

      const rider = await RiderRepository.findRiderByResetToken(token);
      if (!rider) {
        // Publish invalid reset token attempt
        await this.logAndPublish('rider.password_reset_failed', {
          reason: 'invalid_token',
          token: token,
          ip: req.ip
        });

        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token'
        });
      }

      const hashedPassword = await AuthUtils.hashPassword(password);
      const updatedRider = await RiderRepository.updateRiderPassword(rider.id, hashedPassword);

      await this.logAndPublish('rider.password_reset', {
        rider_id: updatedRider.id,
        email: updatedRider.email,
        reset_at: new Date().toISOString(),
        ip: req.ip
      });

      res.json({
        success: true,
        data: { message: 'Password reset successfully' }
      });

    } catch (error: any) {
      console.error('Reset password error:', error);
      
      // Publish password reset error event
      await this.logAndPublish('rider.password_reset_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static getCurrentRider = async (req: AuthRequest, res: Response) => {
    try {
      const riderId = req.rider?.riderId;

      if (!riderId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const rider = await RiderRepository.findRiderById(riderId);
      if (!rider) {
        return res.status(404).json({
          success: false,
          error: 'Rider not found'
        });
      }

      // Publish profile view event
      await this.logAndPublish('rider.profile_viewed', {
        rider_id: rider.id,
        email: rider.email,
        viewed_at: new Date().toISOString(),
        ip: req.ip
      });

      res.json({
        success: true,
        data: {
          rider: {
            id: rider.id,
            firstName: rider.firstName,
            lastName: rider.lastName,
            email: rider.email,
            phone: rider.phone,
            isVerified: rider.isVerified,
            rating: rider.rating,
            totalTrips: rider.totalTrips,
            createdAt: rider.createdAt,
          }
        }
      });

    } catch (error: any) {
      console.error('Get rider error:', error);
      
      // Publish profile view error event
      await this.logAndPublish('rider.profile_view_error', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static getRider = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rider = await RiderRepository.findRiderById(id);

      if (!rider) {
        // Publish rider not found event
        await this.logAndPublish('rider.lookup_failed', {
          rider_id: id,
          reason: 'not_found',
          ip: req.ip
        });

        return res.status(404).json({
          success: false,
          error: 'Rider not found'
        });
      }

      // Publish rider lookup event
      await this.logAndPublish('rider.looked_up', {
        rider_id: rider.id,
        email: rider.email,
        looked_up_by: req.ip,
        looked_up_at: new Date().toISOString()
      });

      res.json({
        success: true,
        data: {
          rider: {
            id: rider.id,
            firstName: rider.firstName,
            lastName: rider.lastName,
            email: rider.email,
            phone: rider.phone,
            rating: rider.rating,
            totalTrips: rider.totalTrips,
          }
        }
      });

    } catch (error: any) {
      console.error('Get rider error:', error);
      
      // Publish rider lookup error event
      await this.logAndPublish('rider.lookup_error', {
        rider_id: req.params.id,
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

 static createRideRequest = async (req: AuthRequest, res: Response) => {
	try {
		const riderId = req.rider?.riderId;
		if (!riderId) {
			return res.status(401).json({
				success: false,
				error: 'Authentication required'
			});
		}

		const {
			pickup_lat,
			pickup_lng,
			pickup_address,
			dropoff_lat,
			dropoff_lng,
			dropoff_address,
			vehicle_type,
			fare 
		} = req.body;
		console.log(pickup_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, vehicle_type, fare) 
		const isMissing = !pickup_lat || !pickup_lng ||
			!dropoff_lat || !dropoff_lng ||
			!fare;
			
		if (isMissing) { 
			console.error('❌ Missing required fields in request');
			await this.logAndPublish('ride.request_validation_error', {
				rider_id: riderId,
				reason: 'missing_fields',
				ip: req.ip
			});

			return res.status(400).json({
				success: false,
				error: 'Pickup and dropoff coordinates, and fare are required'
			});
		}

		const pickupLat = parseFloat(pickup_lat);
		const pickupLng = parseFloat(pickup_lng);
		const dropoffLat = parseFloat(dropoff_lat);
		const dropoffLng = parseFloat(dropoff_lng);
		const rideFare = parseFloat(fare); 
		
		if (isNaN(pickupLat) || isNaN(pickupLng) || isNaN(dropoffLat) || isNaN(dropoffLng) || isNaN(rideFare) || rideFare <= 0) { // <-- VALIDATE FARE
			console.error('❌ Invalid numeric values:', {
				pickupLat, pickupLng, dropoffLat, dropoffLng, rideFare
			});

			await this.logAndPublish('ride.request_validation_error', {
				rider_id: riderId,
				reason: 'invalid_numeric_values',
				coordinates: { pickupLat, pickupLng, dropoffLat, dropoffLng },
				fare: rideFare,
				ip: req.ip
			});

			return res.status(400).json({
				success: false,
				error: 'Invalid coordinate or fare values'
			});
		}

    const new_ride_request_id = uuidv4();
		const rideRequestDataForMatching = {
			ride_request_id: new_ride_request_id,
			rider_id: riderId,
			rider_name: `${req.rider?.firstName || ''} ${req.rider?.lastName || ''}`.trim() || 'Passenger',
			rider_rating: req.rider?.rating || 4.8,
			pickup_location: {
				lat: pickupLat,
				lng: pickupLng,
				address: pickup_address || 'Selected location'
			},
			dropoff_location: {
				lat: dropoffLat,
				lng: dropoffLng,
				address: dropoff_address || 'Selected destination'
			},
			vehicle_type: vehicle_type || 'standard',
			fare: rideFare, 
			requested_at: new Date().toISOString(),
			ip: req.ip
		};
		await this.logAndPublish('ride.requested', rideRequestDataForMatching);

		console.log(`✅ Ride request ${rideRequestDataForMatching.ride_request_id} published to matching queue.`);
		return res.status(202).json({
			success: true,
			message: 'Ride request accepted. Searching for driver.',
			data: {
				rideRequestId: rideRequestDataForMatching.ride_request_id,
				status: 'PENDING_MATCHING',
				pickup: rideRequestDataForMatching.pickup_location,
				dropoff: rideRequestDataForMatching.dropoff_location,
				fare: rideRequestDataForMatching.fare // Also return fare in response
			}
		});

	} catch (error: any) {
		// ... (General error handling) ...
		console.error('❌ Create ride request error:', error);
		await this.logAndPublish('ride.request_error', {
			rider_id: req.rider?.riderId,
			error: error.message,
			ip: req.ip
		});

		res.status(500).json({
			success: false,
			error: 'Internal server error'
		});
	}
};

  static getRideRequest = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const rideRequest = await RiderRepository.getRideRequestById(id);

      if (!rideRequest) {
        // Publish ride request not found event
        await this.logAndPublish('ride.request_lookup_failed', {
          ride_request_id: id,
          reason: 'not_found',
          ip: req.ip
        });

        return res.status(404).json({
          success: false,
          error: 'Ride request not found'
        });
      }

      // Publish ride request view event
      await this.logAndPublish('ride.request_viewed', {
        ride_request_id: rideRequest.id,
        rider_id: rideRequest.riderId,
        status: rideRequest.status,
        viewed_at: new Date().toISOString(),
        ip: req.ip
      });

      res.json({
        success: true,
        data: { rideRequest }
      });

    } catch (error: any) {
      console.error('Get ride request error:', error);
      
      // Publish ride request lookup error event
      await this.logAndPublish('ride.request_lookup_error', {
        ride_request_id: req.params.id,
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static getRiderRideRequests = async (req: AuthRequest, res: Response) => {
    try {
      const riderId = req.rider?.riderId;

      if (!riderId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const { limit = '10', offset = '0', status } = req.query;

      const rideRequests = await RiderRepository.getRiderRideRequests(
        riderId,
        parseInt(limit as string),
        parseInt(offset as string)
      );

      // Publish ride history view event
      await this.logAndPublish('rider.ride_history_viewed', {
        rider_id: riderId,
        filters: { status, limit, offset },
        request_count: rideRequests.length,
        viewed_at: new Date().toISOString(),
        ip: req.ip
      });

      // Filter by status if provided
      const filteredRequests = status
        ? rideRequests.filter(req => req.status === status)
        : rideRequests;

      res.json({
        success: true,
        data: {
          rideRequests: filteredRequests,
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: filteredRequests.length
          }
        }
      });

    } catch (error: any) {
      console.error('Get rider ride requests error:', error);
      
      // Publish ride history view error event
      await this.logAndPublish('rider.ride_history_view_error', {
        rider_id: req.rider?.riderId,
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };

  static cancelRideRequest = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const rideRequest = await RiderRepository.updateRideRequestStatus(id, 'cancelled');

      // Publish ride cancelled event
      await this.logAndPublish('ride.cancelled', {
        ride_request_id: rideRequest.id,
        rider_id: rideRequest.riderId,
        cancelled_by: 'rider',
        reason: reason || 'No reason provided',
        cancelled_at: new Date().toISOString(),
        ip: req.ip
      });

      res.json({
        success: true,
        data: { rideRequest }
      });

    } catch (error: any) {
      console.error('Cancel ride request error:', error);
      
      // Publish ride cancellation error event
      await this.logAndPublish('ride.cancellation_error', {
        ride_request_id: req.params.id,
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };
}