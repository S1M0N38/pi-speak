# pi-speak

Minimal local text-to-speech for Pi: one `speak` tool, one voice, no settings.

## Requirements

- `ptts >= 0.5.0` on `PATH` — `brew install gradium-ai/tap/ptts`, `uv tool install ptts`, or a standalone binary from the [releases page](https://github.com/gradium-ai/xn-ptts/releases). For a standalone binary, download the `ptts-<version>-<target>` archive for your OS/arch and put `ptts` on `PATH`.
- A WAV player on `PATH`: `afplay` on macOS, `pw-play`/`paplay`/`aplay` on Linux, PowerShell on Windows

## Install

```bash
pi install ssh://git@github.com/s1m0n38/pi-speak
```

Run this once to download the q4k weights and check that `ptts` is installed and
on `PATH`:

```bash
ptts --device cpu --threads 4 --lang en --quant q4k --voice Easton --rewrites all --output pi-speak-smoke.wav -- "pi-speak is installed and ready."
```

The first run downloads about 53 MB of weights into `ptts`'s Hugging Face cache.
Play `pi-speak-smoke.wav` with your platform player, then delete it.

## Usage

Ask the agent to speak, or call the `speak` tool with text. The tool blocks until playback finishes. There are no commands, keybindings, or settings. Audio is generated locally and never leaves the machine.

## Development

```bash
npm install --ignore-scripts
pi -e /absolute/path/to/pi-speak
npm test
```

Tests use real `ptts` and a real player, may make sound, and may download the model on first run. Node >= 22.6 is required.
