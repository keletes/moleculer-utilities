/**
 * Does `values` contain everything `pattern` asks for? AND of the pattern's fields: objects match as subsets
 * (recursively), scalars and arrays by equality (arrays are compared whole, order included), a field absent from
 * `values` never matches. No operators: a pattern key is always a field name.
 */
export function matchParams(pattern: unknown, values: unknown): boolean {
	if (pattern === undefined) return true;
	if (isPlainObject(pattern)) {
		if (!isPlainObject(values)) return false;
		return Object.keys(pattern).every(
			(field) => Object.prototype.hasOwnProperty.call(values, field) && matchParams(pattern[field], values[field]),
		);
	}
	return deepEqual(pattern, values);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a)) {
		return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => deepEqual(a[k], b[k]));
	}
	return false;
}

/** JSON with sorted object keys: the same rule always hashes to the same counter. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.filter((k) => value[k] !== undefined)
			.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}
