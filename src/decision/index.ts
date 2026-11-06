/**
 * Decision-model factory. Resolves provider from config + environment.
 *
 * Precedence: BANTAY_DECISION_PROVIDER env → bantay.config.yml `decision:` → none.
 */

import {
  DecisionError,
  DEFAULT_THRESHOLD,
  type DecisionConfig,
  type DecisionModel,
  type DecisionProvider,
} from "./types";
import { SystemOneModel, JEV_BASE_URL, JEV_DEFAULT_MODEL } from "./systemone";
import { GenerativeDecisionModel, ollamaComplete, anthropicComplete } from "./generative";
import { MockDecisionModel } from "./mock";

export * from "./types";
export { SystemOneModel, JEV_BASE_URL, JEV_DEFAULT_MODEL } from "./systemone";
export { GenerativeDecisionModel, ollamaComplete, anthropicComplete, buildPrompt } from "./generative";
export { MockDecisionModel } from "./mock";

const DEFAULT_KEY_ENV: Partial<Record<DecisionProvider, string>> = {
  jev: "TYPESAFE_API_KEY",
  systemone: "TYPESAFE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export interface ResolvedDecision {
  model: DecisionModel | null;
  provider: DecisionProvider;
  threshold: number;
}

/**
 * Resolve the effective decision config, applying env overrides.
 */
export function resolveDecisionConfig(
  config: DecisionConfig | undefined,
  env: NodeJS.ProcessEnv = process.env
): DecisionConfig {
  const provider = (env.BANTAY_DECISION_PROVIDER as DecisionProvider | undefined) ??
    config?.provider ?? "none";
  return {
    ...config,
    provider,
    model: env.BANTAY_DECISION_MODEL ?? config?.model,
    baseUrl: env.BANTAY_DECISION_BASE_URL ?? config?.baseUrl,
    threshold: env.BANTAY_DECISION_THRESHOLD
      ? Number(env.BANTAY_DECISION_THRESHOLD)
      : config?.threshold ?? DEFAULT_THRESHOLD,
  };
}

/**
 * Build a DecisionModel from config. Returns `model: null` for provider `none`.
 * Throws DecisionError when a provider needs a key that isn't set.
 */
export function createDecisionModel(
  config: DecisionConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch
): ResolvedDecision {
  const c = resolveDecisionConfig(config, env);
  const threshold = c.threshold ?? DEFAULT_THRESHOLD;
  const keyEnv = c.apiKeyEnv ?? DEFAULT_KEY_ENV[c.provider];
  const apiKey = keyEnv ? env[keyEnv] : undefined;

  const needKey = () => {
    if (!apiKey) {
      throw new DecisionError(
        `Decision provider "${c.provider}" needs ${keyEnv} in the environment`,
        c.provider
      );
    }
    return apiKey;
  };

  switch (c.provider) {
    case "none":
      return { model: null, provider: "none", threshold };

    case "jev":
      return {
        provider: "jev",
        threshold,
        model: new SystemOneModel({
          name: "jev",
          baseUrl: c.baseUrl ?? JEV_BASE_URL,
          model: c.model ?? JEV_DEFAULT_MODEL,
          apiKey: needKey(),
          fetchImpl,
        }),
      };

    case "systemone":
      // Any System One–compatible endpoint: a gateway or a self-hosted
      // open-weight decision model. Key is optional (local hosts).
      return {
        provider: "systemone",
        threshold,
        model: new SystemOneModel({
          name: "systemone",
          baseUrl: c.baseUrl ?? JEV_BASE_URL,
          model: c.model ?? JEV_DEFAULT_MODEL,
          apiKey,
          fetchImpl,
        }),
      };

    case "ollama":
      return {
        provider: "ollama",
        threshold,
        model: new GenerativeDecisionModel(
          "ollama",
          c.model ?? "llama3.1",
          ollamaComplete({ baseUrl: c.baseUrl, model: c.model, fetchImpl })
        ),
      };

    case "anthropic":
      return {
        provider: "anthropic",
        threshold,
        model: new GenerativeDecisionModel(
          "anthropic",
          c.model ?? "claude-haiku-5-5",
          anthropicComplete({ apiKey: needKey(), model: c.model, baseUrl: c.baseUrl, fetchImpl })
        ),
      };

    case "mock":
      return { provider: "mock", threshold, model: new MockDecisionModel(c.answers) };

    default:
      throw new DecisionError(`Unknown decision provider "${String(c.provider)}"`, String(c.provider));
  }
}
