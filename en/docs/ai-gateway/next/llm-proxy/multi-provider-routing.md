---
title: "Multi-Provider Routing for LLM Proxies"
description: "Route OpenAI-compatible LLM proxy requests to multiple providers using header-based selection and provider-specific transformers."
canonical_url: https://wso2.com/api-platform/docs/ai-gateway/llm-proxy/multi-provider-routing/
md_url: https://wso2.com/api-platform/docs/ai-gateway/llm-proxy/multi-provider-routing.md
tags:
  - ai-gateway
  - llm
  - routing
author: WSO2 API Platform Documentation Team
last_updated: 2026-08-04
content_type: "guide"
---

# Multi-Provider Routing for LLM Proxies

## Overview

Multi-provider routing lets one large language model (LLM) proxy expose a single OpenAI-compatible endpoint while routing each request to a selected LLM provider. Applications continue to use the same endpoint and OpenAI-compatible request format when the upstream provider changes. Non-streaming responses are normalized where supported; streaming compatibility varies by provider.

For example, an application can send all requests to `/openai-multi/chat/completions` and select OpenAI or Anthropic with the `x-provider` request header. The proxy can also distribute requests automatically across provider and model pairs by using round-robin or weighted round-robin routing.

This is useful when you want to:

- Switch providers without changing application code or endpoint URLs
- Compare provider responses using the same OpenAI-compatible request
- Keep vendor credentials in the gateway instead of distributing them to applications
- Apply proxy-level authentication, rate limits, and guardrails consistently across providers
- Introduce provider selection and model suspension through a routing policy

Multi-provider transformation is scoped to the OpenAI Chat Completions request and response model. It does not add cross-provider support for the OpenAI Responses API, embeddings, image generation, audio, assistants, batches, or fine-tuning APIs.

## Choose a Routing Strategy

Choose one provider-selection strategy for each operation unless you have explicitly designed and tested the precedence between multiple routing policies.

| Capability | Header router | Model round robin | Model weighted round robin |
|------------|---------------|-------------------|----------------------------|
| Explicit client or provider choice | Yes | No | No |
| Selects a provider | Yes | Optional per model entry | Optional per model entry |
| Selects and rewrites a model | No | Yes | Yes |
| Uses the primary provider when no provider is selected | Yes | Yes | Yes |
| Suspends a provider/model pair after `429` or `5xx` | No | Yes | Yes |
| Weighted traffic distribution | No | No | Yes |
| Latency-, cost-, or semantic-based routing | No | No | No |
| Retries the failed request on another target | No | No | No |

### Header-based routing

Use `llm-header-router` when the application or an earlier policy must explicitly choose a provider. The router reads a request header, matches its value against an ordered mapping, and publishes the selected provider name.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `mappings` | Yes | None | Ordered list of header values and effective provider names. At least one mapping is required. |
| `headerName` | No | `x-provider` | Header used for provider selection. Header-name lookup is case-insensitive. |
| `defaultProvider` | No | Unset | Provider selected when the header is missing, empty, or unmatched. If unset, the primary provider is used. |

The router has the following selection behavior:

- Uses only the first value when the header appears more than once
- Trims leading and trailing whitespace from the value
- Matches configured values case-insensitively
- Rejects duplicate mapping values case-insensitively
- Preserves a non-empty provider selection made by an earlier policy
- Leaves the routing header on the upstream request

The header router publishes provider-selection metadata but does not by itself override the named upstream. An additional provider therefore needs a matching inline transformer, or another policy that explicitly sets its upstream.

### Model round robin

Use `model-round-robin` to cycle deterministically through a list of models. A model entry can include a `provider` to route that model to an additional provider. When `provider` is omitted, the model uses the primary provider.

```yaml
operationPolicies:
  - name: model-round-robin
    version: v1
    paths:
      - path: /chat/completions
        methods: [POST]
        params:
          models:
            - model: gpt-4o
            - model: claude-sonnet-4-5-20250929
              provider: anthropic-provider
          suspendDuration: 30
```

The policy rewrites the model at the location defined by the provider template. It can rewrite a model in the request payload, a header, a query parameter, or a path parameter.

See [Model Round Robin](load-balancing/model-round-robin.md) for its complete configuration.

### Model weighted round robin

Use `model-weighted-round-robin` to distribute requests in a deterministic weighted cycle. Each entry requires an integer `weight` of at least `1`.

