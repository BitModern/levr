const DEFAULT_API_URL = 'https://api.levr.one';
const DEFAULT_AUTH_URL = 'https://auth.levr.one';

/** OAuth client ID for the CLI (seeded in oauth_clients table) */
export const CLI_CLIENT_ID = '3';

export function getApiUrl(): string {
  return process.env['LEVR_URL'] || DEFAULT_API_URL;
}

export function getAuthUrl(): string {
  return process.env['LEVR_AUTH_URL'] || DEFAULT_AUTH_URL;
}

export function getTeamId(flagValue?: string): string | undefined {
  return flagValue || process.env['LEVR_TEAM_ID'] || undefined;
}

export function getPatToken(): string | undefined {
  return process.env['LEVR_TOKEN'];
}

export function getSourceOverride(): string | undefined {
  return process.env['LEVR_SOURCE'];
}

export function getAutomationSourceIdOverride(): string | undefined {
  return process.env['LEVR_AUTOMATION_SOURCE_ID'];
}
