import { parseResumeContent } from './resume-parser';

self.onmessage = async (event: MessageEvent<{ file: Blob; fileName: string }>) => {
  try {
    const text = await parseResumeContent(event.data.file, event.data.fileName);
    self.postMessage({ text });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'The resume could not be parsed.',
    });
  }
};