```yaml
operationPolicies:
  - name: model-weighted-round-robin
    version: v1
    paths:
      - path: /chat/completions
        methods: [POST]
        params:
          models:
            - model: gpt-4o
              weight: 2
            - model: claude-sonnet-4-5-20250929
              provider: anthropic-provider
              weight: 1
          suspendDuration: 30
```

This example produces the repeating sequence `gpt-4o`, `gpt-4o`, `claude-sonnet-4-5-20250929` while both targets are available. It provides proportional deterministic distribution, not random or performance-based load balancing.

See [Model Weighted Round Robin](load-balancing/model-weighted-round-robin.md) for its complete configuration.

## Configure Providers

### How provider selection works

A multi-provider LLM proxy has:

- One primary provider in `spec.provider`
- One or more selectable providers in `spec.additionalProviders`
- An LLM Header Router policy (`llm-header-router`) that selects a provider from a request header
- An inline transformer for each additional provider that does not use the OpenAI wire format

The request flow is:

```text
OpenAI-compatible client request
            |
            | x-provider: anthropic
            v
    Multi-provider LLM proxy
            |
            | LLM Header Router selects anthropic-provider
            | openai-to-anthropic transforms the request
            | provider loopback authentication is added
            v
      Anthropic LLM provider
            |
            | vendor authentication is added
            v
        Anthropic API
            |
            | response is transformed to OpenAI format
            v
OpenAI-compatible client response
```

The router writes the selected provider name to request metadata. The gateway conditionally applies only the authentication and transformer associated with that provider. When the selection header is missing, empty, or does not match a configured mapping, the router uses `defaultProvider` when configured; otherwise, the proxy's primary provider is used.

The effective provider name connects routing, transformation, authentication, and upstream selection:

- The primary provider is identified by `spec.provider.id`.
- An additional provider uses `additionalProviders[].as` when an alias is configured; otherwise, it uses `additionalProviders[].id`.
- Router mappings and model-routing entries must use the effective provider name.
- When no provider is selected, the proxy uses its primary provider.
- Authentication and transformation for an additional provider execute only when that provider is selected.
- The controller injects the effective provider name into an inline transformer's `providerId`; do not configure it manually.

### Before you begin

Make sure that:

- The AI Gateway is running and the management API is available at `http://localhost:9090/api/management/v1`.
- You are using an AI Gateway version that supports multi-provider routing and includes the required router and transformer policies.
- You have credentials for each external LLM provider.
- `curl` and `jq` are installed if you want to follow the command-line examples.

This guide configures OpenAI as the primary provider and Anthropic as an additional provider. The same configuration model can be extended to Azure OpenAI, Mistral, Gemini, AWS Bedrock, and other providers supported by your AI Gateway version.

### Understand the authentication layers

Multi-provider routing can involve three different kinds of credentials:

| Credential | Used by | Purpose |
|------------|---------|---------|
| Vendor credential | LLM provider to external vendor | Authenticates the gateway to OpenAI, Anthropic, or another external service |
| Provider loopback key | LLM proxy to LLM provider | Authenticates the proxy when it routes internally to a protected provider |
| Proxy consumer key | Application to LLM proxy | Authenticates the application invoking the public proxy endpoint |

Do not use a vendor API key as a loopback or consumer key. Do not commit any of these credentials to source control.

### Step 1: Deploy the LLM providers

Each provider must exist before a proxy can reference it.

#### Deploy the OpenAI provider

Replace `<openai-api-key>` with an OpenAI API key.

```bash
curl -X POST http://localhost:9090/api/management/v1/llm-providers \
  -u admin:admin \
  -H "Content-Type: application/yaml" \
  --data-binary @- <<'EOF'
apiVersion: gateway.api-platform.wso2.com/v1
kind: LlmProvider
metadata:
  name: openai-provider
spec:
  displayName: OpenAI Provider
  version: v1.0
  template: openai
  context: /providers/openai
  upstream:
    url: https://api.openai.com/v1
    auth:
      type: api-key
      header: Authorization
      value: Bearer <openai-api-key>
  accessControl:
    mode: deny_all
    exceptions:
      - path: /chat/completions
        methods: [POST]
  operationPolicies:
    - name: api-key-auth
      version: v1
      paths:
        - path: /chat/completions
          methods: [POST]
          params:
            key: X-API-Key
            in: header
EOF
```

#### Deploy the Anthropic provider

Replace `<anthropic-api-key>` with an Anthropic API key.

