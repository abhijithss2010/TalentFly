export const PROTOCOL_VERSION = 1;
export const MAX_PROTOCOL_MESSAGE_BYTES = 256 * 1024;
export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;

const MESSAGE_TYPES = new Set([
  'PING',
  'PONG',
  'JOB_CAPTURED',
  'CAPTURE_ACK',
  'LIST_JOBS',
  'JOBS',
  'LIST_RESUMES',
  'RESUMES',
  'START_COMPARISON',
  'STATUS_UPDATE',
]);
const RUN_STATUSES = new Set(['received', 'analysing', 'done', 'failed']);
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_JOB_FIELD_LENGTH = 200;
const MAX_RESUME_COUNT = 50;
const MAX_COMPARISON_RESUME_COUNT = 5;

export class ProtocolValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolValidationError';
  }
}

function fail(message) {
  throw new ProtocolValidationError(message);
}

function isRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function validText(value, maxLength, allowEmpty = false) {
  return typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0);
}

function validateJob(value) {
  if (
    !exactKeys(value, ['title', 'company', 'location', 'sourceUrl', 'description']) ||
    !validText(value.title, MAX_JOB_FIELD_LENGTH, true) ||
    !validText(value.company, MAX_JOB_FIELD_LENGTH, true) ||
    !validText(value.location, MAX_JOB_FIELD_LENGTH, true) ||
    !validText(value.description, MAX_JOB_DESCRIPTION_LENGTH)
  ) {
    return false;
  }

  try {
    const url = new URL(value.sourceUrl);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function validatePayload(type, payload) {
  switch (type) {
    case 'PING':
    case 'LIST_RESUMES':
      return exactKeys(payload, []);
    case 'PONG':
      return exactKeys(payload, ['ready']) && payload.ready === true;
    case 'JOB_CAPTURED':
      return exactKeys(payload, ['job']) && validateJob(payload.job);
    case 'CAPTURE_ACK':
      return (
        exactKeys(payload, ['accepted', 'jobId']) &&
        payload.accepted === true &&
        typeof payload.jobId === 'string' &&
        RECORD_ID_PATTERN.test(payload.jobId)
      );
    case 'LIST_JOBS':
      return exactKeys(payload, []);
    case 'JOBS':
      return (
        exactKeys(payload, ['jobs']) &&
        Array.isArray(payload.jobs) &&
        payload.jobs.length <= 100 &&
        payload.jobs.every(
          (job) =>
            isRecord(job) &&
            Object.keys(job).every((key) => ['id', 'title', 'company', 'location'].includes(key)) &&
            Object.hasOwn(job, 'id') &&
            Object.hasOwn(job, 'title') &&
            typeof job.id === 'string' &&
            RECORD_ID_PATTERN.test(job.id) &&
            validText(job.title, MAX_JOB_FIELD_LENGTH) &&
            (job.company === undefined || validText(job.company, MAX_JOB_FIELD_LENGTH)) &&
            (job.location === undefined || validText(job.location, MAX_JOB_FIELD_LENGTH)),
        )
      );
    case 'RESUMES':
      return (
        exactKeys(payload, ['resumes']) &&
        Array.isArray(payload.resumes) &&
        payload.resumes.length <= MAX_RESUME_COUNT &&
        payload.resumes.every(
          (resume) =>
            exactKeys(resume, ['id', 'name']) &&
            typeof resume.id === 'string' &&
            RECORD_ID_PATTERN.test(resume.id) &&
            validText(resume.name, 200),
        )
      );
    case 'START_COMPARISON':
      return (
        exactKeys(payload, ['jobId', 'resumeIds']) &&
        typeof payload.jobId === 'string' &&
        RECORD_ID_PATTERN.test(payload.jobId) &&
        Array.isArray(payload.resumeIds) &&
        payload.resumeIds.length > 0 &&
        payload.resumeIds.length <= MAX_COMPARISON_RESUME_COUNT &&
        payload.resumeIds.every((id) => typeof id === 'string' && RECORD_ID_PATTERN.test(id)) &&
        new Set(payload.resumeIds).size === payload.resumeIds.length
      );
    case 'STATUS_UPDATE':
      return (
        (exactKeys(payload, ['runId', 'status']) ||
          exactKeys(payload, ['runId', 'status', 'error'])) &&
        typeof payload.runId === 'string' &&
        RECORD_ID_PATTERN.test(payload.runId) &&
        RUN_STATUSES.has(payload.status) &&
        (payload.error === undefined || validText(payload.error, 1_000))
      );
    default:
      return false;
  }
}

export function validateProtocolMessage(value) {
  if (
    !exactKeys(value, ['protocolVersion', 'messageId', 'type', 'payload']) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    typeof value.messageId !== 'string' ||
    !MESSAGE_ID_PATTERN.test(value.messageId) ||
    typeof value.type !== 'string' ||
    !MESSAGE_TYPES.has(value.type) ||
    !validatePayload(value.type, value.payload)
  ) {
    fail('The extension message has an invalid shape or unsupported protocol version.');
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('The extension message cannot be serialized.');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PROTOCOL_MESSAGE_BYTES) {
    fail('The extension message exceeds the maximum allowed size.');
  }

  return value;
}

export function isProtocolMessage(value) {
  try {
    validateProtocolMessage(value);
    return true;
  } catch {
    return false;
  }
}

export function createProtocolMessage(type, payload, messageId = crypto.randomUUID()) {
  return validateProtocolMessage({
    protocolVersion: PROTOCOL_VERSION,
    messageId,
    type,
    payload,
  });
}

export function normalizeAllowedPwaOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0 || origins.length > 20) {
    fail('At least one configured PWA origin is required.');
  }

  const normalized = origins.map((origin) => {
    if (typeof origin !== 'string') {
      fail('Configured PWA origins must be origin URLs.');
    }
    let url;
    try {
      url = new URL(origin);
    } catch {
      fail('A configured PWA origin is not a valid URL.');
    }
    const localHttp =
      url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      origin !== url.origin
    ) {
      fail('PWA origins must be exact HTTPS origins (or localhost during development).');
    }
    return url.origin;
  });

  return [...new Set(normalized)];
}

