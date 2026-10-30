"use strict";
// Path helpers the rate limiter needs. They used to be copied out of moleculer-web's internals at install time.
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeTrailingSlashes = removeTrailingSlashes;
exports.addSlashes = addSlashes;
exports.normalizePath = normalizePath;
/** Removes one slash from each end. */
function removeTrailingSlashes(s) {
    if (s.startsWith("/"))
        s = s.slice(1);
    if (s.endsWith("/"))
        s = s.slice(0, -1);
    return s;
}
/** Adds a slash to each end that has none. */
function addSlashes(s) {
    return (s.startsWith("/") ? "" : "/") + s + (s.endsWith("/") ? "" : "/");
}
/** Collapses repeated slashes. */
function normalizePath(s) {
    return s.replace(/\/{2,}/g, "/");
}
