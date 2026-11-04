> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Managed LLMs

> Choose an LLM to generate agent responses.

Cartesia manages the model integration, so you do not need a provider account or API key. The catalog includes models from OpenAI, Anthropic and Google Gemini.

## Choose an LLM

[`GET /v1/agents/models`](https://docs.cartesia.ai/api-reference/agents/models/list) returns the models available to your account. Each entry includes its provider, average latency, and token prices.

Set the model by ID:

```json theme={null}
{
  "config": {
    "model": { "id": "gpt-5.4-mini" }
  }
}
```

Changing the model creates a new agent [version](https://docs.cartesia.ai/agents/configuration.md#versions). You can easily switch models in the Playground or through the API to compare candidates.

## Generation settings

`config.model` also accepts two optional settings. Set `temperature` to `null` to use the model's default. Set `max_output_tokens` to `null` for no output-token limit.

* `temperature` ranges from `0` to `1`. Lower values produce more consistent responses; higher values produce more varied responses.
* `max_output_tokens` limits the number of tokens in a response. It ranges from `1` to `4096`.

```json theme={null}
{
  "config": {
    "model": {
      "id": "gpt-5.4-mini",
      "temperature": 0.3,
      "max_output_tokens": 1024
    }
  }
}
```

## Fallback models

If the model fails before it starts responding, the agent falls back to another model. `config.model.fallback_strategy` sets which:

* `{ "type": "auto" }` uses Cartesia-managed fallback models. This is the default.
* `{ "type": "explicit", "ids": [...] }` uses up to three model IDs from `GET /v1/agents/models`, in order.
* `null` disables fallback.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.