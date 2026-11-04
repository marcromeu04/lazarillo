> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent configuration

> Configure how an agent behaves, listens, speaks, and acts.

An agent's `config` controls its behavior, model, audio, and tools. Set it when you [create an agent](https://docs.cartesia.ai/api-reference/agents/create.md). To change it, send only the fields you want to update with [`PATCH /v1/agents/{agent_id}`](https://docs.cartesia.ai/api-reference/agents/update).

![Agent configuration page in the Playground showing instructions, welcome message, voice, and LLM settings](https://mintcdn.com/cartesia-2650f86a/wJ-UNaUxIYqQcebi/assets/images/agents/playground-configure.png?fit=max\&auto=format\&n=wJ-UNaUxIYqQcebi\&q=85\&s=f10eb51915951d857cec45275a19203a)

The same settings in the Playground: instructions, welcome message, voice, and LLM.

```json theme={null}
{
  "name": "Acme Support",
  "config": {
    "instructions": "You are Acme's support agent. Help callers with orders and returns. Be warm and concise.",
    "initial_message": "Hi, thanks for calling Acme. How can I help?",
    "timezone": "America/Los_Angeles",
    "model": { "id": "gpt-5.4-mini" },
    "language": { "primary": "en" },
    "audio": {
      "input": {
        "noise_suppression": "auto",
        "keyterms": ["Acme", "ProGrip"]
      },
      "output": {
        "voice_id": "e07c00bc-4134-4eae-9ea4-1a55fb45746b",
        "speed": 1.0
      }
    },
    "turn": {
      "inactivity_end_call_secs": 240,
      "inactivity_check_in_secs": 8
    },
    "tools": [{ "id": "agent_tool_5RkP2wZmQ8xTnLc4vB7dHy" }],
    "system_tools": {
      "end_call": {
        "description": null,
        "pre_tool_speech": "force"
      }
    }
  }
}
```

## Instructions and greeting

Use `instructions` to define the agent's role, speaking style, objectives, and limits. A short structure makes the prompt easier to review and maintain:

```text theme={null}
# Identity and personality
You are Acme's friendly and concise support agent.

# Speaking rules
Use short sentences. Ask one question at a time.

# Objectives
Help callers check orders and start returns.

# Guardrails
Never invent order details. Ask for an order number before using the lookup tool.
```

`initial_message` is what the agent says when the call begins. Set it to `null` to wait for the caller to speak first.

Both fields accept [dynamic variables](https://docs.cartesia.ai/agents/dynamic-variables.md), such as `{{customer_name}}`. The agent's instructions use the latest values each time the model responds. The welcome message uses the values available when the call starts. Updates do not rewrite earlier messages in the conversation.

Use **Variables** in the Playground to save samples for test calls, or set `config.dynamic_variable_placeholders` through the API. Production calls never use saved samples.

## Time zone

Set `config.timezone` to an IANA time zone, such as `America/Los_Angeles`, to control `{{system__time}}`. It defaults to `UTC`. In the Playground, choose the time zone under **Settings**.

## Model

`model.id` selects the LLM that generates the agent's responses. `model.temperature` and `model.max_output_tokens` tune its output. See [Managed LLMs](https://docs.cartesia.ai/agents/models.md) for the available models and settings.

## Language

`language.primary` sets the language each call starts in. Use a [supported language or locale](https://docs.cartesia.ai/api-reference/agents/create.md#body-config-language-primary-one-of-0) such as `en`, or `en-GB` for a regional accent.

Configure `language.additional` to allow the agent to switch between the configured languages when the caller asks. Otherwise, calls stay in the primary language.

Set `presets.voice_id` on an additional language to use a different voice.

```json theme={null}
{
  "config": {
    "language": {
      "primary": "en-US",
      "additional": [
        { "code": "es-MX", "presets": { "voice_id": "<spanish_voice_id>" } },
        { "code": "fr" }
      ]
    }
  }
}
```

See [language configuration in Create Agent](https://docs.cartesia.ai/api-reference/agents/create.md#body-config-language) for details.

## Audio input

* `noise_suppression` controls cleanup of incoming audio. Use `auto` for most calls, `max` for noisy environments, or `off` to disable it.
* `keyterms` helps Ink recognize names and domain-specific phrases. See [Improve transcription with keyterms](https://docs.cartesia.ai/use-the-api/stt/keyterms.md). Keyterms affect recognition; a pronunciation dictionary changes how the agent speaks a word.

Dynamic variables in keyterms use the values available at startup; later assignments do not update them.

## Audio output

| Field | Description |
| - | - |
| `voice_id` | Voice used for agent speech. Required. |
| `speed` | Speech speed from `0.6` to `1.5`. `null` uses the voice default. |
| `volume` | Speech volume from `0.5` to `2`. `null` uses the default. |
| `emotion` | Emotion supported by the selected voice. See the [API reference](https://docs.cartesia.ai/api-reference/tts/bytes.md) for available values. |
| `pronunciation_dictionary_id` | [Pronunciation dictionary](https://docs.cartesia.ai/api-reference/pronunciation-dicts/create.md) used when the agent speaks. |
| `background_sound` | Ambient audio with a `file_id` and volume from `0` to `2`. `null` disables it. |

## Turn settings

Set these fields under `config.turn`:

* `inactivity_end_call_secs`: Seconds of inactivity before the agent says a farewell message and ends the call, from `20` to `240`. Defaults to `240`; cannot be `null`.
* `inactivity_check_in_secs`: Seconds of inactivity before the agent checks in, from `5` to `60`. Defaults to `8`. Set to `null` to disable check-ins. When enabled, it must be less than `inactivity_end_call_secs`.

## Speculative generation

To lower response latency, enable `config.speculative_generation`. When enabled, the LLM starts generating a response when the speech-to-text model predicts the caller has finished speaking and emits an [eager end-of-turn event](https://docs.cartesia.ai/use-the-api/stt/turns.md#turn-lifecycle). The agent does not speak or execute tools until the model confirms the turn has ended. If the caller resumes speaking, the agent cancels the speculative response. Discarded responses still consume LLM tokens, so enabling this setting can increase LLM costs.

The setting defaults to `true` for new agents. To disable it, set `AGENT_ID` and `CARTESIA_API_KEY`, then [update the agent](https://docs.cartesia.ai/api-reference/agents/update.md):

```bash theme={null}
curl -X PATCH "https://api.cartesia.ai/v1/agents/$AGENT_ID" \
  -H "X-API-Key: $CARTESIA_API_KEY" \
  -H "Cartesia-Version: 2026-08-14" \
  -H "Content-Type: application/json" \
  -d '{ "config": { "speculative_generation": false } }'
```

Set the value to `true` to enable it again. Omitting the field from an update preserves the agent's current setting.

## Tools

`tools` lists the shared webhook and client tools the agent can invoke, by ID. `system_tools` enables the built-in actions: ending the call, sending DTMF tones, and transferring to a phone number. See [Tools](https://docs.cartesia.ai/agents/tools.md) for how each kind works and how to configure it.

## Versions

When you change an agent's configuration in a way that affects behavior, Cartesia saves a full config snapshot as a version. New calls use the latest version. A call already in progress stays on the version it started with.

Publish from the API or the Playground to save the new configuration. Running the voice agent using the "Preview" button in the Playground does not publish it.

### Version contents

A version contains a complete configuration snapshot and creation metadata:

```jsonc theme={null}
{
  "id": "av_7Hq2mXbK9cLdNfPzR3tWvE",
  "description": "Updated the model",
  "created_at": "2026-08-14T12:34:56.789Z",
  "created_by": "user_123",
  "config": { /* complete agent configuration */ }
}
```

To label a new version, set `version_description` when you update the agent. The version record returns this label as `description`. Metadata-only updates, such as changing the agent's name, do not create versions, and `version_description` is not allowed on them.

### Browse version history

[`GET /v1/agents/{agent_id}/versions`](https://docs.cartesia.ai/api-reference/agents/versions/list) lists versions from newest to oldest. [`GET /v1/agents/{agent_id}/versions/{version_id}`](https://docs.cartesia.ai/api-reference/agents/versions/get) returns one version with its complete configuration.

### Restore a version

To restore a version, read its `config`, then send it through [`PATCH /v1/agents/{agent_id}`](https://docs.cartesia.ai/api-reference/agents/update). That creates a new version instead of rewriting history.

Cartesia validates the configuration again. If it references a resource that has since been deleted, replace that reference before restoring it.

### Referenced resources

Versions store tool and voice IDs, not copies of those resources. Editing a tool affects every agent that references it without creating an agent version. To avoid changing the behavior of earlier versions, create a new tool and attach it instead.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.