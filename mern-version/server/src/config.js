import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
export const config = z.object({
  PORT: z.coerce.number().int().default(5000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/store?replicaSet=rs0'),
  JWT_SECRET: z.string().min(32),
  CLIENT_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173').transform(value => value.split(',').map(origin => origin.trim())),
  MOCK_MODE: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  TAX_RATE: z.coerce.number().min(0).max(1).default(0.08),
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  EVAL_SERVICE_TOKEN: z.string().optional(),
}).parse(process.env);
