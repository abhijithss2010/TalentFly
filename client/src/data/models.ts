export type ProviderId = 'claude' | 'copilot';

export type RunStatus = 'received' | 'analysing' | 'done' | 'failed';

export interface StoredRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeRecord extends StoredRecord {
  name: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  file: Blob;
  extractedText: string;
}

export interface JobRecord extends StoredRecord {
  title: string;
  company?: string;
  location?: string;
  sourceUrl?: string;
  description: string;
}

export interface ComparisonRunRecord extends StoredRecord {
  jobId: string;
  resumeIds: string[];
  status: RunStatus;
  provider?: ProviderId;
  result?: Record<string, unknown>;
  error?: string;
}

export interface UsageRecord extends StoredRecord {
  runId: string;
  provider: ProviderId;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export interface AppSettingsRecord extends StoredRecord {
  id: 'app';
  defaultResumeId: string | null;
  preferredProvider: ProviderId | null;
}

export type ExportedResumeRecord = Omit<ResumeRecord, 'file'> & {
  fileBase64: string;
};

export interface LocalDataExport {
  format: 'talentfly-local-data';
  version: 1;
  exportedAt: string;
  data: {
    resumes: ExportedResumeRecord[];
    jobs: JobRecord[];
    runs: ComparisonRunRecord[];
    usage: UsageRecord[];
    settings: AppSettingsRecord[];
  };
}

export type EntityRecord =
  | ResumeRecord
  | JobRecord
  | ComparisonRunRecord
  | UsageRecord
  | AppSettingsRecord;
