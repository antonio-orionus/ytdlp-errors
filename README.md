# ytdlp-errors

Classify yt-dlp stderr into a closed taxonomy of error kinds. Zero dependencies, pure regex, ESM + CJS, snapshot-tested against upstream yt-dlp source.

```ts
import { classifyYtDlpStderr, errorKindMetadata } from 'ytdlp-errors';

const { kind, raw } = classifyYtDlpStderr(stderrBlob);
// kind: 'botBlock' | 'ipBlock' | 'rateLimit' | 'geoBlocked' | ...

if (kind !== 'unknown') {
  const meta = errorKindMetadata(kind);
  console.log(meta.code);           // 'YTDLP_BOT_BLOCK'  (stable across versions)
  console.log(meta.suggestedFlags); // ['--cookies-from-browser', '--cookies']
  console.log(meta.recoverable);    // true
}
```

## Why this exists

Every JS/TS wrapper around yt-dlp (`yt-dlp-wrap`, `youtube-dl-exec`, `ytdlp-nodejs`, ...) hands you raw stderr and expects you to figure out whether it's a bot block, a geo block, or a disk-full error. yt-dlp itself emits no structured error channel — its [own README](https://github.com/yt-dlp/yt-dlp#embedding-yt-dlp) suggests Python users embed the library directly; CLI consumers are left parsing text.

This package fills the gap: a curated regex taxonomy of every error kind yt-dlp can produce, audited against the upstream source on every release, with stable codes and metadata that drive UX without locking you to any particular wrapper.

## Install

```bash
npm i ytdlp-errors
# or
bun add ytdlp-errors
```

Node >= 18. ESM + CJS dual export. Zero runtime dependencies.

## Public API

| Export | Purpose |
|---|---|
| `classifyYtDlpStderr(stderr, opts?)` | Pure classifier. Returns `{ kind, raw }`. |
| `classifyAll(stderr, opts?)` | Per-line classification for `--ignore-errors` playlist runs. |
| `extractLastError(stderr)` | Pull the most useful single-line description for logs. |
| `isPostprocessFailure(raw)` | Predicate for ENOSPC-masquerading-as-ffmpeg detection. |
| `errorKindMetadata(kind)` | Stable code + recoverability + suggested flags + docs URL. |
| `YT_DLP_ERROR_KINDS` | Closed enum tuple. |
| `YtDlpErrorKind` | Union type. |
| `ERROR_KIND_METADATA` | Full metadata table. |
| `ERROR_PATTERNS` | Internal regex table (exposed for debugging only — not stable). |

### Extension hook

When you need site-specific patterns that don't belong upstream:

```ts
classifyYtDlpStderr(stderr, {
  extraPatterns: {
    ipBlock: /custom-site-ban-string/i,
    rateLimit: [/throttled by upstream/i, /retry-after exceeded/i]
  }
});
```

Custom patterns are tried **before** the built-ins. Keys must be existing `ClassifierKind` values — to add a new category, open a PR.

## Error kinds

| Kind | Code | Recoverable? | User-actionable? | Typical cause |
|---|---|---|---|---|
| `botBlock` | `YTDLP_BOT_BLOCK` | yes | yes | YouTube anti-bot challenge |
| `ipBlock` | `YTDLP_IP_BLOCK` | yes | yes | IP-level ban from extractor host |
| `rateLimit` | `YTDLP_RATE_LIMIT` | yes | yes | HTTP 429 or extractor throttle |
| `ageRestricted` | `YTDLP_AGE_RESTRICTED` | yes | yes | Login required to confirm age |
| `unavailable` | `YTDLP_UNAVAILABLE` | no | no | Removed / private / format gone |
| `geoBlocked` | `YTDLP_GEO_BLOCKED` | yes | yes | Region restriction |
| `drmProtected` | `YTDLP_DRM_PROTECTED` | no | no | DRM (Widevine/PlayReady) |
| `loginRequired` | `YTDLP_LOGIN_REQUIRED` | yes | yes | Subscriber-only / private |
| `outOfDiskSpace` | `YTDLP_OUT_OF_DISK_SPACE` | yes | yes | ENOSPC during write/merge |
| `chunkTransferFailure` | `YTDLP_CHUNK_TRANSFER_FAILURE` | yes | no | Ranged HTTP truncation; retries exhausted |
| `postprocessFailure` | `YTDLP_POSTPROCESS_FAILURE` | yes | no | ffmpeg mux/convert/remux failure |
| `parse` | `YTDLP_PARSE_FAILURE` | no | no | `--dump-json` output unparseable |
| `network` | `YTDLP_NETWORK` | yes | no | Transport-level error |
| `unsupportedUrl` | `YTDLP_UNSUPPORTED_URL` | no | yes | URL not handled by any extractor |
| `unknown` | `YTDLP_UNKNOWN` | no | no | No pattern matched; render `raw` |

