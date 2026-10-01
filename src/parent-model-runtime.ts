import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Pi exposes no public runtime accessor on its extension registry facade. */
export function parentModelRuntime(registry: ModelRegistry): ModelRuntime {
  const runtime: unknown = Reflect.get(registry, "runtime");
  if (!(runtime instanceof ModelRuntime)) {
    throw new Error("Cannot inherit parent providers: Pi's model registry does not expose a recognized ModelRuntime.");
  }
  return runtime;
}
