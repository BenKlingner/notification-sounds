import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, SettingsCard, SettingsInput, SettingsRow, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SOUND_EVENTS, SOUND_EVENT_IDS, type SoundEventId } from "../../shared/events";
import type { SoundRule, SoundSettings } from "../../shared/settings";
import { PageIntro, type SoundSettingsPageProps, useSoundCatalog } from "./common";
import { SoundPicker } from "./sound-picker";

const INHERIT = "inherit";
const FILTER_THRESHOLD = 8;

type RuleKind = "project" | "provider";
type Behavior = "default" | SoundRule["mode"];

interface RuleTarget {
  id: string;
  name: string;
  detail?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "Oh My Pi",
  antigravity: "Antigravity",
  muse: "Muse Code",
  cursor: "Cursor",
  gemini: "Gemini",
};

function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

const BEHAVIOR_OPTIONS: { label: string; value: Behavior }[] = [
  { label: "Use defaults", value: "default" },
  { label: "Custom sounds", value: "custom" },
  { label: "Mute all sounds", value: "muted" },
];

function summarize(rule: SoundRule | undefined): string {
  if (!rule) return "Default";
  if (rule.mode === "muted") return "Muted";
  const count = Object.keys(rule.events).length;
  if (count === 0) return "Custom, nothing changed";
  return `${count} custom sound${count === 1 ? "" : "s"}`;
}

