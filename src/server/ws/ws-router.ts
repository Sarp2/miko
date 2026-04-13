import type { SubscriptionTopic } from "../../shared/protocol";

export interface ClientState {
	subscriptions: Map<string, SubscriptionTopic>;
	snapshotSignatures: Map<string, string>;
}
