import { randomUUID } from 'node:crypto';

const EXTERNAL_FILE_ACCESS_TTL_MS = 10 * 60 * 1000;
const MAX_EXTERNAL_FILE_ACCESS_TOKENS = 1024;

interface ExternalFileAccessGrant {
	filePath: string;
	expiresAt: number;
}

const grantsByToken = new Map<string, ExternalFileAccessGrant>();

function pruneExternalFileAccessGrants(now = Date.now()) {
	for (const [token, grant] of grantsByToken) {
		if (grant.expiresAt <= now) grantsByToken.delete(token);
	}

	while (grantsByToken.size > MAX_EXTERNAL_FILE_ACCESS_TOKENS) {
		const oldestToken = grantsByToken.keys().next().value;
		if (!oldestToken) break;
		grantsByToken.delete(oldestToken);
	}
}

export function registerExternalFileAccess(filePath: string, now = Date.now()) {
	pruneExternalFileAccessGrants(now);
	const token = randomUUID();
	grantsByToken.set(token, {
		filePath,
		expiresAt: now + EXTERNAL_FILE_ACCESS_TTL_MS,
	});
	return token;
}

export function resolveExternalFileAccessToken(token: string, now = Date.now()) {
	pruneExternalFileAccessGrants(now);
	const grant = grantsByToken.get(token);
	if (!grant) return null;
	if (grant.expiresAt <= now) {
		grantsByToken.delete(token);
		return null;
	}
	return grant.filePath;
}

export function resetExternalFileAccessGrantsForTests() {
	grantsByToken.clear();
}
