import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { useTerminalStore } from '../stores/terminal-store';

interface RightSidebarTerminalViewProps {
	terminalId: string;
}

function terminalTheme(background: string) {
	return {
		background,
		foreground: '#d6d6d6',
		cursor: '#f2f2f2',
		selectionBackground: '#2e2e2e',
		black: background,
		red: '#f2756c',
		green: '#7ec87f',
		yellow: '#d9b35c',
		blue: '#74a8f2',
		magenta: '#c79ce8',
		cyan: '#77c4cf',
		white: '#e4e4e8',
		brightBlack: '#6e6e6e',
		brightRed: '#f7a09a',
		brightGreen: '#a6dba4',
		brightYellow: '#e8cc85',
		brightBlue: '#9fc4f7',
		brightMagenta: '#dbbef0',
		brightCyan: '#a4dbe2',
		brightWhite: '#f4f4f6',
	};
}

function cssVariable(name: string, fallback: string) {
	if (typeof window === 'undefined') return fallback;
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function paintXtermBackground(container: HTMLElement, background: string) {
	container.style.backgroundColor = background;
	for (const element of container.querySelectorAll<HTMLElement>(
		'.xterm, .xterm-viewport, .xterm-screen, .xterm-rows, canvas',
	)) {
		element.style.backgroundColor = background;
	}
}

export function RightSidebarTerminalView({ terminalId }: RightSidebarTerminalViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const lastSerializedStateRef = useRef<string | null>(null);
	const restoredInitialSnapshotRef = useRef(false);
	const pendingTerminalEventsRef = useRef<
		Array<{ type: 'terminal.output'; data: string } | { type: 'terminal.exit'; exitCode: number }>
	>([]);
	const snapshot = useTerminalStore((state) => state.getTerminalSnapshot(terminalId));
	const connectTerminal = useTerminalStore((state) => state.connectTerminal);
	const disconnectTerminal = useTerminalStore((state) => state.disconnectTerminal);
	const writeTerminal = useTerminalStore((state) => state.writeTerminal);
	const resizeTerminal = useTerminalStore((state) => state.resizeTerminal);
	const addTerminalEventListener = useTerminalStore((state) => state.addTerminalEventListener);

	useEffect(() => {
		connectTerminal(terminalId);
		return () => disconnectTerminal(terminalId);
	}, [connectTerminal, disconnectTerminal, terminalId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		lastSerializedStateRef.current = null;
		restoredInitialSnapshotRef.current = false;
		const terminalBackground = cssVariable('--surface-1', '#131313');
		paintXtermBackground(container, terminalBackground);

		restoredInitialSnapshotRef.current = false;
		lastSerializedStateRef.current = null;
		pendingTerminalEventsRef.current = [];

		const terminal = new Terminal({
			allowProposedApi: true,
			convertEol: true,
			cursorBlink: true,
			cursorStyle: 'bar',
			cursorWidth: 1,
			customGlyphs: false,
			disableStdin: false,
			fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
			fontSize: 12,
			lineHeight: 1.04,
			scrollback: 10_000,
			theme: terminalTheme(terminalBackground),
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());
		terminal.open(container);
		paintXtermBackground(container, terminalBackground);
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;

		const focusTerminal = () => {
			try {
				terminal.focus();
			} catch {
				// xterm can reject focus while its textarea is being mounted/unmounted.
			}
		};

		const fitAndNotify = () => {
			try {
				paintXtermBackground(container, terminalBackground);
				fitAddon.fit();
				paintXtermBackground(container, terminalBackground);
				void resizeTerminal(terminalId, terminal.cols, terminal.rows).catch(() => undefined);
			} catch {
				// xterm-fit can throw while the element is hidden during layout transitions.
			}
		};

		const mutationObserver = new MutationObserver(() => {
			paintXtermBackground(container, terminalBackground);
		});
		mutationObserver.observe(container, { childList: true, subtree: true });

		const resizeObserver = new ResizeObserver(() => {
			fitAndNotify();
			requestAnimationFrame(fitAndNotify);
		});
		resizeObserver.observe(container);
		requestAnimationFrame(() => {
			fitAndNotify();
			focusTerminal();
		});

		container.addEventListener('pointerdown', focusTerminal);

		const dataDisposable = terminal.onData((data) => {
			void writeTerminal(terminalId, data).catch(() => undefined);
		});

		const unsubscribe = addTerminalEventListener((event) => {
			if (event.terminalId !== terminalId) return;
			if (!restoredInitialSnapshotRef.current) {
				if (event.type === 'terminal.output') {
					pendingTerminalEventsRef.current.push({ type: 'terminal.output', data: event.data });
				} else if (event.type === 'terminal.exit') {
					pendingTerminalEventsRef.current.push({
						type: 'terminal.exit',
						exitCode: event.exitCode,
					});
				}
				return;
			}
			if (event.type === 'terminal.output') terminal.write(event.data);
			else if (event.type === 'terminal.exit') {
				terminal.write(`\r\n[process exited with code ${event.exitCode}]\r\n`);
			}
		});

		return () => {
			unsubscribe();
			dataDisposable.dispose();
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			container.removeEventListener('pointerdown', focusTerminal);
			terminal.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			restoredInitialSnapshotRef.current = false;
			lastSerializedStateRef.current = null;
			pendingTerminalEventsRef.current = [];
		};
	}, [addTerminalEventListener, resizeTerminal, terminalId, writeTerminal]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal || !snapshot || restoredInitialSnapshotRef.current) return;

		terminal.reset();
		if (snapshot.serializedState) terminal.write(snapshot.serializedState);
		lastSerializedStateRef.current = snapshot.serializedState;
		restoredInitialSnapshotRef.current = true;

		// The terminal snapshot is generated after subscribing, so pre-restore output can already
		// be included in serializedState. Only replay buffered bytes for genuinely empty snapshots;
		// otherwise the snapshot is the source of truth and replaying would duplicate prompts/lines.
		if (!snapshot.serializedState) {
			for (const event of pendingTerminalEventsRef.current) {
				if (event.type === 'terminal.output') terminal.write(event.data);
				else terminal.write(`\r\n[process exited with code ${event.exitCode}]\r\n`);
			}
		}
		pendingTerminalEventsRef.current = [];
	}, [snapshot]);

	useEffect(() => {
		if (!terminalRef.current || !snapshot) return;
		terminalRef.current.options.disableStdin = snapshot.status === 'exited';
	}, [snapshot]);

	return (
		<div
			ref={containerRef}
			className="terminal-miko size-full overflow-hidden bg-surface-1 px-3 py-2 [&_.xterm]:h-full"
		/>
	);
}
