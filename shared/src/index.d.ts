export const PROTOCOL_VERSION: 1;
export const MAX_PROTOCOL_MESSAGE_BYTES: 262144;
export const MAX_JOB_DESCRIPTION_LENGTH: 20000;

export type ProtocolMessageType =
  | 'PING'
  | 'PONG'
  | 'JOB_CAPTURED'
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

export interface ProtocolPayloadMap {
  PING: Record<string, never>;
  PONG: { ready: true };
  JOB_CAPTURED: { job: CapturedJob };
  LIST_RESUMES: Record<string, never>;
  RESUMES: { resumes: ResumeSummary[] };
  START_COMPARISON: { job: CapturedJob; resumeIds: string[] };
  STATUS_UPDATE: {
    runId: string;
    status: RunStatus;
    error?: string;
  };
}

export type ProtocolMessage<T extends ProtocolMessageType = ProtocolMessageType> = {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  type: T;
  payload: ProtocolPayloadMap[T];
};

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
