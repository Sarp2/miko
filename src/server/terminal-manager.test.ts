import { describe, expect, spyOn, test } from 'bun:test';
import process from 'node:process';
import type { TerminalEvent } from '../shared/protocol';
import {
	clampScrollback,
	killTerminalProcessTree,
	normalizeTerminalDimension,
	resolveShell,
	resolveShellArgs,
	signalTerminalProcessGroup,
	TerminalManager,
	updateFocusReportingState,
} from './terminal-manager';

const originalBunTerminal = Bun.Terminal;
const originalBunSpawn = Bun.spawn;

interface FakeTerminalSession {
	terminalId: string;
	title: string;
	cwd: string;
	shell: string;
	cols: number;
	rows: number;
	scrollback: number;
	status: 'running' | 'exited';
	exitCode: number | null;
	process: Bun.Subprocess | null;
	terminal: Bun.Terminal;
	headless: {
		options: { scrollback: number };
		resize: (cols: number, rows: number) => void;
		dispose: () => void;
	};
	serializeAddon: {
		serialize: () => string;
		dispose: () => void;
	};
	focusReportingEnabled: boolean;
	modeSequenceTail: string;
}

function restoreBunTerminalMocks() {
	Bun.Terminal = originalBunTerminal;
	Bun.spawn = originalBunSpawn;
}

function createTerminalSession(overrides: Partial<FakeTerminalSession> = {}) {
	return {
		terminalId: 'terminal-1',
		title: 'zsh',
		cwd: '/tmp/project',
		shell: '/bin/zsh',
		cols: 80,
		rows: 24,
		scrollback: 1_000,
		status: 'running' as const,
		exitCode: null,
		process: { pid: 1234 } as Bun.Subprocess,
		terminal: {
			close: () => {},
			resize: () => {},
			write: () => {},
		} as unknown as Bun.Terminal,
		headless: {
			options: { scrollback: 1_000 },
			resize: () => {},
			dispose: () => {},
		},
		serializeAddon: {
			serialize: () => 'serialized terminal state',
			dispose: () => {},
		},
		focusReportingEnabled: false,
		modeSequenceTail: '',
		...overrides,
	};
}

function terminalSessions(manager: TerminalManager) {
	return (
		manager as unknown as {
			sessions: Map<string, FakeTerminalSession>;
		}
	).sessions;
}

describe('clampScrollback', () => {
	test('falls back to the default for invalid values', () => {
		expect(clampScrollback(Number.NaN)).toBe(1_000);
	});

	test('clamps values outside the supported range', () => {
		expect(clampScrollback(499)).toBe(500);
		expect(clampScrollback(5_001)).toBe(5_000);
	});

	test('rounds decimal values', () => {
		expect(clampScrollback(1_000.4)).toBe(1_000);
		expect(clampScrollback(1_000.5)).toBe(1_001);
	});
});

describe('normalizeTerminalDimension', () => {
	test('falls back to the existing dimension for invalid values', () => {
		expect(normalizeTerminalDimension(Number.NaN, 80)).toBe(80);
	});

	test('keeps dimensions at least one cell', () => {
		expect(normalizeTerminalDimension(0, 80)).toBe(1);
		expect(normalizeTerminalDimension(-5, 80)).toBe(1);
	});

	test('rounds decimal values', () => {
		expect(normalizeTerminalDimension(24.4, 80)).toBe(24);
		expect(normalizeTerminalDimension(24.5, 80)).toBe(25);
	});
});

