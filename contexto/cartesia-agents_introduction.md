> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Managed Agents

> Create and run realtime voice agents with Cartesia.

Cartesia Managed Agents helps you deploy realtime voice agents with ultra-low latency and industry-leading accuracy. Built on best-in-class speech models, it handles listening, turn-taking, interruptions, tool calls, and knowledge retrieval around the LLM of your choice.

Create and test an agent in the [Playground](https://play.cartesia.ai/agents), or manage the same agents through the [API](https://docs.cartesia.ai/api-reference/agents/create.md). When you create an agent, Cartesia assigns an `agent_id`, a unique identifier for that agent. Reuse this ID for new conversations instead of creating the agent again. Continue using it after restarting the browser, mobile app, or server that connects users to the agent.

During a WebSocket conversation, the connected browser, mobile app, or server uses a live two-way connection to stream audio with Cartesia. For phone calls, telephony connects the agent to the phone network instead.

You can give a voice agent three kinds of tools. See [Tools](https://docs.cartesia.ai/agents/tools.md) for details. System tools are built-in actions that Cartesia handles, such as ending a call. Webhook tools send requests over the web from Cartesia to your server. Client tools are functions that the connected browser, mobile app, or server runs at Cartesia's request.

![Agent configuration page in the Playground showing instructions, welcome message, voice, and LLM settings](https://mintcdn.com/cartesia-2650f86a/wJ-UNaUxIYqQcebi/assets/images/agents/playground-configure.png?fit=max\&auto=format\&n=wJ-UNaUxIYqQcebi\&q=85\&s=f10eb51915951d857cec45275a19203a)

Configure an agent in the Playground: instructions, welcome message, voice, and LLM.

## Explore

> [card] [Agent configuration](https://docs.cartesia.ai/agents/configuration.md)
>
> Set instructions, language, voice, and audio behavior.

> [card] [Managed LLMs](https://docs.cartesia.ai/agents/models.md)
>
> Choose an LLM and generation settings.

> [card] [Tools](https://docs.cartesia.ai/agents/tools.md)
>
> Add built-in actions, webhooks, and client functions.

> [card] [Versions](https://docs.cartesia.ai/agents/configuration.md#versions)
>
> Inspect configuration history and restore an earlier version.

> [card] [Audio integration](https://docs.cartesia.ai/line/integrations/overview.md)
>
> Stream audio from an application or connect a phone number.

> [card] [Evaluations](https://docs.cartesia.ai/line/evaluations/metrics.md)
>
> Measure call quality with built-in and custom metrics.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.