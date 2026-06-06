import {
	File,
	FileCode,
	FileImage,
	FilePdf,
	FileText,
	MusicNotes,
	VideoCamera,
	X,
} from '@phosphor-icons/react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

export type AttachmentKind = 'image' | 'file';

export interface ChatAttachment {
	id: string;
	kind: AttachmentKind;
	displayName: string;
	absolutePath: string;
	relativePath: string;
	contentUrl: string;
	mimeType: string;
	size: number;
}

type BaseAttachmentCardProps = {
	attachment: ChatAttachment;
	onClick?: () => void;
	onRemove?: () => void;
	className?: string;
};

export type AttachmentIconKind =
	| 'image'
	| 'pdf'
	| 'markdown'
	| 'json'
	| 'table'
	| 'code'
	| 'text'
	| 'archive'
	| 'audio'
	| 'video'
	| 'file';

const CODE_OR_CONFIG_EXTENSIONS = new Set([
	'.c',
	'.cc',
	'.cfg',
	'.conf',
	'.cpp',
	'.cs',
	'.css',
	'.env',
	'.go',
	'.graphql',
	'.h',
	'.hpp',
	'.html',
	'.ini',
	'.java',
	'.js',
	'.jsonc',
	'.jsx',
	'.kt',
	'.lua',
	'.mjs',
	'.php',
	'.pl',
	'.properties',
	'.py',
	'.rb',
	'.rs',
	'.scss',
	'.sh',
	'.sql',
	'.swift',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.vue',
	'.xml',
	'.yaml',
	'.yml',
	'.zsh',
]);
const ARCHIVE_EXTENSIONS = new Set(['.7z', '.bz2', '.gz', '.rar', '.tar', '.tgz', '.xz', '.zip']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mov', '.mp4', '.mkv', '.webm']);

function getFileExtension(fileName: string): string {
	const index = fileName.lastIndexOf('.');
	return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

export function classifyAttachmentIcon(attachment: ChatAttachment): AttachmentIconKind {
	if (attachment.kind === 'image') return 'image';

	const mimeType = attachment.mimeType.toLowerCase();
	const extension = getFileExtension(attachment.displayName);

	if (mimeType.startsWith('image/')) return 'image';
	if (mimeType === 'application/pdf' || extension === '.pdf') return 'pdf';
	if (mimeType === 'application/json' || extension === '.json' || extension === '.jsonc')
		return 'json';
	if (extension === '.md') return 'markdown';
	if (
		mimeType === 'text/csv' ||
		mimeType === 'text/tab-separated-values' ||
		extension === '.csv' ||
		extension === '.tsv'
	)
		return 'table';
	if (mimeType.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
	if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
	if (mimeType.includes('zip') || mimeType.includes('archive') || ARCHIVE_EXTENSIONS.has(extension))
		return 'archive';
	if (CODE_OR_CONFIG_EXTENSIONS.has(extension)) {
		if (extension === '.txt') return 'text';
		return 'code';
	}
	if (mimeType.startsWith('text/')) return 'text';
	return 'file';
}

function getAttachmentIcon(kind: AttachmentIconKind) {
	switch (kind) {
		case 'image':
			return <FileImage className="size-5" weight="regular" />;
		case 'pdf':
			return <FilePdf className="size-5" weight="regular" />;
		case 'markdown':
			return <FileText className="size-5" weight="regular" />;
		case 'json':
			return <FileCode className="size-5" weight="regular" />;
		case 'table':
			return <FileText className="size-5" weight="regular" />;
		case 'code':
			return <FileCode className="size-5" weight="regular" />;
		case 'text':
			return <FileText className="size-5" weight="regular" />;
		case 'archive':
			return <File className="size-5" weight="regular" />;
		case 'audio':
			return <MusicNotes className="size-5" weight="regular" />;
		case 'video':
			return <VideoCamera className="size-5" weight="regular" />;
		default:
			return <File className="size-5" weight="regular" />;
	}
}

function RemoveButton({ displayName, onRemove }: { displayName: string; onRemove: () => void }) {
	return (
		<Button
			type="button"
			size="icon-sm"
			variant="secondary"
			className="absolute right-2 top-2 z-20 h-6 w-6 rounded-full border border-hairline bg-surface-1/90 p-0 text-ink-subtle shadow-sm hover:bg-surface-2 hover:text-ink"
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onRemove();
			}}
			aria-label={`Remove ${displayName}`}
		>
			<X className="size-3.5" weight="bold" />
		</Button>
	);
}

export function AttachmentCard({
	attachment,
	onClick,
	onRemove,
	className,
}: BaseAttachmentCardProps) {
	const iconKind = classifyAttachmentIcon(attachment);

	return (
		<div className={cn('group relative', className)}>
			<Button
				type="button"
				variant="ghost"
				onClick={onClick}
				className="flex h-auto w-full max-w-64 items-center justify-start gap-2 rounded-xl border border-hairline bg-surface-1/90 p-1 pr-3 text-left hover:bg-surface-2"
			>
				<div className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-ink-subtle">
					{getAttachmentIcon(iconKind)}
				</div>
				<div className="min-w-0">
					<div className="max-w-full truncate text-body-sm font-medium text-ink">
						{attachment.displayName}
					</div>
					<div className="truncate text-caption text-ink-subtle">
						{attachment.mimeType} · {formatAttachmentSize(attachment.size)}
					</div>
				</div>
			</Button>

			{onRemove ? <RemoveButton displayName={attachment.displayName} onRemove={onRemove} /> : null}
		</div>
	);
}

export function formatAttachmentSize(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
