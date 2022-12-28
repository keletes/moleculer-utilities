"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const inter_namespace_js_1 = __importDefault(require("./inter-namespace.js"));
const k8s_health_check_js_1 = __importDefault(require("./k8s-health-check.js"));
exports.default = { InterNamespace: inter_namespace_js_1.default, K8sHealthCheck: k8s_health_check_js_1.default };
