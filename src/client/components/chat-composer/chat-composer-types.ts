import type { ChatAttachment } from '../../../shared/types';

export interface LocalAttachment {
	id: string;
	file: File;
	kind: 'image' | 'file';
}

export interface UploadResponse {
	attachments?: ChatAttachment[];
}
