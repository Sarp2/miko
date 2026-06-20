import { describe, expect, test } from 'bun:test';
import {
	actionForKeyboardEvent,
	formatShortcutLabel,
	normalizeShortcut,
	shortcutFromKeyboardEvent,
} from './keybindings';

function keyEvent(input: {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}) {
	return {
		key: input.key,
		metaKey: input.metaKey ?? false,
		ctrlKey: input.ctrlKey ?? false,
		altKey: input.altKey ?? false,
		shiftKey: input.shiftKey ?? false,
	} as KeyboardEvent;
}

describe('normalizeShortcut', () => {
	test('normalizes modifier aliases and ordering', () => {
		expect(normalizeShortcut(' Option + Command + Shift + O ')).toBe('cmd+alt+shift+o');
		expect(normalizeShortcut('Control+`')).toBe('ctrl+`');
	});
});

describe('shortcutFromKeyboardEvent', () => {
	test('creates normalized shortcut strings from keyboard events', () => {
		expect(shortcutFromKeyboardEvent(keyEvent({ key: 'O', metaKey: true, shiftKey: true }))).toBe(
			'cmd+shift+o',
		);
		expect(shortcutFromKeyboardEvent(keyEvent({ key: 'Alt', metaKey: true, altKey: true }))).toBe(
			'cmd+alt',
		);
	});
});

describe('actionForKeyboardEvent', () => {
	test('finds the first matching action binding', () => {
		expect(
			actionForKeyboardEvent(
				{
					toggleLeftSidebar: ['cmd+shift+b'],
					toggleEmbeddedTerminal: ['cmd+j'],
					toggleRightSidebar: ['cmd+b'],
					addSplitTerminal: ['cmd+/'],
					createSessionInCurrentWorkspace: ['cmd+alt+n'],
					createWorkspaceInCurrentDirectory: ['cmd+alt+shift+n'],
					switchToNextWorkspace: ['cmd+alt+down'],
				},
				keyEvent({ key: 'n', metaKey: true, altKey: true }),
			),
		).toBe('createSessionInCurrentWorkspace');
	});

	test('ignores modifier-only shortcuts', () => {
		expect(
			actionForKeyboardEvent(
				{
					toggleLeftSidebar: ['cmd+shift+b'],
					toggleEmbeddedTerminal: ['cmd+j'],
					toggleRightSidebar: ['cmd+b'],
					addSplitTerminal: ['cmd+/'],
					createSessionInCurrentWorkspace: ['cmd+alt+n'],
					createWorkspaceInCurrentDirectory: ['cmd+alt+shift+n'],
					switchToNextWorkspace: ['cmd+alt+down'],
				},
				keyEvent({ key: 'Alt', metaKey: true, altKey: true }),
			),
		).toBeNull();
	});
});

describe('formatShortcutLabel', () => {
	test('formats normalized shortcuts for display', () => {
		expect(formatShortcutLabel('cmd+alt+o')).toBe('Cmd + Alt + O');
		expect(formatShortcutLabel('ctrl+`')).toBe('Ctrl + `');
	});
});
