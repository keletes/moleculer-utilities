import { ServiceBroker, ServiceSchema } from 'moleculer';
import isString from 'lodash.isstring';
import defaultsDeep from 'lodash.defaultsdeep';

export default function InterNamespaceMiddleware(opts: object): Omit<ServiceSchema, 'name'> {
  if (!Array.isArray(opts))
  throw new Error("Must be an Array");

  let thisBroker: ServiceBroker;
  const brokers: {[key: string]: ServiceBroker} = {};

  return {
    created() {
      thisBroker = this.broker;
      opts.forEach(nsOpts => {
        if (isString(nsOpts)) {
          nsOpts = {
            namespace: nsOpts
          };
        }

        const ns: string = nsOpts.namespace;
        this.logger.info(`Create internamespace broker for '${ns} namespace...'`);
        const brokerOpts = defaultsDeep({}, nsOpts, { nodeID: null, middlewares: null }, this.broker.options);
        brokers[ns] = new ServiceBroker(brokerOpts);
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

    call(next: Function) {

      return function(actionName: string, params: object, opts = {}) {

        if (isString(actionName) && actionName.includes("@")) {
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
