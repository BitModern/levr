import { authGetProfileV1, teamFindAllV1 } from '@levr/sdk';
import type { ResponseTeamDto } from '@levr/sdk';

export interface ResolvedTeam {
  teamId: string;
  /** How it was chosen — the caller reports anything not asked for outright. */
  source: 'team-id' | 'team-key' | 'env' | 'active-team' | 'only-team';
}

export interface TeamLite {
  id: string;
  key: string;
  name: string;
}

/**
 * The importing team — NOT the same thing as the `teams` column in the file.
 *
 * `teams` is OWNERSHIP: which teams the imported tests belong to. The
 * importing team is who is doing the import, and the backend uses it as
 * `primaryTeamId` for decisions the file cannot answer:
 *
 *   - where an UNQUALIFIED `estimate` column lands (internal) — a bare
 *     `estimate` is not team-neutral, it sizes one specific team;
 *   - the guaranteed owner when the file names no teams at all
 *     (`ensureMinimumOfOneOwner`);
 *   - which team is excluded from the "extra teams" set.
 *
 * So it is not redundant with the file. It IS unreasonable to demand a UUID
 * for it when the file speaks in keys, which is what `--team-key` fixes.
 *
 * Deliberately NOT inferred from the file's first `teams` value. That value
 * decides where an unqualified estimate lands, and row order is a proxy for
 * that question, not an answer to it — a reordered export would silently size
 * a different team. When it cannot be determined, ask.
 */
async function fetchTeams(): Promise<TeamLite[]> {
  // F-005: this used to take ONE page of 200 and treat it as the whole
  // workspace. Past that, `--team-key ENG` reported "No team with key ENG in
  // this workspace" and listed 200 keys that did not include it — the worst
  // shape of wrong, because the message asserts the team does not exist.
  //
  // MAX_PAGES is the sentinel the repo requires on every paginated fetcher: a
  // `while (true)` over an external API hangs forever when a malformed page
  // returns rows without advancing. 25 * 200 = 5000 teams; a workspace past
  // that gets a warning rather than a silent truncation.
  const PAGE_SIZE = 200;
  const MAX_PAGES = 25;

  const out: TeamLite[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await teamFindAllV1({ query: { limit: PAGE_SIZE, page } });
    if (result.error || !result.data) {
      throw new Error(`Failed to list teams (${describeError(result.error)}).`);
    }
    const body = result.data as {
      data?: unknown[];
      meta?: { totalItems?: number; totalPages?: number };
    };
    const rows = (body.data ?? []) as ResponseTeamDto[];
    for (const r of rows) {
      if (r.id && r.key)
        out.push({ id: r.id, key: r.key, name: r.name ?? r.key });
    }

    const totalPages = body.meta?.totalPages;
    if (rows.length === 0) break;
    if (totalPages !== undefined ? page >= totalPages : rows.length < PAGE_SIZE)
      break;
    if (page === MAX_PAGES) {
      process.stderr.write(
        `[levr] Warning: stopped after ${MAX_PAGES} pages of teams; a --team-key may not resolve.\n`,
      );
    }
  }
  return out;
}

/**
 * The caller's ACTIVE team, when it belongs to this workspace.
 *
 * `active_team_id` is the user's HOME team, not "the team they are looking
 * at" — a distinction `apps/client/CLAUDE.md` is emphatic about. That makes it
 * a fair default for "who is importing" and a poor one for anything scoped to
 * a view, so it is used here and reported, never assumed silently.
 *
 * MUST be checked against this workspace's teams. A user can belong to several
 * workspaces while their home team lives in one of them; adopting it unchecked
 * would import into a team that is not in the workspace being imported to.
 *
 * A failure here is not fatal — it just means no default. The explicit flags
 * and the single-team case still work without a profile call succeeding.
 */
