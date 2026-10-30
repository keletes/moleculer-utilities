import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { Errors } from "moleculer";
import type { ServiceSchema } from "moleculer";

const { MoleculerClientError } = Errors;

/** A topic with its content. */
export interface DocTopic {
	/** The path of the file below the folder, without `.md`, always with `/`: `functions`, `ember/helpers`. */
	id: string;
	title: string;
	/** One or two sentences: what the topic is for, so a reader can choose without opening it. */
	summary: string;
	/** SHA-256 of the markdown, hex. Changes whenever the text does. */
	hash: string;
}

/** What `docs.list` answers and the service publishes in its `metadata`. */
export interface DocsIndex {
	version: string;
	topics: DocTopic[];
}

/** What `docs.get` answers. */
export interface DocsPage extends DocTopic {
	version: string;
	markdown: string;
}

export interface DocsOptions {
	/** The folder with the markdown files (searched recursively). */
	dir: string;
	/** The version of the documentation: normally the `version` of the service's package.json. */
	version: string;
	/** Who may call the two actions. `public` (default) reaches other namespaces; no `rest` alias is ever added. */
	visibility?: "published" | "public" | "protected" | "private";
}

const TOPIC_ID = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const MAX_BYTES = 256 * 1024;

function files(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : name.endsWith(".md") ? [path] : [];
	});
}

/** `---` / `key: value` lines / `---` at the top of the file; the rest is the markdown. */
function split(path: string, text: string): { meta: Record<string, string>; markdown: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!match) throw new Error(`${path}: the file must start with a front matter block (--- title and summary ---)`);
	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const pair = /^([a-z]+):\s*(.*)$/.exec(line);
		if (pair) meta[pair[1]] = pair[2].trim();
	}
	return { meta, markdown: match[2] };
}

/** Reads and checks every topic. Throws on the first malformed file, so a broken doc stops the service from starting. */
export function loadDocs(dir: string): Array<DocTopic & { markdown: string }> {
	const topics = files(dir).sort().map(path => {
		const id = relative(dir, path).slice(0, -".md".length).split(sep).join("/");
		if (!TOPIC_ID.test(id)) throw new Error(`${path}: the name must be lowercase letters, digits, - and _`);
		const text = readFileSync(path, "utf8");
		if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${path}: larger than ${MAX_BYTES} bytes`);
		const { meta, markdown } = split(path, text);
		if (!meta.title || !meta.summary) throw new Error(`${path}: the front matter needs a title and a summary`);
		return { id, title: meta.title, summary: meta.summary, hash: createHash("sha256").update(markdown).digest("hex"), markdown };
	});
	if (!topics.length) throw new Error(`${dir}: no markdown files`);
	return topics;
}

/**
 * Serves a folder of markdown as the documentation of a service, for the people and the assistants that author
 * for it. The files live in the service's repo and ship with its image, so they always describe the code that runs.
 *
 * - `metadata.docs` holds the index (version and, per topic, id/title/summary/hash), which travels with the
 *   service's info: small, and enough to know what exists and whether a copy is current.
 * - `docs.list` answers the index; `docs.get({ topic })` answers one topic with its text.
 *
 * Add the two actions to the service's authorization if it has one.
 */
export function Docs(options: DocsOptions): Partial<ServiceSchema> {
	const visibility = options.visibility ?? "public";
	let pages = new Map<string, DocsPage>();
	let index: DocsIndex = { version: options.version, topics: [] };

	return {
		created() {
			pages = new Map();
			for (const { markdown, ...topic } of loadDocs(options.dir))
				pages.set(topic.id, { ...topic, version: options.version, markdown });
			index = {
				version: options.version,
				topics: [...pages.values()].map(({ id, title, summary, hash }) => ({ id, title, summary, hash })),
			};
			this.metadata.docs = index; // in place: the registry entry holds this very object
		},

		actions: {
			"docs.list": {
				visibility,
				handler(): DocsIndex {
					return index;
				},
			},
			"docs.get": {
				visibility,
				params: { topic: { type: "string", max: 200 } },
				handler(ctx: { params: { topic: string } }): DocsPage {
					const page = pages.get(ctx.params.topic);
					if (!page) throw new MoleculerClientError("No such topic.", 404, "ERR_NO_TOPIC");
					return page;
				},
			},
		},
	};
}
