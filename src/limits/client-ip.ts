import { isIP } from "net";
import type { IncomingMessage } from "http";

/** Port stripped, IPv4-mapped IPv6 unwrapped, lowercased; "" when it is not an IP address. */
function normalise(raw: string | undefined): string {
	let v = (raw ?? "").trim().toLowerCase();
	const bracket = v.match(/^\[([^\]]+)\](?::\d+)?$/);
	if (bracket) v = bracket[1];
	else if (/^[\d.]+:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
	if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
	return isIP(v) ? v : "";
}

/**
 * The client address for a route's `rateLimit.key`: the first `X-Forwarded-For` element, else the socket address,
 * each normalised (port stripped, `::ffff:` unwrapped, lowercased) and validated with `net.isIP`, so a caller cannot
 * mint buckets with junk strings. When neither is a valid IP the shared `"unknown"` bucket is used (never empty:
 * moleculer-web skips the limit for a falsy key). Trustworthy only behind a proxy that overwrites the header
 * (ingress-nginx with PROXY protocol does).
 */
export function clientIp(req: IncomingMessage): string {
	const header = req.headers?.["x-forwarded-for"];
	const first = (Array.isArray(header) ? header[0] : header)?.split(",")[0];
	return normalise(first) || normalise(req.socket?.remoteAddress) || "unknown";
}
