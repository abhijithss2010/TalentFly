import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDataServices } from '../data/local-data-service';
import { ResumeLibrary } from './ResumeLibrary';

const names: string[] = [];

function createServiceFactory() {
  const databaseName = `resume-library-${crypto.randomUUID()}`;
  names.push(databaseName);
  return () => createLocalDataServices({ databaseName, indexedDB });
}

async function removeDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  cleanup();
  await Promise.all(names.splice(0).map(removeDatabase));
});

describe('resume library', () => {
  it('imports locally, renames, sets a default, edits text, and deletes a resume', async () => {
    const serviceFactory = createServiceFactory();
    const parseFile = vi.fn(async () => 'Built accessible experiences.');
    const onCountChange = vi.fn();
    render(
      <ResumeLibrary
        onCountChange={onCountChange}
        parseFile={parseFile}
        serviceFactory={serviceFactory}
      />,
    );

    expect(await screen.findByText('Your resume library is ready.')).toBeTruthy();
    const resumeFile = new File(['resume bytes'], 'career.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload resume files'), {
      target: { files: [resumeFile] },
    });

    expect(await screen.findByRole('heading', { name: 'career' })).toBeTruthy();
    expect(parseFile).toHaveBeenCalledWith(resumeFile);
    expect((await screen.findByRole('status')).textContent).toContain(
      '1 resume added to this device.',
    );
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Resume name'), {
      target: { value: 'Product engineering' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('heading', { name: 'Product engineering' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    expect(await screen.findByText('Default')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View extracted text' }));
    const textArea = screen.getByLabelText('Extracted resume text');
    fireEvent.change(textArea, { target: { value: 'Updated and reviewed text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save extracted text' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Extracted text saved on this device.',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('Your resume library is ready.')).toBeTruthy();
    expect(onCountChange).toHaveBeenLastCalledWith(0);

    const services = await serviceFactory();
    try {
      expect(await services.resumes.getAll()).toEqual([]);
      expect((await services.settings.get('app'))?.defaultResumeId).toBeNull();
    } finally {
      services.close();
    }
  });

  it('surfaces unsupported files and parser failures without saving them', async () => {
    const serviceFactory = createServiceFactory();
    const parseFile = vi.fn(async () => {
      throw new Error('The PDF is password-protected.');
    });
    render(
      <ResumeLibrary
        parseFile={parseFile}
        serviceFactory={serviceFactory}
      />,
    );
    await screen.findByText('Your resume library is ready.');

    fireEvent.change(screen.getByLabelText('Upload resume files'), {
      target: {
        files: [
          new File(['invalid'], 'wrong.pdf', { type: 'text/plain' }),
          new File(['private'], 'locked.pdf', { type: 'application/pdf' }),
        ],
      },
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'wrong.pdf: The file type does not match the .pdf extension.',
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'locked.pdf: The PDF is password-protected.',
    );
    expect(parseFile).toHaveBeenCalledTimes(1);
    expect(parseFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'locked.pdf' }));
    expect(screen.getByText('Your resume library is ready.')).toBeTruthy();
  });
});
