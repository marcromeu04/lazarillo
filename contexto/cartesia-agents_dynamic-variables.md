> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Dynamic variables

> Personalize each call with customer data and values from your tools.

Dynamic variables let a managed agent use customer details and other values during a call. To use a variable in your agent's text, write its name inside double braces. For example, set your agent's [welcome message](https://docs.cartesia.ai/agents/configuration.md#instructions-and-greeting) to:

```text theme={null}
Hi {{customer_name}}, how can I help you today?
```

When you supply `customer_name` as `Jordan`, the agent says "Hi Jordan, how can I help you today?"

Custom values come from your call request or a webhook tool response. Cartesia provides system variables, such as `{{system__caller_id}}`, automatically.

> [accordion] Where values can be inserted
>
> | Where | How |
> | - | - |
> | Instruction prompt, welcome message, keyterms, tool and parameter descriptions, and transfer conditions | Write `{{variable_name}}` in the text |
> | [Phone transfer destinations](https://docs.cartesia.ai/agents/system-tools.md#transfer-to-number) | Use `{{variable_name}}` in place of the phone number |
> | [Webhook path, query, and body parameters](https://docs.cartesia.ai/agents/webhook-tools.md#request-schema) and [headers](https://docs.cartesia.ai/agents/webhook-tools.md#headers-and-authentication) | Configure a dynamic variable as the value source, using its name without braces |

Names are case-sensitive and can contain letters, numbers, and underscores, but cannot start with a number.

## Where values come from

### Values you supply

Pass `dynamic_variables` in your [outbound call request](https://docs.cartesia.ai/api-reference/agents/calls/create-outbound-call.md). Use the agent with the welcome message above, along with your own phone number ID and destination:

```json POST /agents/calls theme={null}
{
  "agent_id": "agent_Fo7pKNBUwLZxrTd6jvhpaE",
  "from_number_id": "ap_Q8PRh7lXyZsawXJmN2KcT5",
  "outbound_calls": [{
    "to_number": "+14155550123",
    "dynamic_variables": {
      "customer_name": "Jordan"
    }
  }]
}
```

For [batch calls](https://docs.cartesia.ai/api-reference/agents/call-batches/create-call-batch.md), put values in each recipient's `dynamic_variables`. For [WebSocket sessions](https://docs.cartesia.ai/api-reference/agents/agent-websocket.md), include them in `session_create` from your server.

Values can be text, numbers, or true/false values.

### System variables

Cartesia provides call context automatically. For example, `system__caller_id` contains the caller's phone number, and `system__time` contains the current local time:

```text theme={null}
The local time is {{system__time}}. Use it when discussing opening hours.
```

Choose the agent's time zone under **Settings** in the Playground; it defaults to UTC.

> [accordion] Available system variables
>
> | Variable | Value |
> | - | - |
> | `system__caller_id` | Calling party's phone number |
> | `system__called_number` | Called party's phone number |
> | `system__call_direction` | `inbound` or `outbound` for phone calls |
> | `system__conversation_id` | Cartesia call ID |
> | `system__agent_id` | Agent ID |
> | `system__agent_version_id` | Agent version used for the call |
> | `system__time` | Current time in the agent's time zone |
> | `system__time_utc` | Current UTC time, such as `2026-09-07T15:30:00Z` |
> | `system__timezone` | Agent's time zone |
>
> Phone numbers and call direction are empty when unavailable, including in browser previews. Time values update during the call.

### Tool responses

A webhook tool can save values from its response for the rest of the call. Add an **assignment** to choose which response field to save and which variable to update.

Suppose an order lookup returns:

```json theme={null}
{
  "order": { "id": "A-1001", "status": "shipped" }
}
```

In the Playground, open the webhook tool and add these assignments:

| Variable name | Response path |
| - | - |
| `order_id` | `order.id` |
| `order_status` | `order.status` |

After the lookup succeeds, `{{order_status}}` becomes `shipped` in instructions and tool descriptions. Other webhook tools can use `order_id` as a [parameter value](https://docs.cartesia.ai/agents/webhook-tools.md#request-schema).

For inbound calls, start with a welcome message that works before you know the caller, such as "Thanks for calling. How can I help?" In your [lookup tool](https://docs.cartesia.ai/agents/webhook-tools.md#request-schema), set the phone-number parameter to use `system__caller_id`, then add assignments to save the returned customer details. Instruct the agent when to call the lookup tool. Those details become available after the tool finishes, not before the welcome message.

## Try it in the Playground

1. Add `Hi {{customer_name}}, how can I help?` to the welcome message. As you type a variable name between `{{` and `}}`, the editor suggests custom and system variables.
2. Open **Variables** and set the sample value for `customer_name` to `Jordan`.
3. Click **Preview** to start a test call with these sample values.

Samples are for test calls only. Production calls never use them. You can also save samples through [`config.dynamic_variable_placeholders`](https://docs.cartesia.ai/api-reference/agents/update).

## Important behavior

* Any custom variables used in the welcome message must be available before the call starts.
* If a webhook or phone transfer needs a missing or invalid value, the agent receives a tool error. No request or transfer is made.
* Empty text, `0`, and `false` count as supplied values.

Assignments update values for the current call only. They do not change the agent's saved configuration or supply values for the next call.

In the Playground, open **Calls** and select a call to see its final variable values and assignments. These are also available through [Get call](https://docs.cartesia.ai/api-reference/agents/calls/get-call.md).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.