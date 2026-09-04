import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindAll = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const mockProfile = vi.fn<() => Promise<unknown>>();
vi.mock('@levr/sdk', () => ({
  teamFindAllV1: (...args: unknown[]): Promise<unknown> => mockFindAll(...args),
  authGetProfileV1: (): Promise<unknown> => mockProfile(),
}));

const { resolveTeamId } = await import('./resolve-team');

const TEAMS = [
  { id: 'id-eng', key: 'ENG', name: 'Engineering' },
  { id: 'id-te', key: 'TE', name: 'Team 2' },
];

beforeEach(() => {
  mockFindAll.mockReset();
  mockProfile.mockReset();
  mockFindAll.mockResolvedValue({ data: { data: TEAMS }, error: undefined });
  // Default: no active team, so the existing cases keep testing what they did.
  mockProfile.mockResolvedValue({
    data: { active_team_id: null },
    error: undefined,
  });
});

describe('resolveTeamId', () => {
  it('returns --team-id unchanged, without calling the API', async () => {
    // A UUID needs no lookup; spending a round trip to confirm it would be
    // pure cost, and would fail the command when the endpoint is down.
    expect((await resolveTeamId('id-explicit', undefined)).teamId).toBe(
      'id-explicit',
    );
    expect(mockFindAll).not.toHaveBeenCalled();
  });

  it('resolves a key to its id', async () => {
    expect((await resolveTeamId(undefined, 'TE')).teamId).toBe('id-te');
  });

  it('matches a key case-insensitively', async () => {
    // The file writes ENG; a user typing eng means the same team.
    expect((await resolveTeamId(undefined, 'eng')).teamId).toBe('id-eng');
    expect((await resolveTeamId(undefined, ' Eng ')).teamId).toBe('id-eng');
  });

  it('REFUSES both flags rather than picking a winner', async () => {
    await expect(resolveTeamId('id-explicit', 'ENG')).rejects.toThrow(
      /not both/i,
    );
  });

  it('lists the valid keys when a key does not match', async () => {
    // "No team matched" without saying what would have is the least useful
    // thing this can print.
    await expect(resolveTeamId(undefined, 'NOPE')).rejects.toThrow(/ENG/);
    await expect(resolveTeamId(undefined, 'NOPE')).rejects.toThrow(/TE/);
  });

  it('auto-selects when the workspace has exactly ONE team', async () => {
    mockFindAll.mockResolvedValue({
      data: { data: [TEAMS[0]] },
      error: undefined,
    });
    expect((await resolveTeamId(undefined, undefined)).teamId).toBe('id-eng');
  });

  it('ASKS when neither flag is given and there are several teams', async () => {
    // Not inferred from the file's first `teams` value: that decides where an
    // unqualified estimate lands, and row order is a proxy for that question,
    // not an answer to it.
    await expect(resolveTeamId(undefined, undefined)).rejects.toThrow(
      /--team-key or --team-id is required/,
    );
  });

  it('surfaces an API failure instead of continuing', async () => {
    mockFindAll.mockResolvedValue({ data: undefined, error: 'boom' });
    await expect(resolveTeamId(undefined, 'ENG')).rejects.toThrow(
      /Failed to list teams/,
    );
  });

  it('ignores rows missing an id or key', async () => {
    mockFindAll.mockResolvedValue({
      data: { data: [{ key: 'ENG' }, { id: 'x' }, TEAMS[1]] },
      error: undefined,
    });
    expect((await resolveTeamId(undefined, 'TE')).teamId).toBe('id-te');
    await expect(resolveTeamId(undefined, 'ENG')).rejects.toThrow(/No team/);
  });

  describe('active team', () => {
    it('defaults to the caller ACTIVE team when no flag is given', async () => {
      mockProfile.mockResolvedValue({
        data: { active_team_id: 'id-te' },
        error: undefined,
      });
      const r = await resolveTeamId(undefined, undefined);
      expect(r).toEqual({ teamId: 'id-te', source: 'active-team' });
    });

    it('IGNORES an active team that is not in this workspace', async () => {
      // A user can belong to several workspaces while their home team lives in
      // one of them. Adopting it unchecked would import into a team that is
      // not in the workspace being imported to.
      mockProfile.mockResolvedValue({
        data: { active_team_id: 'id-from-another-workspace' },
        error: undefined,
      });
      await expect(resolveTeamId(undefined, undefined)).rejects.toThrow(
        /--team-key or --team-id is required/,
      );
    });

    it('does not let an explicit flag be overridden by the active team', async () => {
      mockProfile.mockResolvedValue({
        data: { active_team_id: 'id-te' },
        error: undefined,
      });
      expect((await resolveTeamId(undefined, 'ENG')).source).toBe('team-key');
      expect((await resolveTeamId(undefined, 'ENG')).teamId).toBe('id-eng');
    });

    it('degrades to the single-team case when the profile call fails', async () => {
      // No active team is not fatal: it just means no default.
      mockProfile.mockRejectedValue(new Error('network'));
      mockFindAll.mockResolvedValue({
        data: { data: [TEAMS[0]] },
        error: undefined,
      });
      expect((await resolveTeamId(undefined, undefined)).source).toBe(
        'only-team',
      );
    });
  });

  describe('LEVR_TEAM_ID (F-004)', () => {
    it('honours it when no flag is given', async () => {
      const r = await resolveTeamId(undefined, undefined, 'id-te');
      expect(r).toEqual({ teamId: 'id-te', source: 'env' });
    });

    it('loses to BOTH explicit flags', async () => {
      expect((await resolveTeamId('id-x', undefined, 'id-te')).source).toBe(
        'team-id',
      );
      expect((await resolveTeamId(undefined, 'ENG', 'id-te')).source).toBe(
        'team-key',
      );
    });

    it('beats the active-team default', async () => {
      mockProfile.mockResolvedValue({
        data: { active_team_id: 'id-eng' },
        error: undefined,
      });
      expect((await resolveTeamId(undefined, undefined, 'id-te')).source).toBe(
        'env',
      );
    });

    it('REFUSES an id that is not in this workspace', async () => {
      await expect(
        resolveTeamId(undefined, undefined, 'id-elsewhere'),
      ).rejects.toThrow(/not a team in this workspace/);
    });
  });

  describe('pagination (F-005)', () => {
    it('follows every page, so a key on page 2 still resolves', async () => {
      // One page of 200 was treated as the whole workspace: past that,
      // --team-key reported "No team with key X" and listed 200 keys that did
      // not include it — asserting the team does not exist.
      const page1 = Array.from({ length: 200 }, (_, i) => ({
        id: `id-${i}`,
        key: `T${i}`,
        name: `Team ${i}`,
      }));
      mockFindAll.mockImplementation((...args: unknown[]) => {
        const page = (args[0] as { query?: { page?: number } })?.query?.page;
        return Promise.resolve(
          page === 1
            ? {
                data: { data: page1, meta: { totalPages: 2 } },
                error: undefined,
              }
            : {
                data: {
                  data: [{ id: 'id-late', key: 'LATE', name: 'Late' }],
                  meta: { totalPages: 2 },
                },
                error: undefined,
              },
        );
      });
      expect((await resolveTeamId(undefined, 'LATE')).teamId).toBe('id-late');
    });

    it('surfaces a real Error message, not "{}" (F-012)', async () => {
      // JSON.stringify(new Error("boom")) is "{}" — Error fields are
      // non-enumerable, so the detail meant to end the misdirection produced
      // "Failed to list teams ({})".
      mockFindAll.mockResolvedValue({
        data: undefined,
        error: new Error('connect ECONNREFUSED'),
      });
      await expect(resolveTeamId(undefined, 'ENG')).rejects.toThrow(
        /ECONNREFUSED/,
      );
    });
  });
});