describe('resolveShell', () => {
	test('returns the detected default shell', () => {
		expect(resolveShell({ detect: () => '/bin/zsh' })).toBe('/bin/zsh');
	});

	test('falls back to the cached default shell when detection fails', () => {
		expect(
			resolveShell({
				detect: () => {
					throw new Error('user lookup failed');
				},
				defaultShellPath: '/bin/bash',
			}),
		).toBe('/bin/bash');
	});

	test('falls back to SHELL when detection and cached default shell are unavailable', () => {
		expect(
			resolveShell({
				detect: () => {
					throw new Error('user lookup failed');
				},
				defaultShellPath: null,
				env: { SHELL: '/bin/fish' },
			}),
		).toBe('/bin/fish');
	});

	test('falls back to /bin/sh when no shell can be resolved', () => {
		expect(
			resolveShell({
				detect: () => {
					throw new Error('user lookup failed');
				},
				defaultShellPath: null,
				env: {},
			}),
		).toBe('/bin/sh');
	});
});

describe('resolveShellArgs', () => {
	test('starts common shells as login shells', () => {
		expect(resolveShellArgs('/bin/zsh')).toEqual(['-l']);
		expect(resolveShellArgs('/usr/local/bin/fish')).toEqual(['-l']);
	});

	test('returns no extra args for unknown shells', () => {
		expect(resolveShellArgs('/usr/local/bin/custom-shell')).toEqual([]);
	});
});

describe('updateFocusReportingState', () => {
	test('tracks focus reporting mode from terminal output', () => {
		const session = { focusReportingEnabled: false, modeSequenceTail: '' };
		const esc = String.fromCharCode(27);

		updateFocusReportingState(session, `${esc}[?1004h`);
		expect(session.focusReportingEnabled).toBe(true);

		updateFocusReportingState(session, `${esc}[?1004l`);
		expect(session.focusReportingEnabled).toBe(false);
	});

	test('detects focus reporting mode split across output chunks', () => {
		const session = { focusReportingEnabled: false, modeSequenceTail: '' };
		const esc = String.fromCharCode(27);

		updateFocusReportingState(session, `${esc}[?10`);
		expect(session.focusReportingEnabled).toBe(false);

		updateFocusReportingState(session, '04h');
		expect(session.focusReportingEnabled).toBe(true);
	});
});

describe('killTerminalProcessTree', () => {
	test('does nothing when there is no subprocess', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		try {
			killTerminalProcessTree(null);

			expect(kill).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	test('kills the subprocess process group', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);
		const subprocess = { pid: 1234, kill: () => {} } as unknown as Bun.Subprocess;

		try {
			killTerminalProcessTree(subprocess);

			expect(kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
		} finally {
			kill.mockRestore();
		}
	});

	test('ignores invalid process ids', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		try {
			killTerminalProcessTree({ pid: 0 } as Bun.Subprocess);
			killTerminalProcessTree({ pid: Number.NaN } as Bun.Subprocess);

			expect(kill).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	test('falls back to killing only the subprocess when process group killing fails', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('process group not found');
		});

		let subprocessSignal: NodeJS.Signals | undefined;
		const subprocess = {
			pid: 1234,
			kill: (signal: NodeJS.Signals) => {
				subprocessSignal = signal;
			},
		} as unknown as Bun.Subprocess;

		try {
			killTerminalProcessTree(subprocess);

			expect(kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
			expect(subprocessSignal).toBe('SIGKILL');
		} finally {
			kill.mockRestore();
		}
	});
});

describe('signalTerminalProcessGroup', () => {
	test('returns false when there is no subprocess', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		try {
			expect(signalTerminalProcessGroup(null, 'SIGINT')).toBe(false);
			expect(kill).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	test('signals the subprocess process group', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);
		const subprocess = { pid: 1234, kill: () => {} } as unknown as Bun.Subprocess;

		try {
			expect(signalTerminalProcessGroup(subprocess, 'SIGINT')).toBe(true);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGINT');
		} finally {
			kill.mockRestore();
		}
	});

	test('returns false for invalid process ids', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		try {
			expect(signalTerminalProcessGroup({ pid: 0 } as Bun.Subprocess, 'SIGINT')).toBe(false);
			expect(signalTerminalProcessGroup({ pid: Number.NaN } as Bun.Subprocess, 'SIGINT')).toBe(
				false,
			);
			expect(kill).not.toHaveBeenCalled();
		} finally {
			kill.mockRestore();
		}
	});

	test('falls back to signaling only the subprocess when process group signaling fails', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('process group not found');
		});

		let subprocessSignal: NodeJS.Signals | undefined;
		const subprocess = {
			pid: 1234,
			kill: (signal: NodeJS.Signals) => {
				subprocessSignal = signal;
			},
		} as unknown as Bun.Subprocess;

		try {
			expect(signalTerminalProcessGroup(subprocess, 'SIGWINCH')).toBe(true);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGWINCH');
			expect(subprocessSignal).toBe('SIGWINCH');
		} finally {
			kill.mockRestore();
		}
	});

	test('returns false when process group and subprocess signaling fail', () => {
		const kill = spyOn(process, 'kill').mockImplementation(() => {
			throw new Error('process group not found');
		});
		const subprocess = {
			pid: 1234,
			kill: () => {
				throw new Error('subprocess not found');
			},
		} as unknown as Bun.Subprocess;

		try {
			expect(signalTerminalProcessGroup(subprocess, 'SIGINT')).toBe(false);
		} finally {
			kill.mockRestore();
		}
	});
});

