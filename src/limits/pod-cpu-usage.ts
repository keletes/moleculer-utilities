import { promises as fs } from "fs";
import type { Middleware, ServiceBroker } from "moleculer";

export type PodCpuMeasure = "max" | "node" | "pod";

export interface PodCpuReaders {
	/** Reads a text file; rejects when it is missing. */
	readFile(path: string): Promise<string>;
	now(): number;
}

export interface PodCpuUsageOptions {
	/** Defaults to `process.env.POD_CPU_MEASURE`, then `"max"`. */
	measure?: PodCpuMeasure;
	/** cgroup v2 folder of the pod (default `/sys/fs/cgroup`). */
	cgroupDir?: string;
	readers?: Partial<PodCpuReaders>;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Makes the heartbeat's `node.cpu` mean the pod's CPU pressure instead of the whole k8s node's.
 *
 * Custom code instead of a built-in: Moleculer measures `os.cpus()`, the host, and sends that in every heartbeat
 * (`updateLocalInfo(this.broker.getCpuUsage)`, called unbound); everything else (the heartbeat, the `CpuUsage`
 * balancer strategy, `$node.list`) is Moleculer's own and is reused as is. Only the measure is replaced, with the max of:
 * - the original `os.cpus()` sample (keeps today's placement; an idle pod on a saturated node must look busy);
 * - the cgroup v2 PSI `cpu.pressure` `some avg10` (share of time the pod's tasks waited for CPU);
 * - the throttled share of the last interval from `cpu.stat`, only when `cpu.max` sets a limit.
 * A term whose file is missing is skipped (one warning); with none, the result is exactly Moleculer's original.
 * `POD_CPU_MEASURE`: `max` (default), `node` (original only), `pod` (cgroup terms only; the original when no cgroup
 * file is readable).
 */
export function PodCpuUsage(opts: PodCpuUsageOptions = {}): Middleware {
	const measure = (opts.measure ?? (process.env.POD_CPU_MEASURE as PodCpuMeasure | undefined) ?? "max") as PodCpuMeasure;
	if (!["max", "node", "pod"].includes(measure)) throw new Error(`Invalid POD_CPU_MEASURE: ${measure}`);
	const dir = (opts.cgroupDir ?? "/sys/fs/cgroup").replace(/\/$/, "");
	const readFile = opts.readers?.readFile ?? ((p: string) => fs.readFile(p, "utf8"));
	const now = opts.readers?.now ?? Date.now;

	return {
		name: "PodCpuUsage",
		created(broker: ServiceBroker) {
			const original = broker.getCpuUsage.bind(broker) as () => Promise<{ avg: number }>;
			const warned = new Set<string>();
			let last: { throttledUsec: number; at: number } | undefined;

			const read = async (file: string): Promise<string | undefined> => {
				try {
					return await readFile(`${dir}/${file}`);
				} catch {
					if (!warned.has(file)) {
						warned.add(file);
						broker.logger.warn(`Pod CPU: ${dir}/${file} is not readable, that term is skipped`);
					}
					return undefined;
				}
			};

			async function pressure(): Promise<number | undefined> {
				const text = await read("cpu.pressure");
				const m = text?.match(/^some\b.*\bavg10=([\d.]+)/m);
				return m ? Number(m[1]) : undefined;
			}

			async function throttled(): Promise<number | undefined> {
				const max = await read("cpu.max");
				if (max === undefined || max.trim().startsWith("max")) return undefined; // no CPU limit: nothing is throttled
				const stat = await read("cpu.stat");
				const m = stat?.match(/^throttled_usec\s+(\d+)/m);
				if (!m) return undefined;
				const sample = { throttledUsec: Number(m[1]), at: now() };
				const prev = last;
				last = sample;
				if (!prev || sample.at <= prev.at) return 0;
				return ((sample.throttledUsec - prev.throttledUsec) / ((sample.at - prev.at) * 1000)) * 100;
			}

			// An arrow function: Moleculer passes `broker.getCpuUsage` unbound, so it must not use `this`.
			broker.getCpuUsage = async () => {
				const base = (await original()) as { avg: number };
				if (measure === "node") return base;
				const terms = (await Promise.all([pressure(), throttled()])).filter((t): t is number => t !== undefined);
				if (terms.length === 0) return base;
				return { ...base, avg: clamp(Math.max(...(measure === "pod" ? [] : [base.avg]), ...terms)) };
			};
		},
	} as unknown as Middleware;
}
