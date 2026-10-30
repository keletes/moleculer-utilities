// The package is installed from a git tag and imported by subpath (moleculer-utilities/mixins ...): the
// built folders at the package root are its public surface, so they are what this checks.
/* eslint-disable @typescript-eslint/no-var-requires */
describe("built package layout", () => {
	it.each([
		["mixins", ["Authorizer", "KeyRateLimiter"]],
		["middlewares", ["InterNamespace", "K8sHealthCheck"]],
		["stores", ["MemoryStore", "RedisStore"]],
	])("%s exports its public names", (folder, names) => {
		const exported = require(`../${folder}`);
		for (const name of names) expect(typeof exported[name]).toBe("function");
	});
});