describe('TerminalManager.onEvent', () => {
	test('notifies registered listeners', () => {
		const manager = new TerminalManager();
		let receivedEvent: TerminalEvent | undefined;
		const event: TerminalEvent = {
			type: 'terminal.output',
			terminalId: 'terminal-1',
			data: 'hello',
		};

		manager.onEvent((nextEvent) => {
			receivedEvent = nextEvent;
		});
		(manager as unknown as { emit(event: TerminalEvent): void }).emit(event);

		expect(receivedEvent).toBe(event);
	});

	test('stops notifying listeners after unsubscribe', () => {
		const manager = new TerminalManager();
		let eventCount = 0;

		const unsubscribe = manager.onEvent(() => {
			eventCount += 1;
		});

		const event: TerminalEvent = {
			type: 'terminal.exit',
			terminalId: 'terminal-1',
			exitCode: 0,
		};

		unsubscribe();
		(manager as unknown as { emit(event: TerminalEvent): void }).emit(event);

		expect(eventCount).toBe(0);
	});
});

describe('TerminalManager.createTerminal', () => {
	test('throws when Bun.Terminal is unavailable', () => {
		const manager = new TerminalManager();
		Bun.Terminal = undefined as unknown as typeof Bun.Terminal;

		try {
			expect(() =>
				manager.createTerminal({
					projectPath: '/tmp/project',
					terminalId: 'terminal-1',
					cols: 80,
					rows: 24,
					scrollback: 1_000,
				}),
			).toThrow('Embedded terminal requires Bun 1.3.5+ with Bun.Terminal support.');
		} finally {
			restoreBunTerminalMocks();
		}
	});

	test('updates and returns an existing terminal session', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		let headlessResize: [number, number] | undefined;
		let terminalResize: [number, number] | undefined;

		const session = createTerminalSession({
			terminal: {
				resize: (cols: number, rows: number) => {
					terminalResize = [cols, rows];
				},
			} as Bun.Terminal,
			headless: {
				options: { scrollback: 1_000 },
				resize: (cols: number, rows: number) => {
					headlessResize = [cols, rows];
				},
				dispose: () => {},
			},
			serializeAddon: {
				serialize: () => 'serialized terminal state',
				dispose: () => {},
			},
		});

		terminalSessions(manager).set('terminal-1', session);

		try {
			const snapshot = manager.createTerminal({
				projectPath: '/tmp/project',
				terminalId: 'terminal-1',
				cols: 100.4,
				rows: 30.5,
				scrollback: 5_001,
			});

			expect(snapshot).toMatchObject({
				terminalId: 'terminal-1',
				cols: 100,
				rows: 31,
				scrollback: 5_000,
				serializedState: 'serialized terminal state',
			});

			expect(headlessResize).toEqual([100, 31]);
			expect(terminalResize).toEqual([100, 31]);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGWINCH');
		} finally {
			kill.mockRestore();
		}
	});

	test('creates a terminal session', () => {
		const manager = new TerminalManager();
		let terminalOptions:
			| {
					cols: number;
					rows: number;
					name: string;
					data: (terminal: Bun.Terminal, data: BufferSource) => void;
			  }
			| undefined;

		const terminal = {
			resize: () => {},
			write: () => {},
			close: () => {},
		} as unknown as Bun.Terminal;

		const subprocess = {
			pid: 1234,
			exited: new Promise<number>(() => {}),
			kill: () => {},
		} as unknown as Bun.Subprocess;

		Bun.Terminal = function MockTerminal(options: typeof terminalOptions) {
			terminalOptions = options;
			return terminal;
		} as unknown as typeof Bun.Terminal;

		const spawn = spyOn(Bun, 'spawn').mockImplementation(() => subprocess);
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		try {
			const snapshot = manager.createTerminal({
				projectPath: '/tmp/project',
				terminalId: 'terminal-1',
				cols: 100.4,
				rows: 30.5,
				scrollback: 5_001,
			});

			expect(snapshot).toMatchObject({
				terminalId: 'terminal-1',
				cwd: '/tmp/project',
				cols: 100,
				rows: 31,
				scrollback: 5_000,
				status: 'running',
				exitCode: null,
			});

			expect(snapshot.serializedState).toBeString();
			expect(terminalOptions).toMatchObject({
				cols: 100,
				rows: 31,
				name: 'xterm-256color',
			});

			expect(spawn).toHaveBeenCalled();
		} finally {
			manager.closeAll();
			kill.mockRestore();
			spawn.mockRestore();
			restoreBunTerminalMocks();
		}
	});
});

