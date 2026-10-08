import { describe, expect, it } from 'vitest';

import {
  describeWorkspaces,
  findWorkspaceByKeyOrName,
  type WorkspaceSite,
} from './find-workspace.js';

function site(name: string, key: string): WorkspaceSite {
  return {
    workspace_name: name,
    workspace_url_key: key,
    workspace_id: `id-${key}`,
  } as WorkspaceSite;
}

const SITES = [
  site('Acme', 'acme'),
  site('Beta Corp', 'beta'),
  site('Twin', 'twin-1'),
  site('twin', 'twin-2'),
];

describe('findWorkspaceByKeyOrName (internal D6)', () => {
  it('matches an exact url_key first', () => {
    expect(findWorkspaceByKeyOrName(SITES, 'beta').workspace_name).toBe(
      'Beta Corp',
    );
  });

  it('prefers a url_key over a name that spells the same word', () => {
    const sites = [site('acme', 'other'), site('Acme Inc', 'acme')];
    expect(findWorkspaceByKeyOrName(sites, 'acme').workspace_url_key).toBe(
      'acme',
    );
  });

  it('matches a unique name case-insensitively', () => {
    expect(findWorkspaceByKeyOrName(SITES, 'beta corp').workspace_url_key).toBe(
      'beta',
    );
  });

  it('refuses an ambiguous name and lists the candidates with their url_keys', () => {
    expect(() => findWorkspaceByKeyOrName(SITES, 'TWIN')).toThrow(
      /more than one workspace[\s\S]*Twin \(twin-1\)[\s\S]*twin \(twin-2\)/,
    );
  });

  it('refuses an unknown workspace and lists every choice', () => {
    expect(() => findWorkspaceByKeyOrName(SITES, 'nope')).toThrow(
      /No workspace "nope"[\s\S]*Acme \(acme\)/,
    );
  });

  it('refuses an empty value', () => {
    expect(() => findWorkspaceByKeyOrName(SITES, '  ')).toThrow(
      /needs a workspace name or url_key/,
    );
  });

  it('describes each workspace as name (url_key)', () => {
    expect(describeWorkspaces([site('Acme', 'acme')])).toBe('  - Acme (acme)');
  });
});
