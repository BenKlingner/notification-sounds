/// <reference types="node" />
import { execFile } from "node:child_process";
import path from "node:path";
import { z } from "zod";

// Keep scripts in the server bundle: Paseo need not copy auxiliary script files.
// Application/session identifiers are data, never interpolated into executable code.
const MAC_SCRIPT = String.raw`
function run(argv) {
  var request = JSON.parse(argv[0]);
  var ids = ['com.apple.Music', 'com.spotify.client'];
  function running(id) {
    try {
      var app = Application(id);
      return app.running() ? app : null;
    } catch (error) { return null; } // An uninstalled app must not prevent discovery.
  }
  if (request.action === 'list') {
    return JSON.stringify(ids.filter(function(id) { return running(id) !== null; }));
  }
  if (ids.indexOf(request.id) === -1) return JSON.stringify(false);
  var app = running(request.id);
  if (!app) return JSON.stringify(request.action === 'status' ? null : false);
  var state = app.playerState(); // Automation denial propagates; never claim a pause.
  if (request.action === 'status') {
    return JSON.stringify(state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : 'Stopped');
  }
  if (request.action === 'Pause' && state === 'playing') {
    app.pause();
    return JSON.stringify(true);
  }
  if (request.action === 'Play' && state === 'paused') {
    app.play();
    return JSON.stringify(true);
  }
  return JSON.stringify(false);
}
`;

// Windows PowerShell 5.1 has the .NET Framework WinRT projection; pwsh 7 does not.
// SourceAppUserModelId is not a unique session ID. Refuse ambiguous matches both
// at discovery and immediately before control, rather than selecting an arbitrary tab.
const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and
  $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1'
} | Select-Object -First 1
function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(2000)) { throw 'Media request timed out.' }
  return $task.GetAwaiter().GetResult()
}
function Invoke-Media($request) {
  $manager = Await ($managerType::RequestAsync()) $managerType
  $sessions = @($manager.GetSessions())
  if ($request.action -eq 'list') {
    $ids = @($sessions | ForEach-Object { $_.SourceAppUserModelId })
    return ,@($ids | Where-Object {
      $id = $_
      $id -and $id -notmatch 'paseo' -and @($ids | Where-Object { $_ -ceq $id }).Count -eq 1
    })
  }
  $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -ceq $request.id })
  if ($matches.Count -ne 1 -or $request.id -match 'paseo') {
    if ($request.action -eq 'status') { return $null }
    return $false
  }
  $session = $matches[0]
  $info = $session.GetPlaybackInfo()
  $state = $info.PlaybackStatus.ToString()
  if ($request.action -eq 'status') { return $state }
  if ($request.action -eq 'Pause' -and $state -eq 'Playing' -and $info.Controls.IsPauseEnabled) {
    return (Await ($session.TryPauseAsync()) ([bool]))
  }
  if ($request.action -eq 'Play' -and $state -eq 'Paused' -and $info.Controls.IsPlayEnabled) {
    return (Await ($session.TryPlayAsync()) ([bool]))
  }
  return $false
}
try {
  $request = $env:PASEO_MEDIA_REQUEST | ConvertFrom-Json
  $result = Invoke-Media $request
  ConvertTo-Json -InputObject $result -Compress -Depth 4
} catch {
  [Console]::Error.WriteLine('Windows media control unavailable.')
  exit 1
}
`;

type Action = "list" | "status" | "Pause" | "Play";

async function request(action: Action, id?: string): Promise<unknown> {
  const input = JSON.stringify({ action, ...(id === undefined ? {} : { id }) });
  const windows = process.platform === "win32";
  // Use the system copy instead of a PowerShell executable from the workspace PATH.
  const executable = windows
    ? path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "/usr/bin/osascript";
  const args = windows
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64")]
    : ["-l", "JavaScript", "-e", MAC_SCRIPT, input];
  const output = await new Promise<string>((resolve, reject) => {
    execFile(executable, args, {
      timeout: 6000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      ...(windows ? { env: { ...process.env, PASEO_MEDIA_REQUEST: input } } : {}),
    }, (error, stdout) => {
      if (error) reject(new Error("Desktop media control failed. Check the platform setup instructions."));
      else resolve(stdout);
    });
  });
  return JSON.parse(output.trim());
}

export const desktopMediaHelp = process.platform === "darwin"
  ? "macOS supports Apple Music and Spotify, not browser videos. Allow Automation access when prompted; review System Settings > Privacy & Security > Automation if control is denied."
  : "Windows requires Windows 10 version 1809 or later, Windows PowerShell 5.1, and a logged-in desktop. Only apps exposing Windows media controls are supported; ambiguous sessions from the same app are skipped.";

export const desktopMedia = {
  async listPlayers(): Promise<string[]> {
    const ids = z.array(z.string().min(1).max(1024)).max(1024).parse(await request("list"));
    return ids.filter(id => !/paseo/i.test(id) && ids.indexOf(id) === ids.lastIndexOf(id));
  },
  async playbackStatus(id: string): Promise<string | null> {
    return z.string().max(64).nullable().parse(await request("status", id));
  },
  async control(id: string, method: "Pause" | "Play"): Promise<boolean> {
    return z.boolean().parse(await request(method, id));
  },
};
