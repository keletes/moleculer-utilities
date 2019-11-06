"use strict";

module.exports = {
  middlewares: {
    InterNamespace: require("./middlewares/inter-namespace.js"),
    K8sHealthCheck: require("./middlewares/k8s-health-check.js")
  }
}