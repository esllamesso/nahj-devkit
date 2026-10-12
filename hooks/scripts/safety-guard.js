#!/usr/bin/env node
/**
 * nahj-devkit safety guard — PreToolUse hook for the Bash and PowerShell tools.
 *
 * Reads the hook payload from stdin and inspects tool_input.command:
 *   - "deny"  clearly catastrophic commands (wiping /, ~, a drive root or a
 *             system directory, formatting disks, fork bombs, ...)
 *   - "ask"   risky-but-legitimate commands (force push, reset --hard,
 *             rm -rf on ".", piping a download into a shell, DROP DATABASE)
 *   - silent  everything else, so the normal permission flow applies.
 *
 * Environment:
 *   NAHJ_GUARD_MODE=block (default) | warn (downgrade deny -> ask) | off
 *
 * The guard fails open: malformed input or an internal error exits 0 with no
 * output, so a bug here can never wedge normal development.
 * No dependencies; runs on any Node.js >= 18.
 */
'use strict';

// ---------------------------------------------------------------------------
// Tokenizer: splits a command line into words and control operators while
// respecting single/double quotes, so `echo "rm -rf /"` is one harmless word.
// ---------------------------------------------------------------------------
function tokenize(input) {
  const tokens = [];
  let cur = '';
  let has = false; // whether `cur` holds a word (possibly an empty "" word)
  let quote = null;
  const push = () => {
    if (has) tokens.push({ type: 'word', value: cur });
    cur = '';
    has = false;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) cur += input[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < input.length && input[i + 1] === '\n') { i++; continue; } // line continuation
    if (c === ' ' || c === '\t' || c === '\r') { push(); continue; }
    if (c === '\n' || c === ';') { push(); tokens.push({ type: 'op', value: ';' }); continue; }
    if (c === '&' && (input[i - 1] === '>' || input[i + 1] === '>')) { cur += c; has = true; continue; } // 2>&1, &> file
    if (c === '&' || c === '|') {
      push();
      const two = input.slice(i, i + 2);
      if (two === '&&' || two === '||') { tokens.push({ type: 'op', value: two }); i++; }
      else tokens.push({ type: 'op', value: c });
      continue;
    }
    if (c === '(' || c === ')' || c === '{' || c === '}' || c === '`') { push(); tokens.push({ type: 'op', value: ';' }); continue; }
    cur += c;
    has = true;
  }
  push();
  return tokens;
}

/** Returns [{ words: string[], pipedFrom: string[] | null }] per simple command. */
function segments(command) {
  const out = [];
  let words = [];
  let pipedFrom = null;
  for (const t of tokenize(command)) {
    if (t.type === 'word') { words.push(t.value); continue; }
    if (words.length) out.push({ words, pipedFrom });
    pipedFrom = t.value === '|' ? words : null;
    words = [];
  }
  if (words.length) out.push({ words, pipedFrom });
  return out;
}

// Wrappers that run the following words as the real command.
const PREFIXES = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'nohup', 'time', 'nice', 'ionice', 'env', 'xargs', 'call', 'start',
  'then', 'do', 'else', '!']);
function stripPrefixes(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (PREFIXES.has(w.toLowerCase())) { i++; continue; }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; } // VAR=value
    if (i > 0 && /^-/.test(w) && PREFIXES.has(words[i - 1].toLowerCase())) { i++; continue; } // sudo -u x, env -i
    break;
  }
  return words.slice(i);
}

const base = (w) => w.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------
const SYSTEM_DIRS = new Set([
  '/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/opt', '/proc', '/root', '/sbin', '/srv',
  '/sys', '/usr', '/var', '/home', '/users', '/system', '/library', '/applications', '/private',
  'c:/windows', 'c:/users', 'c:/program files', 'c:/program files (x86)', 'c:/programdata',
]);
const HOME_REFS = /^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%|%homepath%|\$env:systemdrive|%systemdrive%|\$env:windir|%windir%|\$env:homedrive|%homedrive%)$/i;