```bash
curl -X POST http://localhost:9090/api/management/v1/llm-providers \
  -u admin:admin \
  -H "Content-Type: application/yaml" \
  --data-binary @- <<'EOF'
apiVersion: gateway.api-platform.wso2.com/v1
kind: LlmProvider
metadata:
  name: anthropic-provider
spec:
  displayName: Anthropic Provider
  version: v1.0
  template: anthropic
  context: /providers/anthropic
  upstream:
    url: https://api.anthropic.com
    auth:
      type: api-key
      header: x-api-key
      value: <anthropic-api-key>
  accessControl:
    mode: deny_all
    exceptions:
      - path: /v1/messages
        methods: [POST]
  operationPolicies:
    - name: api-key-auth
      version: v1
      paths:
        - path: /v1/messages
          methods: [POST]
          params:
            key: X-API-Key
            in: header
EOF
```

The vendor credentials under `spec.upstream.auth` are added only when the provider calls its external service.

### Step 2: Create provider loopback keys

Because both providers in this example use the `api-key-auth` policy, create an API key for each provider. The proxy uses these keys when routing to the providers through the gateway's internal loopback route.

```bash
OPENAI_LOOPBACK_KEY=$(curl -s -X POST \
  http://localhost:9090/api/management/v1/llm-providers/openai-provider/api-keys \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"name":"openai-proxy-loopback"}' \
  | jq -r '.apiKey.apiKey')

ANTHROPIC_LOOPBACK_KEY=$(curl -s -X POST \
  http://localhost:9090/api/management/v1/llm-providers/anthropic-provider/api-keys \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"name":"anthropic-proxy-loopback"}' \
  | jq -r '.apiKey.apiKey')
```

Verify that both commands returned a value:

```bash
test -n "$OPENAI_LOOPBACK_KEY" && test "$OPENAI_LOOPBACK_KEY" != "null"
test -n "$ANTHROPIC_LOOPBACK_KEY" && test "$ANTHROPIC_LOOPBACK_KEY" != "null"
```

API key values are returned only when they are created or regenerated. Store them securely.

### Step 3: Deploy the multi-provider LLM proxy

The following proxy exposes one `/chat/completions` operation. OpenAI is the primary and default provider. Anthropic is an additional selectable provider with an inline request and response transformer.

```bash
curl -X POST http://localhost:9090/api/management/v1/llm-proxies \
  -u admin:admin \
  -H "Content-Type: application/yaml" \
  --data-binary @- <<EOF
apiVersion: gateway.api-platform.wso2.com/v1
kind: LlmProxy
metadata:
  name: openai-multi
spec:
  displayName: OpenAI Multi-Provider Proxy
  version: v1.0
  context: /openai-multi

  provider:
    id: openai-provider
    auth:
      type: api-key
      header: X-API-Key
      value: ${OPENAI_LOOPBACK_KEY}

  additionalProviders:
    - id: anthropic-provider
      auth:
        type: api-key
        header: X-API-Key
        value: ${ANTHROPIC_LOOPBACK_KEY}
      transformer:
        type: openai-to-anthropic
        version: v1
        params:
          model: claude-sonnet-4-5-20250929

  operationPolicies:
    - name: api-key-auth
      version: v1
      paths:
        - path: /chat/completions
          methods: [POST]
          params:
            key: X-API-Key
            in: header

    - name: llm-header-router
      version: v1
      paths:
        - path: /chat/completions
          methods: [POST]
          params:
            headerName: x-provider
            defaultProvider: openai-provider
            mappings:
              - headerValue: openai
                provider: openai-provider
              - headerValue: anthropic
                provider: anthropic-provider
EOF
```

The controller automatically passes the additional provider's effective upstream name to its transformer. Do not add a `providerId` under `transformer.params`; it is injected from `additionalProviders[].id` or `additionalProviders[].as`.

### Step 4: Create a proxy consumer key

The proxy uses `api-key-auth` to protect its public endpoint. Create a key for the application that will invoke it:

```bash
PROXY_CONSUMER_KEY=$(curl -s -X POST \
  http://localhost:9090/api/management/v1/llm-proxies/openai-multi/api-keys \
  -u admin:admin \
  -H "Content-Type: application/json" \
  -d '{"name":"openai-multi-client"}' \
  | jq -r '.apiKey.apiKey')
```

Verify that a key was returned:

```bash
test -n "$PROXY_CONSUMER_KEY" && test "$PROXY_CONSUMER_KEY" != "null"
```

### Step 5: Invoke different providers

All requests use the same URL and OpenAI Chat Completions payload.

#### Invoke the default provider

If `x-provider` is omitted, the router uses `defaultProvider`, which is `openai-provider` in this example.

