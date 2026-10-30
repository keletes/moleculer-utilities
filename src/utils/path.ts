// Path helpers the rate limiter needs. They used to be copied out of moleculer-web's internals at install time.

/** Removes one slash from each end. */
export function removeTrailingSlashes(s: string): string {
	if (s.startsWith("/")) s = s.slice(1);
	if (s.endsWith("/")) s = s.slice(0, -1);
	return s;
}

/** Adds a slash to each end that has none. */
export function addSlashes(s: string): string {
	return (s.startsWith("/") ? "" : "/") + s + (s.endsWith("/") ? "" : "/");
}

/** Collapses repeated slashes. */
export function normalizePath(s: string): string {
	return s.replace(/\/{2,}/g, "/");
}