/** 'catastrophic' | 'broad' | null */
function classifyPath(raw) {
  let p = raw.trim().replace(/\\/g, '/');
  if (!p) return null;
  // Strip trailing glob / slashes: "/*" -> "/", "C:/*" -> "C:/", "~/" -> "~".
  p = p.replace(/\/\*+$/, '/').replace(/^\*+$/, '*');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '' || p === '/') return 'catastrophic';
  const lower = p.toLowerCase();
  if (HOME_REFS.test(lower)) return 'catastrophic';
  if (/^[a-z]:\/?$/.test(lower)) return 'catastrophic';          // C:  C:/
  if (/^\/(mnt\/)?[a-z]$/.test(lower)) return 'catastrophic';      // Git Bash /c, WSL /mnt/c
  if (SYSTEM_DIRS.has(lower) || SYSTEM_DIRS.has(lower.replace(/^\/(mnt\/)?([a-z])\//, '$2:/'))) return 'catastrophic';
  if (p === '.' || p === '..' || p === '*' || p === './' || p === './*' || p === '../*' || p === '.*') return 'broad';
  return null;
}

function worstTarget(targets) {
  let worst = null;
  for (const t of targets) {
    const c = classifyPath(t);
    if (c === 'catastrophic') return { level: c, target: t };
    if (c === 'broad' && !worst) worst = { level: c, target: t };
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Rules. Each returns { decision: 'deny'|'ask', reason } or null.
// ---------------------------------------------------------------------------
function checkRm(cmd, args) {
  // POSIX rm (Bash, Git Bash, WSL). PowerShell's `rm` alias is handled below.
  if (cmd !== 'rm') return null;
  let recursive = false;
  const targets = [];
  let endOfOpts = false;
  for (const a of args) {
    if (!endOfOpts && a === '--') { endOfOpts = true; continue; }
    if (!endOfOpts && a === '--no-preserve-root') return { decision: 'deny', reason: 'rm --no-preserve-root disables the safeguard against deleting the filesystem root.' };
    if (!endOfOpts && /^--recursive$/i.test(a)) { recursive = true; continue; }
    if (!endOfOpts && /^-[a-zA-Z]+$/.test(a)) { if (/[rR]/.test(a)) recursive = true; continue; }
    if (!endOfOpts && /^-/.test(a)) continue;
    targets.push(a);
  }
  // PowerShell style: rm -Recurse -Force C:\  (recognised here too, since the alias is `rm`)
  if (args.some((a) => /^-rec/i.test(a))) recursive = true;
  if (!recursive) return null;
  const hit = worstTarget(targets);
  if (!hit) return null;
  return hit.level === 'catastrophic'
    ? { decision: 'deny', reason: `Recursive delete of "${hit.target}" would wipe a root, home, or system directory.` }
    : { decision: 'ask', reason: `Recursive delete of "${hit.target}" removes everything in the current directory. Confirm this is intended.` };
}

function checkPowerShellRemove(cmd, args) {
  if (!['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir'].includes(cmd)) return null;
  const lowered = args.map((a) => a.toLowerCase());
  const psRecursive = lowered.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/.test(a));
  const cmdRecursive = lowered.includes('/s');
  if (!psRecursive && !cmdRecursive) return null;
  // Positional args and -Path values; skip PowerShell switches and cmd.exe switches like /s /q.
  const hit = worstTarget(args.filter((a) => !a.startsWith('-') && !/^\/[a-z?]$/i.test(a)));
  if (!hit) return null;
  return hit.level === 'catastrophic'
    ? { decision: 'deny', reason: `Recursive delete of "${hit.target}" would wipe a drive root, home, or system directory.` }
    : { decision: 'ask', reason: `Recursive delete of "${hit.target}" removes everything in the current directory. Confirm this is intended.` };
}

function checkDisk(cmd, args) {
  if (/^mkfs(\..+)?$/.test(cmd) || cmd === 'mke2fs' || cmd === 'wipefs') {
    return { decision: 'deny', reason: `${cmd} formats or wipes a filesystem.` };
  }
  if (cmd === 'format' && args.some((a) => /^[a-z]:$/i.test(a))) {
    return { decision: 'deny', reason: 'format would erase a whole drive.' };
  }
  if (['format-volume', 'clear-disk', 'initialize-disk'].includes(cmd)) {
    return { decision: 'deny', reason: `${cmd} erases a disk or volume.` };
  }
  if (cmd === 'diskpart') return { decision: 'ask', reason: 'diskpart can repartition or wipe disks.' };
  if (cmd === 'dd' && args.some((a) => /^of=\/dev\/(sd|hd|vd|xvd|nvme|disk|rdisk|mmcblk)/i.test(a))) {
    return { decision: 'deny', reason: 'dd writing to a raw block device destroys its contents.' };
  }
  if (cmd === 'shred' && args.some((a) => /^\/dev\//.test(a))) {
    return { decision: 'deny', reason: 'shred on a device destroys its contents.' };
  }
  return null;
}

function checkPermissions(cmd, args) {
  if (!['chmod', 'chown', 'chgrp'].includes(cmd)) return null;
  if (!args.some((a) => /^-[a-zA-Z]*R/.test(a) || a === '--recursive')) return null;
  const hit = worstTarget(args.filter((a) => !/^-/.test(a)));
  if (hit && hit.level === 'catastrophic') {
    return { decision: 'deny', reason: `Recursive ${cmd} on "${hit.target}" can break the whole system.` };
  }
  return null;
}

function checkFind(cmd, args) {
  if (cmd !== 'find' || !args.some((a) => a === '-delete' || a === 'rm')) return null;
  const roots = [];
  for (const a of args) { if (/^[-(!]/.test(a)) break; roots.push(a); }
  const hit = worstTarget(roots);
  if (hit && hit.level === 'catastrophic') {
    return { decision: 'deny', reason: `find ... -delete starting at "${hit.target}" would delete files across a root, home, or system directory.` };
  }
  return null;
}

function checkGit(cmd, args) {
  if (cmd !== 'git') return null;
  // Skip global options such as `-C path` or `-c key=value`.
  let i = 0;
  while (i < args.length && /^-/.test(args[i])) i += /^-(C|c)$/.test(args[i]) ? 2 : 1;
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === 'push' && rest.some((a) => a === '--force' || a === '-f' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+/.test(a))
      && !rest.some((a) => a.startsWith('--force-with-lease') || a.startsWith('--force-if-includes'))) {
    return { decision: 'ask', reason: 'git push --force can overwrite commits on the remote. Prefer --force-with-lease.' };
  }
  if (sub === 'reset' && rest.includes('--hard')) {
    return { decision: 'ask', reason: 'git reset --hard permanently discards uncommitted changes.' };
  }
  if (sub === 'clean' && rest.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force') && !rest.some((a) => /^-[a-zA-Z]*n/.test(a) || a === '--dry-run')) {
    return { decision: 'ask', reason: 'git clean -f permanently deletes untracked files (and ignored files with -x).' };
  }
  return null;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'python', 'python3', 'node', 'perl', 'ruby', 'pwsh', 'powershell', 'iex', 'invoke-expression']);
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
function checkPipeToShell(cmd, _args, pipedFrom) {
  if (!pipedFrom || !SHELLS.has(cmd)) return null;
  const src = stripPrefixes(pipedFrom);
  if (src.length && DOWNLOADERS.has(base(src[0]))) {
    return { decision: 'ask', reason: `Piping a download from ${base(src[0])} straight into ${cmd} runs unreviewed remote code.` };
  }
  return null;
}

const RULES = [checkRm, checkPowerShellRemove, checkDisk, checkPermissions, checkFind, checkGit, checkPipeToShell];
const INLINE_FLAGS = new Set(['-c', '-command', '/c', '-encodedcommand']);

function analyze(command, depth = 0) {
  const findings = [];
  if (typeof command !== 'string' || !command.trim() || depth > 3) return findings;

  // Whole-string patterns that a tokenizer would split apart.
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/.test(command)) {
    findings.push({ decision: 'deny', reason: 'Fork bomb detected: it exhausts system processes.' });
  }
  if (/>\s*\/dev\/(sd[a-z]|hd[a-z]|vd[a-z]|nvme\d|disk\d|mmcblk\d)/i.test(command)) {
    findings.push({ decision: 'deny', reason: 'Redirecting output to a raw block device destroys its contents.' });
  }
  if (/\bdrop\s+(database|schema)\b/i.test(command)) {
    findings.push({ decision: 'ask', reason: 'Command contains DROP DATABASE/SCHEMA.' });
  } else if (/\b(drop\s+table|truncate\s+table)\b/i.test(command)) {
    findings.push({ decision: 'ask', reason: 'Command contains DROP TABLE or TRUNCATE TABLE.' });
  }

  for (const seg of segments(command)) {
    const words = stripPrefixes(seg.words);
    if (!words.length) continue;
    const cmd = base(words[0]);
    const args = words.slice(1);
    // Recurse into `bash -c "..."`, `pwsh -Command "..."`, `cmd /c "..."`.
    if (SHELLS.has(cmd) || cmd === 'cmd') {
      const idx = args.findIndex((a) => INLINE_FLAGS.has(a.toLowerCase()));
      if (idx !== -1 && args[idx + 1]) findings.push(...analyze(args.slice(idx + 1).join(' '), depth + 1));
    }
    for (const rule of RULES) {
      const r = rule(cmd, args, seg.pipedFrom);
      if (r) findings.push(r);
    }
  }
  return findings;
}

function decide(payload, mode) {
  if (mode === 'off') return null;
  const command = payload && payload.tool_input && payload.tool_input.command;
  const findings = analyze(command);
  if (!findings.length) return null;
  const deny = findings.find((f) => f.decision === 'deny');
  const chosen = deny || findings[0];
  const decision = chosen.decision === 'deny' && mode === 'warn' ? 'ask' : chosen.decision;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[nahj-devkit safety guard] ${chosen.reason}` +
        (decision === 'deny' ? ' If this is truly intended, run it yourself outside Claude Code.' : ''),
    },
  };
}

function main() {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => {
    try {
      const mode = String(process.env.NAHJ_GUARD_MODE || 'block').toLowerCase();
      const result = decide(JSON.parse(data), mode);
      if (result) process.stdout.write(JSON.stringify(result));
    } catch (_) {
      // Fail open: never block work because the guard itself misbehaved.
    }
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { analyze, decide, classifyPath, tokenize, segments };
