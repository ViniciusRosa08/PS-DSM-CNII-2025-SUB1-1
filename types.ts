export interface CloudFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: string;
  content?: string | Blob; // Conteúdo do arquivo
}

export enum TransferStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface TransferItem {
  file: CloudFile;
  status: TransferStatus;
  progress: number;
  message?: string;
  destinationUrl?: string;
}

export interface AzureConfig {
  accountName: string;
  containerName: string;
  sasToken: string;
}

export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  accessToken?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'SUCCESS' | 'ERROR' | 'WARNING';
  message: string;
}