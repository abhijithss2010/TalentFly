import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_RESUME_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_ARCHIVE_EXPANDED_SIZE = 100 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_PDF_PAGES = 500;
export const MAX_EXTRACTED_TEXT_LENGTH = 500_000;

export type ResumeFileFormat = 'pdf' | 'docx' | 'pptx';

const formatByExtension: Record<string, ResumeFileFormat> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};

const mimeTypes: Record<ResumeFileFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

export function validateResumeFile(file: File): ResumeFileFormat {
  const format = formatByExtension[extensionOf(file.name)];
  if (!format) {
    throw new Error('Choose a PDF, DOCX, or PPTX resume file.');
  }
  if (file.size === 0) {
    throw new Error('The selected resume file is empty.');
  }
  if (file.size > MAX_RESUME_FILE_SIZE) {
    throw new Error('Resume files must be 15 MB or smaller.');
  }
  if (
    file.type &&
    file.type !== mimeTypes[format] &&
    file.type !== 'application/octet-stream' &&
    !(format !== 'pdf' && file.type === 'application/zip')
  ) {
    throw new Error(`The file type does not match the .${format} extension.`);
  }

  return format;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The resume could not be parsed.';
}

function ensureTextLimit(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    throw new Error('No readable text was found. This file may be image-only or empty.');
  }
  if (normalized.length > MAX_EXTRACTED_TEXT_LENGTH) {
    throw new Error('The extracted text is larger than the 500,000 character limit.');
  }
  return normalized;
}

async function parsePdf(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error('PDF resumes must contain 500 pages or fewer.');
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      );
    }
    return ensureTextLimit(pages.join('\n'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('500 pages')) {
      throw error;
    }
    throw new Error(`Could not read this PDF. It may be damaged or password-protected. ${getErrorMessage(error)}`);
  } finally {
    await loadingTask.destroy();
  }
}

function nodeText(node: unknown): string {
  if (Array.isArray(node)) {
    return node.map(nodeText).join('');
  }
  if (typeof node !== 'object' || node === null) {
    return '';
  }

  return Object.entries(node)
    .map(([key, value]) => {
      if (key === '#text') {
        return typeof value === 'string' ? value : '';
      }
      if (key === 'br') {
        return '\n';
      }
      if (key === 'tab') {
        return '\t';
      }
      return nodeText(value);
    })
    .join('');
}

function collectParagraphs(
  node: unknown,
  output: string[],
): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectParagraphs(child, output);
    }
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'p') {
      const text = nodeText(value).trim();
      if (text) {
        output.push(text);
      }
    } else {
      collectParagraphs(value, output);
    }
  }
}

function officeXmlText(xml: string, label: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`The ${label} document contains unsupported XML declarations.`);
  }

  return xml;
}

async function readOfficeXml(file: Blob, format: 'docx' | 'pptx'): Promise<string> {
  const { unzipSync } = await import('fflate');
  const { XMLParser, XMLValidator } = await import('fast-xml-parser');
  let archiveEntries = 0;
  let expandedSize = 0;
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      archiveEntries += 1;
      expandedSize += entry.originalSize;
      if (archiveEntries > MAX_ARCHIVE_ENTRIES) {
        throw new Error('The Office document contains too many archive entries.');
      }
      if (expandedSize > MAX_ARCHIVE_EXPANDED_SIZE) {
        throw new Error('The Office document expands beyond the 100 MB safety limit.');
      }
      return format === 'docx'
        ? entry.name === 'word/document.xml'
        : /^ppt\/slides\/slide\d+\.xml$/.test(entry.name);
    },
  });
  const paths = Object.keys(archive);
  if (paths.length === 0) {
    throw new Error(`No readable ${format.toUpperCase()} content was found.`);
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    preserveOrder: true,
    removeNSPrefix: true,
    processEntities: true,
  });
  const paragraphs: string[] = [];

  for (const path of paths.sort((left, right) => {
    const leftNumber = Number(left.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    const rightNumber = Number(right.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    return leftNumber - rightNumber;
  })) {
    const xml = new TextDecoder().decode(archive[path]);
    officeXmlText(xml, format.toUpperCase());
    const validation = XMLValidator.validate(xml);
    if (validation !== true) {
      throw new Error(`The ${format.toUpperCase()} document contains invalid XML.`);
    }
    collectParagraphs(parser.parse(xml), paragraphs);
  }

  return ensureTextLimit(paragraphs.join('\n'));
}

export async function parseResumeContent(file: Blob, fileName: string): Promise<string> {
  const format = formatByExtension[extensionOf(fileName)];
  if (!format) {
    throw new Error('Choose a PDF, DOCX, or PPTX resume file.');
  }
  if (file.size > MAX_RESUME_FILE_SIZE) {
    throw new Error('Resume files must be 15 MB or smaller.');
  }

  if (format === 'pdf') {
    return parsePdf(file);
  }
  return readOfficeXml(file, format);
}

interface WorkerResponse {
  text?: string;
  error?: string;
}

function parseWithWorker(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./resume-parser.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (typeof event.data.text === 'string') {
        resolve(ensureTextLimit(event.data.text));
      } else {
        reject(new Error(event.data.error ?? 'The resume could not be parsed.'));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The resume parsing worker stopped unexpectedly.'));
    };
    worker.postMessage({ file, fileName: file.name });
  });
}

export async function parseResumeFile(file: File): Promise<string> {
  validateResumeFile(file);
  try {
    if (typeof Worker === 'undefined') {
      return await parseResumeContent(file, file.name);
    }
    return await parseWithWorker(file);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
