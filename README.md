# pi-speak

Local text-to-speech for Pi.

## Install

```bash
pi install ssh://git@github.com/s1m0n38/pi-speak
```

## Usage

The extension registers:

- a `speak` tool the agent can call with text, and optional `voice`/`speed` overrides;
- `/speak` for voice, speed, and preprocessing settings;
- `Ctrl+Alt+X` to speak the last agent message.

The first synthesis downloads the Kokoro q4 model (~305 MB) into
`~/.pi/agent/pi-speak-models`. After that, audio is generated locally and never
leaves the machine.

## Preprocessing

`Ctrl+Alt+X` can summarize the last agent message before speaking it. It is off
by default. Run `/speak` and choose `Preprocessing` to enable it with the
current chat model or a specific model.

`~/.pi/agent/pi-speak.json` holds the settings:

```json
{
  "voice": "af_heart",
  "speed": 1,
  "preprocessingEnabled": true,
  "preprocessingModel": { "provider": "openai", "id": "gpt-4o-mini" },
  "preprocessingPrompt": "Summarize this for speech in one sentence."
}
```

Omit `preprocessingModel` to use the active session model. Omit
`preprocessingPrompt` to use the built-in summarization prompt.

## Audio playback

pi-speak uses the first available player:

- macOS: `afplay`, `ffplay`, `mpv`
- Linux: `pw-play`, `paplay`, `aplay`, `ffplay`, `mpv`
- Windows: `ffplay`, PowerShell `SoundPlayer`

It searches `PATH` and common system locations, including Nix profiles. If no
player is found, the error is shown in Pi instead of failing silently.

## Development

```bash
npm install --ignore-scripts
pi -e /absolute/path/to/pi-speak
```

```bash
npm run check   # tsc --noEmit
npm test        # check + compile tests + node --test
```
