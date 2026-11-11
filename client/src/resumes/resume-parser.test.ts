import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  MAX_RESUME_FILE_SIZE,
  MAX_EXTRACTED_TEXT_LENGTH,
  parseResumeContent,
  validateResumeFile,
} from './resume-parser';

function officeFile(entries: Record<string, string>, name: string): File {
  const zipEntries = Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, strToU8(text)]),
  );
  return new File([zipSync(zipEntries)], name);
}

describe('resume parser', () => {
  it('accepts only DOCX and rejects other, mismatched, and oversized files', () => {
    expect(
      validateResumeFile(
        new File(['doc'], 'resume.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).toBe('docx');
    for (const name of ['resume.pdf', 'deck.pptx', 'resume.doc', 'resume.txt', 'resume']) {
      expect(() => validateResumeFile(new File(['x'], name))).toThrow(
        'Choose a DOCX resume file.',
      );
    }
    expect(() =>
      validateResumeFile(new File(['doc'], 'resume.docx', { type: 'text/plain' })),
    ).toThrow('The file type does not match the .docx extension.');
    expect(() => validateResumeFile(new File([], 'empty.docx'))).toThrow(
      'The selected resume file is empty.',
    );

    const oversized = new File(['doc'], 'large.docx');
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

  it('refuses PDF and PPTX content even when it is parsed directly', async () => {
    await expect(
      parseResumeContent(new File(['%PDF'], 'resume.pdf'), 'resume.pdf'),
    ).rejects.toThrow('Choose a DOCX resume file.');
    await expect(
      parseResumeContent(new File(['zip'], 'deck.pptx'), 'deck.pptx'),
    ).rejects.toThrow('Choose a DOCX resume file.');
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

  it('enforces the extracted-text limit', async () => {
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
});
