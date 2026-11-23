// The package is installed from GitHub Packages and imported by subpath (@keletes/moleculer-utilities/mixins ...): the
// built folders at the package root are its public surface, so they are what this checks.
/* eslint-disable @typescript-eslint/no-var-requires */
describe("built package layout", () => {
	it.each([
		["mixins", ["Authorizer", "Docs", "ValidateEntity"]],
		["middlewares", ["InterNamespace", "K8sHealthCheck"]],
		[
			"limits",
			[
				"Limits",
				"LimitExceededError",
				"RateLimitStore",
				"clientIp",
				"PodCpuUsage",
				"BusyGuard",
				"resolveStore",
				"MemoryAdapter",
				"RedisAdapter",
				"matchParams",
			],
		],
	])("%s exports its public names", (folder, names) => {
		const exported = require(`../${folder}`);
		for (const name of names) expect(typeof exported[name]).toBe("function");
	});

	it("no longer ships the removed stores subpath nor KeyRateLimiter", () => {
		expect(() => require("../stores")).toThrow();
		expect(require("../mixins").KeyRateLimiter).toBeUndefined();
	});
});
