import { Router } from 'express';import { requireAuth } from '../../middleware/auth.js';import { asyncHandler,HttpError } from '../../utils/http.js';export const aiRouter=Router();
aiRouter.post('/chat',requireAuth,asyncHandler(async(_req,_res)=>{throw new HttpError(503,'AI provider is not configured. Add a server-side provider adapter; never expose its API key to the frontend.');}));
