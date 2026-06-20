import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingToolPrompt } from './pending-tool-prompt';

describe('PendingToolPrompt', () => {
	test('renders the plan and approval actions for exit_plan_mode', () => {
		const html = renderToStaticMarkup(
			<PendingToolPrompt
				sessionId="session-1"
				pending={{
					toolUseId: 'tool-1',
					toolKind: 'exit_plan_mode',
					plan: 'Refactor the parser',
					summary: 'Two steps',
				}}
			/>,
		);

		expect(html).toContain('Plan ready for review');
		expect(html).toContain('Refactor the parser');
		expect(html).toContain('Two steps');
		expect(html).toContain('Approve');
		expect(html).toContain('Keep planning');
		expect(html).toContain('clear context');
	});

	test('renders questions and options for ask_user_question', () => {
		const html = renderToStaticMarkup(
			<PendingToolPrompt
				sessionId="session-1"
				pending={{
					toolUseId: 'tool-2',
					toolKind: 'ask_user_question',
					questions: [{ question: 'Which framework?', options: [{ label: 'React' }] }],
				}}
			/>,
		);

		expect(html).toContain('Which framework?');
		expect(html).toContain('React');
		expect(html).toContain('Submit');
	});
});
