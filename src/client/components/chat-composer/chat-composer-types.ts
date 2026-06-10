import type { AttachmentKind, ChatAttachment } from '../../../shared/types';

export interface LocalAttachment {
	id: string;
	file: File;
	kind: AttachmentKind;
}

export interface UploadResponse {
	attachments?: ChatAttachment[];
}