```bash
curl -k -X POST https://localhost:8443/openai-multi/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${PROXY_CONSUMER_KEY}" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "Explain multi-provider routing in one sentence."
      }
    ]
  }'
```

#### Invoke Anthropic

Set `x-provider` to the configured `headerValue`:

```bash
curl -k -X POST https://localhost:8443/openai-multi/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${PROXY_CONSUMER_KEY}" \
  -H "x-provider: anthropic" \
  -d '{
    "model": "client-model-name",
    "messages": [
      {
        "role": "user",
        "content": "Explain multi-provider routing in one sentence."
      }
    ]
  }'
```

The Anthropic transformer replaces the request's `model` value with the model configured under `transformer.params.model`. It also translates the request to the Anthropic Messages format and translates the response back to the OpenAI response shape.

Header names and mapped header values are matched case-insensitively. Leading and trailing whitespace in the header value is ignored. If the header is missing, empty, or does not match a mapping, the router selects `defaultProvider`.

### Add more providers

Add each selectable provider under `additionalProviders`, then add a corresponding mapping under the LLM Header Router policy (`llm-header-router`).

#### Supported provider transformers

Use a transformer when an additional provider does not accept and return the OpenAI wire format.

| Target provider | Transformer type used in this guide | Purpose |
|-----------------|-------------------------------------|---------|
| Anthropic | `openai-to-anthropic` | Converts OpenAI-compatible requests to Anthropic Messages and converts non-streaming responses back to OpenAI format. |
| Azure OpenAI | `openai-to-azure-openai` | Adapts the request path for an Azure OpenAI deployment and API version. |
| Mistral | `openai-to-mistral` | Normalizes OpenAI-compatible requests and responses for Mistral. |
| Gemini | `openai-to-gemini` | Converts OpenAI-compatible requests and non-streaming responses for Gemini. |
| AWS Bedrock | `openai-to-bedrock-transformer` | Converts OpenAI-compatible requests and Bedrock Converse responses, including streaming responses. |

A transformer is not required when the selected provider already exposes an OpenAI-compatible API.

!!! note "Transformer names and versions"
    Transformer names and major versions can differ between AI Gateway releases. Inspect the policy catalog installed with your gateway and use the name and version exposed there. The examples on this page use the policy names supported by this documentation baseline.

#### Azure OpenAI

```yaml
- id: azure-openai-provider
  auth:
    type: api-key
    header: X-API-Key
    value: <azure-provider-loopback-key>
  transformer:
    type: openai-to-azure-openai
    version: v1
    params:
      model: gpt-4o
      apiVersion: "2024-02-15-preview"
```

#### Mistral

```yaml
- id: mistral-provider
  auth:
    type: api-key
    header: X-API-Key
    value: <mistral-provider-loopback-key>
  transformer:
    type: openai-to-mistral
    version: v1
    params:
      model: mistral-large-latest
```

#### Gemini

```yaml
- id: gemini-provider
  auth:
    type: api-key
    header: X-API-Key
    value: <gemini-provider-loopback-key>
  transformer:
    type: openai-to-gemini
    version: v1
    params:
      model: gemini-2.5-flash
      apiVersion: v1beta
```

#### AWS Bedrock

```yaml
- id: aws-bedrock-provider
  auth:
    type: api-key
    header: X-API-Key
    value: <aws-bedrock-provider-loopback-key>
  transformer:
    type: openai-to-bedrock-transformer
    version: v1
    params:
      model: anthropic.claude-3-5-sonnet-20240620-v1:0
```

For example, the matching router entries are:

```yaml
mappings:
  - headerValue: azure-openai
    provider: azure-openai-provider
  - headerValue: mistral
    provider: mistral-provider
  - headerValue: gemini
    provider: gemini-provider
  - headerValue: aws-bedrock
    provider: aws-bedrock-provider
```

### Use provider aliases

Use `as` when the logical upstream name used by routing policies should differ from the deployed provider ID:

```yaml
additionalProviders:
  - id: anthropic-provider
    as: anthropic-upstream
    auth:
      type: api-key
      header: X-API-Key
      value: <anthropic-provider-loopback-key>
    transformer:
      type: openai-to-anthropic
      version: v1
      params:
        model: claude-sonnet-4-5-20250929
```

When an alias is present, router mappings must select the alias, not the provider ID:

```yaml
mappings:
  - headerValue: anthropic
    provider: anthropic-upstream
```

The alias must:

