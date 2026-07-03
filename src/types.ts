// Shared types for the kit's chat components (the minimal subset the components themselves
// need — host apps keep their own richer domain types).

// A slash command in the composer's discovery catalog. `source` groups the browse list;
// host apps with a different taxonomy can map into these three buckets.
export type SlashCommand = { name: string; desc: string; source: 'builtin' | 'skill' | 'custom' };
export type CommandsResponse = { available: boolean; commands: SlashCommand[]; counts?: Record<string, number> };
