/**
 * In-process `migration_down_scope` check for `levr gates inspect` (internal).
 *
 * This is the same function as `migrationRevertScopeCheck` in
 * `packages/db-core/src/seeds/migration-revert-scope.check.ts`. The CLI does
 * not import `@levr/db-core`: that package would be inlined into the
 * published bundle. Indexed reads below carry `!` because the CLI tsconfig
 * enables `noUncheckedIndexedAccess` and the db-core copy does not. The
 * checks themselves are unchanged.
 */
import type * as Fs from 'node:fs';

type CheckFs = Pick<typeof Fs, 'existsSync' | 'statSync' | 'readFileSync'>;

/**
 * The `migration_revert_scope` check — internal L3a.
 *
 * For every path given: find the migration's `down()` and report each
 * statement in it that empties a table — a `DELETE FROM` with no `WHERE`, a
 * `TRUNCATE` statement, `queryRunner.clearTable()`, or TypeORM's own:
 * `.clear(X)` on an entity manager, `.clear()` on a repository (one got
 * from `getRepository`, or named `…repo` / `…repository`), `.delete({})` /
 * `manager.delete(X, {})`, or a query-builder `.delete()` with no
 * `.where` in its chain. Logs one line per path and returns the exit code
 * (0 = nothing unscoped, 1 = anything else).
 *
 * It reads the source the way JavaScript does, not as raw text:
 * - EVERY `down` with a body is read (class method, arrow or function
 *   property, `down: …`), not just the first, and so is every same-file
 *   function, method or arrow — braced or expression-bodied, `q => …`
 *   included — whose NAME a body mentions, transitively, however it is
 *   reached: `this.wipe(q)`, `M.wipe(q)`, `H.wipe(q)`, `run(wipe(q))`,
 *   `ids.forEach(wipe)`. Reading too much can only fail a file, never pass
 *   one.
 * - Bodies are found by matching braces, skipping strings, template
 *   literals, comments and regex literals, so a `}` inside a SQL string (a
 *   JSON value, say) cannot end one early, and indentation does not matter.
 *   A `/` starts a regex after an operator, after a keyword such as
 *   `return`, `in` or `void`, and after the `)` of an `if`/`while`/`for`
 *   head; after `++`/`--` or any other `)` it is division.
 * - SQL is read only from string and template literals inside those bodies,
 *   with their JS escapes (`\n`, `\'`, `\x57`, `\u0020`) applied, so the
 *   JS `delete` operator is never mistaken for SQL and a `where` in code cannot scope a DELETE.
 *   Within a literal the SQL is scanned left to right: quoted values and
 *   identifiers ('…' with '' escapes, E'…', "…") and comments (--, block)
 *   are opaque, a dollar- or quote-delimited PL/pgSQL body ($$…$$,
 *   $fn$…$fn$, DO '…') — and the string a PL/pgSQL
 *   `EXECUTE` / `EXECUTE format(` runs — is checked as SQL of its own (a
 *   TRUNCATE there may follow BEGIN / THEN / ELSE / LOOP / DO), and
 *   a DELETE is judged at its own bracket depth up to its own `;` or
 *   closing `)`, so a CTE's DELETE never borrows another statement's WHERE
 *   and a subquery's WHERE never scopes the outer DELETE. Literals joined by
 *   `+` (directly or around one identifier) are read as one.
 * - A DELETE whose table is not a literal (`'DELETE FROM ' + t`, a template
 *   `${t}`) is reported as `(dynamic)` rather than crashing.
 *
 * Known limits, which fail OPEN (internal): SQL held in a constant outside
 * the bodies read; a helper reached only through an alias
 * (`const c = wipe`) or a factory; and PL/pgSQL `EXECUTE` of a variable,
 * a parenthesised string or an `E'…'` string.
 *
 * WHY IT IS ONE SELF-CONTAINED FUNCTION: the seeded gate template inlines its
 * compiled source into `node -e` (see `inlineNodeCheck`), so the gate runs in
 * any repository with Node and needs no file from this one (internal is what
 * a repo-local runner costs). It may therefore use nothing from outside its
 * own body, and no line comments inside it (the source is joined onto one
 * line); `inlineNodeCheck` refuses the latter at module load.
 */
