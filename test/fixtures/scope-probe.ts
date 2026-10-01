import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function scopeProbe(pi: ExtensionAPI) {
  let generation = 0;
  pi.on("before_agent_start", () => {
    generation++;
    for (const prefix of ["permitted", "denied"]) {
      const name = `${prefix}-${generation}`;
      pi.registerTool({
        name, label: name, description: name,
        exposure: "deferred",
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: "text", text: `${name}-EXECUTED` }], details: {} };
        },
      });
    }
  });
  pi.registerTool({
    name: "allowed", label: "allowed", description: "Call two nested tools",
    parameters: Type.Object({}),
    async execute(_id, _args, _signal, _update, ctx) {
      const permitted = await ctx.executeTool(`permitted-${generation}`, {});
      const denied = await ctx.executeTool(`denied-${generation}`, {});
      return {
        content: [{ type: "text", text: JSON.stringify({ permitted, denied }) }],
        details: {},
      };
    },
  });
}
