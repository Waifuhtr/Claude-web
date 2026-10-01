#!/usr/bin/env node
// rtk (https://github.com/rtk-ai/rtk) shortens the output of shell commands
// before Claude reads it. Claude Code runs it through a PreToolUse hook on the
// Bash tool: `git status` becomes `rtk git status`. This script registers that
// hook in ~/.claude/settings.json and writes rtk's config; it runs at
// container start, before any Claude process.
//
// AGENTWEB_RTK=0 turns it off (the hook is removed). Removing the hook by hand
// (or `rtk init -g --uninstall`) is respected; the config file is only
// rewritten while it is still exactly what this script wrote.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOOK_COMMAND = 'rtk hook claude';
const HOOK_ENTRY = { matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_COMMAND }] };

// Safe mode: no information loss. Most rtk filters summarise (test failures
// cut to a few lines, `head -N` turned into a "smart" excerpt, lists capped,
// git messages replaced by "ok"), and only some keep the full output. So every
// command rtk would rewrite is excluded except the ones whose rtk output was
// checked to carry the same information: `git status` (porcelain listing,
// nothing capped with the limits below), `git add`, and npm/npx script runs
// (only npm's own banner, notices and warnings go; the program's output stays).
//
// rtk ignores the whole file when a section misses a field it requires (and
// then rewrites everything with its defaults), so [filters], [telemetry] and
// [limits] are always written complete.
const GIT_EXCLUDED = ['log', 'show', 'diff', 'stash', 'blame', 'commit', 'push', 'pull', 'fetch', 'checkout', 'branch', 'worktree'];
const EXCLUDED = [
  // git commands with output worth every line (also as `git -C <dir> ...`)
  ...GIT_EXCLUDED.map((sub) => `git ${sub}`),
  `^git\\s+((-C|-c)\\s+\\S+\\s+|--no-pager\\s+|--git-dir=\\S+\\s+|--work-tree=\\S+\\s+)*(${GIT_EXCLUDED.join('|')})(\\s|$)`,
  'yadm', 'gh', 'glab', 'gt',
  // reading, searching, listing
  'cat', 'head', 'tail', 'grep', 'rg', 'ast-grep', 'find', 'ls', 'tree', 'diff', 'wc', 'du', 'df', 'ps',
  // downloads, APIs, databases, infrastructure
  'curl', 'wget', 'psql', 'aws', 'gcloud', 'kubectl', 'oc', 'helm', 'docker', 'terraform', 'tofu', 'pulumi',
  'ansible-playbook', 'systemctl', 'iptables', 'fail2ban-client', 'sops', 'ping', 'rsync', 'liquibase',
  // tests, linters, type checkers, builds (their filters cut error details)
  'tsc', 'biome', 'eslint', 'lint', 'prettier', 'next', 'jest', 'vitest', 'ctest', 'playwright', 'prisma',
  'mypy', 'ruff', 'sqlfluff', 'pytest', 'go', 'golangci-lint', 'golangci', 'cargo', 'make', 'sbt', 'mix',
  'swift', 'dotnet', 'mvn', 'mvnw', './mvnw', 'mvnd', 'gradle', 'gradlew', './gradlew', 'pio', 'trunk', 'quarto',
  'rspec', 'rubocop', 'rake', 'rails', 'bundle', 'php', 'phpunit', 'phpstan', 'pest', 'paratest', 'ecs', 'pint',
  'shellcheck', 'yamllint', 'markdownlint', 'hadolint', 'pre-commit', 'shopify',
  // package managers whose filters cap or cut output
  'pip', 'pip3', 'uv', 'poetry', 'pnpm', 'bun', 'bunx', 'deno', 'brew', 'composer',
];

const CONFIG = `# Agent Web tarafindan yazildi (scripts/setup-rtk.js). Degistirirsen
# dokunulmaz; silersen bir sonraki baslatmada yeniden yazilir.
#
# Guvenli mod (bilgi kaybi yok): rtk'nin cogu filtresi ozet cikarir (test
# hatalarini birkac satira indirir, listeleri sinirlar, git mesajlarini "ok"
# yapar). Bu yuzden yalnizca ciktisi ayni bilgiyi tasiyan komutlar acik:
# git status, git add ve npm/npx ile script calistirma (npm'in kendi baslik,
# uyari ve bildirim satirlari gider; programin ciktisi aynen kalir).
# Daha fazla tasarruf icin asagidaki listeden komut cikarabilirsin; o
# komutlarin ciktisi rtk'nin ozetine doner.

[filters]
ignore_dirs = []
ignore_files = []

[limits]
grep_max_results = 1000000
grep_max_per_file = 1000000
status_max_files = 1000000
status_max_untracked = 1000000
passthrough_max_chars = 100000000

[retriever]
mode = "sqlite"

[telemetry]
enabled = false

[hooks]
exclude_commands = [
${EXCLUDED.map((c) => `  ${c.startsWith('^') ? `'${c}'` : JSON.stringify(c)},`).join('\n')}
]
`;

