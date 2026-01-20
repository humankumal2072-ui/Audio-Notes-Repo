
export interface Folder {
  id: string;
  name: string;
  timestamp: number;
  pin?: string; // 4-digit PIN for protection
}

export interface Note {
  id: string;
  title: string;
  transcription: string;
  summary?: string;
  actionItems?: string[];
  tags: string[];
  audioUrl: string;
  timestamp: number;
  duration: number;
  isPinned?: boolean;
  isFavorite?: boolean;
  folderId?: string; // Reference to Folder.id
  translatedTranscription?: string;
  translatedLanguage?: string;
}

export enum RecordingStatus {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  TRANSCRIBING = 'TRANSCRIBING',
}
