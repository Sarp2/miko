import type {
	AttachmentKind,
	ChatAttachment,
	WorkspaceFileContentsResult,
} from '../../shared/types';

const TEXT_LIKE_EXTENSIONS = new Set([
	'.css',
	'.csv',
	'.env',
	'.gitignore',
	'.html',
	'.js',
	'.json',
	'.jsx',
	'.md',
	'.mdx',
	'.sql',
	'.ts',
	'.tsx',
	'.txt',
	'.xml',
	'.yaml',
	'.yml',
]);
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

function extension(name: string) {
	const lastSegment = name.split('/').filter(Boolean).at(-1) ?? name;
	const dotIndex = lastSegment.lastIndexOf('.');
	return dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : '';
}

export function isPreviewableImageMimeType(mimeType: string) {
	const normalized = mimeType.toLowerCase();
	return normalized.startsWith('image/') && normalized !== 'image/svg+xml';
}

export function isTextLikeAttachment(name: string, mimeType: string) {
	const normalized = mimeType.toLowerCase();
	return (
		normalized.startsWith('text/') ||
		normalized.includes('json') ||
		normalized.includes('xml') ||
		normalized.includes('javascript') ||
		normalized.includes('typescript') ||
		TEXT_LIKE_EXTENSIONS.has(extension(name))
	);
}

function fileToDataUrl(file: File) {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
		reader.readAsDataURL(file);
	});
}

export async function localFilePreviewResult({
	attachmentId,
	file,
	kind,
}: {
	attachmentId: string;
	file: File;
	kind: AttachmentKind;
}): Promise<WorkspaceFileContentsResult> {
	const name = file.name || 'file';
	const mimeType = file.type || 'application/octet-stream';
	const cacheKey = `${attachmentId}:${file.size}:${file.lastModified}`;

	if (kind === 'image' && isPreviewableImageMimeType(mimeType)) {
		return {
			kind: 'image',
			path: name,
			name,
			contentUrl: await fileToDataUrl(file),
			mimeType,
			size: file.size,
			cacheKey,
		};
	}

	if (!isTextLikeAttachment(name, mimeType)) {
		return { kind: 'binary', path: name, name, mimeType, size: file.size, cacheKey };
	}

	if (file.size > MAX_TEXT_PREVIEW_BYTES) {
		return { kind: 'binary', path: name, name, mimeType, size: file.size, cacheKey };
	}

	const contents = await file.text();
	return {
		kind: 'text',
		path: name,
		name,
		contents,
		mimeType,
		size: file.size,
		encoding: 'utf-8',
		cacheKey: `${cacheKey}:${contents.length}`,
	};
}

export async function attachmentPreviewResult(
	attachment: ChatAttachment,
): Promise<WorkspaceFileContentsResult> {
	const name = attachment.displayName || attachment.relativePath || 'file';
	const mimeType = attachment.mimeType || 'application/octet-stream';
	const cacheKey = `${attachment.id}:${attachment.size}`;
	const hasContentUrl = attachment.contentUrl.trim().length > 0;

	if (attachment.kind === 'image' && isPreviewableImageMimeType(mimeType) && hasContentUrl) {
		return {
			kind: 'image',
			path: name,
			name,
			contentUrl: attachment.contentUrl,
			mimeType,
			size: attachment.size,
			cacheKey,
		};
	}

	if (!hasContentUrl || !isTextLikeAttachment(name, mimeType)) {
		return { kind: 'binary', path: name, name, mimeType, size: attachment.size, cacheKey };
	}

	if (attachment.size > MAX_TEXT_PREVIEW_BYTES) {
		return { kind: 'binary', path: name, name, mimeType, size: attachment.size, cacheKey };
	}

	const response = await fetch(attachment.contentUrl);
	if (!response.ok) throw new Error(`Failed to load attachment: ${response.status}`);
	const contents = await response.text();
	return {
		kind: 'text',
		path: name,
		name,
		contents,
		mimeType,
		size: attachment.size,
		encoding: 'utf-8',
		cacheKey: `${cacheKey}:${contents.length}`,
	};
}
