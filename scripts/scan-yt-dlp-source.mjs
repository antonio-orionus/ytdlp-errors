#!/usr/bin/env node
// Scan the pinned yt-dlp source tree for error-emitting strings and write
// data/known-yt-dlp-strings.json. Run via:
//
//   node scripts/scan-yt-dlp-source.mjs [--clone] [--update-pin]
//
// --clone        Shallow-clone yt-dlp at the pinned tag into .tmp/yt-dlp.
//                Skipped when an existing tree path is supplied via
//                YTDLP_SRC_PATH.
// --update-pin   After scanning, read the cloned tree's yt_dlp/version.py
//                and bump data/yt-dlp-version.json to match.
//
// Output JSON schema (data/known-yt-dlp-strings.json):
//
//   {
//     "ytDlpVersion": "2026.03.17",
//     "strings": [
//       {
//         "id": "<stable hash>",       // sha1 of source+fragment
//         "source": "yt_dlp/<path>:<line>",
//         "call": "report_error" | "raise ExtractorError" | ...,
//         "fragment": "Sign in to confirm you're not a bot",
//         "kind": "botBlock" | null   // null = pending human triage
//       }
//     ]
//   }
//
// The companion test (tests/upstream-coverage.test.ts) asserts every entry
// with a non-null kind round-trips through classifyYtDlpStderr correctly.
// New entries with kind === null are tolerated — they trigger a PR via the
// weekly cron so humans can assign a kind.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const VERSION_FILE = join(DATA_DIR, 'yt-dlp-version.json');
const OUT_FILE = join(DATA_DIR, 'known-yt-dlp-strings.json');
const FLAGS = new Set(process.argv.slice(2));

function loadPin() {
  return JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
}

function clone(commit) {
  const dir = join(ROOT, '.tmp', 'yt-dlp');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync('git', ['init', '--quiet', dir], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/yt-dlp/yt-dlp.git'], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'fetch', '--depth=1', '--quiet', 'origin', commit], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'checkout', '--quiet', 'FETCH_HEAD'], { stdio: 'inherit' });
  return dir;
}

// Recursively yield .py files under a directory.
function* walkPy(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) yield* walkPy(full);
    else if (ent.isFile() && ent.name.endsWith('.py')) yield full;
  }
}

// Regex anchored to common error-emitting call sites in yt-dlp. We capture
// the FIRST string-literal argument; default messages on raise_geo_restricted
// / raise_login_required are picked up by a separate pass below.
const CALL_RE = /(?:report_error|raise\s+ExtractorError|raise\s+PostProcessingError|raise\s+DownloadError|raise\s+GeoRestrictedError)\s*\(\s*(?:f|r|rf|fr|b)?(['"])((?:\\.|(?!\1).)*?)\1/g;

// Default-arg messages on raise_geo_restricted / raise_login_required.
const DEFAULT_MSG_RE = /def\s+raise_(?:geo_restricted|login_required)\s*\([^)]*?msg\s*=\s*['"]([^'"]+)['"]/gms;

function scanFile(absPath, rel) {
  const out = [];
  const src = readFileSync(absPath, 'utf8');
  // Pre-split into lines to derive line numbers cheaply.
  const linePos = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) linePos.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = linePos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (linePos[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  for (const m of src.matchAll(CALL_RE)) {
    out.push({
      source: `${rel}:${lineOf(m.index)}`,
      call: m[0].split(/[\s(]/)[0],
      fragment: m[2]
    });
  }
  for (const m of src.matchAll(DEFAULT_MSG_RE)) {
    out.push({
      source: `${rel}:${lineOf(m.index)}`,
      call: 'default_msg',
      fragment: m[1]
    });
  }
  return out;
}

function sha1(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function main() {
  const pin = loadPin();

  let srcPath = process.env.YTDLP_SRC_PATH;
  if (!srcPath) {
    if (FLAGS.has('--clone')) srcPath = clone(pin.commit);
    else {
      // Fall back to the sibling project's refs/ checkout for local dev.
      const candidate = resolve(ROOT, '..', 'yt-download-ui', 'refs', 'yt-dlp');
      try {
        statSync(candidate);
        srcPath = candidate;
      } catch {
        throw new Error('Pass --clone or set YTDLP_SRC_PATH to a yt-dlp checkout.');
      }
    }
  }

  const ytdlpDir = join(srcPath, 'yt_dlp');
  console.log(`Scanning ${ytdlpDir} (pinned ${pin.version} @ ${pin.commit})`);

  const rawHits = [];
  for (const file of walkPy(ytdlpDir)) {
    const rel = relative(srcPath, file);
    for (const hit of scanFile(file, rel)) rawHits.push(hit);
  }

  // Dedupe identical fragments — many extractors raise the same boilerplate.
  // Keep the first source for traceability.
  const byHash = new Map();
  for (const hit of rawHits) {
    const id = sha1(`${hit.fragment}::${hit.call}`);
    if (!byHash.has(id)) byHash.set(id, { id, source: hit.source, call: hit.call, fragment: hit.fragment, kind: null });
  }

  // Preserve existing kind assignments across re-scans.
  let prior = { strings: [] };
  try {
    prior = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  } catch {
    // first run — no prior file
  }
  const priorById = new Map(prior.strings?.map((s) => [s.id, s]) ?? []);
  for (const entry of byHash.values()) {
    const previous = priorById.get(entry.id);
    if (previous?.kind) entry.kind = previous.kind;
  }

  const strings = [...byHash.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    OUT_FILE,
    `${JSON.stringify({ ytDlpVersion: pin.version, ytDlpCommit: pin.commit, strings }, null, 2)}\n`
  );

  const pending = strings.filter((s) => !s.kind).length;
  console.log(`Wrote ${strings.length} strings to ${relative(ROOT, OUT_FILE)}`);
  if (pending) console.log(`⚠  ${pending} entries have kind: null — assign a kind or null-mark them intentionally`);

  if (FLAGS.has('--update-pin')) {
    const versionPy = readFileSync(join(srcPath, 'yt_dlp', 'version.py'), 'utf8');
    const ver = versionPy.match(/__version__\s*=\s*'([^']+)'/)?.[1];
    const commit = versionPy.match(/RELEASE_GIT_HEAD\s*=\s*'([^']+)'/)?.[1];
    if (!ver || !commit) throw new Error('Could not parse version.py');
    writeFileSync(VERSION_FILE, `${JSON.stringify({ ...pin, version: ver, commit }, null, 2)}\n`);
    console.log(`Pin updated → ${ver} @ ${commit}`);
  }
}

main();
