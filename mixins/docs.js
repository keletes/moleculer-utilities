"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDocs = loadDocs;
exports.Docs = Docs;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const moleculer_1 = require("moleculer");
const { MoleculerClientError } = moleculer_1.Errors;
const TOPIC_ID = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const MAX_BYTES = 256 * 1024;
function files(dir) {
    return (0, fs_1.readdirSync)(dir).flatMap(name => {
        const path = (0, path_1.join)(dir, name);
        return (0, fs_1.statSync)(path).isDirectory() ? files(path) : name.endsWith(".md") ? [path] : [];
    });
}
/** `---` / `key: value` lines / `---` at the top of the file; the rest is the markdown. */
function split(path, text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (!match)
        throw new Error(`${path}: the file must start with a front matter block (--- title and summary ---)`);
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = /^([a-z]+):\s*(.*)$/.exec(line);
        if (pair)
            meta[pair[1]] = pair[2].trim();
    }
    return { meta, markdown: match[2] };
}
/** Reads and checks every topic. Throws on the first malformed file, so a broken doc stops the service from starting. */
function loadDocs(dir) {
    const topics = files(dir).sort().map(path => {
        const id = (0, path_1.relative)(dir, path).slice(0, -".md".length).split(path_1.sep).join("/");
        if (!TOPIC_ID.test(id))
            throw new Error(`${path}: the name must be lowercase letters, digits, - and _`);
        const text = (0, fs_1.readFileSync)(path, "utf8");
        if (Buffer.byteLength(text) > MAX_BYTES)
            throw new Error(`${path}: larger than ${MAX_BYTES} bytes`);
        const { meta, markdown } = split(path, text);
        if (!meta.title || !meta.summary)
            throw new Error(`${path}: the front matter needs a title and a summary`);
        return { id, title: meta.title, summary: meta.summary, hash: (0, crypto_1.createHash)("sha256").update(markdown).digest("hex"), markdown };
    });
    if (!topics.length)
        throw new Error(`${dir}: no markdown files`);
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
function Docs(options) {
    const visibility = options.visibility ?? "public";
    let pages = new Map();
    let index = { version: options.version, topics: [] };
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
                handler() {
                    return index;
                },
            },
            "docs.get": {
                visibility,
                params: { topic: { type: "string", max: 200 } },
                handler(ctx) {
                    const page = pages.get(ctx.params.topic);
                    if (!page)
                        throw new MoleculerClientError("No such topic.", 404, "ERR_NO_TOPIC");
                    return page;
                },
            },
        },
    };
}
