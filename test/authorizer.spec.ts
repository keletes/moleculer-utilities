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
