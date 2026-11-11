import { describe, expect, it } from 'vitest';
import {
  createProtocolMessage,
  isProtocolMessage,
  MAX_JOB_DESCRIPTION_LENGTH,
  normalizeAllowedPwaOrigins,
  ProtocolValidationError,
  validateExtensionMessage,
  validateProtocolMessage,
  validatePwaMessage,
} from '../src/index.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const pwaOrigin = 'https://talentfly.example';
const job = {
  title: 'Frontend Engineer',
  company: 'Example Co',
  location: 'Remote',
  sourceUrl: 'https://jobs.example/roles/frontend',
  description: 'Build accessible web applications.',
};

describe('shared extension protocol', () => {
  it('creates and validates a versioned captured-job message', () => {
    const message = createProtocolMessage(
      'JOB_CAPTURED',
      { job },
      'capture_123',
    );

    expect(message).toEqual({
      protocolVersion: 1,
      messageId: 'capture_123',
      type: 'JOB_CAPTURED',
      payload: { job },
    });
    expect(validateProtocolMessage(message)).toEqual(message);
    expect(isProtocolMessage(message)).toBe(true);
  });

  it('validates every supported message shape', () => {
    const validMessages = [
      createProtocolMessage('PING', {}, 'ping'),
      createProtocolMessage('PONG', { ready: true }, 'pong'),
      createProtocolMessage('JOB_CAPTURED', { job }, 'job'),
      createProtocolMessage('CAPTURE_ACK', { accepted: true, jobId: 'job_1' }, 'capture-ack'),
      createProtocolMessage('LIST_JOBS', {}, 'list-jobs'),
      createProtocolMessage(
        'JOBS',
        { jobs: [{ id: 'job_1', title: 'Engineer' }] },
        'jobs',
      ),
      createProtocolMessage('LIST_RESUMES', {}, 'list'),
      createProtocolMessage(
        'RESUMES',
        { resumes: [{ id: 'resume_1', name: 'Engineer' }] },
        'resumes',
      ),
      createProtocolMessage(
        'START_COMPARISON',
        { jobId: 'job_1', resumeIds: ['resume_1'] },
        'start',
      ),
      createProtocolMessage(
        'STATUS_UPDATE',
        { runId: 'run_1', status: 'failed', error: 'Provider unavailable.' },
        'status',
      ),
    ];

    for (const message of validMessages) {
      expect(validateProtocolMessage(message)).toEqual(message);
    }
  });

  it('rejects unknown versions, types, extra keys, invalid URLs, and malformed payloads', () => {
    const ping = createProtocolMessage('PING', {}, 'ping');
    expect(() => validateProtocolMessage({ ...ping, protocolVersion: 2 })).toThrow(
      ProtocolValidationError,
    );
    expect(isProtocolMessage({ ...ping, type: 'EXECUTE' })).toBe(false);
    expect(() => validateProtocolMessage({ ...ping, injected: true })).toThrow(
      'invalid shape',
    );
    expect(() =>
      createProtocolMessage(
        'JOB_CAPTURED',
        { job: { ...job, sourceUrl: 'javascript:alert(1)' } },
        'bad-url',
      ),
    ).toThrow('invalid shape');
    expect(() =>
      createProtocolMessage(
        'START_COMPARISON',
        { jobId: 'job_1', resumeIds: ['resume_1', 'resume_1'] },
        'duplicate',
      ),
    ).toThrow('invalid shape');
  });

  it('rejects overlong job descriptions and accepts the documented description limit', () => {
    const tooLongJob = {
      ...job,
      description: 'x'.repeat(MAX_JOB_DESCRIPTION_LENGTH + 1),
    };
    expect(() =>
      createProtocolMessage('JOB_CAPTURED', { job: tooLongJob }, 'long-description'),
    ).toThrow('invalid shape');

    const maximumJob = createProtocolMessage(
      'JOB_CAPTURED',
      { job: { ...job, description: 'x'.repeat(MAX_JOB_DESCRIPTION_LENGTH) } },
      'maximum-description',
    );
    expect(validateProtocolMessage(maximumJob)).toEqual(maximumJob);
  });

  it('rejects PWA origins that are not exact HTTPS origins or local development origins', () => {
    expect(normalizeAllowedPwaOrigins([pwaOrigin, 'http://localhost:5173'])).toEqual([
      pwaOrigin,
      'http://localhost:5173',
    ]);
    expect(() => normalizeAllowedPwaOrigins(['https://talentfly.example/path'])).toThrow(
      'exact HTTPS origins',
    );
    expect(() => normalizeAllowedPwaOrigins(['http://talentfly.example'])).toThrow(
      'exact HTTPS origins',
    );
    expect(() => normalizeAllowedPwaOrigins(['*'])).toThrow('valid URL');
  });

  it('requires the expected extension identity and the configured PWA origin', () => {
    const ping = createProtocolMessage('PING', {}, 'trusted-ping');
    expect(
      validateExtensionMessage(
        ping,
        {
          origin: `chrome-extension://${extensionId}`,
          extensionId,
          pageOrigin: pwaOrigin,
        },
        extensionId,
        [pwaOrigin],
      ),
    ).toEqual(ping);

    expect(() =>
      validateExtensionMessage(
        ping,
        {
          origin: `chrome-extension://${extensionId}`,
          extensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba',
          pageOrigin: pwaOrigin,
        },
        extensionId,
        [pwaOrigin],
      ),
    ).toThrow('not trusted');
    expect(() =>
      validateExtensionMessage(
        ping,
        { origin: `chrome-extension://${extensionId}`, extensionId, pageOrigin: 'https://evil.example' },
        extensionId,
        [pwaOrigin],
      ),
    ).toThrow('not trusted');
  });

  it('requires an allow-listed PWA origin when validating messages on the extension side', () => {
    const resumes = createProtocolMessage('LIST_RESUMES', {}, 'list');
    expect(
      validatePwaMessage(
        resumes,
        { origin: pwaOrigin },
        extensionId,
        [extensionId],
        [pwaOrigin],
      ),
    ).toEqual(resumes);

    expect(() =>
      validatePwaMessage(
        resumes,
        { origin: 'https://evil.example' },
        extensionId,
        [extensionId],
        [pwaOrigin],
      ),
    ).toThrow('not trusted');
    expect(() =>
      validatePwaMessage(
        resumes,
        { origin: pwaOrigin, extensionId: 'ponmlkjihgfedcbaponmlkjihgfedcba' },
        extensionId,
        [extensionId],
        [pwaOrigin],
      ),
    ).toThrow('not trusted');
    expect(() =>
      validatePwaMessage(resumes, { origin: pwaOrigin }, extensionId, [], [pwaOrigin]),
    ).toThrow('not allow-listed');
  });
});
