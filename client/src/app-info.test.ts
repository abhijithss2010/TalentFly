import { describe, expect, it } from 'vitest';
import { APP_NAME } from './app-info';

describe('client workspace', () => {
  it('exposes the product name', () => {
    expect(APP_NAME).toBe('TalentFly');
  });
});