- Contain only letters, numbers, hyphens, or underscores
- Be between 1 and 100 characters
- Be unique within the proxy
- Not match the primary provider ID or another additional provider's effective name

### Configuration reference

#### `additionalProviders`

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | ID of an already deployed `LlmProvider` |
| `as` | No | Logical upstream name used by routing policies; defaults to `id` |
| `auth` | No | API key authentication used by the proxy when calling the provider's internal route |
| `transformer` | No | Request and response transformer applied only when this provider is selected |

#### `transformer`

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Installed transformer policy name, such as `openai-to-anthropic` |
| `version` | Yes | Major policy version, such as `v1` |
| `params` | No | Transformer-specific parameters, such as `model` or `apiVersion` |

#### LLM Header Router parameters

Use `llm-header-router` as the policy name in the configuration.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `headerName` | No | `x-provider` | Request header used for selection |
| `defaultProvider` | No | Unset | Effective provider name selected when no mapping matches. When omitted, selection remains unset and the proxy's primary provider is used. |
| `mappings` | Yes | None | Header value to effective provider name mappings; the first match wins |

## Provider Capability Matrix

All transformer capabilities on this page refer to the OpenAI Chat Completions contract implemented by the gateway. They do not imply that every model offered by a provider supports the corresponding feature.

| Capability | Anthropic | Azure OpenAI | AWS Bedrock | Gemini | Mistral |
|------------|-----------|--------------|-------------|--------|---------|
| Request body handling | Full conversion | Pass-through | Full conversion | Full conversion | OpenAI-compatible normalization |
| Request path | `/v1/messages` | Deployment path with `api-version` | Converse or Converse Stream | `generateContent` or `streamGenerateContent` | `/v1/chat/completions` |
| Model behavior | Policy model required | Optional deployment override; otherwise body model | Optional policy model; otherwise body model | Policy model required | Policy model required |
| System and developer messages | Converted to top-level system text | Pass-through | Converted to system blocks | Converted to `systemInstruction` | Pass-through |
| Text messages | Converted | Pass-through | Converted | Converted | Pass-through |
| Image input | Base64 data URI and remote URL | Pass-through | Base64 data URI only | Base64 data URI and remote URL | Pass-through |
| Function tools | Converted | Pass-through | Converted | Converted | Pass-through |
| Tool-call history and results | Converted | Pass-through | Converted | Converted | Pass-through |
| Non-streaming response | Converted to OpenAI format | Already OpenAI-compatible | Converted to OpenAI format | Converted to OpenAI format | Normalized OpenAI-compatible response |
| Error response | Converted | Passed through | Converted | Converted | Converted |
| Streaming request selection | Passed to Anthropic | Passed through | Selects Converse Stream | Selects `streamGenerateContent` SSE | Passed through |
| OpenAI-compatible streaming response | No | Yes, subject to deployment and API version | Yes | No | Expected, subject to model and API behavior |
| Usage conversion | Converted, including available cache details | Passed through | Converted, including cache details | Converted, including cached and reasoning tokens | Passed through |

### Input capability matrix

`Converted` means that the transformer explicitly maps a field to the provider-native format. `Pass-through` means that it deliberately retains the OpenAI field. `Omitted` means that a full-conversion transformer does not copy the field. A passed-through field is still subject to support by the selected provider model and API version.

| OpenAI Chat Completions input | Anthropic | Azure OpenAI | AWS Bedrock | Gemini | Mistral |
|--------------------------------|-----------|--------------|-------------|--------|---------|
| `model` | Replaced by policy | Passed through and used as deployment fallback | Used in path and omitted from body | Replaced and used in path | Replaced by policy |
| Text messages | Converted | Pass-through | Converted | Converted | Pass-through |
| `system` role | Top-level system text | Pass-through | System blocks | `systemInstruction` | Pass-through |
| `developer` role | Treated as system | Pass-through | Treated as system | Treated as system | Pass-through |
| `assistant.tool_calls` | Converted | Pass-through | Converted | Converted | Pass-through |
| `tool` role results | Converted | Pass-through | Converted | Converted | Pass-through |
| Image data URI | Converted | Pass-through | Converted | Converted | Pass-through |
| Remote image URL | Converted | Pass-through | Omitted | Converted to `fileData` | Pass-through |
| `max_completion_tokens` | Mapped to `max_tokens` | Pass-through | Mapped to `max_tokens` | Mapped to `maxOutputTokens` | Pass-through |
| `max_tokens` | Mapped to `max_tokens` | Pass-through | Mapped to `max_tokens` | Mapped to `maxOutputTokens` | Pass-through |
| `temperature` | Converted | Pass-through | Converted | Converted | Pass-through |
| `top_p` | Converted | Pass-through | Converted | Converted | Pass-through |
| `stop` string or array | Converted | Pass-through | Converted | Converted | Pass-through |
| `stream` | Passed to Anthropic | Pass-through | Selects streaming path | Selects streaming path | Pass-through |
| `n` | Omitted | Pass-through | Omitted | Mapped to `candidateCount` | Removed |
| `seed` | Omitted | Pass-through | Omitted | Converted | Pass-through |
| `frequency_penalty` | Omitted | Pass-through | Omitted | Converted | Pass-through |
| `presence_penalty` | Omitted | Pass-through | Omitted | Converted | Pass-through |
| `tools` and `tool_choice` | Converted | Pass-through | Converted | Converted | Pass-through |
| `response_format` | Omitted | Pass-through | Omitted | Omitted | Pass-through |
| `logprobs` and `top_logprobs` | Omitted | Pass-through | Omitted | Omitted | Removed |
| `logit_bias` | Omitted | Pass-through | Omitted | Omitted | Removed |
| `service_tier`, `store`, `metadata`, and `user` | Omitted | Pass-through | Omitted | Omitted | Removed |

