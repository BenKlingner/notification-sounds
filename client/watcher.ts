import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { SoundEventId } from "../shared/events";
import { resolveSound } from "../shared/rules";
import type { SoundPlayer } from "./player";

const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

// The subset of the agent snapshot the watcher reads.
interface WatchedAgent {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string;
  status: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  attentionTimestamp?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
  labels?: Record<string, string>;
  pendingPermissions?: readonly { id: string; kind: string }[];
}

interface AgentState {
  status: string;
  attentionKey: string | null;
  pendingIds: Set<string>;
  archived: boolean;
  subagent: boolean;
  provider: string;
  workspaceId: string | null;
  cwd: string;
}

function stateOf(agent: WatchedAgent): AgentState {
  return {
    status: agent.status,
    attentionKey: agent.requiresAttention
      ? `${agent.attentionReason ?? ""}:${agent.attentionTimestamp ?? ""}`
      : null,
    pendingIds: new Set((agent.pendingPermissions ?? []).map((request) => request.id)),
    archived: Boolean(agent.archivedAt),
    subagent: Boolean(agent.labels?.[PARENT_AGENT_ID_LABEL]),
    provider: agent.provider,
    workspaceId: agent.workspaceId ?? null,
    cwd: agent.cwd,
  };
}

/** Compares two observations of one agent and names the events that happened between them. */
function diff(previous: AgentState | undefined, agent: WatchedAgent, next: AgentState): SoundEventId[] {
  const events: SoundEventId[] = [];
  if (!previous) {
    if (!next.archived) events.push("agentCreated");
  } else {
    if (!previous.archived && next.archived) events.push("agentArchived");
    if (previous.status !== "running" && next.status === "running") events.push("turnStarted");
  }
  if (next.attentionKey && next.attentionKey !== previous?.attentionKey) {
    if (agent.attentionReason === "finished") events.push("finished");
    if (agent.attentionReason === "error") events.push("error");
    // "permission" attention is reported per request below, so questions and plans differ.
  }
  for (const request of agent.pendingPermissions ?? []) {
    if (previous?.pendingIds.has(request.id)) continue;
    events.push(request.kind === "question" ? "question" : request.kind === "plan" ? "plan" : "permission");
  }
  return events;
}

/**
 * Observes the selected host's agent directory and plays the configured sound for each event.
 * The first snapshot, and the fresh snapshot after a reconnect, only set the baseline.
 */
export function watchAgents(client: PluginClientContext, player: SoundPlayer): () => void {
  const lifetime = new AbortController();
  const agents = new Map<string, AgentState>();
  const lastPlayed = new Map<string, number>();
  // A workspace never moves between projects, so each lookup is cached for the session.
  const projectIds = new Map<string, Promise<string | null>>();
  let projectRoots: { at: number; value: Promise<{ id: string; root: string }[]> } | null = null;
  let release: (() => unknown) | null = null;

  /** For an agent without a workspace, the project whose root contains its directory. */
  async function projectIdFromCwd(cwd: string): Promise<string | null> {
    if (!projectRoots || Date.now() - projectRoots.at > 60_000) {
      const value = client.paseo.projects
        .list()
        .then((result) => result.projects.map((project) => ({ id: project.projectId, root: project.projectRootPath })));
      value.catch(() => {
        projectRoots = null;
      });
      projectRoots = { at: Date.now(), value };
    }
    const normalize = (dir: string) => dir.replace(/[\\/]+$/, "");
    const dir = normalize(cwd);
    let best: { id: string; length: number } | null = null;
    for (const { id, root } of await projectRoots.value) {
      const base = normalize(root);
      const inside = dir === base || dir.startsWith(`${base}/`) || dir.startsWith(`${base}\\`);
      if (inside && base.length > (best?.length ?? -1)) best = { id, length: base.length };
    }
    return best?.id ?? null;
  }

  function projectIdOf(workspaceId: string | null, cwd: string): Promise<string | null> {
    if (!workspaceId) return projectIdFromCwd(cwd);
    let cached = projectIds.get(workspaceId);
    if (!cached) {
      cached = client.paseo.workspaces
        .ref(workspaceId)
        .refresh()
        .then((workspace) => {
          if (!workspace) throw new Error("Workspace context is unavailable.");
          return workspace.projectId;
        });
      cached.catch(() => projectIds.delete(workspaceId));
      if (projectIds.size >= 256) projectIds.delete(projectIds.keys().next().value!);
      projectIds.set(workspaceId, cached);
    }
    return cached;
  }

  async function trigger(event: SoundEventId, agent: AgentState) {
    const settings = await player.readSettings();
    if (!settings?.enabled || lifetime.signal.aborted) return;
    if (agent.subagent && !settings.includeSubagents) return;
    let projectId: string | null = null;
    if (Object.keys(settings.projectRules).length) {
      try {
        projectId = await projectIdOf(agent.workspaceId, agent.cwd);
      } catch {
        // Unknown project context must not bypass a project's mute rule.
        return;
      }
    }
    if (lifetime.signal.aborted) return;
    const { sound } = resolveSound(settings, event, { projectId, provider: agent.provider });
    if (sound === "none") return;
    // Different projects can finish together with different sounds; each sound has its own limit.
    const key = `${event}|${sound}`;
    const now = Date.now();
    if (now - (lastPlayed.get(key) ?? 0) < settings.cooldownMs) return;
    for (const [oldKey, at] of lastPlayed) {
      if (now - at >= settings.cooldownMs) lastPlayed.delete(oldKey);
    }
    if (lastPlayed.size >= 512) lastPlayed.delete(lastPlayed.keys().next().value!);
    lastPlayed.set(key, now);
    try {
      await player.play(sound, settings.volume, settings.pauseMedia && settings.events[event].pauseMedia);
    } catch (error) {
      if (lastPlayed.get(key) === now) lastPlayed.delete(key);
      throw error;
    }
  }

  function observe(agent: WatchedAgent) {
    if (agent.internal) return;
    const previous = agents.get(agent.id);
    const next = stateOf(agent);
    agents.set(agent.id, next);
    for (const event of diff(previous, agent, next)) {
      trigger(event, next).catch((error) => {
        if (!lifetime.signal.aborted) console.warn(`[notification-sounds] ${event} sound failed`, error);
      });
    }
  }

  function remove(agentId: string) {
    const previous = agents.get(agentId);
    agents.delete(agentId);
    if (previous && !previous.archived) {
      trigger("agentArchived", previous).catch(() => {});
    }
  }

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return void subscription.release();
      release = () => subscription.release();
      subscription.subscribe({
        snapshot: ({ entries }) => {
          agents.clear();
          for (const { agent } of entries) {
            if (!agent.internal) agents.set(agent.id, stateOf(agent));
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") observe(update.agent);
          else remove(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("[notification-sounds] Agent observation failed", error);
    });

  return () => {
    lifetime.abort();
    void Promise.resolve(release?.()).catch(() => {});
    agents.clear();
    projectIds.clear();
    lastPlayed.clear();
  };
}
