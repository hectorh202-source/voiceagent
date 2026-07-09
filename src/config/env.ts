import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
});

export const env = envSchema.parse(process.env);
