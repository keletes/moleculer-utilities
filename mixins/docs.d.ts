import type { ServiceSchema } from "moleculer";
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
/** Reads and checks every topic. Throws on the first malformed file, so a broken doc stops the service from starting. */
export declare function loadDocs(dir: string): Array<DocTopic & {
    markdown: string;
}>;
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
export declare function Docs(options: DocsOptions): Partial<ServiceSchema>;
