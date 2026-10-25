Notification sounds plays a sound inside the Paseo app when something happens to one of your agents. Each event can have its own sound, picked from built-in sounds or from audio files you add. It does not depend on the operating system's notification sound, so it also works where Paseo's built-in notification sound stays silent, such as GNOME on Linux.

Open Settings, Plugins, Notification sounds to configure it. The page has six tabs: General, Events, Projects, Providers, Sound library, and About. About shows the plugin version, author, source and support links, and sound credits. You can also reach the settings from the Command Center with "Notification sounds: settings" and "Notification sounds: project rules".

## Events

Each event can be turned on or off and given its own sound, with a preview button.

- Agent finished: an agent completes its turn and is waiting for you. On by default.
- Agent failed: an agent stops because of an error. On by default.
- Permission needed: an agent asks to run a tool or change modes. On by default.
- Question asked: an agent asks you a question. On by default.
- Plan ready: an agent proposes a plan for you to approve. On by default.
- Agent started working, agent created, and agent archived. Off by default.

Subagents started by other agents are ignored unless you turn on "Include subagents". A repeat limit keeps several agents that finish together from playing the same sound many times.

## Project and provider rules

Rules change the sounds for one project or one agent provider, such as Claude Code or Codex. A rule either mutes every sound, or sets custom sounds for any events you choose; events you leave alone use the next layer. A project rule wins over a provider rule, which wins over the default sound for the event. A project rule covers every workspace and worktree in that project.

The Projects and Providers tabs list everything on the host with a short summary, such as "Default", "Muted", or "2 custom sounds". Select one to expand its settings in place. From a workspace, the Command Center items "Notification sounds: mute this project" and "Notification sounds: unmute this project" do the same without opening settings.

## Sounds

Every sound row has a play button and a picker. The picker opens a searchable list grouped into sections, with a play button on each sound so you can listen before choosing. Star a sound to add it to Favorites, which appears at the top of the picker and of the Sound library tab; favorites are saved with the host's settings. While one preview plays, only your latest pick waits to play next. Disabling or unloading the plugin cancels its audio through Paseo. Built-in sounds are trimmed of silence so previews end promptly.

About 140 recorded sounds are built in, grouped into UI, Musical, Game, Voice, Sci-Fi, Impacts, and Whooshes sections, and the default for each event comes from them. They ship inside the plugin as compact MP3 data, so nothing is downloaded. The original thirteen synthesized sounds are still available under the Classic sections.

The bundled recorded sounds are licensed for distribution with Notification sounds only. Installing this plugin does not grant permission to redistribute those recordings separately or as part of another project. The source, author, and license of each sound are listed in `SOUND-LICENSES.md`.

Your own sounds live in the sound folder, `notification-sounds` inside the Paseo home directory (usually `~/.paseo/notification-sounds`). Each subfolder becomes a section, so a library organized into folders such as Warnings or Success keeps that structure. WAV, MP3, OGG, M4A, AAC, and FLAC files up to 5 MB are accepted. WAV and MP3 are the most portable; other formats depend on your device’s decoder. Imports are limited to 5,000 sounds and 256 MB total, with at most four section levels. Oversized or overly deep files are skipped, and partial imports show a summary. Symbolic links inside the sound folder are not supported. Use the Sound library tab to open the folder, or paste the path of a file or a whole folder on the host machine to copy it in, optionally into a named section. The volume setting applies to built-in sounds, supported PCM/32-bit float WAV files, and MP3 files without CRC protection. Other formats play at their recorded level.

## Pausing other media

Turn on "Allow sounds to pause media" in the General tab to let notifications pause music and videos while they play, then resume them afterward. Turning it on reveals a switch for each event, on by default, so you can pause for "Agent finished" but not for "Agent failed", for example. These per-event choices apply to every project and provider; rules change only which sound plays. Players that were already paused are left alone. The plugin attempts to resume only players it successfully paused that are still paused afterward. It cannot distinguish every manual playback change made during a notification. Overlapping sounds share a pause; a disconnected client’s hold expires after one minute. It acts on the computer running the Paseo daemon and requires Linux, the `gdbus` command, a logged-in desktop session, and media players that support MPRIS, which includes most browsers, Spotify, and VLC. The setting shows how many media players it can see. Up to 16 players are controlled per notification. Media may remain paused while a sound waits behind other Paseo audio.

## Limits

Requires Paseo 0.13.0 or later. Browsers may require a click or a sound preview before allowing audio. Custom audio is transferred from the daemon to the connected client for playback; the plugin does not send it to third-party services.

Sounds play on every device where the Paseo app is open and connected to the host, including phones. Nothing plays while the app is closed or suspended. Settings are shared by every client of the host. Sounds are queued with other Paseo audio, such as voice playback, and play in order. Adding files by path and opening the sound folder act on the machine running the daemon.
