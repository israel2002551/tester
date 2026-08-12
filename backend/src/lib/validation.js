import { z } from 'zod';

export const uuid = z.string().uuid();
export const moneyString = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);
export const paginationQuery = z.object({ page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() }).passthrough();
export const optionalHttpUrl = z.string().url().max(2048).optional().nullable();

export function cleanText(max = 5000) {
  return z.string().trim().min(1).max(max);
}
