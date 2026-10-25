import { ExternalLink, SettingsCard, SettingsSection, useToast } from "@getpaseo/plugin/client/ui";
import { Image, Text, View } from "react-native";
import { ABOUT, ABOUT_LOGO } from "../about-data";
import type { SoundSettingsPageProps } from "./common";

export function AboutPage({ theme, layout }: SoundSettingsPageProps) {
  const toast = useToast();
  const body = { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 };
  const muted = { ...body, color: theme.colors.foregroundMuted };
  const link = { ...body, textDecorationLine: "underline" as const };
  const card = { padding: layout.compact ? 16 : 20, gap: 12 };
  const onLinkError = () => toast.error("Could not open the link. Please try again.");

  return (
    <View style={{ gap: layout.compact ? 20 : 24 }}>
      <Image
        source={{ uri: ABOUT_LOGO.uri }}
        accessibilityLabel="Notification Sounds for Paseo"
        resizeMode="contain"
        style={{
          width: "100%",
          maxWidth: 560,
          aspectRatio: ABOUT_LOGO.aspectRatio,
          alignSelf: "center",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      />
      <View style={{ gap: 8 }}>
        <Text style={muted}>Version {ABOUT.version} · By {ABOUT.author}</Text>
        <Text style={body}>
          Give each agent event its own sound. Hear when work finishes, a question needs your attention,
          or something goes wrong, with sounds you can customize by project and provider.
        </Text>
        <Text style={muted}>Requires Paseo {ABOUT.paseoRequirement}.</Text>
      </View>
      <SettingsSection title="Project">
        <SettingsCard>
          <View style={card}>
            <ExternalLink href={ABOUT.repository} onError={onLinkError}>
              <Text style={link}>View source on GitHub</Text>
            </ExternalLink>
            <ExternalLink href={`${ABOUT.repository}/issues`} onError={onLinkError}>
              <Text style={link}>Report an issue or suggest a feature</Text>
            </ExternalLink>
          </View>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Credits and licenses">
        <SettingsCard>
          <View style={card}>
            <Text style={body}>Plugin code © {ABOUT.copyrightYear} {ABOUT.author}. Licensed under MIT.</Text>
            <ExternalLink href={`${ABOUT.repository}/blob/main/LICENSE`} onError={onLinkError}>
              <Text style={link}>Read the MIT license</Text>
            </ExternalLink>
            <Text style={muted}>
              Recorded sounds are licensed from Envato Elements for use in Notification Sounds.
              They are not covered by the MIT license and may not be extracted, redistributed separately,
              or reused in other projects. Original Classic sounds are synthesized by the plugin.
            </Text>
            <ExternalLink href={`${ABOUT.repository}/blob/main/SOUND-LICENSES.md`} onError={onLinkError}>
              <Text style={link}>Sound credits and license details</Text>
            </ExternalLink>
            <Text style={muted}>
              An independent plugin for Paseo. Not affiliated with or endorsed by the Paseo team.
            </Text>
          </View>
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
