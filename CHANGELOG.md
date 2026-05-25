# Changelog

## 1.0.0 — initial release

First public release. Curated regex taxonomy of yt-dlp error kinds, snapshot-anchored to the upstream source.

### Public API

- `classifyYtDlpStderr(stderr, opts?)` — pure stderr → `{ kind, raw }` classifier
- `classifyAll(stderr, opts?)` — per-line classification for `--ignore-errors` runs
- `extractLastError(stderr)` — pull the most useful single-line description
- `isPostprocessFailure(raw)` — predicate for ENOSPC-masquerading-as-ffmpeg detection
- `errorKindMetadata(kind)` — stable code, recoverability, suggested yt-dlp flags, docs URL
- `YT_DLP_ERROR_KINDS`, `YtDlpErrorKind`, `ERROR_KIND_METADATA`, `ERROR_PATTERNS`

### Kinds (15 total)

`botBlock`, `ipBlock`, `rateLimit`, `ageRestricted`, `unavailable`, `geoBlocked`, `drmProtected`, `loginRequired`, `outOfDiskSpace`, `chunkTransferFailure`, `postprocessFailure`, `parse`, `network`, `unsupportedUrl`, `unknown`.

### Upstream pin

- yt-dlp `2026.03.17` (`04d6974f502bbdfaed72c624344f262e30ad9708`)
- Weekly CI cron tracks new releases and opens PR on snapshot drift.

### Coverage

- Fixture corpus: realistic stderr blobs per kind under `tests/fixtures/yt-dlp-stderr/`.
- `data/known-yt-dlp-strings.json`: auto-extracted yt-dlp source strings, each tagged with `kind` for round-trip testing.
- `data/known-extractor-strings.json`: hand-curated YouTube / extractor-passthrough strings (those that don't originate in yt-dlp source).
- `tests/codes-golden.test.ts`: stable-code contract — any change requires a major SemVer bump.
