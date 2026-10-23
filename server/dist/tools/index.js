import { MCP_TOOL_PREFIX } from "../infra/mcp.js";
import { bashTool } from "./bash.js";
import { doctorTool } from "./doctor.js";
import { generateImageTool } from "./image.js";
import { agentsTool } from "./agents.js";
import { browserTool } from "./browser.js";
import { expoStartTool, expoQrTool, expoInitTool, expoBuildTool, expoDoctorTool, expoInstallTool, expoStopTool } from "./expo.js";
import { templateTool } from "./templates.js";
import { testRunnerTool } from "./test-runner.js";
import { computerUseTool } from "./computer-use.js";
import { visualAgentTool } from "./visual-agent.js";
import { sessionExportTool, sessionShareTool } from "./session-export.js";
import { codeReviewTool } from "./code-review.js";
import { autoDocsTool } from "./auto-docs.js";
import { themeTool } from "./theme.js";
import { mobilePreviewTool } from "./mobile-preview.js";
import { collabTool } from "./collab.js";
import { perfProfilerTool } from "./perf-profiler.js";
import { voiceInputTool } from "./voice-input.js";
import { multiModelTool } from "./multi-model.js";
import { ollamaTool } from "./ollama.js";
import { bashOutputTool, killShellTool } from "./shells.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { multiEditTool } from "./multiedit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { webfetchTool } from "./webfetch.js";
import { webSearchTool } from "./websearch.js";
import { todoTool } from "./todo.js";
import { taskTool } from "./task.js";
import { taskBoardTools } from "./tasks.js";
import { skillTool, notifyTool } from "./skill.js";
import { notebookReadTool, notebookEditTool } from "./notebook.js";
import { exitPlanModeTool } from "./exitplan.js";
import { cronTools } from "./cron.js";
import { askUserTool } from "./ask.js";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.js";
import { gitBranchTool, gitCommitTool, gitStashTool, gitRemoteTool, gitPushTool, gitPullTool, gitWorktreeTool, gitConflictTool } from "./git-extra.js";
import { mcpResourcesTool, mcpReadResourceTool, mcpPromptsTool, mcpPromptTool } from "./mcp.js";
import { teamTool, boardPostTool, boardReadTool } from "./team.js";
import { githubPrListTool, githubPrViewTool, githubPrDiffTool, githubPrReviewTool, githubIssueTool } from "./github.js";
import { readPdfTool } from "./pdf.js";
import { lspDefinitionTool, lspReferencesTool, lspHoverTool, lspDiagnosticsTool, lspSymbolsTool } from "./lsp.js";
/** Build a callable Tool from a discovered MCP tool descriptor. */
function makeMcpTool(desc) {
    return {
        name: desc.name,
        description: `[MCP:${desc.server}] ${desc.description}`,
        parameters: desc.inputSchema || { type: "object", properties: {} },
        async execute(args, ctx) {
            if (!ctx.mcp)
                return "Error: MCP is not available.";
            return ctx.mcp.callTool(desc.server, desc.remoteName, args);
        },
    };
}
export class ToolRegistry {
    tools = new Map();
    constructor(opts = {}) {
        const useBase = opts.base !== false;
        if (useBase) {
            for (const t of BASE_TOOLS)
                this.register(t);
        }
    }
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    unregister(name) {
        this.tools.delete(name);
    }
    get(name) {
        return this.tools.get(name);
    }
    all() {
        return [...this.tools.values()];
    }
    /** Register (or refresh) tools discovered from connected MCP servers. */
    registerMcpTools(descs) {
        for (const name of this.all()
            .map((t) => t.name)
            .filter((n) => n.startsWith(MCP_TOOL_PREFIX))) {
            this.unregister(name);
        }
        for (const d of descs)
            this.register(makeMcpTool(d));
    }
    /** Names of the currently registered tools. */
    names() {
        return this.all().map((t) => t.name);
    }
}
/** Build a new registry containing only the named tools from `source`. */
export function subsetRegistry(source, names) {
    const r = new ToolRegistry({ base: false });
    for (const n of names) {
        const t = source.get(n);
        if (t)
            r.register(t);
    }
    return r;
}
const BASE_TOOLS = [
    bashTool,
    doctorTool,
    generateImageTool,
    agentsTool,
    templateTool,
    computerUseTool,
    visualAgentTool,
    sessionExportTool,
    sessionShareTool,
    codeReviewTool,
    autoDocsTool,
    themeTool,
    mobilePreviewTool,
    collabTool,
    perfProfilerTool,
    voiceInputTool,
    multiModelTool,
    testRunnerTool,
    ollamaTool,
    browserTool,
    expoStartTool,
    expoQrTool,
    expoInitTool,
    expoBuildTool,
    expoDoctorTool,
    expoInstallTool,
    expoStopTool,
    bashOutputTool,
    killShellTool,
    readTool,
    writeTool,
    editTool,
    multiEditTool,
    globTool,
    grepTool,
    lsTool,
    webfetchTool,
    webSearchTool,
    todoTool,
    taskTool,
    skillTool,
    notifyTool,
    notebookReadTool,
    notebookEditTool,
    exitPlanModeTool,
    ...taskBoardTools,
    ...cronTools,
    askUserTool,
    gitStatusTool,
    gitDiffTool,
    gitLogTool,
    gitBranchTool,
    gitCommitTool,
    gitStashTool,
    gitRemoteTool,
    gitPushTool,
    gitPullTool,
    gitWorktreeTool,
    gitConflictTool,
    mcpResourcesTool,
    mcpReadResourceTool,
    mcpPromptsTool,
    mcpPromptTool,
    teamTool,
    boardPostTool,
    boardReadTool,
    githubPrListTool,
    githubPrViewTool,
    githubPrDiffTool,
    githubPrReviewTool,
    githubIssueTool,
    readPdfTool,
    lspDefinitionTool,
    lspReferencesTool,
    lspHoverTool,
    lspDiagnosticsTool,
    lspSymbolsTool,
];
export * from "./types.js";
export { collabTool } from "./collab.js";
export { BASE_TOOLS };
