export const createClientConfig = (config) => ({
    baseUrl: 'https://api.levr.one',
    ...config,
});
export { createClientConfig as default };
