import { ERROR_PATTERNS } from './patterns.js';

// Pull the most useful single-line error description out of a yt-dlp stderr
// blob. Used both for log lines and for the renderer's verbatim "unknown"
// fallback. yt-dlp sometimes emits a bare "ERROR:" with no message after the
// downloader exhausts its retries — fall back to the most recent [download]
// line, then the last non-empty line.
export function extractLastError(stderr: string): string | null {
  const errorMatches = stderr.match(/ERROR:.*$/gm);
  const lastError = errorMatches ? errorMatches[errorMatches.length - 1]!.trim() : null;
  if (!lastError || /^ERROR:\s*$/.test(lastError)) {
    const downloadMatches =
      stderr.match(/\[download\] Got error:.*Giving up after \d+ retries.*$/gm) ??
      stderr.match(/\[download\] Got error:.*$/gm);
    if (downloadMatches) return downloadMatches[downloadMatches.length - 1]!.trim();
    const lines = stderr.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) return lines[lines.length - 1]!.trim();
  }
  return lastError;
}

// True when the raw error string looks like a yt-dlp postprocessor failure.
// Useful when a host app wants to disambiguate masked-ENOSPC errors (which
// surface as ffmpeg "Conversion failed!" with no underlying detail) by doing
// a follow-up disk-space probe. Kept as a separate predicate rather than
// always returning `postprocessFailure` from the classifier so the
// disk-space upgrade path can short-circuit when a probe confirms ENOSPC.
export function isPostprocessFailure(rawError: string | null): boolean {
  return rawError !== null && ERROR_PATTERNS.postprocessFailure.test(rawError);
}
