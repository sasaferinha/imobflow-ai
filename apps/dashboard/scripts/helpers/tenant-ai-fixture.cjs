// Legacy worker regressions intentionally exercise an absent tenant configuration.
// Dedicated tenant runtime tests use the real scoped reader and test read failures.
const { loadLocalAI } = require('./load-local-ai.cjs');
const { getTenantAISettings } = loadLocalAI('tenant-settings.ts');
module.exports = { legacyTenantAIReader: { readTenantAISettings: async () => getTenantAISettings() } };
