import { z } from 'zod';

/** Request schemas. Every route body is parsed through one of these before anything else. */

export const checkoutSchema = z.object({
  word: z.string().min(1).max(60),
  brandName: z.string().trim().min(1, 'Enter your brand or product name.').max(60),
  url: z.string().min(1).max(2000),
  /** Whole cents. The client sends cents so no float ever crosses the wire. */
  amountCents: z.number().int().positive(),
  description: z.string().trim().max(160).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const boostSchema = z.object({
  word: z.string().min(1).max(60),
  /** The word's desired resulting value, in whole cents — not the difference charged. */
  targetValueCents: z.number().int().positive(),
});

export type BoostInput = z.infer<typeof boostSchema>;

export const adminActionSchema = z.object({
  action: z.enum(['block_word', 'unblock_word', 'block_owner']),
  id: z.string().min(1),
});
