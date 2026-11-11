export const PROTOCOL_VERSION: 1;
export const MAX_PROTOCOL_MESSAGE_BYTES: 262144;
export const MAX_JOB_DESCRIPTION_LENGTH: 20000;

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
  | 'STATUS_UPDATE';

export type RunStatus = 'received' | 'analysing' | 'done' | 'failed';

export interface CapturedJob {
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  description: string;
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
  START_COMPARISON: { jobId: string; resumeIds: string[] };
  STATUS_UPDATE: {
    runId: string;
    status: RunStatus;
    error?: string;
  };
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
