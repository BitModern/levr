import type {
  DeviceAuthorizationResponse,
  OAuthTokenResponse,
} from '../types/auth-types.js';
import { getApiUrl, CLI_CLIENT_ID } from '../utils/env.js';
import { sleep } from '../utils/sleep.js';

/**
 * Request a device authorization code from the backend.
 */
export async function requestDeviceCode(): Promise<DeviceAuthorizationResponse> {
  const apiUrl = getApiUrl();
  const res = await fetch(`${apiUrl}/v1/oauth/device/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLI_CLIENT_ID,
      scope: 'read:own write:own',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to request device code (${res.status}): ${body}`);
  }

  return (await res.json()) as DeviceAuthorizationResponse;
}

interface DeviceFlowPollOptions {
  deviceCode: string;
  interval: number;
  expiresIn: number;
  onPending?: () => void;
}

/**
 * Poll the token endpoint for device flow approval.
 * Returns tokens on success, throws on error/expiry/denial.
 */
export async function pollForDeviceToken(
  options: DeviceFlowPollOptions,
): Promise<OAuthTokenResponse> {
  const apiUrl = getApiUrl();
  let interval = options.interval;
  const deadline = Date.now() + options.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);

    const res = await fetch(`${apiUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: options.deviceCode,
        client_id: CLI_CLIENT_ID,
      }),
    });

    if (res.ok) {
      return (await res.json()) as OAuthTokenResponse;
    }

    const body = (await res.json()) as { error: string };

    switch (body.error) {
      case 'authorization_pending':
        options.onPending?.();
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'expired_token':
        throw new Error('Device code expired. Please try again.');
      case 'access_denied':
        throw new Error('Authorization denied by user.');
      default:
        throw new Error(`Unexpected error: ${body.error}`);
    }
  }

  throw new Error('Device code expired. Please try again.');
}
