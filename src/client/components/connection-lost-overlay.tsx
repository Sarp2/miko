import { PlugsConnected } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useWsStore, type WsConnectionStatus } from '../stores/ws-store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

function isDisconnected(status: WsConnectionStatus) {
	return status === 'closed' || status === 'error' || status === 'connecting';
}

export function ConnectionLostOverlay() {
	const status = useWsStore((state) => state.status);
	const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
	const [hasFailedInitialAttempt, setHasFailedInitialAttempt] = useState(false);
	const sawConnectingRef = useRef(false);
	useEffect(() => {
		if (status === 'connecting') sawConnectingRef.current = true;
		if (status === 'open') {
			setHasConnectedOnce(true);
			return;
		}
		if (
			!hasConnectedOnce &&
			sawConnectingRef.current &&
			(status === 'closed' || status === 'error')
		) {
			setHasFailedInitialAttempt(true);
		}
	}, [hasConnectedOnce, status]);

	const open = (hasConnectedOnce || hasFailedInitialAttempt) && isDisconnected(status);
	const title = 'Connection lost';
	const description =
		'Miko is trying to reconnect. Keep this window open — your workspace state will resume when the server is back.';

	return (
		<Dialog open={open} onOpenChange={() => undefined}>
			<DialogContent
				showCloseButton={false}
				overlayClassName="bg-canvas/95 backdrop-blur-sm"
				className="max-w-[460px] gap-0 overflow-hidden rounded-xl p-0 shadow-dialog"
			>
				<div className="flex flex-col gap-5 px-6 py-6">
					<div className="flex items-start gap-4">
						<div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-hairline bg-surface-2 text-ink-subtle">
							<PlugsConnected className="size-5" />
						</div>
						<DialogHeader className="min-w-0 gap-2 pt-0.5">
							<DialogTitle className="text-[15px] leading-6">{title}</DialogTitle>
							<DialogDescription className="max-w-[360px] text-[13px] leading-6">
								{description}
							</DialogDescription>
						</DialogHeader>
					</div>

					<div className="rounded-lg border border-hairline bg-surface-2 px-3.5 py-3 text-[12px] leading-5 text-ink-subtle">
						Restart the CLI, then refresh this page.
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
