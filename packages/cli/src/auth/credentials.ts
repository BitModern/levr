import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { StoredCredentials } from '../types/auth-types.js';

const CREDENTIALS_DIR = join(homedir(), '.config', 'levr');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}

export function readCredentials(): StoredCredentials | null {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: StoredCredentials): void {
  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function deleteCredentials(): boolean {
  try {
    unlinkSync(CREDENTIALS_PATH);
    return true;
  } catch {
    return false;
  }
}
