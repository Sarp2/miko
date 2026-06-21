import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerQueuedMessages } from './composer-queued-messages';

describe('ComposerQueuedMessages', () => {
	test('renders nothing when the queue is empty', () => {
		expect(renderToStaticMarkup(<ComposerQueuedMessages queued={[]} onRemove={() => {}} />)).toBe(
			'',
		);
	});

	test('renders each queued message with a remove control', () => {
		const html = renderToStaticMarkup(
			<ComposerQueuedMessages
				queued={[
					{ id: 'q1', content: 'run the tests', attachmentCount: 0 },
					{ id: 'q2', content: '', attachmentCount: 2 },
				]}
				onRemove={() => {}}
			/>,
		);

		expect(html).toContain('run the tests');
		expect(html).toContain('Attachment'); // empty content falls back to a label
		expect(html).toContain('+2');
		expect(html).toContain('Remove queued message');
	});
});
