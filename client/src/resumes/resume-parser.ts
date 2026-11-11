export const MAX_RESUME_FILE_SIZE = 15 * 1024 * 1024;
export const MAX_ARCHIVE_EXPANDED_SIZE = 100 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_EXTRACTED_TEXT_LENGTH = 500_000;

export const SUPPORTED_RESUME_MESSAGE = 'Choose a DOCX resume file.';

const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function isDocx(fileName: string): boolean {
  return extensionOf(fileName) === 'docx';
}

export function validateResumeFile(file: File): 'docx' {
  if (!isDocx(file.name)) {
    throw new Error(SUPPORTED_RESUME_MESSAGE);
  }
  if (file.size === 0) {
    throw new Error('The selected resume file is empty.');
  }
  if (file.size > MAX_RESUME_FILE_SIZE) {
    throw new Error('Resume files must be 15 MB or smaller.');
  }
  if (
    file.type &&
    file.type !== DOCX_MIME_TYPE &&
    file.type !== 'application/octet-stream' &&
    file.type !== 'application/zip'
  ) {
    throw new Error('The file type does not match the .docx extension.');
  }

  return 'docx';
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

async function readDocxXml(file: Blob): Promise<string> {
  const { unzipSync } = await import('fflate');
  const { XMLParser, XMLValidator } = await import('fast-xml-parser');
  let archiveEntries = 0;
  let expandedSize = 0;
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      archiveEntries += 1;
      expandedSize += entry.originalSize;
      if (archiveEntries > MAX_ARCHIVE_ENTRIES) {
        throw new Error('The DOCX document contains too many archive entries.');
      }
      if (expandedSize > MAX_ARCHIVE_EXPANDED_SIZE) {
        throw new Error('The DOCX document expands beyond the 100 MB safety limit.');
      }
      return entry.name === 'word/document.xml';
    },
  });
  const xmlBytes = archive['word/document.xml'];
  if (!xmlBytes) {
    throw new Error('No readable DOCX content was found.');
  }

  const xml = new TextDecoder().decode(xmlBytes);
  officeXmlText(xml, 'DOCX');
  if (XMLValidator.validate(xml) !== true) {
    throw new Error('The DOCX document contains invalid XML.');
  }
  const parser = new XMLParser({
    ignoreAttributes: true,
    preserveOrder: true,
    removeNSPrefix: true,
    processEntities: true,
  });
  const paragraphs: string[] = [];
  collectParagraphs(parser.parse(xml), paragraphs);

  return ensureTextLimit(paragraphs.join('\n'));
}

export async function parseResumeContent(file: Blob, fileName: string): Promise<string> {
  if (!isDocx(fileName)) {
    throw new Error(SUPPORTED_RESUME_MESSAGE);
  }
  if (file.size > MAX_RESUME_FILE_SIZE) {
    throw new Error('Resume files must be 15 MB or smaller.');
  }

  return readDocxXml(file);
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
