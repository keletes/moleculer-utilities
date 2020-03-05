const { ServiceBroker } = require("moleculer");
const _ = require("lodash");

module.exports = function InterNamespaceMiddleware(opts) {
  if (!Array.isArray(opts))
  throw new Error("Must be an Array");

  let thisBroker;
  const brokers = {};

  return {
    created(broker) {
      thisBroker = broker;
      broker.logger.info("Hi!");
      opts.forEach(nsOpts => {
        if (_.isString(nsOpts)) {
          nsOpts = {
            namespace: nsOpts
          };
        }

        const ns = nsOpts.namespace;
        broker.logger.info(`Create internamespace broker for '${ns} namespace...'`);
        const brokerOpts = _.defaultsDeep({}, nsOpts, { nodeID: null, middlewares: null }, broker.options);
        brokers[ns] = new ServiceBroker(brokerOpts);
      });
    },

    started() {
      return Promise.all(Object.values(brokers).map(b => b.start()));
    },

    stopped() {
      return Promise.all(Object.values(brokers).map(b => b.stop()));
    },

    call(next) {

      return function(actionName, params, opts = {}) {

        if (_.isString(actionName) && actionName.includes("@")) {
          const [action, namespace] = actionName.split("@");

          if (brokers[namespace]) {
            return brokers[namespace].call(action, params, opts);

          } else if (namespace === thisBroker.namespace) {
            return next(action, params, opts);

          } else {
            throw new Error("Unknown namespace: " + namespace);
          }
        }

      return next(actionName, params, opts);
      };
    },
  };
};