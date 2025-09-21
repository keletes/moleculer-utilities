import type { RateLimitSettings } from 'moleculer-web';
import type { ServiceBroker } from 'moleculer';

export abstract class ExtendedRateLimitStore {
	resetTime: number;
	constructor(clearPeriod: number, opts?: RateLimitSettings, broker?: ServiceBroker) { this.resetTime = 0; }
	inc(key: string, setExpire?: boolean): number | Promise<number> {
		return 0;
	}
}
