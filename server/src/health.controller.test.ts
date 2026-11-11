import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('server workspace', () => {
  it('reports the API health state', () => {
    expect(new HealthController().getHealth()).toEqual({ status: 'ok' });
  });
});