For Anthropic, AWS Bedrock, and Gemini, the transformer constructs a new provider-native request body. Fields not explicitly converted are omitted.

### Response capability matrix

| Output feature | Anthropic | Azure OpenAI | AWS Bedrock | Gemini | Mistral |
|----------------|-----------|--------------|-------------|--------|---------|
| OpenAI `chat.completion` envelope | Generated | Native and passed through | Generated | Generated | Native and normalized |
| Multiple choices | No; one choice | Upstream-dependent | No; one choice | Yes; all candidates | Upstream-dependent |
| Text output | Converted | Pass-through | Converted | Converted; thought parts excluded | Pass-through |
| Tool calls | Converted | Pass-through | Converted | Converted | Pass-through |
| Finish reason | Converted | Pass-through | Converted | Converted | Pass-through |
| Token usage | Converted, including available cache-read and cache-creation details | Pass-through | Converted, including cache-read and cache-write details | Converted, including cached and reasoning tokens | Pass-through |
| Error envelope | Converted | Pass-through | Converted | Converted | Converted |
| OpenAI SSE conversion | No | Native and passed through | Yes | No | Native and passed through |

Anthropic produces one OpenAI choice and preserves available cache-read and cache-creation counts in prompt token details. AWS Bedrock produces one choice and retains cache-read and cache-write information for cost calculation. Gemini converts every candidate, preserves candidate indices, excludes `thought: true` parts from visible assistant text, and exposes thought tokens as reasoning tokens.

## Streaming

Streaming behavior is not uniform across provider routes. Select a provider based on the response contract required by the client, not only on whether the upstream accepts `stream: true`.

| Provider route | Upstream stream | Response returned to the client | OpenAI SSE compatible |
|----------------|-----------------|---------------------------------|-----------------------|
| Anthropic | Anthropic SSE | Native Anthropic events are passed through | No |
| Azure OpenAI | Azure OpenAI SSE | Passed through | Yes, subject to deployment and API version |
| AWS Bedrock | Amazon binary event stream | Decoded into OpenAI `chat.completion.chunk` SSE | Yes |
| Gemini | Gemini SSE | Native Gemini events are passed through | No |
| Mistral | OpenAI-compatible SSE | Passed through | Expected, subject to model and API behavior |

!!! warning "Anthropic and Gemini streams are not OpenAI SSE"
    The Anthropic and Gemini transformers select the correct upstream streaming endpoint, but they do not translate the returned provider-native SSE events into OpenAI Chat Completions chunks. Use non-streaming requests for clients that require one uniform OpenAI response contract.

The Bedrock transformer provides full cross-protocol streaming conversion. It decodes Amazon event-stream frames, converts text and tool-call deltas, maps stream errors, emits usage data, and terminates the stream with `data: [DONE]`.

## Tools and Multimodal Input

### Images

Image support varies by provider:

- Anthropic accepts OpenAI image parts containing base64 data URIs or remote image URLs.
- AWS Bedrock accepts base64 image data URIs. Remote image URLs are omitted because Bedrock Converse requires image bytes.
- Gemini converts base64 data URIs to inline data and remote URLs to file data.
- Azure OpenAI and Mistral receive image parts unchanged. Support depends on the selected deployment or model.

