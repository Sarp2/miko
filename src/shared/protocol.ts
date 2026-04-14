export type SubscriptionTopic =
	| { type: 'sidebar' }
	| { type: 'local-projects' }
	| { type: 'update' }
	| { type: 'keybindings' }
	| { type: 'chat'; chatId: string; recentLimit?: number }
	| { type: 'project-git'; projectId: string }
	| { type: 'terminal'; terminalId: string };
