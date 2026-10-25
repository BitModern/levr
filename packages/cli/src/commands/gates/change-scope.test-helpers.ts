import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A throwaway git repository for the change-scope tests (internal D4.6).
 * `GIT_*` per-process variables are scrubbed so a test run from a git hook
 * can never operate on the real repository (internal).
 */
export class TempRepo {
  readonly root: string;

  constructor(prefix = 'gates-change-scope-') {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    this.git('init', '-q', '-b', 'main');
  }

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith('GIT_')) env[k] = v;
    }
    return {
      ...env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: this.root,
    };
  }

  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.root,
      env: this.env(),
      encoding: 'utf8',
    });
  }

  write(file: string, content: string | Buffer): void {
    const abs = join(this.root, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', message);
    return this.git('rev-parse', 'HEAD').trim();
  }

  /** Commit everything as the base, and point `main` + `origin/HEAD` at it. */
  commitBase(): string {
    const sha = this.commit('base');
    this.git('update-ref', 'refs/remotes/origin/main', sha);
    this.git(
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
    );
    this.git('checkout', '-q', '-b', 'feature');
    return sha;
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** `n` lines `line 1` … `line n`, newline-terminated. */
export function lines(n: number, prefix = 'line'): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}\n`).join('');
}
