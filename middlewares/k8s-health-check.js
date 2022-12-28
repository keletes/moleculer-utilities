"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_defaultsdeep_1 = __importDefault(require("lodash.defaultsdeep"));
const http_1 = require("http");
function K8sMiddleware(opts) {
    opts = (0, lodash_defaultsdeep_1.default)(opts, {
        port: 3001,
        readiness: {
            path: "/ready",
        },
        liveness: {
            path: "/live",
        },
    });
    let state = "down";
    let server;
    function handler(req, res) {
        var _a;
        if (req.url == opts.readiness.path || req.url == opts.liveness.path) {
            const resHeader = {
                "Content-Type": "application/json; charset=utf-8",
            };
            const content = {
                state,
                uptime: process.uptime(),
                timestamp: Date.now(),
            };
            if (req.url == ((_a = opts.readiness) === null || _a === void 0 ? void 0 : _a.path)) {
                // Readiness if the broker started successfully.
                // https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-readiness-probes
                res.writeHead(state == "up" ? 200 : 503, resHeader);
            }
            else {
                // Liveness if the broker is not stopped.
                // https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/#define-a-liveness-command
                res.writeHead(state != "down" ? 200 : 503, resHeader);
            }
            res.end(JSON.stringify(content, null, 2));
        }
        else {
            res.writeHead(404, http_1.STATUS_CODES[404], {});
            res.end();
        }
    }
    return {
        created() {
            state = "starting";
            server = (0, http_1.createServer)(handler);
            server.listen(opts.port, (err) => {
                if (err) {
                    return this.broker.logger.error("Unable to start health-check server", err);
                }
                this.broker.logger.info("");
                this.broker.logger.info("K8s health-check server listening on");
                this.broker.logger.info(`    http://localhost:${opts.port}${opts.readiness.path}`);
                this.broker.logger.info(`    http://localhost:${opts.port}${opts.liveness.path}`);
                this.broker.logger.info("");
            });
        },
        // After broker started
        started() {
            state = "up";
        },
        // Before broker stopping
        stopping() {
            state = "stopping";
        },
        // After broker stopped
        stopped() {
            state = "down";
            server.close();
        },
    };
}
exports.default = K8sMiddleware;
;
