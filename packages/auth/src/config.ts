/**
 * Unified environment configuration for Levr
 *
 * Single source of truth for backend URLs, auth URLs, and OAuth client IDs.
 * Precedence: TQ_BACKEND_URL env var > ~/.tq/config.json > token apiBaseUrl > staging default
 *
 * In test environments (VITEST or NODE_ENV=test), ~/.tq/config.json is
 * skipped so that tests stay deterministic and never depend on the
 * developer's local config file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTqDir, loadTokens } from './token-store.js';
import {
  isLocalTlsMode,
  isTestEnv,
  LOCAL_HTTP,
  LOCAL_HTTPS,
  resolveLocalCheckout,
} from './local-env.js';

// Moved to `local-env.ts` (internal); re-exported so the public surface and
// every existing import keep working.
export {
  extractEnvValue,
  parseDevTls,
  parseLocalBackenderOrigin,
  resolveOriginFromEnvFiles,
} from './local-env.js';

export interface TqConfig {
  environment: 'local' | 'staging' | 'production' | 'custom';
  apiUrl: string;
  authUrl: string;
  clientUrl: string;
  oauthClientId: string;
}

/**
 * Environment presets. Staging is the default.
 *
 * `local` is a getter that returns the HTTPS variant when DEV_TLS dev mode
 * is detected (see `isLocalTlsMode()`), so `yarn tq:env local` writes the
 * right URLs whether the user has TLS dev mode set up or not.
 */
export const PRESETS: Record<'local' | 'staging' | 'production', TqConfig> = {
  staging: {
    environment: 'staging',
    // internal D15: levr.now is the unified staging origin set.
    apiUrl: 'https://api.levr.now',
    authUrl: 'https://auth.levr.now',
    clientUrl: 'https://ai.levr.now',
    oauthClientId: '2',
  },
  get local(): TqConfig {
    return isLocalTlsMode() ? { ...LOCAL_HTTPS } : { ...LOCAL_HTTP };
  },
  production: {
    environment: 'production',
    // internal: rebranded levr.tools → levr.one. Redirect CloudFront keeps
    // legacy levr.tools URLs reachable indefinitely via 301.
    apiUrl: 'https://api.levr.one',
    authUrl: 'https://auth.levr.one',
    clientUrl: 'https://ai.levr.one',
    oauthClientId: '2',
  },
};

/**
 * Env var override — single canonical name
 */
const ENV_VAR = 'TQ_BACKEND_URL';

/**
 * Legacy localhost form for the HTTPS dev preset. Older configs and
 * stored tokens may have `https://localhost:8080` as the apiUrl; we
 * accept it as an alias of `LOCAL_HTTPS` so flipping DEV_TLS doesn't
 * orphan existing config files.
 */
const LOCAL_HTTPS_LOCALHOST_ALIAS = 'https://localhost:8080';

/**
 * Resolve a full TqConfig from a bare API URL by matching presets.
 * Returns 'custom' environment if no preset matches.
 *
 * Local resolution covers three forms:
 *   - `http://localhost:8080`        → LOCAL_HTTP
 *   - `https://api.levr.test:8080`   → LOCAL_HTTPS (canonical TLS form)
 *   - `https://localhost:8080`       → LOCAL_HTTPS (legacy alias)
 *
 * Resolving the legacy localhost alias to the new levr.test preset means
 * a token issued in TLS mode under the old localhost URL still maps to
 * the right config when read after this change.
 */
export function resolveFromApiUrl(url: string): TqConfig {
  const normalized = url.replace(/\/+$/, '');

  if (normalized === LOCAL_HTTP.apiUrl) return { ...LOCAL_HTTP };
  if (normalized === LOCAL_HTTPS.apiUrl) return { ...LOCAL_HTTPS };
  if (normalized === LOCAL_HTTPS_LOCALHOST_ALIAS) return { ...LOCAL_HTTPS };

  for (const preset of [PRESETS.staging, PRESETS.production]) {
    if (preset.apiUrl === normalized) {
      return { ...preset };
    }
  }

  // Custom URL -- use staging-style auth/client URLs as placeholders
  return {
    environment: 'custom',
    apiUrl: normalized,
    authUrl: normalized,
    clientUrl: normalized,
    oauthClientId: process.env.TQ_OAUTH_CLIENT_ID || '2',
  };
}

/**
 * Load unified config with precedence:
 * 1. TQ_BACKEND_URL env var
 * 2. ~/.tq/config.json  (skipped in test environments)
 * 3. Token's apiBaseUrl from ~/.tq/oauth-tokens.json (skipped in test environments)
 * 4. Staging default
 *
 * TQ_OAUTH_CLIENT_ID env var overrides oauthClientId from any source.
 */
export function loadConfig(): TqConfig {
  let config: TqConfig;

  // 1. Check env var override
  const envValue = process.env[ENV_VAR];
  if (envValue) {
    config = resolveFromApiUrl(envValue);
    if (process.env.TQ_OAUTH_CLIENT_ID) {
      config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
    }
    return config;
  }

  // 2. Read ~/.tq/config.json (skip in test environments for determinism)
  if (!isTestEnv()) {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(configPath, 'utf-8'),
        ) as Partial<TqConfig>;
        config = {
          environment: raw.environment || 'custom',
          apiUrl: raw.apiUrl ?? PRESETS.staging.apiUrl,
          authUrl: raw.authUrl ?? PRESETS.staging.authUrl,
          clientUrl: raw.clientUrl ?? PRESETS.staging.clientUrl,
          oauthClientId: raw.oauthClientId ?? '2',
        };
        // `local` is "this checkout's backend", not the URL whichever
        // checkout last ran `tq:env local` stored (internal).
        if (config.environment === 'local') {
          const local = resolveLocalCheckout();
          if (local) {
            config.apiUrl = local.apiUrl;
            config.authUrl = local.authUrl;
            config.clientUrl = local.clientUrl;
          }
        }
        // Apply TQ_OAUTH_CLIENT_ID override
        if (process.env.TQ_OAUTH_CLIENT_ID) {
          config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
        }
        return config;
      } catch {
        process.stderr.write(
          `[levr-auth] WARNING: Malformed config at ${configPath}, falling back to default.\n`,
        );
      }
    }
  }

  // 3. Infer from stored token's apiBaseUrl (tokens know which backend issued them)
  if (!isTestEnv()) {
    const stored = loadTokens();
    if (stored?.apiBaseUrl) {
      config = resolveFromApiUrl(stored.apiBaseUrl);
      if (process.env.TQ_OAUTH_CLIENT_ID) {
        config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
      }
      process.stderr.write(
        `[levr-auth] No config.json found. Using environment from token: ${config.environment} (${config.apiUrl})\n`,
      );
      return config;
    }
  }

  // 4. Default to staging
  config = { ...PRESETS.staging };
  // Apply TQ_OAUTH_CLIENT_ID override
  if (process.env.TQ_OAUTH_CLIENT_ID) {
    config.oauthClientId = process.env.TQ_OAUTH_CLIENT_ID;
  }
  return config;
}

/**
 * Write config to ~/.tq/config.json using atomic write (tmp + rename)
 */
export function writeConfig(config: TqConfig): void {
  const tqDir = getTqDir();

  if (!fs.existsSync(tqDir)) {
    fs.mkdirSync(tqDir, { recursive: true, mode: 0o700 });
  }

  const configPath = getConfigFilePath();
  const tempPath = configPath + '.tmp';

  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(tempPath, configPath);
}

/**
 * Get the config file path (~/.tq/config.json)
 */
export function getConfigFilePath(): string {
  return path.join(getTqDir(), 'config.json');
}
