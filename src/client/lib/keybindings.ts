import type { KeybindingAction, KeybindingsSnapshot } from '../../shared/types';

const MODIFIER_KEYS = new Set(['alt', 'control', 'ctrl', 'meta', 'cmd', 'shift']);

export const KEYBINDING_ACTION_LABELS: Record<KeybindingAction, string> = {
	toggleLeftSidebar: 'Toggle left sidebar',
	toggleEmbeddedTerminal: 'Toggle embedded terminal',
	toggleRightSidebar: 'Toggle right sidebar',
	addSplitTerminal: 'Add split terminal',
	createSessionInCurrentWorkspace: 'Create session in current workspace',
	createWorkspaceInCurrentDirectory: 'Create workspace in current directory',
	switchToNextWorkspace: 'Switch to next workspace',
};

export const KEYBINDING_ACTION_DESCRIPTIONS: Record<KeybindingAction, string> = {
	toggleLeftSidebar: 'Show or hide the workspace list.',
	toggleEmbeddedTerminal: 'Show or hide the workspace terminal panel.',
	toggleRightSidebar: 'Show or hide the workspace inspector.',
	addSplitTerminal: 'Create a new terminal tab in the active workspace.',
	createSessionInCurrentWorkspace: 'Start a new chat session in the active workspace.',
	createWorkspaceInCurrentDirectory:
		'Create a workspace from the same directory as the active workspace.',
	switchToNextWorkspace: 'Move to the next workspace in the sidebar order.',
};

export const KEYBINDING_ACTIONS = Object.keys(KEYBINDING_ACTION_LABELS) as KeybindingAction[];

export function normalizeShortcut(value: string) {
	const parts = value
		.split('+')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean)
		.map((part) => {
			if (part === 'command' || part === 'meta') return 'cmd';
			if (part === 'option') return 'alt';
			if (part === 'control') return 'ctrl';
			if (part === 'esc') return 'escape';
			return part;
		});

	const modifierSet = new Set(parts.filter((part) => MODIFIER_KEYS.has(part)));
	const key = parts.findLast((part) => !MODIFIER_KEYS.has(part));
	const normalized: string[] = [];
	if (modifierSet.has('cmd')) normalized.push('cmd');
	if (modifierSet.has('ctrl')) normalized.push('ctrl');
	if (modifierSet.has('alt')) normalized.push('alt');
	if (modifierSet.has('shift')) normalized.push('shift');
	if (key) normalized.push(normalizeKeyName(key));
	return normalized.join('+');
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent) {
	const parts: string[] = [];
	if (event.metaKey) parts.push('cmd');
	if (event.ctrlKey) parts.push('ctrl');
	if (event.altKey) parts.push('alt');
	if (event.shiftKey) parts.push('shift');

	const key = normalizeKeyName(event.key);
	if (key && !MODIFIER_KEYS.has(key)) parts.push(key);
	return parts.join('+');
}

export function shortcutMatchesEvent(shortcut: string, event: KeyboardEvent) {
	return normalizeShortcut(shortcut) === shortcutFromKeyboardEvent(event);
}

export function actionForKeyboardEvent(
	bindings: KeybindingsSnapshot['bindings'],
	event: KeyboardEvent,
) {
	for (const action of KEYBINDING_ACTIONS) {
		if (bindings[action].some((shortcut) => shortcutMatchesEvent(shortcut, event))) {
			return action;
		}
	}
	return null;
}

export function formatShortcutLabel(shortcut: string) {
	return normalizeShortcut(shortcut)
		.split('+')
		.filter(Boolean)
		.map((part) => {
			if (part === 'cmd') return 'Cmd';
			if (part === 'ctrl') return 'Ctrl';
			if (part === 'alt') return 'Alt';
			if (part === 'shift') return 'Shift';
			if (part === 'escape') return 'Esc';
			if (part === ' ') return 'Space';
			return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
		})
		.join(' + ');
}

export function shouldIgnoreKeybindingTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target.closest('[contenteditable="true"]')) return true;
	const tagName = target.tagName.toLowerCase();
	return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function normalizeKeyName(key: string) {
	const lower = key.toLowerCase();
	if (lower === ' ') return 'space';
	if (lower === 'arrowup') return 'up';
	if (lower === 'arrowdown') return 'down';
	if (lower === 'arrowleft') return 'left';
	if (lower === 'arrowright') return 'right';
	return lower;
}
