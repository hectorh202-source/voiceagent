import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "../config/env";

const keyPath = path.join(path.dirname(env.DATABASE_PATH), ".encryption.key");

function loadOrCreateKey(): Buffer {
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

export const encryptionKey = loadOrCreateKey();
