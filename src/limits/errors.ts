import { Errors } from "moleculer";

/**
 * A key, or an IP at the gateway, went over a limit: 429, never retryable (the same call fails again until
 * `retryAfter` has passed), and below 500 so the circuit breaker ignores it. `data` holds `retryAfter` and nothing
 * else: no rule, key id, product or store detail may reach a client.
 */
export class LimitExceededError extends Errors.MoleculerClientError {
	constructor(retryAfterSeconds: number) {
		const retryAfter = Math.max(1, Math.ceil(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1));
		super("Limit exceeded", 429, "LIMIT_EXCEEDED", { retryAfter });
		this.retryable = false;
	}
}
