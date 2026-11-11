import { describe, expect, it } from 'vitest';
import {
  createProtocolMessage,
  isProtocolMessage,
  MAX_JOB_DESCRIPTION_LENGTH,
  normalizeAllowedPwaOrigins,
  PROTOCOL_VERSION,
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
      protocolVersion: 3,
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
        { job, resumeIds: ['resume_1'] },
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
    expect(() => validateProtocolMessage({ ...ping, protocolVersion: 1 })).toThrow(
      ProtocolValidationError,
    );
    expect(() => validateProtocolMessage({ ...ping, protocolVersion: 1 })).toThrow(
      /Unsupported protocol version 1; this build speaks version 3\. Reload the TalentFly extension/,
    );
    expect(isProtocolMessage({ ...ping, type: 'EXECUTE' })).toBe(false);
    expect(() => validateProtocolMessage({ ...ping, injected: true })).toThrow(
      'not a TalentFly protocol message',
    );
    expect(() =>
      createProtocolMessage(
        'JOB_CAPTURED',
        { job: { ...job, sourceUrl: 'javascript:alert(1)' } },
        'bad-url',
      ),
    ).toThrow('job.sourceUrl must be an https URL');
    expect(() =>
      createProtocolMessage(
        'START_COMPARISON',
        { job, resumeIds: ['resume_1', 'resume_1'] },
        'duplicate',
      ),
    ).toThrow('resumeIds contains duplicates');
  });

  it('rejects overlong job descriptions and accepts the documented description limit', () => {
    const tooLongJob = {
      ...job,
      description: 'x'.repeat(MAX_JOB_DESCRIPTION_LENGTH + 1),
    };
    expect(() =>
      createProtocolMessage('JOB_CAPTURED', { job: tooLongJob }, 'long-description'),
    ).toThrow('job.description is longer than 20000 characters');

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

  it('accepts bounded otherFields on a job and rejects malformed or dangerous ones', () => {
    const withFields = (otherFields: unknown) =>
      createProtocolMessage('JOB_CAPTURED', { job: { ...job, otherFields } as never }, 'fields');

    const accepted = withFields({ Reference: 'REF-1' });
    expect(validateProtocolMessage(accepted)).toEqual(accepted);

    expect(() => withFields({ Reference: 42 })).toThrow('job.otherFields must have at most 10');
    expect(() => withFields({ Reference: '' })).toThrow('job.otherFields must have at most 10');
    expect(() => withFields({ '': 'x' })).toThrow('job.otherFields must have at most 10');
    expect(() => withFields(['Reference'])).toThrow('job.otherFields must have at most 10');
    expect(() => withFields(JSON.parse('{"__proto__": "x"}'))).toThrow('job.otherFields must have at most 10');
    expect(() => withFields({ constructor: 'x' })).toThrow('job.otherFields must have at most 10');
    expect(() => withFields({ Reference: 'x'.repeat(2_001) })).toThrow('job.otherFields must have at most 10');
    expect(() =>
      withFields(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, 'v']))),
    ).toThrow('job.otherFields must have at most 10');
    expect(() =>
      createProtocolMessage('JOB_CAPTURED', { job: { ...job, extra: 'x' } as never }, 'extra'),
    ).toThrow('job.extra is not part of the contract');
  });

  it('explains an old START_COMPARISON that still sends jobId', () => {
    const old = {
      protocolVersion: 3,
      messageId: 'old',
      type: 'START_COMPARISON',
      payload: { jobId: 'job_1', resumeIds: ['resume_1'] },
    };
    expect(() => validateProtocolMessage(old)).toThrow(/still uses the old "jobId" field/);
  });

  it('names the offending field for common payload mistakes', () => {
    const start = (payload: unknown) =>
      createProtocolMessage('START_COMPARISON', payload as never, 'start');
    expect(() => start({ job: { ...job, title: 't'.repeat(201) }, resumeIds: ['r'] })).toThrow(
      'job.title is longer than 200 characters',
    );
    expect(() => start({ job: { ...job, description: '   ' }, resumeIds: ['r'] })).toThrow(
      'job.description must not be empty',
    );
    expect(() => start({ job, resumeIds: [] })).toThrow('resumeIds must list at least one resume');
    expect(() => start({ job, resumeIds: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(
      'resumeIds may list at most 5 resumes',
    );
  });

  it('validates the ERROR response', () => {
    const error = createProtocolMessage(
      'ERROR',
      { code: 'NOT_FOUND', message: 'That resume is no longer available.' },
      'start',
    );
    expect(validateProtocolMessage(error)).toEqual(error);
    expect(() =>
      createProtocolMessage('ERROR', { code: 'WHATEVER', message: 'x' } as never, 'bad'),
    ).toThrow('"ERROR" message is invalid');
    expect(() =>
      createProtocolMessage('ERROR', { code: 'INTERNAL', message: '' }, 'empty'),
    ).toThrow('"ERROR" message is invalid');
  });

  it('validates the run status lookup messages', () => {
    const status = createProtocolMessage('GET_RUN_STATUS', { runId: 'run_123-abc' }, 'get');
    expect(validateProtocolMessage(status)).toEqual(status);
    const latest = createProtocolMessage(
      'LATEST_RUN_FOR_URL',
      { sourceUrl: 'https://app.whoz.com/jobs/1?tab=2#top' },
      'latest',
    );
    expect(validateProtocolMessage(latest)).toEqual(latest);

    expect(() => createProtocolMessage('GET_RUN_STATUS', { runId: '../x' }, 'bad')).toThrow(
      '"GET_RUN_STATUS" message is invalid',
    );
    expect(() => createProtocolMessage('GET_RUN_STATUS', {} as never, 'empty')).toThrow(
      '"GET_RUN_STATUS" message is invalid',
    );
    for (const sourceUrl of [
      'javascript:alert(1)',
      'http://example.com/x',
      'https://user:pw@whoz.com/x',
      'not a url',
      `https://whoz.com/${'x'.repeat(2_000)}`,
    ]) {
      expect(() =>
        createProtocolMessage('LATEST_RUN_FOR_URL', { sourceUrl }, 'url'),
      ).toThrow('"LATEST_RUN_FOR_URL" message is invalid');
    }
  });

  it('is on protocol version 3', () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });
});
