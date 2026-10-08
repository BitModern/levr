// Runtime client barrel
export { createClient } from './client.js';
// Default client instance. Point it elsewhere with `client.setConfig()`.
import { createClient } from './client.js';
const defaultConfig = {
    baseUrl: 'https://api.levr.one',
};
export const client = createClient(defaultConfig);
