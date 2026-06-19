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
		foreground: '#d4d4d8',
		cursor: '#a1a1aa',
		selectionBackground: '#27272a',
		black: background,
		red: '#f87171',
		green: '#4ade80',
		yellow: '#facc15',
		blue: '#60a5fa',
		magenta: '#c084fc',
		cyan: '#67e8f9',
		white: '#e4e4e7',
		brightBlack: '#52525b',
		brightRed: '#fca5a5',
		brightGreen: '#86efac',
		brightYellow: '#fde047',
		brightBlue: '#93c5fd',
		brightMagenta: '#d8b4fe',
		brightCyan: '#a5f3fc',
		brightWhite: '#fafafa',
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
		const terminalBackground = cssVariable('--surface-1', '#111112');
		paintXtermBackground(container, terminalBackground);

		const terminal = new Terminal({
			allowProposedApi: true,
			convertEol: true,
			cursorBlink: true,
			cursorStyle: 'bar',
			cursorWidth: 1,
			customGlyphs: false,
			disableStdin: false,
			fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace',
			fontSize: 12,
			lineHeight: 1.0,
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
		};
	}, [addTerminalEventListener, resizeTerminal, terminalId, writeTerminal]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal || !snapshot?.serializedState) return;
		if (lastSerializedStateRef.current === snapshot.serializedState) return;
		if (lastSerializedStateRef.current !== null) return;
		terminal.write(snapshot.serializedState);
		lastSerializedStateRef.current = snapshot.serializedState;
	}, [snapshot?.serializedState]);

	useEffect(() => {
		if (!terminalRef.current || !snapshot) return;
		terminalRef.current.options.disableStdin = snapshot.status === 'exited';
	}, [snapshot]);

	return (
		<div
			ref={containerRef}
			className="terminal-miko size-full overflow-hidden bg-surface-1 px-2 py-2 [&_.xterm]:h-full"
		/>
	);
}
