import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupTestDatabases,
  createTestDatabase,
  seedRun,
} from '../test-helpers/local-data';
import { HistoryPage } from './HistoryPage';

afterEach(async () => {
  cleanup();
  await cleanupTestDatabases();
});

describe('HistoryPage', () => {
  it('explains the empty state', async () => {
    const { factory } = createTestDatabase();
    render(<HistoryPage serviceFactory={factory} />);

    expect(await screen.findByRole('heading', { name: 'No comparisons yet.' })).toBeTruthy();
  });

  it('lists saved runs newest first and links each to its run detail route', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const first = await seedRun(services, { title: 'Older role' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await seedRun(services, { title: 'Newer role' });
    await seedRun(services, { title: 'Waiting role', done: false });

    render(<HistoryPage serviceFactory={factory} />);
    const items = (await screen.findAllByRole('listitem')).filter((item) =>
      item.classList.contains('history-item'),
    );
    expect(items).toHaveLength(3);
    const titles = items.map((item) => within(item).getByRole('link').textContent);
    expect(titles[0]).toContain('Waiting role');
    expect(titles.some((text) => text?.includes('Newer role'))).toBe(true);

    const newer = items.find((item) => item.textContent?.includes('Newer role'));
    expect(within(newer as HTMLElement).getByRole('link').getAttribute('href')).toBe(
      `#history/${second.run.id}`,
    );
    expect(within(newer as HTMLElement).getByText('81/100')).toBeTruthy();
    expect(within(newer as HTMLElement).getByText('Platform resume')).toBeTruthy();
    expect(within(newer as HTMLElement).getByText('done')).toBeTruthy();
    const older = items.find((item) => item.textContent?.includes('Older role'));
    expect(within(older as HTMLElement).getByRole('link').getAttribute('href')).toBe(
      `#history/${first.run.id}`,
    );
    const waiting = items.find((item) => item.textContent?.includes('Waiting role'));
    expect(within(waiting as HTMLElement).getByText('received')).toBeTruthy();
    expect(within(waiting as HTMLElement).queryByText(/\/100/)).toBeNull();
  });

  it('no longer shows usage statistics; they live on the Usage page', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    await seedRun(services);

    render(<HistoryPage serviceFactory={factory} />);
    await screen.findByText('Platform resume');
    expect(screen.queryByText(/input tokens|Usage on this device|responses/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('labels a run whose resume was deleted and still opens its saved report', async () => {
    const { factory } = createTestDatabase();
    const services = await factory();
    const { resumeId } = await seedRun(services);
    await services.resumes.delete(resumeId);

    render(<HistoryPage serviceFactory={factory} />);
    // The saved report keeps the resume name even though the resume itself is gone.
    expect(await screen.findByText('Platform resume')).toBeTruthy();
  });
});
