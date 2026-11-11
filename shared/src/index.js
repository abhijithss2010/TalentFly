/**
 * Bump when a message payload changes incompatibly or a new message type is added
 * (v2: START_COMPARISON carries `job` instead of `jobId`, ERROR response added;
 * v3: GET_RUN_STATUS and LATEST_RUN_FOR_URL added).
 */
export const PROTOCOL_VERSION = 3;
export const MAX_PROTOCOL_MESSAGE_BYTES = 256 * 1024;
export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
export const MAX_JOB_FIELD_LENGTH = 200;
export const MAX_OTHER_FIELDS = 10;
export const MAX_OTHER_FIELD_KEY_LENGTH = 100;
export const MAX_OTHER_FIELD_VALUE_LENGTH = 2_000;
export const MAX_COMPARISON_RESUME_COUNT = 5;
export const ERROR_CODES = ['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'NOT_FOUND', 'INTERNAL'];

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
  'GET_RUN_STATUS',
  'LATEST_RUN_FOR_URL',
  'STATUS_UPDATE',
  'ERROR',
]);
const RUN_STATUSES = new Set(['received', 'analysing', 'done', 'failed']);
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RESUME_COUNT = 50;
const FORBIDDEN_FIELD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

function validateOtherFields(value) {
  if (!isRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_OTHER_FIELDS &&
    entries.every(
      ([key, fieldValue]) =>
        key.trim().length > 0 &&
        key.length <= MAX_OTHER_FIELD_KEY_LENGTH &&
        !FORBIDDEN_FIELD_KEYS.has(key) &&
        validText(fieldValue, MAX_OTHER_FIELD_VALUE_LENGTH),
    )
  );
}

function validatePageUrl(value) {
  if (typeof value !== 'string' || value.length > 2_000) {
    return false;
  }
  try {
    const url = new URL(value);
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

function validateJob(value) {
  const baseKeys = ['title', 'company', 'location', 'sourceUrl', 'description'];
  if (
    !(exactKeys(value, baseKeys) ||
      (exactKeys(value, [...baseKeys, 'otherFields']) && validateOtherFields(value.otherFields))) ||
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

/** Names the first job field that breaks the contract, or '' when the job is valid. */
function describeJobProblem(job) {
  if (!isRecord(job)) return 'job must be an object';
  const allowed = new Set(['title', 'company', 'location', 'sourceUrl', 'description', 'otherFields']);
  const unknown = Object.keys(job).find((key) => !allowed.has(key));
  if (unknown) return `job.${unknown} is not part of the contract`;
  for (const key of ['title', 'company', 'location']) {
    if (typeof job[key] !== 'string') return `job.${key} must be text`;
    if (job[key].length > MAX_JOB_FIELD_LENGTH) {
      return `job.${key} is longer than ${MAX_JOB_FIELD_LENGTH} characters`;
    }
  }
  if (typeof job.description !== 'string' || job.description.trim().length === 0) {
    return 'job.description must not be empty';
  }
  if (job.description.length > MAX_JOB_DESCRIPTION_LENGTH) {
    return `job.description is longer than ${MAX_JOB_DESCRIPTION_LENGTH} characters`;
  }
  if (typeof job.sourceUrl !== 'string') return 'job.sourceUrl must be text';
  try {
    const url = new URL(job.sourceUrl);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) {
      return 'job.sourceUrl must be an https URL without credentials';
    }
  } catch {
    return 'job.sourceUrl is not a valid URL';
  }
  if (job.otherFields !== undefined && !validateOtherFields(job.otherFields)) {
    return `job.otherFields must have at most ${MAX_OTHER_FIELDS} non-empty text values (keys up to ${MAX_OTHER_FIELD_KEY_LENGTH} and values up to ${MAX_OTHER_FIELD_VALUE_LENGTH} characters)`;
  }
  return '';
}

function describePayloadProblem(type, payload) {
  if (!isRecord(payload)) return 'the payload must be an object';
  if (type === 'START_COMPARISON' || type === 'JOB_CAPTURED') {
    if (!Object.hasOwn(payload, 'job')) {
      return type === 'START_COMPARISON' && Object.hasOwn(payload, 'jobId')
        ? 'it still uses the old "jobId" field; the job details are now sent in "job" (an older extension or app build is running)'
        : 'the "job" field is missing';
    }
    const problem = describeJobProblem(payload.job);
    if (problem) return problem;
    if (type === 'START_COMPARISON') {
      const ids = payload.resumeIds;
      if (!Array.isArray(ids) || ids.length === 0) return 'resumeIds must list at least one resume';
      if (ids.length > MAX_COMPARISON_RESUME_COUNT) {
        return `resumeIds may list at most ${MAX_COMPARISON_RESUME_COUNT} resumes`;
      }
      if (!ids.every((id) => typeof id === 'string' && RECORD_ID_PATTERN.test(id))) {
        return 'resumeIds contains an invalid resume ID';
      }
      if (new Set(ids).size !== ids.length) return 'resumeIds contains duplicates';
      const extra = Object.keys(payload).find((key) => key !== 'job' && key !== 'resumeIds');
      if (extra) return `"${extra}" is not part of the contract`;
    }
  }
  return 'the payload has an unexpected shape';
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
        exactKeys(payload, ['job', 'resumeIds']) &&
        validateJob(payload.job) &&
        Array.isArray(payload.resumeIds) &&
        payload.resumeIds.length > 0 &&
        payload.resumeIds.length <= MAX_COMPARISON_RESUME_COUNT &&
        payload.resumeIds.every((id) => typeof id === 'string' && RECORD_ID_PATTERN.test(id)) &&
        new Set(payload.resumeIds).size === payload.resumeIds.length
      );
    case 'GET_RUN_STATUS':
      return (
        exactKeys(payload, ['runId']) &&
        typeof payload.runId === 'string' &&
        RECORD_ID_PATTERN.test(payload.runId)
      );
    case 'LATEST_RUN_FOR_URL':
      return exactKeys(payload, ['sourceUrl']) && validatePageUrl(payload.sourceUrl);
    case 'ERROR':
      return (
        exactKeys(payload, ['code', 'message']) &&
        ERROR_CODES.includes(payload.code) &&
        validText(payload.message, 500)
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
  if (!exactKeys(value, ['protocolVersion', 'messageId', 'type', 'payload'])) {
    fail('The extension message is not a TalentFly protocol message.');
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    fail(
      `Unsupported protocol version ${String(value.protocolVersion)}; this build speaks version ${PROTOCOL_VERSION}. Reload the TalentFly extension on chrome://extensions and refresh the TalentFly tab.`,
    );
  }
  if (typeof value.messageId !== 'string' || !MESSAGE_ID_PATTERN.test(value.messageId)) {
    fail('The extension message has an invalid message ID.');
  }
  if (typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type)) {
    fail(`The extension message type "${String(value.type)}" is not supported by this build.`);
  }
  if (!validatePayload(value.type, value.payload)) {
    fail(`The "${value.type}" message is invalid: ${describePayloadProblem(value.type, value.payload)}.`);
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
