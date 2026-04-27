export interface GenerateStructuredArgs {
	cwd: string;
	prompt: string;
	model?: string;
}

export class CodexAppServerManager {
	async generateStructured(_args: GenerateStructuredArgs): Promise<string | null> {
		return null;
	}
}
