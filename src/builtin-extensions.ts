/**
 * builtin-extensions.ts — Pi's built-in extensions for subagent sessions.
 */

import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

/**
 * Pi's built-in codemode, tool-search, and MCP extensions, in the shape and
 * order the CLI's `main()` passes them (`dist/extensions/index.js`).
 *
 * Only the CLI loads built-ins; an SDK `DefaultResourceLoader` loads none
 * unless they are supplied, and a subagent is an SDK session. `builtin: true`
 * makes each one the `builtin:<name>` extension resource, so the user's
 * `extensions` setting (`-builtin:mcp`) still disables it, and `replaceable`
 * lets an extension that registers `/mcp` or `codemode` take over, as in the
 * parent session. A bare factory would load as `<inline:…>` and ignore both.
 *
 * Built fresh per call: the MCP factory keeps its servers and connections in
 * its closure, so concurrent subagents must not share one.
 *
 * `llama.cpp` is left out: pi does not export its factory, and as a model
 * provider it reaches subagents through the parent's shared model runtime.
 */
export function builtinExtensions(): InlineExtension[] {
  return [
    { name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
    { name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
    { name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true },
  ];
}