export function migrationRevertScopeCheck(
  fs: CheckFs,
  paths: string[],
  log: (line: string) => void,
): number {
  const SQ = 39;
  const DQ = 34;
  const BT = 96;
  const BS = 92;
  const SL = 47;
  const ST = 42;
  const NL = 10;
  const DOLLAR = 36;
  const OB = 123;
  const CB = 125;
  const NOT_A_HELPER =
    /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|let|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|of|static|get|set|constructor|require|down)$/;

  type Lit = { start: number; end: number; text: string };

  function unescape(raw: string): string {
    let text = '';
    for (let i = 0; i < raw.length; i++) {
      if (raw.charCodeAt(i) === BS && i + 1 < raw.length) {
        const n = raw[i + 1];
        const hex =
          n === 'x'
            ? /^[0-9a-fA-F][0-9a-fA-F]/.exec(raw.slice(i + 2))
            : n === 'u' && raw.charCodeAt(i + 2) === OB
              ? /^.([0-9a-fA-F]+)./.exec(raw.slice(i + 2))
              : n === 'u'
                ? /^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/.exec(
                    raw.slice(i + 2),
                  )
                : null;
        if (hex) {
          text += String.fromCodePoint(parseInt(hex[1] || hex[0], 16));
          i += 1 + hex[0].length;
        } else {
          text += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          i++;
        }
      } else {
        text += raw[i];
      }
    }
    return text;
  }

  function lex(src: string): { masked: string; lits: Lit[] } {
    const out = src.split('');
    const lits: Lit[] = [];
    const blank = (a: number, b: number): void => {
      for (let k = a; k < b && k < out.length; k++) {
        if (out[k] !== '\n') out[k] = ' ';
      }
    };
    const regexAllowed = (i: number): boolean => {
      let k = i - 1;
      while (k >= 0 && /\s/.test(src[k]!)) k--;
      if (k < 0) return true;
      const c = src[k]!;
      if (/[\w$]/.test(c)) {
        let w = k;
        while (w >= 0 && /[\w$]/.test(src[w]!)) w--;
        return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(
          src.slice(w + 1, k + 1),
        );
      }
      if (c === ')') {
        let depth = 0;
        let o = k;
        for (; o >= 0; o--) {
          if (out[o] === ')') depth++;
          else if (out[o] === '(') {
            depth--;
            if (depth === 0) break;
          }
        }
        let w = o - 1;
        while (w >= 0 && /\s/.test(src[w]!)) w--;
        let s = w;
        while (s >= 0 && /\w/.test(src[s]!)) s--;
        return /^(if|while|for|with)$/.test(src.slice(s + 1, w + 1));
      }
      if ((c === '+' || c === '-') && src[k - 1] === c) return false;
      return '(,=:[!&|?{};+-*%<>~^'.includes(c);
    };
    const quoted = (i: number, q: number): number => {
      let j = i + 1;
      while (
        j < src.length &&
        src.charCodeAt(j) !== q &&
        src.charCodeAt(j) !== NL
      ) {
        j += src.charCodeAt(j) === BS ? 2 : 1;
      }
      lits.push({ start: i, end: j + 1, text: unescape(src.slice(i + 1, j)) });
      blank(i, j + 1);
      return j + 1;
    };
    const template = (i: number): number => {
      let j = i + 1;
      let text = '';
      blank(i, i + 1);
      while (j < src.length && src.charCodeAt(j) !== BT) {
        if (src.charCodeAt(j) === BS) {
          const kind = src[j + 1];
          const braced = /^.([0-9a-fA-F]+)./.exec(src.slice(j + 2, j + 12));
          let len = 2;
          if (
            kind === 'x' &&
            /^[0-9a-fA-F][0-9a-fA-F]/.test(src.slice(j + 2, j + 4))
          ) {
            len = 4;
          } else if (
            kind === 'u' &&
            src.charCodeAt(j + 2) === OB &&
            braced &&
            braced[0].charCodeAt(braced[0].length - 1) === CB
          ) {
            len = 2 + braced[0].length;
          } else if (
            kind === 'u' &&
            /^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/.test(
              src.slice(j + 2, j + 6),
            )
          ) {
            len = 6;
          }
          text += unescape(src.slice(j, j + len));
          blank(j, j + len);
          j += len;
        } else if (
          src.charCodeAt(j) === DOLLAR &&
          src.charCodeAt(j + 1) === OB
        ) {
          blank(j, j + 2);
          const close = code(j + 2, true);
          blank(close, close + 1);
          text += ' ? ';
          j = close + 1;
        } else {
          text += src[j];
          blank(j, j + 1);
          j++;
        }
      }
      blank(j, j + 1);
      lits.push({ start: i, end: j + 1, text });
      return j + 1;
    };
    function code(i: number, stopAtBrace: boolean): number {
      let depth = 0;
      let j = i;
      while (j < src.length) {
        const c = src.charCodeAt(j);
        const next = src.charCodeAt(j + 1);
        if (c === SL && next === SL) {
          let e = src.indexOf('\n', j);
          if (e < 0) e = src.length;
          blank(j, e);
          j = e;
        } else if (c === SL && next === ST) {
          let e = src.indexOf('*/', j + 2);
          e = e < 0 ? src.length : e + 2;
          blank(j, e);
          j = e;
        } else if (c === SL && regexAllowed(j)) {
          let e = j + 1;
          let inClass = false;
          while (e < src.length && src.charCodeAt(e) !== NL) {
            const d = src.charCodeAt(e);
            if (d === BS) {
              e += 2;
              continue;
            }
            if (d === 91) inClass = true;
            else if (d === 93) inClass = false;
            else if (d === SL && !inClass) break;
            e++;
          }
          blank(j, e + 1);
          j = e + 1;
        } else if (c === SQ || c === DQ) {
          j = quoted(j, c);
        } else if (c === BT) {
          j = template(j);
        } else {
          if (c === OB) depth++;
          else if (c === CB) {
            if (stopAtBrace && depth === 0) return j;
            depth--;
          }
          j++;
        }
      }
      return j;
    }
    code(0, false);
    lits.sort((a, b) => a.start - b.start);
    return { masked: out.join(''), lits };
  }

  function bodyAfter(m: string, from: number): [number, number] | null {
    let j = from;
    while (j < m.length && /\s/.test(m[j]!)) j++;
    if (m[j] === ':') {
      j++;
      let depth = 0;
      let typed = false;
      while (j < m.length) {
        const c = m[j]!;
        if (depth === 0 && c === '=' && m[j + 1] === '>') break;
        if (depth === 0 && c === ';') return null;
        if (depth === 0 && c === '{' && typed) {
          let k = j - 1;
          while (k >= 0 && /\s/.test(m[k]!)) k--;
          if (!'|&:<,'.includes(m[k]!)) break;
        }
        if (c === '<' || c === '{' || c === '(' || c === '[') depth++;
        else if (
          (c === '>' && m[j - 1] !== '=') ||
          c === '}' ||
          c === ')' ||
          c === ']'
        ) {
          depth--;
        }
        if (!/\s/.test(c)) typed = true;
        j++;
      }
    }
    if (m[j] === '=' && m[j + 1] === '>') {
      j += 2;
      while (j < m.length && /\s/.test(m[j]!)) j++;
      if (m.charCodeAt(j) !== OB) {
        let depth = 0;
        let e = j;
        for (; e < m.length; e++) {
          const c = m[e];
          if (c === '(' || c === '[' || c === '{') depth++;
          else if (c === ')' || c === ']' || c === '}') {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (c === ';' || c === ',')) break;
        }
        return [j - 1, e];
      }
    }
    if (m.charCodeAt(j) !== OB) return null;
    let depth = 0;
    for (let e = j; e < m.length; e++) {
      if (m.charCodeAt(e) === OB) depth++;
      else if (m.charCodeAt(e) === CB) {
        depth--;
        if (depth === 0) return [j, e];
      }
    }
    return null;
  }

  function bodiesOf(m: string, name: string): Array<[number, number]> {
    const safe = name.split('$').join('\\$');
    const re = new RegExp(
      '(?:^|[^\\w$.])' +
        safe +
        '\\s*(?:=\\s*(?:async\\s*)?(?:function\\s*\\w*\\s*)?|:\\s*(?:async\\s*)?(?:function\\s*\\w*\\s*)?)?\\(',
      'g',
    );
    const found: Array<[number, number]> = [];
    for (let hit = re.exec(m); hit; hit = re.exec(m)) {
      let j = hit.index + hit[0].length;
      let parens = 1;
      while (j < m.length && parens > 0) {
        if (m[j] === '(') parens++;
        else if (m[j] === ')') parens--;
        j++;
      }
      const body = bodyAfter(m, j);
      if (body) found.push(body);
    }
    const bare = new RegExp(
      '(?:^|[^\\w$.])' +
        safe +
        '\\s*[=:]\\s*(?:async\\s+)?[A-Za-z_$][\\w$]*\\s*(?==>)',
      'g',
    );
    for (let hit = bare.exec(m); hit; hit = bare.exec(m)) {
      const body = bodyAfter(m, hit.index + hit[0].length);
      if (body) found.push(body);
    }
    return found;
  }

  function sqlMask(
    sql: string,
    nested: string[],
    inBlock: boolean,
  ): { m: string; depth: number[] } {
    let lastString = -1;
    let m = '';
    const depth: number[] = [];
    let d = 0;
    const blankTo = (from: number, to: number): void => {
      for (let k = from; k < to; k++) {
        m += ' ';
        depth.push(d);
      }
    };
    let i = 0;
    while (i < sql.length) {
      const c = sql.charCodeAt(i);
      const tag =
        c === DOLLAR ? /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i)) : null;
      if (c === SQ || c === DQ) {
        const eString =
          c === SQ &&
          i > 0 &&
          /[eE]/.test(sql[i - 1]!) &&
          !(i > 1 && /\w/.test(sql[i - 2]!));
        let e = i + 1;
        while (e < sql.length) {
          const d = sql.charCodeAt(e);
          if (eString && d === BS) {
            e += 2;
          } else if (d === c && sql.charCodeAt(e + 1) === c) {
            e += 2;
          } else if (d === c) {
            break;
          } else {
            e++;
          }
        }
        const end = Math.min(e + 1, sql.length);
        if (
          c === SQ &&
          (inBlock ||
            /\b(?:execute\s*(?:format\s*\(\s*)?[eE]?|do\s*(?:language\s+\w+\s*)?)(?![^])/i.test(
              sql.slice(0, i),
            ))
        ) {
          const body = sql
            .slice(i + 1, e)
            .split(String.fromCharCode(SQ, SQ))
            .join(String.fromCharCode(SQ));
          if (
            lastString >= 0 &&
            /^\s*\|\|\s*[eE]?(?![^])/.test(sql.slice(lastString, i))
          ) {
            nested[nested.length - 1] += body;
          } else {
            nested.push(body);
          }
          lastString = end;
        }
        blankTo(i, end);
        i = end;
      } else if (tag) {
        const open = i + tag[0].length;
        const close = sql.indexOf(tag[0], open);
        const end = close < 0 ? sql.length : close + tag[0].length;
        nested.push(sql.slice(open, close < 0 ? sql.length : close));
        blankTo(i, end);
        i = end;
      } else if (c === 45 && sql.charCodeAt(i + 1) === 45) {
        let e = sql.indexOf('\n', i);
        if (e < 0) e = sql.length;
        blankTo(i, e);
        i = e;
      } else if (c === SL && sql.charCodeAt(i + 1) === ST) {
        let e = sql.indexOf('*/', i + 2);
        e = e < 0 ? sql.length : e + 2;
        blankTo(i, e);
        i = e;
      } else {
        if (c === 41 && d > 0) d--;
        m += sql[i];
        depth.push(d);
        if (c === 40) d++;
        i++;
      }
    }
    return { m, depth };
  }

  function unscopedIn(sql: string, inBlock: boolean): string[] {
    const nested: string[] = [];
    const { m, depth } = sqlMask(sql, nested, inBlock);
    let found: string[] = [];
    const re = inBlock
      ? /\bdelete\s+from\b|(?:^|[;(]|\b(?:begin|then|else|loop|do)\b)\s*(truncate)\s/gi
      : /\bdelete\s+from\b|(?:^|[;(])\s*(truncate)\s/gi;
    for (let hit = re.exec(m); hit; hit = re.exec(m)) {
      const isTruncate = hit[1] !== undefined;
      if (!isTruncate) {
        const level = depth[hit.index]!;
        let scope = '';
        for (let e = hit.index + hit[0].length; e < m.length; e++) {
          if (depth[e]! < level || (m[e] === ';' && depth[e] === level)) break;
          scope += depth[e] === level ? m[e] : ' ';
        }
        if (/\bwhere\b/i.test(scope)) continue;
      }
      const name = (
        isTruncate
          ? /^\s*(?:table\s+)?(?:only\s+)?((?:"[^"]*"|[^\s,();"]+)+)/i
          : /^\s*(?:only\s+)?((?:"[^"]*"|[^\s,();"]+)+)/i
      ).exec(sql.slice(hit.index + hit[0].length));
      let table = name
        ? name[1]!
            .split('')
            .filter((ch) => ch.charCodeAt(0) !== DQ && ch.charCodeAt(0) !== BS)
            .join('')
            .trim()
        : '';
      if (table === '' || table === '?') table = '(dynamic)';
      found.push((isTruncate ? 'TRUNCATE ' : 'DELETE FROM ') + table);
    }
    for (const inner of nested) found = found.concat(unscopedIn(inner, true));
    return found;
  }

  function check(p: string): boolean {
    if (!fs.existsSync(p)) {
      log('no file matches: ' + p);
      return false;
    }
    if (fs.statSync(p).isDirectory()) {
      log(
        p +
          ' is a directory: name the migration file, or a glob that matches only files, such as dir/*AddFoo*.ts',
      );
      return false;
    }
    const lexed = lex(String(fs.readFileSync(p, 'utf-8')));
    const m = lexed.masked;
    const bodies = bodiesOf(m, 'down');
    if (bodies.length === 0) {
      log(p + ': no down method');
      return false;
    }
    const seen = new Set<string>();
    for (let b = 0; b < bodies.length && b < 500; b++) {
      const text = m.slice(bodies[b]![0], bodies[b]![1]);
      const names = /[A-Za-z_$][\w$]*/g;
      for (let c = names.exec(text); c; c = names.exec(text)) {
        const name = c[0];
        if (seen.has(name) || NOT_A_HELPER.test(name)) continue;
        seen.add(name);
        for (const body of bodiesOf(m, name)) bodies.push(body);
      }
    }
    const repos: string[] = [];
    const repoDecl =
      /(?:\b(?:const|let|var)\s+|\bthis\s*\.\s*)([A-Za-z_$][\w$]*)\s*=\s*[^;]*?\bget(?:Tree)?Repository\s*\(/g;
    for (let d = repoDecl.exec(m); d; d = repoDecl.exec(m)) repos.push(d[1]!);
    const inBody = (start: number, end: number): boolean =>
      bodies.some((b) => start > b[0] && end <= b[1]);
    const unscoped: string[] = [];
    for (const b of bodies) {
      const text = m.slice(b[0], b[1]);
      if (/\.clearTable\s*\(/.test(text)) unscoped.push('clearTable()');
      if (
        /\.\s*clear\s*\(\s*[^\s)]/.test(text) ||
        /\b(?:manager|em|entityManager)\s*\.\s*clear\s*\(/.test(text) ||
        /\w*(?:repo|repository)\s*\.\s*clear\s*\(/i.test(text) ||
        /\bget(?:Tree)?Repository\s*\([^)]*\)\s*\.\s*clear\s*\(/.test(text) ||
        repos.some((r) =>
          new RegExp(
            '(?:^|[^\\w$.])' +
              r.split('$').join('\\$') +
              '\\s*\\.\\s*clear\\s*\\(',
          ).test(text),
        )
      ) {
        unscoped.push('clear()');
      }
      if (/\.\s*delete\s*\(\s*(?:[^,()]*,\s*)?\{\s*\}\s*,?\s*\)/.test(text)) {
        unscoped.push('delete({})');
      }
      if (
        /\.\s*delete\s*\(\s*\)(?!(?:\s*\.\s*[\w$]+\s*\([^()]*\))*\s*\.\s*(?:where|andWhere|orWhere|whereInIds)\s*\()/.test(
          text,
        )
      ) {
        unscoped.push('delete() with no where');
      }
    }
    const mine = lexed.lits.filter((lit) => inBody(lit.start, lit.end));
    const joined = new Set<Lit>();
    for (let a = 0; a < mine.length; a++) {
      let b = a;
      while (
        b + 1 < mine.length &&
        /^\s*,\s*(?![^])/.test(m.slice(mine[b]!.end, mine[b + 1]!.start))
      ) {
        b++;
      }
      if (
        b > a &&
        /^\s*,?\s*\]\s*\.\s*join\s*\(/.test(
          m.slice(mine[b]!.end, mine[b]!.end + 80),
        )
      ) {
        for (let k = a + 1; k <= b; k++) joined.add(mine[k]!);
      }
      a = b;
    }
    const sqls: string[] = [];
    let prev: Lit | null = null;
    for (const lit of mine) {
      const gap = prev ? m.slice(prev.end, lit.start) : '';
      if (joined.has(lit)) {
        sqls[sqls.length - 1] += ' ' + lit.text;
      } else if (
        prev &&
        prev.end <= lit.start &&
        /^\s*[+]\s*(?![^])/.test(gap)
      ) {
        sqls[sqls.length - 1] += lit.text;
      } else if (
        prev &&
        prev.end <= lit.start &&
        /^\s*[+]\s*[\w.]+\s*[+]\s*(?![^])/.test(gap)
      ) {
        sqls[sqls.length - 1] += ' ? ' + lit.text;
      } else {
        sqls.push(lit.text);
      }
      prev = lit;
    }
    for (const sql of sqls) {
      for (const hit of unscopedIn(sql, false)) unscoped.push(hit);
    }
    if (unscoped.length > 0) {
      log(p + ': unscoped ' + unscoped.join(','));
      return false;
    }
    log(p + ': all scoped');
    return true;
  }

  if (paths.length === 0) {
    log('no file given');
    return 1;
  }
  let bad = 0;
  for (const p of paths) {
    try {
      if (!check(p)) bad = 1;
    } catch (e) {
      log(
        p +
          ': could not be checked: ' +
          (e instanceof Error ? e.message : String(e)),
      );
      bad = 1;
    }
  }
  return bad;
}
