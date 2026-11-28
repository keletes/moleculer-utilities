import { ServiceBroker } from "moleculer";
import { InterNamespace } from "../src/middlewares";

const wait = (ms = 50) => new Promise(r => setTimeout(r, ms));
const until = async (cond: () => boolean) => {
	for (let i = 0; i < 100 && !cond(); i++) await wait(20);
	expect(cond()).toBe(true);
};

describe("InterNamespace registry access", () => {
	let main: ServiceBroker;
	let other: ServiceBroker;

	beforeAll(async () => {
		main = new ServiceBroker({
			namespace: "main",
			nodeID: "main-node",
			transporter: "Fake",
			logger: false,
			middlewares: [InterNamespace(["other"])],
		});
		other = new ServiceBroker({ namespace: "other", nodeID: "other-node", transporter: "Fake", logger: false });
		other.createService({ name: "math", actions: { double: (ctx: any) => ctx.params.n * 2 } });
		await Promise.all([main.start(), other.start()]);
		await until(() => main.interNamespace!("other").services("math").length === 1);
	});

	afterAll(async () => {
		await Promise.all([main.stop(), other.stop()]);
	});

	it("throws for an unknown namespace", () => {
		expect(() => main.interNamespace!("nope")).toThrow("Unknown namespace");
	});

	it("keeps the call('action@ns') behaviour", async () => {
		await expect(main.call("math.double@other", { n: 2 })).resolves.toBe(4);
	});

	it("lists services and watches joins and leaves", async () => {
		const ns = main.interNamespace!("other");
		expect(ns.services().map(s => s.name)).toEqual(["math"]);
		expect(ns.services("nothing")).toEqual([]);

		const seen: any[] = [];
		const unwatch = ns.watch("feature", s => seen.push(s));
		expect(seen).toEqual([[]]);

		other.createService({ name: "unrelated" });
		await until(() => ns.services("unrelated").length === 1);
		expect(seen).toHaveLength(1);

		const svc = other.createService({ name: "feature", settings: { flag: 1 } });
		await until(() => seen.length === 2);
		expect(seen[1]).toEqual([{ flag: 1 }]);
		expect(ns.services("feature")[0].settings).toEqual({ flag: 1 });

		await other.destroyService(svc);
		await until(() => seen.length === 3);
		expect(seen[2]).toEqual([]);

		unwatch();
		other.createService({ name: "feature", settings: { flag: 2 } });
		await until(() => ns.services("feature").length === 1);
		expect(seen).toHaveLength(3);
	});

	it("receives events of the namespace until unsubscribed", async () => {
		const got: any[] = [];
		const off = await main.interNamespace!("other").on("thing.*", (payload, sender, event) => got.push([payload, event]));
		// the new listener reaches the other namespace's registry asynchronously: emit until it is known
		await until(() => {
			void other.emit("thing.done", { a: 1 });
			return got.length > 0;
		});
		expect(got[0]).toEqual([{ a: 1 }, "thing.done"]);
		await wait(100);
		const received = got.length;

		await off();
		await other.emit("thing.done", { a: 2 });
		await wait(150);
		expect(got).toHaveLength(received);
	});
});
