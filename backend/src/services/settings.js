import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

export const SAFE_SETTING_SCHEMAS = Object.freeze({
  marketplace: z.object({ maintenanceMode: z.boolean().default(false), sellerOnboardingOpen: z.boolean().default(true), supplierOnboardingOpen: z.boolean().default(true) }).strict(),
  checkout: z.object({ enabledDeliveryMethods: z.array(z.enum(['STANDARD', 'EXPRESS', 'PICKUP'])).min(1), minimumOrderKobo: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).default(0) }).strict(),
  support: z.object({ email: z.string().email(), phone: z.string().trim().max(30).optional(), hours: z.string().trim().max(160).optional() }).strict(),
  homepage: z.object({ announcement: z.string().trim().max(240).optional(), announcementEnabled: z.boolean().default(false) }).strict(),
  sourcing_public: z.object({ enabled: z.boolean().default(true), minimumItems: z.number().int().min(1).max(50).default(1), guidance: z.string().trim().max(1000).optional() }).strict(),
});

export const safeSettingKeys = Object.freeze(Object.keys(SAFE_SETTING_SCHEMAS));

export function validateSafeSetting(key, value) {
  const schema = SAFE_SETTING_SCHEMAS[key];
  if (!schema) throw badRequest('SETTING_NOT_ALLOWED', 'This setting is unknown or may contain sensitive configuration and cannot be managed through the API.');
  return schema.parse(value);
}
