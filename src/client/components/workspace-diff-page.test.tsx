import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { WorkspaceDiffPatchResult } from '../../shared/types';
import { useWorkspaceFileStore } from '../stores/workspace-file-store';
import { WorkspaceDiffPage } from './workspace-diff-page';

function seedDiffResource(path: string, patch: string) {
	const data: WorkspaceDiffPatchResult = { path, patch, patchDigest: 'digest' };
	useWorkspaceFileStore.setState((state) => {
		const diffByKey = new Map(state.diffByKey);
		diffByKey.set(JSON.stringify(['workspace-1', path]), {
			status: 'ready',
			data,
			error: null,
			requestId: null,
			expectedPatchDigest: 'digest',
		});
		return { diffByKey };
	});
}

function renderWorkspaceDiff(path: string) {
	return renderToStaticMarkup(
		<MemoryRouter>
			<WorkspaceDiffPage
				workspaceId="workspace-1"
				path={path}
				source="workspace"
				workspaceRoot="/repo"
				composerSessionId={null}
				composerSessionSnapshot={null}
			/>
		</MemoryRouter>,
	);
}

describe('WorkspaceDiffPage', () => {
	afterEach(() => {
		useWorkspaceFileStore.getState().resetForTests();
	});

	// An empty patch made Pierre's PatchDiff throw during render and crash the whole
	// diff view (e.g. opening a listed file for which git emits no textual diff).
	test('renders a calm empty state instead of crashing on an empty patch', () => {
		seedDiffResource('.gitkeep', '');
		const html = renderWorkspaceDiff('.gitkeep');
		expect(html).toContain('No changes to display');
	});

	test('renders the diff for a non-empty patch', () => {
		seedDiffResource(
			'.gitignore',
			'diff --git a/.gitignore b/.gitignore\nnew file mode 100644\nindex 0000000..abc\n--- /dev/null\n+++ b/.gitignore\n@@ -0,0 +1 @@\n+node_modules\n',
		);
		const html = renderWorkspaceDiff('.gitignore');
		expect(html).not.toContain('No changes to display');
	});
});