The gateway does not inspect a model's capabilities before routing. A successfully transformed request can still be rejected when the selected model does not support image input.

### Function tools

Anthropic, AWS Bedrock, and Gemini convert OpenAI function declarations into provider-native tool declarations. Azure OpenAI and Mistral receive `tools` unchanged.

The transformers accept OpenAI function tools in the following shape:

```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the weather for a city",
    "parameters": {
      "type": "object",
      "properties": {
        "city": {
          "type": "string"
        }
      },
      "required": ["city"]
    }
  }
}
```

| OpenAI field | Anthropic | AWS Bedrock | Gemini | Azure OpenAI and Mistral |
|--------------|-----------|-------------|--------|--------------------------|
| `function.name` | `tools[].name` | `toolConfig.tools[].toolSpec.name` | `tools[].functionDeclarations[].name` | Passed through |
| `function.description` | `description` | `toolSpec.description` | `description` | Passed through |
| `function.parameters` | `input_schema` | `inputSchema.json` | `parameters` | Passed through |
| Missing parameter schema | Empty object schema | Empty object schema | Omitted | Passed through |

Only OpenAI tools with `type: function` are explicitly converted. Provider-native tools, hosted tools, computer-use tools, web-search tools, MCP tool declarations, and OpenAI custom tools are not translated.

### Tool choice

| OpenAI `tool_choice` | Anthropic | AWS Bedrock | Gemini |
|----------------------|-----------|-------------|--------|
| `auto` | Automatic selection | Automatic selection | `AUTO` mode |
| `required` | Any tool | Any tool | `ANY` mode |
| `none` | Tool definitions omitted | Tool configuration omitted | Tools omitted and mode set to `NONE` |
| Named function | Named tool | Named tool | `ANY` mode restricted to the named function |
| Unknown or malformed value | Defaults to automatic selection | Omits `toolChoice` | Defaults to `AUTO` mode |

Azure OpenAI and Mistral receive `tools` and `tool_choice` unchanged. Their acceptance depends on the selected model and API version.

### Tool-call conversations

The Anthropic, AWS Bedrock, and Gemini transformers support multi-turn function-tool conversations:

- Assistant `tool_calls` are converted into provider-native tool-use or function-call blocks.
- The JSON string in `function.arguments` is decoded into an object.
- A `role: tool` message is converted into a provider-native tool result or function response.
- Consecutive tool results are grouped into a provider-compatible user turn where required.
- Provider tool calls in non-streaming responses are converted back into OpenAI `message.tool_calls`.
- Bedrock streaming tool-call deltas are converted into OpenAI chunk deltas.

Invalid JSON in historical assistant tool arguments is replaced with an empty object. OpenAI-specific strict schemas, `parallel_tool_calls`, provider-specific tool caching, and non-function tool types are not explicitly translated.

## Failure Behavior

### Routing failures and suspension

The round-robin policies track failures per provider/model pair. The same model name configured for two providers is therefore suspended independently.

- A `429` response or any `5xx` response suspends the selected pair.
- `suspendDuration` defaults to 30 seconds.
- Setting `suspendDuration` to `0` disables failure suspension.
- Suspended entries are skipped on later requests until their suspension expires.
- If every entry is suspended, the policy returns HTTP `503` with `All models are currently unavailable`.
- Rotation counters and suspension state are held by the policy instance in memory and are not coordinated across gateway replicas.

!!! important "Suspension is not a retry"
    The request that receives a `429` or `5xx` response is returned to the client. The policy does not replay that request on another provider. Suspension affects only later requests.

### Transformation failures

- Empty or invalid JSON request bodies return HTTP `400` in transformers that perform full request conversion.
- Missing required transformer parameters cause policy validation or initialization to fail.
- Azure OpenAI returns HTTP `400` when neither the policy nor the request supplies a deployment ID.
- AWS Bedrock returns HTTP `400` when neither the policy nor the request supplies a model ID.
- A non-JSON successful provider response is generally passed through instead of being replaced with a gateway-generated `500` response.
- Converted provider errors retain the upstream HTTP status and use an OpenAI-style error envelope where supported by the transformer.

## Limitations

