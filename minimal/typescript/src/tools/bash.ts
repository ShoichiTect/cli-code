import type { CoreTool } from "../core/types.js";

export const bashTool: CoreTool = {
  name: "bash",
  description: "Execute a shell command in the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run." },
    },
    required: ["command"],
  },
};