describe('TerminalManager.write', () => {
	test('writes input to the active terminal session', () => {
		const manager = new TerminalManager();
		let writtenData = '';
		const session = createTerminalSession({
			terminal: {
				write: (data: string) => {
					writtenData += data;
				},
			} as unknown as Bun.Terminal,
			process: null,
		});

		terminalSessions(manager).set('terminal-1', session);
		manager.write('terminal-1', 'echo hello');

		expect(writtenData).toBe('echo hello');
	});

	test('filters focus reports when focus reporting is disabled', () => {
		const manager = new TerminalManager();
		const esc = String.fromCharCode(27);
		let writtenData = '';

		const session = createTerminalSession({
			terminal: {
				write: (data: string) => {
					writtenData += data;
				},
			} as unknown as Bun.Terminal,
			process: null,
		});

		terminalSessions(manager).set('terminal-1', session);
		manager.write('terminal-1', `before${esc}[Iafter${esc}[O`);

		expect(writtenData).toBe('beforeafter');
	});

	test('sends SIGINT to the process group for Ctrl-C input', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);
		const writtenChunks: string[] = [];

		const session = createTerminalSession({
			terminal: {
				write: (data: string) => {
					writtenChunks.push(data);
				},
			} as unknown as Bun.Terminal,
		});

		terminalSessions(manager).set('terminal-1', session);

		try {
			manager.write('terminal-1', 'before\x03after');

			expect(writtenChunks).toEqual(['before', 'after']);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGINT');
		} finally {
			kill.mockRestore();
		}
	});
});

describe('TerminalManager.resize', () => {
	test('resizes the terminal session and signals a window change', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		let headlessResize: [number, number] | undefined;
		let terminalResize: [number, number] | undefined;

		const session = createTerminalSession({
			headless: {
				options: { scrollback: 1_000 },
				resize: (cols: number, rows: number) => {
					headlessResize = [cols, rows];
				},
				dispose: () => {},
			},
			terminal: {
				resize: (cols: number, rows: number) => {
					terminalResize = [cols, rows];
				},
			} as unknown as Bun.Terminal,
		});

		terminalSessions(manager).set('terminal-1', session);

		try {
			manager.resize('terminal-1', 100.4, 30.5);
			expect(session.cols).toBe(100);
			expect(session.rows).toBe(31);

			expect(headlessResize).toEqual([100, 31]);
			expect(terminalResize).toEqual([100, 31]);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGWINCH');
		} finally {
			kill.mockRestore();
		}
	});
});

