import { useEffect, useRef, useState } from 'react';
import {
  createLocalDataServices,
  createRecordId,
  type LocalDataServices,
} from '../data/local-data-service';
import type { AppSettingsRecord, ResumeRecord } from '../data/models';
import { parseResumeFile, validateResumeFile } from './resume-parser';

interface ResumeLibraryProps {
  onCountChange?: (count: number) => void;
  serviceFactory?: typeof createLocalDataServices;
  parseFile?: (file: File) => Promise<string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested resume action failed.';
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  return size < 1024 * 1024
    ? `${Math.round(size / 1024)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function updatedSettings(
  existing: AppSettingsRecord | undefined,
  changes: Pick<AppSettingsRecord, 'defaultResumeId'>,
): AppSettingsRecord {
  const now = new Date().toISOString();
  return {
    id: 'app',
    defaultResumeId: changes.defaultResumeId,
    preferredProvider: existing?.preferredProvider ?? null,
    providerModels: existing?.providerModels,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function ResumeLibrary({
  onCountChange,
  serviceFactory = createLocalDataServices,
  parseFile = parseResumeFile,
}: ResumeLibraryProps) {
  const servicesRef = useRef<LocalDataServices | null>(null);
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [defaultResumeId, setDefaultResumeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [viewingTextId, setViewingTextId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function refresh(services: LocalDataServices): Promise<void> {
    const [storedResumes, settings] = await Promise.all([
      services.resumes.getAll(),
      services.settings.get('app'),
    ]);
    storedResumes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    setResumes(storedResumes);
    setDefaultResumeId(settings?.defaultResumeId ?? null);
    onCountChange?.(storedResumes.length);
  }

  useEffect(() => {
    let active = true;
    let openedServices: LocalDataServices | null = null;

    void serviceFactory()
      .then(async (services) => {
        openedServices = services;
        if (!active) {
          services.close();
          return;
        }
        servicesRef.current = services;
        await refresh(services);
        if (active) {
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError));
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (openedServices) {
        openedServices.close();
      }
      servicesRef.current = null;
    };
  }, [serviceFactory]);

  async function reloadAfterAction(successMessage: string): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      throw new Error('The local resume library is not available.');
    }
    await refresh(services);
    setNotice(successMessage);
    setError(null);
  }

  async function addFiles(fileList: FileList | null): Promise<void> {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      return;
    }

    const services = servicesRef.current;
    if (!services) {
      setError('The local resume library is not available.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    let imported = 0;

    for (const file of files) {
      try {
        validateResumeFile(file);
        const extractedText = await parseFile(file);
        const now = new Date().toISOString();
        await services.resumes.save({
          id: createRecordId('resume'),
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          file,
          extractedText,
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
      } catch (fileError) {
        failures.push(`${file.name}: ${errorMessage(fileError)}`);
      }
    }

    try {
      await refresh(services);
      if (imported > 0) {
        setNotice(`${imported} resume${imported === 1 ? '' : 's'} added to this device.`);
      }
      setError(failures.length > 0 ? failures.join('\n') : null);
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  }

  async function saveName(resume: ResumeRecord): Promise<void> {
    const services = servicesRef.current;
    const name = nameDraft.trim();
    if (!services || !name) {
      setError(name ? 'The local resume library is not available.' : 'Enter a resume name.');
      return;
    }

    setBusy(true);
    try {
      await services.resumes.save({ ...resume, name, updatedAt: new Date().toISOString() });
      setEditingNameId(null);
      await reloadAfterAction('Resume name updated.');
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function saveExtractedText(resume: ResumeRecord): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      setError('The local resume library is not available.');
      return;
    }
    if (!textDraft.trim()) {
      setError('Extracted text cannot be empty.');
      return;
    }

    setBusy(true);
    try {
      await services.resumes.save({
        ...resume,
        extractedText: textDraft.trim(),
        updatedAt: new Date().toISOString(),
      });
      await reloadAfterAction('Extracted text saved on this device.');
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(resume: ResumeRecord): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      setError('The local resume library is not available.');
      return;
    }

    setBusy(true);
    try {
      const current = await services.settings.get('app');
      await services.settings.save(updatedSettings(current, { defaultResumeId: resume.id }));
      await reloadAfterAction(`${resume.name} is now your default resume.`);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteResume(resume: ResumeRecord): Promise<void> {
    const services = servicesRef.current;
    if (!services) {
      setError('The local resume library is not available.');
      return;
    }

    setBusy(true);
    try {
      const settings = await services.settings.get('app');
      const wasDefault = settings?.defaultResumeId === resume.id;
      if (wasDefault && settings) {
        await services.settings.save(updatedSettings(settings, { defaultResumeId: null }));
      }
      try {
        await services.resumes.delete(resume.id);
      } catch (deleteError) {
        if (wasDefault && settings) {
          try {
            await services.settings.save(settings);
          } catch (rollbackError) {
            throw new AggregateError(
              [deleteError, rollbackError],
              'The resume could not be deleted and its default setting could not be restored.',
            );
          }
        }
        throw deleteError;
      }
      setConfirmDeleteId(null);
      if (viewingTextId === resume.id) {
        setViewingTextId(null);
      }
      await reloadAfterAction('Resume and its local file were deleted.');
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="resume-library" aria-labelledby="resume-library-heading">
      <div className="resume-library-heading">
        <div>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h2 id="resume-library-heading">Keep your experience close.</h2>
          <p className="muted-copy">
            Add DOCX files. Original files and extracted text stay in this browser.
          </p>
        </div>
        <label className={`button button-primary upload-button${busy ? ' button-disabled' : ''}`}>
          <input
            aria-label="Upload resume files"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="file-input"
            disabled={busy || loading}
            multiple
            type="file"
            onChange={(event) => {
              const { files } = event.currentTarget;
              void addFiles(files);
              event.currentTarget.value = '';
            }}
          />
          {busy ? 'Working…' : '＋ Add resumes'}
        </label>
      </div>

      <p className="resume-storage-note">
        Files up to 15 MB each · Parsing happens locally · No file is uploaded
      </p>

      {error && (
        <div className="resume-feedback resume-feedback-error" role="alert">
          {error.split('\n').map((line) => <span key={line}>{line}</span>)}
        </div>
      )}
      {notice && <p className="resume-feedback resume-feedback-success" role="status">{notice}</p>}

      {loading ? (
        <div className="resume-loading" role="status">Opening your local resume library…</div>
      ) : resumes.length === 0 ? (
        <div className="resume-empty">
          <span className="resume-empty-icon" aria-hidden="true">R</span>
          <h3>Your resume library is ready.</h3>
          <p>Choose a DOCX file to save it privately on this device.</p>
          <p className="muted-copy">Scanned/image-only documents may not contain extractable text.</p>
        </div>
      ) : (
        <ul className="resume-list" aria-label="Saved resumes">
          {resumes.map((resume) => (
            <li className="resume-card" key={resume.id}>
              <div className="resume-card-main">
                <span className="resume-file-icon" aria-hidden="true">
                  {resume.fileName.split('.').pop()?.toUpperCase()}
                </span>
                <div className="resume-card-info">
                  <div className="resume-name-row">
                    <h3>{resume.name}</h3>
                    {defaultResumeId === resume.id && <span className="default-resume-badge">Default</span>}
                  </div>
                  <p>{resume.fileName} <span aria-hidden="true">·</span> {formatFileSize(resume.fileSize)}</p>
                </div>
              </div>

              {editingNameId === resume.id ? (
                <form
                  className="resume-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName(resume);
                  }}
                >
                  <label htmlFor={`resume-name-${resume.id}`}>Resume name</label>
                  <input
                    autoFocus
                    id={`resume-name-${resume.id}`}
                    maxLength={100}
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.currentTarget.value)}
                  />
                  <button className="text-button" disabled={busy} type="submit">Save name</button>
                  <button className="text-button" disabled={busy} type="button" onClick={() => setEditingNameId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="resume-actions">
                  <button
                    className="text-button"
                    disabled={busy || defaultResumeId === resume.id}
                    onClick={() => void setDefault(resume)}
                  >
                    {defaultResumeId === resume.id ? 'Default resume' : 'Make default'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setNameDraft(resume.name);
                      setEditingNameId(resume.id);
                      setError(null);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    aria-expanded={viewingTextId === resume.id}
                    className="text-button"
                    onClick={() => {
                      setViewingTextId(viewingTextId === resume.id ? null : resume.id);
                      setTextDraft(resume.extractedText);
                    }}
                  >
                    {viewingTextId === resume.id ? 'Hide extracted text' : 'View extracted text'}
                  </button>
                  <button
                    className="text-button text-button-danger"
                    onClick={() => setConfirmDeleteId(resume.id)}
                  >
                    Delete
                  </button>
                </div>
              )}

              {confirmDeleteId === resume.id && (
                <div className="resume-delete-confirm" role="group" aria-label={`Delete ${resume.name}`}>
                  <p>Delete this resume and its original file from this device?</p>
                  <button className="text-button text-button-danger" disabled={busy} onClick={() => void deleteResume(resume)}>
                    Delete permanently
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                    Keep resume
                  </button>
                </div>
              )}

              {viewingTextId === resume.id && (
                <div className="resume-text-editor">
                  <label htmlFor={`resume-text-${resume.id}`}>Extracted resume text</label>
                  <textarea
                    id={`resume-text-${resume.id}`}
                    value={textDraft}
                    onChange={(event) => setTextDraft(event.currentTarget.value)}
                  />
                  <button className="button button-secondary" disabled={busy} onClick={() => void saveExtractedText(resume)}>
                    Save extracted text
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
