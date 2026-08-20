// Resolves daemon settings (watched directory, port, poll interval, file
// pattern) from, in ascending priority: built-in defaults, an optional JSON
// config file, then CLI arguments. Kept separate from bin/serve.js so it can
// be unit tested without spawning a process or binding a socket.

import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({
  dirPath: undefined,
  port: 4317,
  pollMs: 500,
  pattern: '\\.jsonl$',
});

/**
 * Parse a config file's JSON text into a plain settings object. Only the
 * known keys are read; anything else is ignored rather than rejected, so a
 * config file can be shared across tool versions without breaking.
 */
function parseConfigFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read config file '${filePath}': ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Config file '${filePath}' is not valid JSON: ${err.message}`);
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Config file '${filePath}' must contain a JSON object`);
  }

  const out = {};
  if (data.dir !== undefined) out.dirPath = String(data.dir);
  if (data.port !== undefined) out.port = data.port;
  if (data.pollMs !== undefined) out.pollMs = data.pollMs;
  if (data.pattern !== undefined) out.pattern = data.pattern;
  return out;
}

/**
 * Split `--config <path>` (or `--config=<path>`) out of an argv-style array
 * and return the remaining positional arguments alongside it.
 */
function extractConfigFlag(argv) {
  const rest = [];
  let configPath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') {
      configPath = argv[i + 1];
      i++;
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
    } else {
      rest.push(arg);
    }
  }
  return { configPath, rest };
}

function validatePort(port, source) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`Invalid port from ${source}: ${JSON.stringify(port)}`);
  }
  return n;
}

function validatePollMs(pollMs, source) {
  const n = Number(pollMs);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid pollMs from ${source}: ${JSON.stringify(pollMs)}`);
  }
  return n;
}

function compilePattern(pattern, source) {
  if (pattern instanceof RegExp) return pattern;
  try {
    return new RegExp(String(pattern));
  } catch (err) {
    throw new Error(`Invalid pattern from ${source}: ${err.message}`);
  }
}

/**
 * Resolve final settings for the daemon. `argv` is a positional-plus-flags
 * array in the shape of `process.argv.slice(2)`: an optional `--config
 * <path>` flag anywhere in it, then `<dir> [port]` positionally, matching
 * the CLI's existing usage.
 */
export function loadConfig(argv = []) {
  const { configPath, rest } = extractConfigFlag(argv);

  let settings = { ...DEFAULTS };

  if (configPath) {
    settings = { ...settings, ...parseConfigFile(configPath) };
  }

  const [dirArg, portArg] = rest;
  if (dirArg !== undefined) settings.dirPath = dirArg;
  if (portArg !== undefined) settings.port = portArg;

  if (!settings.dirPath) {
    throw new Error('No transcripts directory given (positional arg or config "dir")');
  }

  return {
    dirPath: settings.dirPath,
    port: validatePort(settings.port, 'config'),
    pollMs: validatePollMs(settings.pollMs, 'config'),
    pattern: compilePattern(settings.pattern, 'config'),
  };
}
