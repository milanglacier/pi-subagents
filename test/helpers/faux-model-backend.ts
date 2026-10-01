import { InMemoryCredentialStore, InMemoryModelsStore, type Model } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { streamSimple } from "./pi-ai.js";

/** Real provider/auth plumbing with in-memory stores and no catalog network. */
export async function fauxModelBackend(model: Model<string>) {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider(model.provider, {
    api: model.api,
    baseUrl: model.baseUrl,
    apiKey: "faux",
    models: [model],
    streamSimple,
  });
  return { modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) };
}
