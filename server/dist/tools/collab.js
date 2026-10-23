export const collabTool = {
    name: "collab",
    description: "Live collaboration: open a shared session on your LAN so other people can " +
        "view or edit along with you. Owner-only controls: create room, close room, " +
        "set read-only, grant edit rights. Returns an invite link.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: [
                    "status",
                    "create_room",
                    "close_room",
                    "set_readonly",
                    "roster",
                    "set_role",
                    "rename",
                ],
                description: "What to do",
            },
            value: { type: "boolean", description: "Value for set_readonly" },
            id: { type: "string", description: "Member id for set_role / rename" },
            role: { type: "string", enum: ["editor", "viewer"], description: "New role for set_role" },
            name: { type: "string", description: "New display name for rename" },
        },
        required: ["action"],
    },
    async execute(args, ctx) {
        const collab = ctx.collab;
        if (!collab)
            return "Collaboration hub unavailable.";
        switch (args.action) {
            case "status": {
                const s = collab.state();
                const lines = ["## Collaboration", ""];
                lines.push(`  Room: ${s.room ?? "(none — host only)"}`);
                lines.push(`  Read-only: ${s.readOnly ? "yes" : "no"}`);
                lines.push(`  Members: ${s.members.length}`);
                if (s.url)
                    lines.push(`  Invite link: ${s.url}`);
                if (s.lan)
                    lines.push(`  LAN address: ${s.lan}`);
                if (s.port)
                    lines.push(`  Port: ${s.port}`);
                return lines.join("\n");
            }
            case "create_room": {
                if (collab.state().room)
                    return `Room already open: ${collab.state().room}`;
                const code = collab.createRoom();
                const s = collab.state();
                return `Room opened: ${code}\nInvite link: ${s.url ?? "(no LAN IP detected)"}`;
            }
            case "close_room": {
                const code = collab.closeRoom();
                if (!code)
                    return "No room was open.";
                return `Room ${code} closed. Remote participants have been disconnected.`;
            }
            case "set_readonly": {
                collab.setReadOnly(!!args.value);
                return `Read-only mode: ${collab.state().readOnly ? "ON (viewers only)" : "OFF"}`;
            }
            case "roster": {
                const members = collab.list();
                if (!members.length)
                    return "No participants connected.";
                const lines = ["## Participants", ""];
                for (const m of members) {
                    const focus = m.file ? ` — ${m.file}${m.line ? `:${m.line}` : ""}` : "";
                    lines.push(`  ${m.name} (${m.color}) · ${m.role}${m.local ? " · you" : ""}${focus}`);
                }
                return lines.join("\n");
            }
            case "set_role": {
                if (!args.id || !args.role)
                    return "Error: id and role required";
                const m = collab.setRole(args.id, args.role);
                if (!m)
                    return `Unknown member: ${args.id}`;
                return `${m.name} is now ${m.role}.`;
            }
            case "rename": {
                if (!args.id || !args.name)
                    return "Error: id and name required";
                const m = collab.rename(args.id, args.name);
                if (!m)
                    return `Unknown member: ${args.id}`;
                return `Renamed to ${m.name}.`;
            }
            default:
                return `Unknown action: ${args.action}`;
        }
    },
};
