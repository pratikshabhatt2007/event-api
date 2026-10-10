import { z } from 'zod';
import { badRequest } from './errors.js';

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid ISO date/time (e.g. 2026-11-20T10:00:00Z)')
  .transform((v) => new Date(v).toISOString());

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const eventFields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).default(''),
  date_time: isoDate,
  venue: z.string().trim().min(1, 'Venue is required').max(200),
  capacity: z.number({ invalid_type_error: 'Capacity must be a number' }).int().min(1, 'Capacity must be at least 1').max(1_000_000),
  category: z.string().trim().min(1, 'Category is required').max(60),
};

export const createEventSchema = z.object(eventFields);
export const updateEventSchema = z
  .object(eventFields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one field to update');

export const listEventsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  available: z.enum(['true', 'false']).optional(),
  upcoming: z.enum(['true', 'false']).optional(),
  sort: z.enum(['date_asc', 'date_desc', 'newest']).default('date_asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
});

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    throw badRequest(details[0]?.message || 'Validation failed', details);
  }
  return result.data;
}

export function parseId(value, label = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw badRequest(`Invalid ${label}`);
  return id;
}
