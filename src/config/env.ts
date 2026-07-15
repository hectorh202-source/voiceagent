import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  // The master key protecting every ServiceTitan/ElevenLabs/SMTP credential
  // (see settings/encryptionKey.ts). Optional so an unmigrated deployment
  // still starts (falling back to the old file-based key, with a loud
  // warning) — but if set, it must be a real 32-byte key, not silently
  // ignored if malformed. docker-compose's `${ENCRYPTION_KEY:-}` substitution
  // yields an empty string rather than an absent variable when unset, so
  // that's normalized to undefined before the regex check runs — otherwise
  // every unmigrated deployment would fail to start at all.
  ENCRYPTION_KEY: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z
      .string()
      .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)")
      .optional(),
  ),
});

export const env = envSchema.parse(process.env);