async function activeTeamIn(teams: TeamLite[]): Promise<string | null> {
  let activeId: string | undefined;
  try {
    const result = await authGetProfileV1();
    if (result.error || !result.data) return null;
    // No cast: `active_team_id` is now declared on UserProfileResponseDto.
    // It previously needed one because `GET /v1/auth/profile` was published
    // under the LLM-model `ProfileResponseDto` — two backend classes shared
    // that name and the wrong one won the schema slot (review F-013).
    activeId = result.data.active_team_id ?? undefined;
  } catch {
    return null;
  }
  if (!activeId) return null;
  return teams.some((t) => t.id === activeId) ? activeId : null;
}

/**
 * F-012: `JSON.stringify(new Error("boom"))` is `"{}"` — Error's own fields are
 * non-enumerable. The detail that was meant to end the misdirection produced
 * "Failed to list teams ({})", which is worse than saying nothing.
 */
function describeError(error: unknown): string {
  if (error === undefined || error === null) return 'no data returned';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    if (json !== undefined && json !== '{}') return json;
  } catch {
    // Circular payload — JSON.stringify throws. Fall through.
  }
  // Deliberately not `String(error)`: on a plain object that is
  // "[object Object]", which is the same non-information as "{}".
  return 'unserialisable error';
}

function describe(teams: TeamLite[]): string {
  return teams.map((t) => `  ${t.key}  ${t.name}`).join('\n');
}

/**
 * Resolve the importing team from `--team-id`, `--team-key`, or the workspace.
 *
 * Key matching is case-insensitive: the file writes `ENG`, and a user typing
 * `eng` means the same team. Errors list the valid keys, because "no team
 * matched" without saying what would have is the least useful thing this can
 * print.
 */
export async function resolveTeamId(
  teamId: string | undefined,
  teamKey: string | undefined,
  /**
   * F-004: `LEVR_TEAM_ID`. `levr push` honours it via `getTeamId()`; import
   * ignored it entirely — in the same change that added `.env` support and
   * used `LEVR_TEAM_ID` as its worked example. A CI job setting it and running
   * `import --yes` fell through to the service account's active team and sized
   * every unqualified estimate against the wrong one.
   *
   * Ranked BELOW both flags (an explicit flag beats an ambient variable) and
   * ABOVE the active-team default. Validated against the workspace like the
   * active team, because the same cross-workspace mistake is possible.
   */
  envTeamId?: string,
): Promise<ResolvedTeam> {
  if (teamId && teamKey) {
    throw new Error(
      'Pass either --team-id or --team-key, not both — they can disagree, and there is no sensible winner.',
    );
  }
  if (teamId) return { teamId, source: 'team-id' };

  const teams = await fetchTeams();
  if (teams.length === 0) {
    throw new Error('No teams found in this workspace.');
  }

  if (teamKey) {
    const wanted = teamKey.trim().toLowerCase();
    const matches = teams.filter((t) => t.key.toLowerCase() === wanted);
    if (matches.length === 1)
      return { teamId: matches[0]!.id, source: 'team-key' };
    if (matches.length === 0) {
      throw new Error(
        `No team with key "${teamKey}" in this workspace. Available:\n${describe(teams)}`,
      );
    }
    // Keys are unique per workspace, so this means the workspace scope is not
    // what we think it is. Refusing beats picking one at random.
    throw new Error(
      `More than one team has key "${teamKey}" in this workspace — refusing to guess.`,
    );
  }

  // Neither flag given. Fall back, most-specific first.
  if (envTeamId) {
    if (teams.some((t) => t.id === envTeamId))
      return { teamId: envTeamId, source: 'env' };
    throw new Error(
      `LEVR_TEAM_ID (${envTeamId}) is not a team in this workspace. Available:\n${describe(teams)}`,
    );
  }

  const active = await activeTeamIn(teams);
  if (active) return { teamId: active, source: 'active-team' };

  // One team is unambiguous whatever the profile says.
  if (teams.length === 1) return { teamId: teams[0]!.id, source: 'only-team' };

  // No active team in this workspace and several to choose from. Asking is the
  // only correct answer: the importing team decides where an unqualified
  // `estimate` lands, so guessing would silently size the wrong team.
  throw new Error(
    `--team-key or --team-id is required: this workspace has ${teams.length} teams and you have no active team here.\n${describe(teams)}`,
  );
}
