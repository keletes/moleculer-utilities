import { ServiceBroker } from "moleculer";
import DbService from "moleculer-db";
import { ValidateEntity } from "../src/mixins";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
const schemaValidator = {
	name: { type: "string", min: 2 },
	age: { type: "number", integer: true },
	address: { type: "object", optional: true, props: { city: { type: "string" } } },
	$$strict: true,
};

function setup(settings: any = {}, extra: any = {}) {
	const broker = new ServiceBroker({ logger: false });
	const service = broker.createService({
		name: "people",
		mixins: [DbService, ValidateEntity()],
		adapter: new DbService.MemoryAdapter(),
		settings: { fields: ["_id", "name", "age", "address"], entityValidator: schemaValidator, ...settings },
		...extra,
	});
	return { broker, service };
}

describe("ValidateEntity", () => {
	let broker: ServiceBroker;
	afterEach(() => broker.stop());

	it("lets a valid update through", async () => {
		({ broker } = setup());
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30 }) as any;
		const res = await broker.call("people.update", { id: _id, name: "Anna" }) as any;
		expect(res.name).toBe("Anna");
		expect(res.age).toBe(30);
	});

	it("refuses an update that breaks a required field or a type, and writes nothing", async () => {
		({ broker } = setup());
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30 }) as any;
		await expect(broker.call("people.update", { id: _id, name: "A" })).rejects.toMatchObject({ name: "ValidationError" });
		await expect(broker.call("people.update", { id: _id, age: "old" })).rejects.toMatchObject({ name: "ValidationError" });
		await expect(broker.call("people.update", { id: _id, age: null })).rejects.toMatchObject({ name: "ValidationError" });
		expect(await broker.call("people.get", { id: _id })).toMatchObject({ name: "Ann", age: 30 });
	});

	it("accepts a partial update of other fields", async () => {
		({ broker } = setup());
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30 }) as any;
		await expect(broker.call("people.update", { id: _id, age: 31 })).resolves.toMatchObject({ name: "Ann", age: 31 });
	});

	it("applies dot-notation updates onto the stored entity", async () => {
		({ broker } = setup({ useDotNotation: true }));
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30, address: { city: "Rome" } }) as any;
		await expect(broker.call("people.update", { id: _id, address: { city: 5 } })).rejects.toMatchObject({ name: "ValidationError" });
		const ok = await broker.call("people.update", { id: _id, address: { city: "Milan" } }) as any;
		expect(ok.address).toEqual({ city: "Milan" });
		expect(ok.name).toBe("Ann");
	});

	it("works with a function entityValidator and keeps its error", async () => {
		const seen: any[] = [];
		const entityValidator = async (entity: any) => {
			seen.push(entity);
			if (entity.age < 0) throw new Error("negative age");
		};
		({ broker } = setup({ entityValidator }));
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30 }) as any;
		await expect(broker.call("people.update", { id: _id, age: -1 })).rejects.toThrow("negative age");
		await broker.call("people.update", { id: _id, age: 40 });
		expect(seen[seen.length - 1]).toEqual({ name: "Ann", age: 40 });
		expect(await broker.call("people.get", { id: _id })).toMatchObject({ age: 40 });
	});

	it("keeps the 404 for an unknown id", async () => {
		({ broker } = setup());
		await broker.start();
		await expect(broker.call("people.update", { id: "nope", name: "Ann" })).rejects.toMatchObject({ code: 404 });
	});

	it("runs the service's own beforeEntityUpdate first and validates its result", async () => {
		({ broker } = setup({}, { beforeEntityUpdate: (p: any) => ({ ...p, age: "forced" }) }));
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "Ann", age: 30 }) as any;
		await expect(broker.call("people.update", { id: _id, name: "Anna" })).rejects.toMatchObject({ name: "ValidationError" });
	});

	it("does nothing without an entityValidator", async () => {
		({ broker } = setup({ entityValidator: null }));
		await broker.start();
		const { _id } = await broker.call("people.create", { name: "A", age: 1 }) as any;
		await expect(broker.call("people.update", { id: _id, age: "x" })).resolves.toMatchObject({ age: "x" });
	});
});
