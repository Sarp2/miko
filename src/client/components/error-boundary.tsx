import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button';

interface ErrorBoundaryProps {
	children: ReactNode;
	message?: string;
	onError?: (error: Error, info: ErrorInfo) => void;
	onReset?: () => void;
	resetKey?: string;
	resetLabel?: string;
}

interface ErrorBoundaryState {
	error: Error | null;
	resetKey?: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { error };
	}

	static getDerivedStateFromProps(
		props: ErrorBoundaryProps,
		state: ErrorBoundaryState,
	): Partial<ErrorBoundaryState> | null {
		if (props.resetKey === state.resetKey) return null;
		return { error: null, resetKey: props.resetKey };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		this.props.onError?.(error, info);
	}

	reset = () => {
		if (this.props.onReset) {
			this.props.onReset();
			return;
		}
		this.setState({ error: null, resetKey: this.props.resetKey });
	};

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-center text-caption text-ink-tertiary">
				<p>{this.props.message ?? 'Something went wrong.'}</p>
				<Button type="button" variant="ghost" size="xs" onClick={this.reset}>
					{this.props.resetLabel ?? 'Try again'}
				</Button>
			</div>
		);
	}
}
