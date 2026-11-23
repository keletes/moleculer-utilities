import { ServiceSchema } from "moleculer";

type Schema = Omit<ServiceSchema, "name">;
type AnyObject = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Applies one `$set` entry on a copy, copying only the objects along the path (the stored entity is never mutated).
function setPath(target: AnyObject, path: string[], value: unknown): AnyObject {
	const [head, ...rest] = path;
	const copy: AnyObject = Array.isArray(target) ? [...target] : { ...target };
	if (!rest.length) copy[head] = value;
	else {
		const child = copy[head];
		copy[head] = setPath(child !== null && typeof child === "object" ? child : {}, rest, value);
	}
	return copy;
}

// Same as moleculer-db's `useDotNotation` flattening: plain objects become dotted keys, anything else is kept as is.
function flatten(obj: AnyObject, prefix = ""): AnyObject {
	const out: AnyObject = {};
	for (const key of Object.keys(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];
		if (value && typeof value === "object" && value.constructor === Object) Object.assign(out, flatten(value, path));
		else out[path] = value;
	}
	return out;
}

/**
 * Mixin for `moleculer-db`: the entity is validated on every write. moleculer-db runs `settings.entityValidator` on
 * create and insert; this mixin adds update: the stored entity with the changes applied is passed to
 * `this.validateEntity` before anything is written, and its error is thrown unchanged.
 *
 * Put it after the DbService mixin: `mixins: [DbService, ValidateEntity()]`. It adds no settings: it uses
 * `settings.entityValidator` (a function, or a schema compiled by `broker.validator`) and does nothing without one.
 * The id field(s) (`_id` and `settings.idField`) are left out of the validated entity: the id is not a change.
 *
 * Hook point: moleculer-db's `_update` calls `this.beforeEntityChange("update", params, ctx)` first, which runs the
 * service's own `beforeEntityUpdate` and hands its result to the write. Wrapping that method (in `created`, so the
 * result does not depend on the mixin order) validates exactly what would be written, after the service's own hook,
 * and leaves `_update` (the write, `entityUpdated`, transforms, the 404 for an unknown id) untouched.
 */
export default function ValidateEntity(): Schema {
	return {
		created(this: AnyObject) {
			const beforeEntityChange = this.beforeEntityChange;
			if (typeof beforeEntityChange !== "function" || typeof this.validateEntity !== "function") {
				throw new Error("ValidateEntity must be used together with the moleculer-db mixin");
			}

			this.beforeEntityChange = async (type: string, entity: AnyObject, ctx: unknown) => {
				const params = await beforeEntityChange.call(this, type, entity, ctx);
				// moleculer-db compiles a schema object into a function in its own `created`; the validator is
				// read at call time, so the mixin order does not matter.
				if (type !== "update" || typeof this.settings.entityValidator !== "function") return params;

				const idField: string = this.settings.idField;
				let id: unknown;
				const sets: AnyObject = {};
				for (const prop of Object.keys(params)) {
					if (prop === "id" || prop === idField) id = this.decodeID(params[prop]);
					else sets[prop] = params[prop];
				}

				const stored = await this.adapter.findById(id);
				if (!stored) return params; // unknown id: _update answers with its own 404

				// The entity as `create` would have seen it: the stored fields without the ids.
				let merged: AnyObject = { ...stored };
				delete merged._id;
				delete merged[idField];

				if (this.settings.useDotNotation) {
					for (const [path, value] of Object.entries(flatten(sets))) merged = setPath(merged, path.split("."), value);
				} else {
					merged = { ...merged, ...sets };
				}

				await this.validateEntity(merged);
				return params;
			};
		},
	};
}
