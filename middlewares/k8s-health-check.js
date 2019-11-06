"use strict";
const _ = require("lodash");
const http = require("http");
module.exports = function(opts) {
    opts = _.defaultsDeep(opts, {
        port: 3001,
        path: "/health"
    });
let state = "starting";
let server;
function handler(req, res) {
if (req.url == opts.path) {
const resHeader = {
"Content-Type": "application/json; charset=utf-8"
            };
const content = {
                state,
                uptime: process.uptime(),
                timestamp: Date.now()
            };
res.writeHead(state == "up" ? 200 : 503, resHeader);
res.end(JSON.stringify(content, null, 2));
        } else {
res.writeHead(404, http.STATUS_CODES[404], {});
res.end();
        }
    }
return {
created(broker) {
            server = http.createServer(handler);
server.on("request", handler);
server.listen(opts.port, err => {
if (err) {
return broker.logger.error("Unable to start health-check server", err);
                }
broker.logger.info(`Health-check server listening on http://0.0.0.0:${opts.port}${opts.path} address.`);
            });
        },
// After broker started
started(broker) {
            state = "up";
        },
// Before broker stopping
stopping(broker) {
            state = "stopping";
        },
// After broker stopped
stopped(broker) {
            state = "down";
server.close();
        }
    };
}