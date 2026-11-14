import { ServiceBroker } from "moleculer";
import { Authorizer } from "../src/mixins";

describe("Authorizer", () => {
	const broker = new ServiceBroker({ logger: false });
	broker.createService({
		name: "things",
		mixins: [Authorizer({ whitelist: ["things.open"] })],
		actions: {
			open: () => "open",
			closed: () => "closed",
		},
	});
	beforeAll(() => broker.start());
	afterAll(() => broker.stop());

	it("lets a whitelisted action through without authorization", async () => {
		expect(await broker.call("things.open")).toBe("open");
	});

	it("refuses any other action with a 403", async () => {
		await expect(broker.call("things.closed")).rejects.toMatchObject({ code: 403, type: "E_NOT_AUTHORIZED" });
	});

	it("lets an authorized action through", async () => {
		const meta = { authorizer: { actions: ["things.closed"] } };
		expect(await broker.call("things.closed", {}, { meta })).toBe("closed");
	});

	it("does not authorize an action the key does not list", async () => {
		const meta = { authorizer: { actions: ["things.other"] } };
		await expect(broker.call("things.closed", {}, { meta })).rejects.toMatchObject({ code: 403 });
	});
});

describe("Authorizer implies", () => {
	const broker = new ServiceBroker({ logger: false });
	broker.createService({
		name: "drawer",
		mixins: [
			Authorizer({
				whitelist: ["drawer.open"],
				implies: {
					"drawer.jobStatus": "drawer.draw",
					"drawer.jobResult": ["drawer.draw", "drawer.view"],
					"drawer.draw": "drawer.admin",
					"__proto__": "drawer.draw",
					"toString": "drawer.draw",
				} as Record<string, string | string[]>,
			}),
		],
		actions: {
			open: () => "open",
			draw: () => "draw",
			admin: () => "admin",
			jobStatus: () => "status",
			jobResult: () => "result",
			jobEvents: () => "events",
			constructor: () => "ctor",
		},
	});
	beforeAll(() => broker.start());
	afterAll(() => broker.stop());
	const call = (action: string, actions: string[]) => broker.call(action, {}, { meta: { authorizer: { actions } } });

	it("allows the action itself", async () => {
		expect(await call("drawer.jobStatus", ["drawer.jobStatus"])).toBe("status");
	});
	it("allows through an implied permission", async () => {
		expect(await call("drawer.jobStatus", ["drawer.draw"])).toBe("status");
	});
	it("allows through any permission of an array", async () => {
		expect(await call("drawer.jobResult", ["drawer.view"])).toBe("result");
		expect(await call("drawer.jobResult", ["drawer.draw"])).toBe("result");
	});
	it("refuses an action that is not implied", async () => {
		await expect(call("drawer.jobEvents", ["drawer.draw"])).rejects.toMatchObject({ code: 403, type: "E_NOT_AUTHORIZED" });
		await expect(call("drawer.jobStatus", ["drawer.view"])).rejects.toMatchObject({ code: 403 });
	});
	it("is not transitive", async () => {
		await expect(call("drawer.jobStatus", ["drawer.admin"])).rejects.toMatchObject({ code: 403 });
		expect(await call("drawer.draw", ["drawer.admin"])).toBe("draw");
	});
	it("keeps the whitelist", async () => {
		expect(await broker.call("drawer.open")).toBe("open");
	});
	it("ignores prototype keys and non-string permissions", async () => {
		await expect(call("drawer.constructor", ["drawer.draw"])).rejects.toMatchObject({ code: 403 });
		const b = new ServiceBroker({ logger: false });
		b.createService({
			name: "x",
			mixins: [Authorizer({ implies: { "x.a": [1, null, {}] } as unknown as Record<string, string[]> })],
			actions: { a: () => "a" },
		});
		await b.start();
		await expect(b.call("x.a", {}, { meta: { authorizer: { actions: ["1", "null", "[object Object]"] } } })).rejects.toMatchObject({ code: 403 });
		await b.stop();
	});
	it("behaves as before without implies", async () => {
		const b = new ServiceBroker({ logger: false });
		b.createService({ name: "y", mixins: [Authorizer()], actions: { a: () => "a" } });
		await b.start();
		await expect(b.call("y.a", {}, { meta: { authorizer: { actions: ["drawer.draw"] } } })).rejects.toMatchObject({ code: 403 });
		expect(await b.call("y.a", {}, { meta: { authorizer: { actions: ["y.a"] } } })).toBe("a");
		await b.stop();
	});
});
