import { ServiceSchema } from 'moleculer';
export default function InterNamespaceMiddleware(opts: object): Omit<ServiceSchema, 'name'>;
