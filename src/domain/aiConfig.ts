/** Shared presentation/configuration only; provider credentials stay in the local engine. */
export const DEFAULT_AI_MODEL='gpt-6.1-sol';
export const DEFAULT_AI_MODEL_LABEL='GPT-6.1 Sol';
const LEGACY_DEFAULT_AI_MODEL='gpt-4.1-mini';

/** Upgrade Atelier's former default while retaining other explicit model choices. */
export function resolveAiModel(value?:string|null):string{
  const model=value?.trim();
  return!model||model===LEGACY_DEFAULT_AI_MODEL?DEFAULT_AI_MODEL:model;
}
export function aiModelLabel(model:string):string{return model===DEFAULT_AI_MODEL?DEFAULT_AI_MODEL_LABEL:model;}
