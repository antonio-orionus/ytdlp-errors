export { YT_DLP_ERROR_KINDS } from './kinds.js';
export type { YtDlpErrorKind, ClassifierKind, ClassifiedError } from './kinds.js';

export { classifyYtDlpStderr, classifyAll, ERROR_PATTERNS } from './classifier.js';
export type { ClassifyOpts } from './classifier.js';

export { extractLastError, isPostprocessFailure } from './extractors.js';

export { errorKindMetadata, ERROR_KIND_METADATA } from './metadata.js';
export type { KindMetadata } from './metadata.js';