## Adapter recipes

### `yt-dlp-wrap`

```ts
import YTDlpWrap from 'yt-dlp-wrap';
import { classifyYtDlpStderr, extractLastError } from 'ytdlp-errors';

const ytdlp = new YTDlpWrap();
const proc = ytdlp.exec(['-f', 'best', url]);
let stderr = '';
proc.on('error', (err) => { stderr += String(err); });
proc.on('close', () => {
  const { kind } = classifyYtDlpStderr(stderr);
  if (kind !== 'unknown') console.error('classified:', kind);
  else console.error('raw:', extractLastError(stderr));
});
```

### `youtube-dl-exec`

```ts
import ytdl from 'youtube-dl-exec';
import { classifyYtDlpStderr } from 'ytdlp-errors';

try {
  await ytdl(url, { format: 'best' });
} catch (err) {
  const { kind, raw } = classifyYtDlpStderr(err.stderr ?? String(err));
  console.error(kind, raw);
}
```

### `ytdlp-nodejs`

```ts
import { YtDlp } from 'ytdlp-nodejs';
import { classifyYtDlpStderr } from 'ytdlp-errors';

const ytdlp = new YtDlp();
const stream = ytdlp.stream(url);
let stderr = '';
stream.on('error', (chunk) => { stderr += chunk; });
stream.on('end', () => {
  if (stderr) console.error(classifyYtDlpStderr(stderr).kind);
});
```

## Handling `unknown`

`classifyYtDlpStderr` never throws. When no pattern matches, you get `{ kind: 'unknown', raw }`. Surface `raw` verbatim — the upstream snapshot scan opens a PR when new unrecognized strings appear, so unknowns shrink over time. Don't suppress them; render them.

## Stability contract

- **`code` strings are public API.** Host apps key i18n strings, analytics labels, and logs on them. Golden-tested in `tests/codes-golden.test.ts`. Changing one is a major SemVer bump.
- **`YtDlpErrorKind` is a closed enum.** Adding a kind is a minor bump; consumers' exhaustive switches will warn. Removing a kind is a major bump.
- **Regex internals are not public API.** They live in `src/patterns.ts` and `ERROR_PATTERNS`. Tweaks that don't change classification outcomes for known strings ship as patch.
- **Upstream snapshot drives audit.** `data/known-yt-dlp-strings.json` (auto-generated) and `data/known-extractor-strings.json` (curated) pin the lib to specific yt-dlp source strings. CI fails if a snapshot entry's declared `kind` stops classifying correctly.

## How the upstream sync works

`scripts/scan-yt-dlp-source.mjs` clones yt-dlp at the pin in `data/yt-dlp-version.json`, greps for `report_error` / `raise *Error` / default-arg `raise_*` messages, dedupes by content hash, and writes `data/known-yt-dlp-strings.json`. Each entry carries `source` (file:line), `call` (which API emitted it), `fragment` (the string), and `kind` (human-assigned, `null` until triaged).

A weekly GitHub Actions cron re-runs the scan, bumps the pin to the latest stable yt-dlp release, and opens a PR. Reviewers triage `kind: null` entries.

Coverage tests (`tests/upstream-coverage.test.ts`) load both snapshot files and assert every non-null entry round-trips through `classifyYtDlpStderr` to its declared kind. The fixture corpus (`tests/fixtures/yt-dlp-stderr/`) provides realistic full-stderr blobs per kind.

## License

MIT (c) Antonio Orionus
