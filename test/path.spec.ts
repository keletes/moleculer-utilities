import { addSlashes, normalizePath, removeTrailingSlashes } from "../src/utils/path";

describe("path helpers", () => {
	it("removes one slash from each end", () => {
		expect(removeTrailingSlashes("/api/")).toBe("api");
		expect(removeTrailingSlashes("api")).toBe("api");
		expect(removeTrailingSlashes("//")).toBe("");
	});

	it("adds the slashes that are missing", () => {
		expect(addSlashes("api")).toBe("/api/");
		expect(addSlashes("/api/")).toBe("/api/");
	});

	it("collapses repeated slashes", () => {
		expect(normalizePath("/a//b///c")).toBe("/a/b/c");
	});
});
