import { ServiceBroker, ServiceSchema } from "moleculer";
import isString from "lodash.isstring";
import defaultsDeep from "lodash.defaultsdeep";

export interface InterNamespaceService {
	name: string;
	version?: string | number;
	fullName: string;
	settings: Record<string, any>;
	nodeID: string;
}

export interface InterNamespaceEventOptions {
	/** Balancing group of the subscription, as in a service's `events` definition. */
	group?: string;
}

/** Read access to another namespace, returned by `broker.interNamespace(namespace)`. */
export interface InterNamespaceApi {
	/** Available services of the namespace (all, or those named `name`) with their settings. Local registry, no network call. */
	services(name?: string): InterNamespaceService[];
	/**
	 * Calls `handler` with the settings of every available instance of `name` (possibly empty) once the namespace
	 * has started and again each time that result changes. Returns the unsubscribe function.
	 */
	watch(name: string, handler: (settings: Record<string, any>[]) => void): () => void;
	/** Subscribes to an event of the namespace (wildcards allowed). Returns an async unsubscribe. */
	on(event: string, handler: (payload: any, sender: string, event: string) => unknown, opts?: InterNamespaceEventOptions): () => Promise<void>;
}

declare module "moleculer" {
	interface ServiceBroker {
		/** Set by the `InterNamespace` middleware. Throws `Unknown namespace` for a namespace that is not configured. */
		interNamespace?(namespace: string): InterNamespaceApi;
	}
}

export default function InterNamespaceMiddleware(opts: object): Omit<ServiceSchema, "name"> {
	if (!Array.isArray(opts))
		throw new Error("Must be an Array");

	let thisBroker: ServiceBroker;
	const brokers: Record<string, ServiceBroker> = {};
	const started = new Set<string>();
	const checks: Record<string, Array<() => void>> = {};
	let listeners = 0;

	const services = (ns: string, name?: string): InterNamespaceService[] =>
		(brokers[ns].registry.getServiceList({ onlyAvailable: true, skipInternal: true, withActions: false }) as InterNamespaceService[])
			.filter(svc => !name || svc.name === name);

	const api = (ns: string): InterNamespaceApi => {
		const b = brokers[ns];
		return {
			services: name => services(ns, name),

			watch(name, handler) {
				let last: string | undefined;
				const check = () => {
					const settings = services(ns, name).map(svc => svc.settings);
					const serialized = JSON.stringify(settings);
					if (serialized === last) return;
					last = serialized;
					try {
						handler(settings);
					} catch (err) {
						b.logger.error("InterNamespace watch handler failed", err);
					}
				};
				b.localBus.on("$services.changed", check);
				(checks[ns] ||= []).push(check);
				if (started.has(ns)) check();
				return () => {
					b.localBus.off("$services.changed", check);
					checks[ns] = checks[ns].filter(c => c !== check);
				};
			},

			on(event, handler, opts = {}) {
				const service = b.createService({
					name: `inter-namespace-listener-${++listeners}`,
					events: { [event]: { ...opts, handler: async (ctx: any) => { await handler(ctx.params, ctx.nodeID, ctx.eventName); } } },
				});
				return () => b.destroyService(service);
			},
		};
	};

	return {
		created(broker: ServiceBroker) {
			thisBroker = broker;
			opts.forEach(nsOpts => {
				if (isString(nsOpts)) {
					nsOpts = {
						namespace: nsOpts
					};
				}

				const ns: string = nsOpts.namespace;
				this.logger.info(`Create internamespace broker for '${ns} namespace...'`);
				const brokerOpts = defaultsDeep({}, nsOpts, { nodeID: null, middlewares: null }, broker.options);
				brokers[ns] = new ServiceBroker(brokerOpts);
			});

			broker.interNamespace = (namespace: string) => {
				if (!brokers[namespace]) throw new Error("Unknown namespace: " + namespace);
				return api(namespace);
			};
		},

		started() {
			return Promise.all(Object.entries(brokers).map(async ([ns, b]) => {
				await b.start();
				started.add(ns);
				(checks[ns] || []).forEach(check => check());
			}));
		},

		stopped() {
			started.clear();
			return Promise.all(Object.values(brokers).map(b => b.stop()));
		},

		call(next: (...args: any[]) => any) {

			return function(actionName: string, params: object, opts = {}) {

				if (isString(actionName) && actionName.includes("@")) {
					const [action, namespace] = actionName.split("@");

					if (brokers[namespace]) {
						return brokers[namespace].call(action, params, opts);

					} else if (namespace === thisBroker.namespace) {
						return next(action, params, opts);

					} else {
						throw new Error("Unknown namespace: " + namespace);
					}
				}

				return next(actionName, params, opts);
			};
		},
	};
}
