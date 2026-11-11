import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RESUME_FILE_SIZE,
  MAX_EXTRACTED_TEXT_LENGTH,
  MAX_PDF_PAGES,
  parseResumeContent,
  parseResumeFile,
  validateResumeFile,
} from './resume-parser';

const pdfjsMock = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => pdfjsMock);

function officeFile(entries: Record<string, string>, name: string): File {
  const zipEntries = Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, strToU8(text)]),
  );
  return new File([zipSync(zipEntries)], name);
}

describe('resume parser', () => {
  it('accepts supported formats and rejects unsupported, mismatched, and oversized files', () => {
    expect(validateResumeFile(new File(['pdf'], 'resume.pdf', { type: 'application/pdf' })))
      .toBe('pdf');
    expect(
      validateResumeFile(
        new File(['doc'], 'resume.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe('docx');
    expect(() => validateResumeFile(new File(['txt'], 'resume.txt', { type: 'text/plain' })))
      .toThrow('Choose a PDF, DOCX, or PPTX resume file.');
    expect(() =>
      validateResumeFile(new File(['pdf'], 'resume.pdf', { type: 'text/plain' })),
    ).toThrow('The file type does not match the .pdf extension.');

    const oversized = new File(['pdf'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: MAX_RESUME_FILE_SIZE + 1 });
    expect(() => validateResumeFile(oversized)).toThrow('Resume files must be 15 MB or smaller.');
  });

  it('extracts ordered paragraphs from DOCX XML locally', async () => {
    const file = officeFile(
      {
        'word/document.xml':
          '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Product</w:t></w:r></w:p><w:p><w:r><w:t>Engineer &amp; designer</w:t></w:r></w:p></w:body></w:document>',
      },
      'resume.docx',
    );

    await expect(parseResumeContent(file, file.name)).resolves.toBe(
      'Product\nEngineer & designer',
    );
  });

  it('extracts PPTX slide text in slide-number order', async () => {
    const file = officeFile(
      {
        'ppt/slides/slide2.xml':
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:cSld></p:sld>',
        'ppt/slides/slide1.xml':
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:cSld></p:sld>',
      },
      'portfolio.pptx',
    );

    await expect(parseResumeContent(file, file.name)).resolves.toBe(
      'First slide\nSecond slide',
    );
  });

  it('reports damaged Office archives and image-only documents explicitly', async () => {
    await expect(
      parseResumeContent(new File(['not a zip'], 'broken.docx'), 'broken.docx'),
    ).rejects.toThrow();

    const emptyDocument = officeFile(
      { 'word/document.xml': '<w:document xmlns:w="urn:word"><w:body/></w:document>' },
      'empty.docx',
    );
    await expect(parseResumeContent(emptyDocument, emptyDocument.name)).rejects.toThrow(
      'No readable text was found. This file may be image-only or empty.',
    );
  });

  it('enforces PDF page and extracted-text limits', async () => {
    const pdf = new File(['pdf-data'], 'resume.pdf', { type: 'application/pdf' });
    pdfjsMock.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: MAX_PDF_PAGES + 1 }),
      destroy: vi.fn(),
    });
    await expect(parseResumeContent(pdf, pdf.name)).rejects.toThrow(
      'PDF resumes must contain 500 pages or fewer.',
    );

    const longDocument = officeFile(
      {
        'word/document.xml':
          `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>${'x'.repeat(MAX_EXTRACTED_TEXT_LENGTH + 1)}</w:t></w:r></w:p></w:body></w:document>`,
      },
      'long.docx',
    );
    await expect(parseResumeContent(longDocument, longDocument.name)).rejects.toThrow(
      'The extracted text is larger than the 500,000 character limit.',
    );
  });

  it('extracts PDF page text through PDF.js and rejects empty extraction', async () => {
    pdfjsMock.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: 'Experienced engineer' }] }),
        }),
      }),
      destroy: vi.fn(),
    });

    const pdf = new File(['pdf-data'], 'resume.pdf', { type: 'application/pdf' });
    await expect(parseResumeFile(pdf)).resolves.toBe('Experienced engineer');
    expect(pdfjsMock.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Uint8Array) }),
    );

    pdfjsMock.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
      }),
      destroy: vi.fn(),
    });
    await expect(parseResumeContent(pdf, pdf.name)).rejects.toThrow(
      'No readable text was found. This file may be image-only or empty.',
    );
  });
});