function validateExtensionId(extensionId) {
  return typeof extensionId === 'string' && /^[a-p]{32}$/.test(extensionId);
}

export function validateExtensionMessage(
  value,
  sender,
  expectedExtensionId,
  allowedPwaOrigins,
) {
  if (!validateExtensionId(expectedExtensionId)) {
    fail('The configured extension ID is invalid.');
  }
  const allowedOrigins = normalizeAllowedPwaOrigins(allowedPwaOrigins);
  if (
    !isRecord(sender) ||
    sender.extensionId !== expectedExtensionId ||
    sender.origin !== `chrome-extension://${expectedExtensionId}` ||
    !allowedOrigins.includes(sender.pageOrigin)
  ) {
    fail('The extension message sender is not trusted.');
  }
  return validateProtocolMessage(value);
}

export function validatePwaMessage(
  value,
  sender,
  receiverExtensionId,
  allowedExtensionIds,
  allowedPwaOrigins,
) {
  if (
    !validateExtensionId(receiverExtensionId) ||
    !Array.isArray(allowedExtensionIds) ||
    !allowedExtensionIds.includes(receiverExtensionId)
  ) {
    fail('The configured extension ID is not allow-listed.');
  }
  const allowedOrigins = normalizeAllowedPwaOrigins(allowedPwaOrigins);
  if (
    !isRecord(sender) ||
    !allowedOrigins.includes(sender.origin) ||
    (sender.extensionId !== undefined && sender.extensionId !== receiverExtensionId)
  ) {
    fail('The PWA message sender is not trusted.');
  }
  return validateProtocolMessage(value);
}
