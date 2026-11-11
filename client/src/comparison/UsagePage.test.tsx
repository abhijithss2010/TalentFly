import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecordId } from '../data/local-data-service';
import {
  cleanupTestDatabases,
  createTestDatabase,
  seedRun,
} from '../test-helpers/local-data';
import { UsagePage } from './UsagePage';

afterEach(async () => {
  cleanup();
  await cleanupTestDatabases();
});

describe('UsagePage', () => {
  it('explains that nothing has been used yet', async () => {
    const { factory } = createTestDatabase();
    render(<UsagePage serviceFactory={factory} />);

    expect(await screen.findByRole('heading', { name: 'No usage yet.' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists token usage against each run and totals it per provider', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const first = await seedRun(services, { title: 'Older role' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await seedRun(services, { title: 'Newer role' });
    // A run that was never sent has no usage and therefore no row.
    await seedRun(services, { title: 'Waiting role', done: false });

    render(<UsagePage serviceFactory={factory} />);

    const totals = await screen.findByText(/2 responses/);
    expect(totals.textContent).toContain('claude');
    expect(totals.textContent).toContain('2,400 input');
    expect(totals.textContent).toContain('600 output tokens');
    expect(screen.getByText(/Costs are not calculated/)).toBeTruthy();

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Newer role');
    expect(rows[1]?.textContent).toContain('Older role');
    expect(rows.some((row) => row.textContent?.includes('Waiting role'))).toBe(false);
    for (const [row, seeded] of [[rows[0], second], [rows[1], first]] as const) {
      const cells = within(row as HTMLElement).getAllByRole('cell');
      expect(within(row as HTMLElement).getByRole('link').getAttribute('href')).toBe(
        `#history/${seeded.run.id}`,
      );
      expect(cells[2]?.textContent).toBe('claude');
      expect(cells[3]?.textContent).toBe('1');
      expect(cells[4]?.textContent).toBe('1,200');
      expect(cells[5]?.textContent).toBe('300');
    }
  });

  it('adds up several responses for one run and groups usage of deleted runs', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { run } = await seedRun(services);
    await services.usage.save({
      id: createRecordId('usage'),
      runId: run.id,
      provider: 'claude',
      inputTokens: 800,
      outputTokens: 200,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await services.usage.save({
      id: createRecordId('usage'),
      runId: 'run_deleted',
      provider: 'claude',
      inputTokens: 50,
      outputTokens: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(<UsagePage serviceFactory={factory} />);
    await screen.findByRole('table');

    const runRow = document.querySelector(`[data-run-id="${run.id}"]`) as HTMLElement;
    expect(within(runRow).getAllByRole('cell').map((cell) => cell.textContent).slice(3)).toEqual([
      '2',
      '2,000',
      '500',
    ]);
    const deleted = document.querySelector('[data-run-id="deleted"]') as HTMLElement;
    expect(deleted.textContent).toContain('Deleted runs');
    expect(within(deleted).getAllByRole('cell').map((cell) => cell.textContent).slice(3)).toEqual([
      '1',
      '50',
      '5',
    ]);
  });
});
