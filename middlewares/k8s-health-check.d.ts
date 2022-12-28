import { ServiceSchema } from 'moleculer';
interface Options {
    readiness: {
        path: string;
    };
    liveness: {
        path: string;
    };
    port: string;
}
export default function K8sMiddleware(opts?: Options): Omit<ServiceSchema, 'name'>;
export {};
