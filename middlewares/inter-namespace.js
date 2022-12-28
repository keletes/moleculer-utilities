"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const moleculer_1 = require("moleculer");
const lodash_isstring_1 = __importDefault(require("lodash.isstring"));
const lodash_defaultsdeep_1 = __importDefault(require("lodash.defaultsdeep"));
function InterNamespaceMiddleware(opts) {
    if (!Array.isArray(opts))
        throw new Error("Must be an Array");
    let thisBroker;
    const brokers = {};
    return {
        created(broker) {
            thisBroker = broker;
            opts.forEach(nsOpts => {
                if ((0, lodash_isstring_1.default)(nsOpts)) {
                    nsOpts = {
                        namespace: nsOpts
                    };
                }
                const ns = nsOpts.namespace;
                this.logger.info(`Create internamespace broker for '${ns} namespace...'`);
                const brokerOpts = (0, lodash_defaultsdeep_1.default)({}, nsOpts, { nodeID: null, middlewares: null }, this.broker.options);
                brokers[ns] = new moleculer_1.ServiceBroker(brokerOpts);
            });
        },
        // Can be removed once PR [#1173](https://github.com/moleculerjs/moleculer/pull/1173) is implemented.
        //@ts-ignore-errors
        started() {
            return Promise.all(Object.values(brokers).map(b => b.start()));
        },
        // Can be removed once PR [#1173](https://github.com/moleculerjs/moleculer/pull/1173) is implemented.
        //@ts-ignore-errors
        stopped() {
            return Promise.all(Object.values(brokers).map(b => b.stop()));
        },
        call(next) {
            return function (actionName, params, opts = {}) {
                if ((0, lodash_isstring_1.default)(actionName) && actionName.includes("@")) {
                    const [action, namespace] = actionName.split("@");
                    if (brokers[namespace]) {
                        return brokers[namespace].call(action, params, opts);
                    }
                    else if (namespace === thisBroker.namespace) {
                        return next(action, params, opts);
                    }
                    else {
                        throw new Error("Unknown namespace: " + namespace);
                    }
                }
                return next(actionName, params, opts);
            };
        },
    };
}
exports.default = InterNamespaceMiddleware;
;