function log(message) {
  console.log(`[setup-rtk] ${message}`);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function findOnPath(name, envPath) {
  for (const dir of String(envPath || '').split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // bu dizinde yok
    }
  }
  return null;
}

function isRtkHook(command) {
  return typeof command === 'string' && /(^|\/)rtk hook claude\s*$/.test(command.trim());
}

function hasHook(settings) {
  const list = settings && settings.hooks && Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  return list.some((entry) => entry && Array.isArray(entry.hooks) && entry.hooks.some((h) => h && isRtkHook(h.command)));
}

function removeHook(settings) {
  const list = settings.hooks && Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
  const kept = [];
  for (const entry of list) {
    if (!entry || !Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter((h) => !(h && isRtkHook(h.command)));
    if (hooks.length) kept.push({ ...entry, hooks });
  }
  if (kept.length) settings.hooks.PreToolUse = kept;
  else delete settings.hooks.PreToolUse;
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
}

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return { value: fallback, mode: 0o600 };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { value, mode: fs.statSync(file).mode & 0o777 };
}

function writeFileAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.agentweb-tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, mode);
}

function apply(home, env = process.env) {
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const stateFile = path.join(home, '.cc-web', 'managed-rtk.json');
  const configFile = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'rtk', 'config.toml');

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {};
  } catch {
    state = {};
  }
  const before = JSON.stringify(state);

  const setting = String(env.AGENTWEB_RTK || '').trim().toLowerCase();
  const enabled = !['0', 'off', 'false', 'no'].includes(setting);
  const installed = !!findOnPath('rtk', env.PATH);

  let settings;
  let mode;
  try {
    ({ value: settings, mode } = readJsonFile(settingsFile, {}));
  } catch (err) {
    log(`~/.claude/settings.json okunamadi (${err.message}); dokunulmadi.`);
    return;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    log('~/.claude/settings.json beklenmeyen bicimde; dokunulmadi.');
    return;
  }
  const present = hasHook(settings);
  let settingsChanged = false;

  if (!enabled || !installed) {
    // Only a hook this script added is taken out again.
    if (state.hook === true && present) {
      removeHook(settings);
      settingsChanged = true;
      log(enabled ? 'rtk bulunamadi; hook kaldirildi.' : 'AGENTWEB_RTK=0: rtk hook kaldirildi.');
    }
    delete state.hook;
  } else if (state.hook === undefined) {
    if (!present) {
      if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) settings.hooks = {};
      if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
      settings.hooks.PreToolUse.push(HOOK_ENTRY);
      settingsChanged = true;
      log('rtk hook tanimlandi (Bash ciktilari kisaltilir).');
    }
    state.hook = true;
  }
  // state.hook === true and the hook is gone: removed on purpose, respected.

  if (settingsChanged) {
    const backup = `${settingsFile}.agentweb-backup`;
    if (fs.existsSync(settingsFile) && !fs.existsSync(backup)) fs.copyFileSync(settingsFile, backup);
    writeFileAtomic(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, mode);
  }

  if (enabled && installed) {
    const wanted = sha256(CONFIG);
    let current = null;
    try {
      current = sha256(fs.readFileSync(configFile, 'utf8'));
    } catch {
      current = null;
    }
    if (current === null || (current === state.config && current !== wanted)) {
      writeFileAtomic(configFile, CONFIG, 0o644);
      state.config = wanted;
      log(current === null ? 'rtk ayarlari yazildi.' : 'rtk ayarlari guncellendi.');
    } else if (current !== wanted && current !== state.config) {
      // the user's own config; left alone
    } else if (current === wanted && state.config !== wanted) {
      state.config = wanted;
    }
  }

  if (JSON.stringify(state) !== before) writeFileAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

if (require.main === module) {
  if (!process.env.HOME) {
    log('HOME tanimli degil; atlandi.');
  } else {
    apply(process.env.HOME);
  }
}

module.exports = { apply, CONFIG, HOOK_COMMAND, EXCLUDED };