describe('TerminalManager.close', () => {
	test('removes the session and disposes terminal resources', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		let terminalClosed = false;
		let serializeAddonDisposed = false;
		let headlessDisposed = false;

		const session = createTerminalSession({
			terminal: {
				close: () => {
					terminalClosed = true;
				},
			} as unknown as Bun.Terminal,
			serializeAddon: {
				serialize: () => 'serialized terminal state',
				dispose: () => {
					serializeAddonDisposed = true;
				},
			},
			headless: {
				options: { scrollback: 1_000 },
				resize: () => {},
				dispose: () => {
					headlessDisposed = true;
				},
			},
		});

		const sessions = terminalSessions(manager);
		sessions.set('terminal-1', session);

		try {
			manager.close('terminal-1');
			expect(sessions.has('terminal-1')).toBe(false);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGKILL');

			expect(terminalClosed).toBe(true);
			expect(serializeAddonDisposed).toBe(true);
			expect(headlessDisposed).toBe(true);
		} finally {
			kill.mockRestore();
		}
	});
});

describe('TerminalManager.closeByCwd', () => {
	test('closes sessions matching the provided cwd', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		let matchingTerminalClosed = false;
		let otherTerminalClosed = false;

		const matchingSession = createTerminalSession({
			cwd: '/tmp/project',
			terminal: {
				close: () => {
					matchingTerminalClosed = true;
				},
			} as unknown as Bun.Terminal,
		});

		const otherSession = createTerminalSession({
			terminalId: 'terminal-2',
			cwd: '/tmp/other-project',
			process: { pid: 5678 } as Bun.Subprocess,
			terminal: {
				close: () => {
					otherTerminalClosed = true;
				},
			} as unknown as Bun.Terminal,
		});

		const sessions = terminalSessions(manager);
		sessions.set('terminal-1', matchingSession);
		sessions.set('terminal-2', otherSession);

		try {
			manager.closeByCwd('/tmp/project');
			expect(sessions.has('terminal-1')).toBe(false);
			expect(sessions.has('terminal-2')).toBe(true);

			expect(matchingTerminalClosed).toBe(true);
			expect(otherTerminalClosed).toBe(false);
			expect(kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
		} finally {
			kill.mockRestore();
		}
	});
});

describe('TerminalManager.closeAll', () => {
	test('closes every terminal session', () => {
		const manager = new TerminalManager();
		const kill = spyOn(process, 'kill').mockImplementation(() => true);

		let firstTerminalClosed = false;
		let secondTerminalClosed = false;

		const firstSession = createTerminalSession({
			terminal: {
				close: () => {
					firstTerminalClosed = true;
				},
			} as unknown as Bun.Terminal,
		});

		const secondSession = createTerminalSession({
			terminalId: 'terminal-2',
			process: { pid: 5678 } as Bun.Subprocess,
			terminal: {
				close: () => {
					secondTerminalClosed = true;
				},
			} as unknown as Bun.Terminal,
		});

		const sessions = terminalSessions(manager);
		sessions.set('terminal-1', firstSession);
		sessions.set('terminal-2', secondSession);

		try {
			manager.closeAll();

			expect(sessions.size).toBe(0);
			expect(firstTerminalClosed).toBe(true);
			expect(secondTerminalClosed).toBe(true);

			expect(kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
			expect(kill).toHaveBeenCalledWith(-5678, 'SIGKILL');
		} finally {
			kill.mockRestore();
		}
	});
});
