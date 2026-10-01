import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { parentModelRuntime } from "../../src/parent-model-runtime.js";

describe("parent provider runtime inheritance", () => {
  it("validates the real registry facade and fails clearly if its private field changes", async () => {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const registry = new ModelRegistry(runtime);
    expect(parentModelRuntime(registry)).toBe(runtime);
    Reflect.set(registry, "runtime", undefined);
    expect(() => parentModelRuntime(registry)).toThrow("Cannot inherit parent providers");
  });
});
