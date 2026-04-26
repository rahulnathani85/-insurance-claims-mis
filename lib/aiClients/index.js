// ============================================================
// lib/aiClients/index.js
// ------------------------------------------------------------
// Public surface of the aiClients module. Other parts of the
// codebase should import from here (not from llmClient.js or
// ocrClient.js directly) so we can refactor internals freely.
// ============================================================

export { callLLM, listProviders as listLlmProviders } from './llmClient';
export { extractText, listProviders as listOcrProviders } from './ocrClient';
export { recordAICall } from './aiCallLog';
