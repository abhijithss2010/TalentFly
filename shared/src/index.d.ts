export const PROTOCOL_VERSION: 3;
export const MAX_PROTOCOL_MESSAGE_BYTES: 262144;
export const MAX_JOB_DESCRIPTION_LENGTH: 20000;
export const MAX_JOB_FIELD_LENGTH: 200;
export const MAX_OTHER_FIELDS: 10;
export const MAX_OTHER_FIELD_KEY_LENGTH: 100;
export const MAX_OTHER_FIELD_VALUE_LENGTH: 2000;
export const MAX_COMPARISON_RESUME_COUNT: 5;
export const ERROR_CODES: readonly ErrorCode[];

export type ErrorCode = 'INVALID_REQUEST' | 'UNSUPPORTED_VERSION' | 'NOT_FOUND' | 'INTERNAL';

export type ProtocolMessageType =
  | 'PING'
  | 'PONG'
  | 'JOB_CAPTURED'
  | 'CAPTURE_ACK'
  | 'LIST_JOBS'
  | 'JOBS'
  | 'LIST_RESUMES'
  | 'RESUMES'
  | 'START_COMPARISON'
  | 'GET_RUN_STATUS'
  | 'LATEST_RUN_FOR_URL'
  | 'STATUS_UPDATE'
  | 'ERROR';

export type RunStatus = 'received' | 'analysing' | 'done' | 'failed';

export interface CapturedJob {
  title: string;
  company: string;
  location: string;
  /** The page URL the job was read from. */
  sourceUrl: string;
  description: string;
  /** Site-specific extras (for example `Reference` on whoz.com). Omitted when empty. */
  otherFields?: Record<string, string>;
}

export interface ResumeSummary {
  id: string;
  name: string;
}

export interface JobSummary {
  id: string;
  title: string;
  company?: string;
  location?: string;
}

export interface ProtocolPayloadMap {
  PING: Record<string, never>;
  PONG: { ready: true };
  JOB_CAPTURED: { job: CapturedJob };
  CAPTURE_ACK: { accepted: true; jobId: string };
  LIST_JOBS: Record<string, never>;
  JOBS: { jobs: JobSummary[] };
  LIST_RESUMES: Record<string, never>;
  RESUMES: { resumes: ResumeSummary[] };
  START_COMPARISON: { job: CapturedJob; resumeIds: string[] };
  /** Reply: STATUS_UPDATE, or ERROR with code NOT_FOUND when the run does not exist. */
  GET_RUN_STATUS: { runId: string };
  /** Reply: STATUS_UPDATE for the latest run of that page URL, or ERROR NOT_FOUND. */
  LATEST_RUN_FOR_URL: { sourceUrl: string };
  STATUS_UPDATE: {
    runId: string;
    status: RunStatus;
    error?: string;
  };
  /** Sent instead of a normal reply when a request is rejected or cannot be processed. */
  ERROR: { code: ErrorCode; message: string };
}

export type ProtocolMessage<T extends ProtocolMessageType = ProtocolMessageType> =
  T extends ProtocolMessageType
    ? {
        protocolVersion: typeof PROTOCOL_VERSION;
        messageId: string;
        type: T;
        payload: ProtocolPayloadMap[T];
      }
    : never;

export interface MessageSender {
  origin: string;
  extensionId?: string;
  pageOrigin?: string;
}

export class ProtocolValidationError extends Error {
  name: 'ProtocolValidationError';
}

export function createProtocolMessage<T extends ProtocolMessageType>(
  type: T,
  payload: ProtocolPayloadMap[T],
  messageId?: string,
): ProtocolMessage<T>;

export function validateProtocolMessage(value: unknown): ProtocolMessage;
export function isProtocolMessage(value: unknown): value is ProtocolMessage;
export function normalizeAllowedPwaOrigins(origins: readonly string[]): readonly string[];

export function validateExtensionMessage(
  value: unknown,
  sender: MessageSender,
  expectedExtensionId: string,
  allowedPwaOrigins: readonly string[],
): ProtocolMessage;

export function validatePwaMessage(
  value: unknown,
  sender: MessageSender,
  receiverExtensionId: string,
  allowedExtensionIds: readonly string[],
  allowedPwaOrigins: readonly string[],
): ProtocolMessage;