function useTargets(kind: RuleKind) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["notification-sounds", kind === "project" ? "projects" : "providers"],
    queryFn: async (): Promise<RuleTarget[]> => {
      if (kind === "project") {
        const result = await paseo.projects.list();
        return result.projects
          .map((project) => ({
            id: project.projectId,
            name: project.projectCustomName || project.projectDisplayName,
            detail: project.projectRootPath,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
      const result = await paseo.providers.listAvailable();
      return result.providers
        .map((provider) => ({
          id: provider.provider,
          name: providerLabel(provider.provider),
          detail: provider.available ? undefined : "Not installed on this host",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export function createRulesPage(kind: RuleKind) {
  const rulesKey = kind === "project" ? "projectRules" : "providerRules";
  const noun = kind === "project" ? "project" : "provider";

  return function RulesPage({ values, save, preview, player, theme, layout }: SoundSettingsPageProps) {
    const targets = useTargets(kind);
    const catalog = useSoundCatalog();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [filter, setFilter] = useState("");
    const rules = values[rulesKey];

    // Rules whose project or provider is gone stay listed so they can be removed.
    const items = useMemo(() => {
      const known = targets.data ?? [];
      const knownIds = new Set(known.map((target) => target.id));
      const orphans = Object.entries(rules)
        .filter(([id]) => !knownIds.has(id))
        .map(([id, rule]) => ({ id, name: rule.name || id, detail: `No longer on this host` }));
      const query = filter.trim().toLowerCase();
      return [...known, ...orphans].filter(
        (target) => !query || target.name.toLowerCase().includes(query) || target.detail?.toLowerCase().includes(query),
      );
    }, [targets.data, rules, filter]);

    const styles = useMemo(
      () => ({
        header: {
          flexDirection: "row" as const,
          alignItems: "center" as const,
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: layout.compact ? 14 : 12,
        },
        titles: { flex: 1, minWidth: 0 },
        name: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
        detail: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 },
        summary: { color: theme.colors.foregroundMuted, fontSize: 13 },
        summaryActive: { color: theme.colors.accent, fontSize: 13 },
        empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
      }),
      [theme, layout.compact],
    );

    const setRule = (id: string, rule: SoundRule | null) => {
      const next = { ...rules };
      if (rule) next[id] = rule;
      else delete next[id];
      save({ ...values, [rulesKey]: next } as SoundSettings);
    };

    const setBehavior = (target: RuleTarget, behavior: Behavior) => {
      const current = rules[target.id];
      if (behavior === "default") return setRule(target.id, null);
      setRule(target.id, { name: target.name, events: current?.events ?? {}, mode: behavior });
    };

    const setEvent = (target: RuleTarget, rule: SoundRule, event: SoundEventId, value: string) => {
      const events = { ...rule.events };
      if (value === INHERIT) delete events[event];
      else events[event] = value;
      setRule(target.id, { ...rule, name: target.name, events });
    };

    const toggle = (id: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

    // What an event falls back to without this rule. A project's fallback depends on the agent's
    // provider, so it is described rather than named.
    const inheritLabel = (event: SoundEventId) => {
      if (kind === "project") return "Use provider rule or default";
      const global = values.events[event];
      return `Default (${global.enabled ? catalog.labelOf(global.sound) : "off"})`;
    };
    const inheritHint =
      kind === "project"
        ? "Falls back to a matching provider rule, then the Events tab."
        : "Falls back to the Events tab.";

    const total = (targets.data?.length ?? 0) + Object.keys(rules).length;

    return (
      <View style={{ gap: layout.compact ? 12 : 16 }}>
        <PageIntro theme={theme}>
          {kind === "project"
            ? "Mute a project or give it its own sounds. A project rule covers every workspace and worktree in it, and wins over provider rules."
            : "Give each agent provider, such as Claude Code or Codex, its own sounds or mute it. Project rules win over these."}
        </PageIntro>

        {total > FILTER_THRESHOLD ? (
          <SettingsCard>
            <SettingsInput label={`Find a ${noun}`} placeholder="Type to filter" onChangeText={setFilter} />
          </SettingsCard>
        ) : null}

        {targets.isPending ? <Text style={styles.empty}>Loading…</Text> : null}
        {targets.error ? (
          <Text style={{ color: theme.colors.statusDanger }}>Could not load {noun}s: {String(targets.error)}</Text>
        ) : null}
        {!targets.isPending && items.length === 0 ? (
          <Text style={styles.empty}>{filter ? `No ${noun}s match.` : `No ${noun}s on this host yet.`}</Text>
        ) : null}

        {items.map((target) => {
          const rule = rules[target.id];
          const open = expanded.has(target.id);
          const behavior: Behavior = rule?.mode ?? "default";
          return (
            <SettingsCard key={target.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${target.name}, ${summarize(rule)}. ${open ? "Collapse" : "Expand"}`}
                onPress={() => toggle(target.id)}
                style={styles.header}
              >
                <View style={styles.titles}>
                  <Text style={styles.name} numberOfLines={1}>
                    {target.name}
                  </Text>
                  {target.detail ? (
                    <Text style={styles.detail} numberOfLines={1}>
                      {target.detail}
                    </Text>
                  ) : null}
                </View>
                {rule?.mode === "muted" ? <Icon name="VolumeX" size={14} color={theme.colors.foregroundMuted} /> : null}
                <Text style={rule?.mode === "custom" ? styles.summaryActive : styles.summary}>{summarize(rule)}</Text>
                <Icon name={open ? "ChevronDown" : "ChevronRight"} size={18} color={theme.colors.foregroundMuted} />
              </Pressable>
              {open ? (
                <SettingsSelect
                  label="Behavior"
                  value={behavior}
                  options={BEHAVIOR_OPTIONS}
                  onValueChange={(next) => setBehavior(target, next)}
                />
              ) : null}
              {open && rule?.mode === "custom"
                ? SOUND_EVENT_IDS.map((event) => {
                    const value = rule.events[event] ?? INHERIT;
                    const missing = value !== INHERIT && !catalog.has(value) && !catalog.custom.isPending;
                    // An inherited sound can be previewed only where the fallback is known.
                    const global = values.events[event];
                    const fallback = kind === "provider" && global.enabled ? global.sound : null;
                    return (
                      <SettingsRow
                        key={event}
                        label={SOUND_EVENTS[event].label}
                        error={missing ? "This sound is no longer available." : null}
                      >
                        <SoundPicker
                          title={`${target.name}: ${SOUND_EVENTS[event].label}`}
                          value={value}
                          onChange={(next) => setEvent(target, rule, event, next)}
                          catalog={catalog}
                          player={player}
                          preview={preview}
                          theme={theme}
                          compact={layout.compact}
                          choices={[{ value: INHERIT, label: inheritLabel(event), hint: inheritHint }]}
                          previewFallback={fallback}
                        />
                      </SettingsRow>
                    );
                  })
                : null}
            </SettingsCard>
          );
        })}
      </View>
    );
  };
}
