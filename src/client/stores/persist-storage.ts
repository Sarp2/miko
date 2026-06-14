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

export function getLocalStorage(): StateStorage {
	if (typeof window === 'undefined') return fallbackStorage;
	return window.localStorage;
}
