"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.K8sHealthCheck = exports.InterNamespace = void 0;
const inter_namespace_js_1 = __importDefault(require("./inter-namespace.js"));
Object.defineProperty(exports, "InterNamespace", { enumerable: true, get: function () { return inter_namespace_js_1.default; } });
const k8s_health_check_js_1 = __importDefault(require("./k8s-health-check.js"));
Object.defineProperty(exports, "K8sHealthCheck", { enumerable: true, get: function () { return k8s_health_check_js_1.default; } });
