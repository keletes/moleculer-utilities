import { Errors } from "moleculer";
import type { Context, Middleware, ServiceBroker } from "moleculer";
import type { LimitsMode } from "./middleware";

export interface BusyGuardOptions {
	/** CPU pressure (0-100) above which new work is refused; defaults to `process.env.BUSY_CPU_PRESSURE`, then 60. */
	threshold?: number;
	/** Defaults to `process.env.BUSY_MODE`, then `"enforce"`. */
	mode?: LimitsMode;
}

/**
 * Pod admission: an action with `busyGuard: true` (or `{ threshold }`) is refused before its handler starts while the
 * local node's CPU measure is over the threshold, with Moleculer's own `QueueIsFullError` (`QUEUE_FULL`, retryable),
 * so callers' existing "not started, retry on another pod" path handles it unchanged.
 *
 * It reads `broker.registry.nodes.localNode.cpu`, the value the heartbeat already refreshes (pair it with `PodCpuUsage` so it
 * means pod pressure); no sampler of its own. Ordering: Moleculer adds user middlewares before the internal ones and
 * later ones wrap outside, so the bulkhead is outside and BusyGuard inside it: a call that gets a slot is checked at
 * once, one waiting in the bulkhead queue is checked when it reaches the front.
 * Custom code: no built-in refuses on CPU. `limits.busy{action,mode}` counts refusals (`shadow` serves and counts).
 */
export function BusyGuard(opts: BusyGuardOptions = {}): Middleware {
	const mode = (opts.mode ?? (process.env.BUSY_MODE as LimitsMode | undefined) ?? "enforce") as LimitsMode;
	if (!["enforce", "shadow", "off"].includes(mode)) throw new Error(`Invalid BUSY_MODE: ${mode}`);
	const envThreshold = process.env.BUSY_CPU_PRESSURE != null ? Number(process.env.BUSY_CPU_PRESSURE) : undefined;
	const defaultThreshold = opts.threshold ?? (Number.isFinite(envThreshold) ? (envThreshold as number) : 60);
	let broker!: ServiceBroker;

	return {
		name: "BusyGuard",
		created(b: ServiceBroker) {
			broker = b;
			b.metrics?.register({
				type: "counter",
				name: "limits.busy",
				labelNames: ["action", "mode"],
				description: "Calls refused (or that shadow mode would refuse) because the pod is busy",
			});
		},
		localAction(handler: (ctx: Context<any, any>) => unknown, action: any) {
			const cfg = action.busyGuard;
			if (!cfg || mode === "off") return handler;
			const threshold = typeof cfg === "object" && cfg.threshold != null ? Number(cfg.threshold) : defaultThreshold;
			return function busyGuard(this: unknown, ctx: Context<any, any>) {
				const cpu = (broker.registry.nodes as any).localNode?.cpu;
				if (cpu != null && cpu > threshold) {
					broker.metrics?.increment("limits.busy", { action: action.name, mode });
					// A rejected promise, not a throw: a synchronous throw would escape `broker.call` instead of rejecting it.
					if (mode === "enforce") {
						return Promise.reject(new Errors.QueueIsFullError({ action: action.name, nodeID: broker.nodeID }));
					}
				}
				return handler.call(this, ctx);
			};
		},
	} as unknown as Middleware;
}
