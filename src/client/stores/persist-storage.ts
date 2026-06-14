import type { StateStorage } from 'zustand/middleware';

const memoryStorage = new Map<string, string>();

const fallbackStorage: StateStorage = {
	getItem: (name) => memoryStorage.get(name) ?? null,
	setItem: (name, value) => {
		memoryStorage.set(name, value);
	},
	removeItem: (name) => {
		memoryStorage.delete(name);
	},
};

function safeBrowserStorage(storage: Storage): StateStorage {
	return {
		getItem: (name) => {
			try {
				return storage.getItem(name);
			} catch {
				return fallbackStorage.getItem(name);
			}
		},
		setItem: (name, value) => {
			try {
				storage.setItem(name, value);
			} catch {
				fallbackStorage.setItem(name, value);
			}
		},
		removeItem: (name) => {
			try {
				storage.removeItem(name);
			} catch {
				fallbackStorage.removeItem(name);
			}
		},
	};
}

export function getLocalStorage(): StateStorage {
	if (typeof window === 'undefined') return fallbackStorage;
	try {
		return safeBrowserStorage(window.localStorage);
	} catch {
		return fallbackStorage;
	}
}
