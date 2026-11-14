import type { IncomingMessage } from "http";

/**
 * The client address for a route's `rateLimit.key`: the first `X-Forwarded-For` element, else the socket address.
 * Trustworthy only behind a proxy that overwrites the header (ingress-nginx with PROXY protocol does); anything
 * else lets a caller pick its own bucket. Never empty: moleculer-web skips the limit for a falsy key.
 */
export function clientIp(req: IncomingMessage): string {
	const header = req.headers?.["x-forwarded-for"];
	const first = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim();
	return first || req.socket?.remoteAddress || "unknown";
}
