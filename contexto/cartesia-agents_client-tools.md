> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Client tools

> Run functions in your application over the WebSocket API.

Client tools let an agent trigger actions in the connected application, such as opening a page or reading client-side state. They are available only over the [WebSocket API](https://docs.cartesia.ai/line/integrations/websocket-api.md).

When the model invokes a client tool, the server sends a `client_tool_call` event to the connected browser, mobile app, or server. After running the function, that connected client sends [`client_tool_result`](https://docs.cartesia.ai/api-reference/agents/agent-websocket) to the server when a response is required.

## Define a client tool

```json theme={null}
{
  "type": "client",
  "name": "open_cart",
  "description": "Opens the shopping cart. Use it when the user wants to review or check out their cart.",
  "pre_tool_speech": "auto",
  "execution_mode": "async",
  "expects_response": false,
  "parameters": {
    "type": "object",
    "properties": {
      "cart_id": {
        "type": "string",
        "description": "Cart to open."
      }
    },
    "required": ["cart_id"]
  }
}
```

Create the tool with [`POST /v1/agents/tools`](https://docs.cartesia.ai/api-reference/agents/tools/create), then attach its ID through `config.tools`. See [Tools](https://docs.cartesia.ai/agents/tools.md#execution-settings) for the shared execution settings.

## Parameters

`parameters` must be a JSON Schema object. Properties may use `string`, `integer`, `number`, `boolean`, or an array of one of those scalar types. Use `enum` inside a string property to list its allowed string values. Use `required` to identify values the model must supply.

## Response behavior

* `expects_response: true` makes the agent wait for a `client_tool_result` with the same `tool_call_id`. Use it when the result affects the conversation.
* `expects_response: false` completes the tool after dispatch. Use it for client-side actions that the agent does not need to confirm.

When `expects_response` is `true`, Cartesia waits up to `response_timeout_secs` for the result. If no result arrives, Cartesia automatically supplies `Tool call timed out` to the LLM.

To report its own failure, the connected client sends a result with `is_error: true` and an optional `error_type`.

## Handle a tool call

```javascript theme={null}
// ws is the connection from the WebSocket API quick start.
async function runTool(name, parameters) {
  if (name === "open_cart") {
    // Open the cart in your interface.
    return { opened: true, cart_id: parameters.cart_id };
  }
  throw new Error(`Unknown tool: ${name}`);
}

ws.onmessage = async (message) => {
  const event = JSON.parse(message.data);
  if (event.type !== "client_tool_call") return;

  let result;
  try {
    result = await runTool(event.tool_name, event.parameters);
  } catch (error) {
    console.error("Client tool failed:", error);
    if (event.expects_response) {
      ws.send(JSON.stringify({
        type: "client_tool_result",
        tool_call_id: event.tool_call_id,
        result: "The client tool failed.",
        is_error: true,
      }));
    }
    return;
  }

  if (event.expects_response) {
    ws.send(JSON.stringify({
      type: "client_tool_result",
      tool_call_id: event.tool_call_id,
      result: JSON.stringify(result),
      is_error: false,
    }));
  }
};
```

Results are strings up to 16 KiB. On failure, send `is_error: true` with a short `result` that the LLM can act on. The `result` is what the LLM receives. The optional `error_type` accepts a free-form string up to 256 UTF-8 bytes, such as `timeout`; a longer value discards the result as well. See the [WebSocket event reference](https://docs.cartesia.ai/api-reference/agents/agent-websocket.md) for complete event schemas.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.