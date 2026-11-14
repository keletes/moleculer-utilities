import { ALLOW, GuardedStore, HitResult } from "./base";

/** `LIMITS_STORE=false`: nothing is stored, nothing is ever refused. */
export class NoneAdapter extends GuardedStore {
	protected async doHit(): Promise<HitResult> {
		return { ...ALLOW };
	}
	protected async doAcquire(): Promise<HitResult> {
		return { ...ALLOW };
	}
	protected async doRenew(): Promise<boolean> {
		return false;
	}
	protected async doRelease(): Promise<void> {
		/* nothing */
	}
}
