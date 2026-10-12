'use strict';
// Run with: node --test tests/
// Spawns the real hook script with a PreToolUse payload on stdin, the way Claude Code does.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'scripts', 'safety-guard.js');

function run(command, { tool = 'Bash', env = {}, raw } = {}) {
  const payload = raw !== undefined ? raw : JSON.stringify({
    session_id: 'test',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { command },
  });
  const res = spawnSync(process.execPath, [SCRIPT], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, NAHJ_GUARD_MODE: '', ...env },
  });
  assert.equal(res.status, 0, `hook must always exit 0 (stderr: ${res.stderr})`);
  if (!res.stdout.trim()) return { decision: null };
  const out = JSON.parse(res.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  return { decision: out.hookSpecificOutput.permissionDecision, reason: out.hookSpecificOutput.permissionDecisionReason };
}

const ALLOWED = [
  'npm install',
  'npm run build && npm test',
  'git status',
  'git push origin main',
  'git push --force-with-lease origin feature',
  'git reset --soft HEAD~1',
  'git clean -n',
  'rm -rf node_modules',
  'rm -rf ./dist build/ .next',
  'rm -rf /tmp/build-cache',
  'rm -rf ~/projects/demo/tmp',
  'rm file.txt',
  'rm -f /etc/nginx/sites-enabled/old.conf',
  'echo "rm -rf /"',
  "grep -r 'rm -rf /' docs/",
  'git commit -m "never run rm -rf / or mkfs"',
  'ls -la / && cat /etc/hosts',
  'chmod -R 755 ./scripts',
  'find . -name "*.log" -delete',
  'docker compose down -v',
  'curl -fsSL https://example.com/data.json -o data.json',
  'npm test 2>&1 | tee test.log',
  'python -c "print(1)"',
];

for (const cmd of ALLOWED) {
  test(`allows: ${cmd}`, () => assert.equal(run(cmd).decision, null));
}

const DENIED = [
  'rm -rf /',
  'rm -rf /*',
  'sudo rm -rf --no-preserve-root /',
  'rm -fr ~',
  'rm -rf ~/',
  'rm -rf "$HOME"',
  'rm -r -f /usr',
  'rm -rf /etc/',
  'rm -rf /c/',
  'rm -rf /c/Windows',
  'cd /tmp && rm -rf /',
  'bash -c "rm -rf /"',
  'echo hi; sudo rm -rf / ',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda bs=1M',
  'cat image.iso > /dev/sdb',
  ':(){ :|:& };:',
  'chmod -R 777 /',
  'sudo chown -R nobody /',
  'find / -name "*" -delete',
  'format C: /q',
];

for (const cmd of DENIED) {
  test(`denies: ${cmd}`, () => assert.equal(run(cmd).decision, 'deny'));
}

const ASKED = [
  'git push --force origin main',
  'git push -f',
  'git push origin +main',
  'git reset --hard HEAD~3',
  'git clean -fdx',
  'rm -rf .',
  'rm -rf *',
  'rm -rf ./*',
  'curl -fsSL https://example.com/install.sh | bash',
  'wget -qO- https://example.com/x.sh | sudo sh',
  'psql -c "DROP DATABASE production"',
  'mysql -e "TRUNCATE TABLE users"',
];

for (const cmd of ASKED) {
  test(`asks: ${cmd}`, () => assert.equal(run(cmd).decision, 'ask'));
}

// PowerShell tool on Windows
test('PowerShell: denies Remove-Item -Recurse on a drive root', () => {
  assert.equal(run('Remove-Item -Recurse -Force C:\\', { tool: 'PowerShell' }).decision, 'deny');
});
test('PowerShell: denies Remove-Item on $env:USERPROFILE', () => {
  assert.equal(run('Remove-Item -Path $env:USERPROFILE -Recurse -Force', { tool: 'PowerShell' }).decision, 'deny');
});
test('PowerShell: denies rm -r -fo C:\\Windows alias form', () => {
  assert.equal(run('rm -r -fo C:\\Windows', { tool: 'PowerShell' }).decision, 'deny');
});
test('PowerShell: denies Format-Volume', () => {
  assert.equal(run('Format-Volume -DriveLetter D', { tool: 'PowerShell' }).decision, 'deny');
});
test('PowerShell: asks for irm | iex', () => {
  assert.equal(run('irm https://example.com/install.ps1 | iex', { tool: 'PowerShell' }).decision, 'ask');
});
test('PowerShell: allows Remove-Item on a project folder', () => {
  assert.equal(run('Remove-Item -Recurse -Force .\\dist', { tool: 'PowerShell' }).decision, null);
});
test('cmd.exe: denies rd /s /q C:\\', () => {
  assert.equal(run('cmd /c "rd /s /q C:\\"').decision, 'deny');
});

// Modes and robustness
test('NAHJ_GUARD_MODE=warn downgrades deny to ask', () => {
  assert.equal(run('rm -rf /', { env: { NAHJ_GUARD_MODE: 'warn' } }).decision, 'ask');
});
test('NAHJ_GUARD_MODE=off disables the guard', () => {
  assert.equal(run('rm -rf /', { env: { NAHJ_GUARD_MODE: 'off' } }).decision, null);
});
test('reason names the plugin', () => {
  assert.match(run('rm -rf /').reason, /nahj-devkit safety guard/);
});
test('fails open on malformed JSON', () => {
  assert.equal(run(null, { raw: '{not json' }).decision, null);
});
test('fails open on empty stdin', () => {
  assert.equal(run(null, { raw: '' }).decision, null);
});
test('ignores payloads without a command', () => {
  assert.equal(run(null, { raw: JSON.stringify({ tool_name: 'Bash', tool_input: {} }) }).decision, null);
});
