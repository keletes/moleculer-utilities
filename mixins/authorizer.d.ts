import { ServiceSchema } from 'moleculer';
interface Options {
    whitelist?: string[];
}
type Schema = Omit<ServiceSchema<Settings>, 'name'>;
interface Settings {
    authorizer: {
        whitelist: [string];
    };
}
export default function Authorizer(opts?: Options): Schema;
export {};
