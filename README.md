# pi-speak

Minimal local text-to-speech for Pi: one `speak` tool that blocks until playback ends.

## Requirements

- `ptts >= 0.5.0` on `PATH` — `brew install gradium-ai/tap/ptts`, `uv tool install ptts`, or a standalone binary from the [releases page](https://github.com/gradium-ai/xn-ptts/releases). For a standalone binary, download the `ptts-<version>-<target>` archive for your OS/arch and put `ptts` on `PATH`.
- A WAV player on `PATH`:

| Platform | Player |
|---|---|
| macOS | `afplay` (built in) |
| Linux | `pw-play`, `paplay`, or `aplay` |
| Windows | PowerShell |

## Install

```bash
pi install ssh://git@github.com/s1m0n38/pi-speak
```

The first synthesis downloads about 53 MB of q4k weights into `ptts`'s own Hugging Face cache. `pi-speak` never sets `HF_HOME`, so the weights stay wherever `ptts` puts them.

## Usage

Ask the agent to read something aloud. It calls the `speak` tool, which synthesises with `ptts` (voice `Easton`, English, q4k, CPU) and returns only after playback finishes. Sibling calls run one at a time; there is no queue.

There are no settings, no keybindings, no `/speak` command, and no configuration file. Text is passed to `ptts` unchanged: no summarising, no markdown stripping, no chunking. A single call is capped at 4,000 characters and fails instead of truncating.

Audio is generated locally and never leaves the machine.

## Development

```bash
npm install --ignore-scripts
pi -e /absolute/path/to/pi-speak
npm test
```

`npm test` typechecks and then runs the end-to-end suite against real `ptts` and a real player. Tests may make sound and may download the model on first run. Node >= 22.6 is required.