- **Chat Completions only:** Cross-provider translation targets the OpenAI `/chat/completions` model.
- **No universal streaming abstraction:** Only AWS Bedrock has cross-protocol conversion to OpenAI SSE. Anthropic and Gemini streams remain provider-native.
- **No automatic capability negotiation:** The gateway does not query the selected model for support for vision, tools, schemas, or individual generation parameters.
- **No automatic routing validation:** Router mappings must match the primary provider ID or an additional provider's effective name.
- **No request retry or immediate failover:** Suspension removes an unhealthy target from later rotations but does not retry the failing request.
- **Instance-local state:** Round-robin counters and suspension maps are maintained in memory by each policy instance.
- **Field loss during full conversion:** Anthropic, AWS Bedrock, and Gemini omit request fields that their transformers do not explicitly map.
- **Provider restrictions still apply:** Successful conversion does not guarantee that a model accepts images, tools, tool choice, penalties, candidate counts, or other mapped values.
- **No primary inline transformer:** The inline `transformer` field is available on `additionalProviders`, not on the primary `provider` object. A transformer for another layout must be attached as an operation policy.
- **One routing strategy is recommended:** Combining routing policies can produce precedence-dependent behavior and should be tested explicitly.
- **Header selection needs an upstream override:** A header-routed additional provider without a transformer does not automatically change the named upstream.

## Troubleshooting

### The additional provider is not found

Deploy every provider before deploying the proxy. Each `additionalProviders[].id` must match the `metadata.name` of an existing `LlmProvider`.

### The proxy reports a duplicate upstream name

Every effective provider name must be unique. The effective name is `as` when it is configured; otherwise, it is `id`. It must not collide with the primary provider ID.

### The transformer is rejected during deployment

Make sure that:

- `transformer.type` names a transformer supported by your AI Gateway version.
- `transformer.version` uses a major-only version such as `v1`.
- All parameters required by that transformer are present.

The gateway resolves the major version to an installed full policy version and rejects invalid transformer configuration during deployment.

### The request always reaches the default provider

Check that:

- The routing policy is attached to the same path and method being invoked.
- The request uses the header configured by `headerName`.
- The header value matches a `mappings[].headerValue`.
- The mapping's `provider` matches the additional provider's `as` value when an alias is configured; otherwise, it matches `id`.

An unknown header value intentionally falls back to `defaultProvider`.

If the mapping selects an additional provider that has no transformer, confirm that another operation policy explicitly sets the named upstream. The header router alone publishes selection metadata.

### The model router does not move to another provider after a failure

Model suspension does not retry the current request. Confirm the behavior with a later request after the first target returns `429` or `5xx`. Also confirm that `suspendDuration` is greater than `0` and that each model entry uses the correct effective provider name.

### Streaming is not in OpenAI chunk format

Anthropic and Gemini streaming responses are provider-native SSE. Use non-streaming mode, choose Azure OpenAI, AWS Bedrock, or an OpenAI-compatible Mistral stream, or adapt the provider-native stream in the client.

### An image or tool request is rejected by the provider

Transformation support and model support are separate. Check the capability matrix, then verify that the exact selected model supports images, function tools, the requested `tool_choice`, and the supplied JSON Schema.

### The provider returns `401 Unauthorized`

Confirm which authentication layer rejected the request:

- A rejection at the proxy usually means the proxy consumer key is missing or invalid.
- A rejection on the provider's loopback route usually means `provider.auth` or `additionalProviders[].auth` contains an invalid provider API key.
- A rejection from the external vendor usually means `LlmProvider.spec.upstream.auth` contains an invalid vendor credential or uses the wrong header format.

### The configured transformer is not supported

The AI Gateway distribution includes the router and transformer policies supported by that version. Use a supported `transformer.type` and major version, or upgrade the AI Gateway to a version that includes the required transformer.

## Security Recommendations

- Store vendor credentials and loopback keys in a secret manager or Kubernetes `Secret` instead of committing plain-text values.
- Protect the proxy with an authentication policy so applications cannot invoke it anonymously.
- Expose only required provider operations through `accessControl`.
- Apply rate limiting and guardrails at the provider or proxy level according to your governance requirements.
- Use explicit router mappings. Do not accept a client-provided value as an unrestricted upstream name.

## Complete Example

For a larger configuration containing OpenAI, Anthropic, Azure OpenAI, Mistral, Gemini, and AWS Bedrock, see [`gateway/examples/openai-multi-provider-proxy.yaml`](https://github.com/wso2/api-platform/blob/main/gateway/examples/openai-multi-provider-proxy.yaml).

For automatic traffic distribution across models and providers, see:

- [Model Round Robin](load-balancing/model-round-robin.md)
- [Model Weighted Round Robin](load-balancing/model-weighted-round-robin.md)

AWS Bedrock usage can also be evaluated by the [LLM Cost policy](../../../next/ai-workspace/policies/overview.md#llm-cost).
