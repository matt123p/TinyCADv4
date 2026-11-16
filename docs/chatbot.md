# TinyCAD assistant

The assistant is available only in the Electron desktop version. Browser builds
have no Chat button, chatbot dialog, AI providers, LLM tools, or chat workers.

Open **Chat** in the toolbar. When disconnected, the conversation area shows
**Click here to Sign in to use AI**. Click it or the header's **settings gear**
to open the centered **AI settings** popup. Setup has three steps:

1. **Provider:** choose ChatGPT, Anthropic, Gemini, local Ollama or a compatible endpoint.
   The page explains the three hosted options: eligible paid ChatGPT allowance,
   Gemini's limited free API tier, or a key from another provider.
2. **Account or API key:** ChatGPT has two radio choices: **Sign In with ChatGPT**
   or **Use API Key**. Only the selected method's controls appear. A remembered
   ChatGPT email offers **Continue as …** or **Sign in with a different account**;
   first-time users see just **Sign in with ChatGPT**. There is no account list.
   ChatGPT sign-in explicitly states that an eligible paid subscription is required
   and requests in TinyCAD count towards that allowance. API-key billing is separate.
   Other hosted-provider pages include key-creation instructions and links, including
   the Gemini page and custom compatible endpoints.
   API-key entry includes provider instructions and an optional **Show API key**
   checkbox while typing. Keys are never filled back into the UI after leaving
   the entry step, including when going Back. Gemini uses an API key; compatible endpoints also ask for an API base URL.
3. **Pick Model:** choose a model and thinking level, then **Finish**. Connection
   checks happen automatically on Next from step 2, or during account sign-in.
   Failed checks keep the user on step 2. There is no Test Connection button.
   Endpoints without a model list ask for a model ID in step 2 and verify it with
   a short greeting on Next.

Only one AI provider is active at a time, and the local ChatGPT runtime retains
one account. A successful different-account sign-in replaces the previous account;
older multi-account stores keep only the selected account on the next load.
Desktop API keys are saved with OS-backed
encryption when secure storage is available; otherwise setup explains that they
remain in memory until TinyCAD quits. Credentials never enter saved preferences.

For an existing connection, the settings gear opens a separate **AI settings**
view showing the provider, connection method and account email (when applicable).
It has **Sign out** or **Clear API key**, plus model/thinking controls and **Save**.
It does not show the setup steps, provider switching or any API-key input/reveal
control. Sign out or clear the key before setting up another connection.
Cancel preserves the active connection, preferences and message draft.

Thinking uses a slider with **Minimal** and **Max** endpoints, initially **Medium**.
The available stops use each provider's supported reasoning levels; Max means
that provider's highest supported setting. The slider appears in setup, settings
and the composer's combined model popup. Default preferences save on Finish/Save,
without storing credentials. Popups support Escape and contain keyboard focus.

The header's **pencil in a box** starts a new chat and clears the draft/attachments.
Both header controls use icons with accessible names and tooltips. The input has
an accessible Message label without a visible heading above it.

The small model icon opens one popup containing both **Model** and **Thinking**.
Its tooltip shows the current selection. Latest models are grouped by the highest
numeric version across families (for example Sol, Luna and Astra 6.1). Older
versions live under **More models**. Selected models move into **Recently selected**,
with up to six remembered per provider and endpoint, without storing keys.
They can change between replies. Changing a model keeps the conversation and
rebuilds portable tool-call history without replaying another model's signed
reasoning. Connecting a different provider/key starts a new chat.

ChatGPT lists only Sol, Luna and Astra models available to the supplied key.
Other providers use their model lists, with custom IDs available when needed.
Model availability, vision and reasoning support depend on the
provider/account. The output-token limit is an internal default and has no user
control. All non-secret provider, endpoint, model, thinking and connection-method
settings are persisted. Desktop restores the last completed connection on launch
when its credentials are available. Clearing a key removes its saved credential
while retaining preferences. Chat history remains in memory. Desktop API keys
and ChatGPT OAuth credentials use the protected storage described below.

## Local Ollama

Choose **Ollama (hosted locally)** to connect directly to your local server at
`http://localhost:11434/v1` (editable for another localhost port or path). This
connection requires no API key and sends no Authorization header. It lists installed
models via `/v1/models` and uses `/v1/chat/completions` for streaming, reasoning and
TinyCAD tool calls. Settings show the local URL and **Disconnect Ollama**. Local
URLs are restricted to localhost/loopback; use **OpenAI compatible** for a remote
server instead. Switching/disconnecting follows the same one-provider rule.

Install and start [Ollama](https://ollama.com/download), then download a model with
`ollama pull MODEL_NAME`. Choose a model with tool support; circuit-image/PDF
imports also require vision. PDFs are rasterized locally before model requests.
Configure enough model context for the circuit tools; see Ollama's
[OpenAI compatibility and context setup](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size).

Requests go directly to the local server; TinyCAD's hosted server does not relay
them. Tool/vision/thinking
capabilities depend on the installed model. Cloud models configured through an
Ollama server can use that server's cloud connection; choose a local model for
local inference.

The wizard's free-Gemini wording refers to the [Gemini API free tier](https://ai.google.dev/gemini-api/docs/pricing),
which has model, availability and usage limits; it does not promise unlimited free
access or free access to every model.

## Browser and Electron URL routing

Every browser build uses the origin that served the editor for TinyCAD website
and API access. Requests are root-relative, e.g. `/api/search/search`, regardless
of hostname, port, or build/deployment environment. This covers
the library panel, thumbnails, account requests, website links
and help pages. The serving host must serve or proxy these routes.

Electron uses `https://www.tinycad.net` for TinyCAD website/API requests because
its editor loads from `file://`. The shared `src/io/apiServer.ts` selects routing
using `TARGET_SYSTEM`, not localhost or production hostname detection.
Public online-library searches and symbol downloads run through a restricted
Electron main-process bridge, because those endpoints do not permit cross-origin
renderer requests. Browser builds continue to use their same-origin API proxy.

## OpenAI-compatible providers

Choose **OpenAI compatible**, enter the provider's API base URL and API key,
and choose a model. If the endpoint cannot list models, enter its exact model
ID when prompted; Next checks it with a short greeting. Model and reasoning
support depend on the service. Requests go directly to the configured endpoint
in the desktop renderer. The endpoint must allow renderer CORS and
use HTTPS except for localhost; TinyCAD does not provide a provider relay.

## Circuit tools, Markdown and files

Assistant output renders Markdown headings, emphasis, lists, tables, fenced code
and links. Raw HTML stays escaped text, unsafe link schemes are blocked, and
Markdown images become links rather than automatically loading third-party URLs.
Actual TinyCAD preview images appear as chat attachments.

Attach PDFs, PNGs, JPEGs or WebPs to reconstruct editable circuits or symbols.
OpenAI, Anthropic and Gemini receive PDFs natively. Compatible endpoints
receive locally rendered selected PDF pages (up to 20). Inputs total at most
10 MiB and six files; converted images are also bounded to 10 MiB. Provider
limits still apply. Select a model supporting tools and vision for diagrams.

All original MCP function names are local tools: `search_symbols`, `get_symbol`,
`create_ic_symbol`, `validate_component`, `render_component`, `validate_drawing`,
`render_drawing`, `auto_tidy_drawing`. Additional tools are `read_drawing`,
`read_metadata`, `read_netlist`, `set_drawing`, `edit_drawing`, `add_to_drawing`,
`insert_symbol`, `read_skill_reference`, and `export_file`. No MCP connection is
used. Public library search/retrieval uses TinyCAD's existing REST endpoints.

The runtime system prompt and `read_skill_reference` (`SKILL.md`) include the
available bundled library names, IDs and descriptions. The assistant searches
`search_bundled_symbols` **first**, before online search or symbol generation.
Omit `libraryId` to search all bundled libraries (including unselected libraries),
or pass a catalog ID to restrict the search. Names, descriptions and attributes
are searched; results are paginated and include original artwork and SPICE
attributes through reusable component IDs. Searches do not change the selected
library. Load errors are reported separately from a complete search with no matches.

Search results return a session-local `componentId`. `get_symbol` supplies metadata,
pin mappings, validation and a preview; XML is omitted unless explicitly requested
with `includeDefinition=true`. `create_ic_symbol` and `store_component` also return
reusable IDs. `place_component` resolves artwork internally, remaps resources,
reuses embedded definitions for repeated instances, chooses an unused reference
and returns actual rotated pin hotspots. Optional x/y place it in the intended
functional block; omitted coordinates stage it beside existing content.
`insert_symbol` remains available for explicitly supplied XML.

`auto_layout` reads and applies the current drawing directly, returning compact
quality/connectivity reports and a new revision. There is no download or XML
round trip. It requires connectivity and serialization checks to pass. Existing
`auto_tidy_drawing` remains a non-applying tool for external XML.

In library mode, `read_library` returns an inventory and `add_library_components`
adds up to 64 validated component IDs per atomic, undoable batch. The current
unsaved symbol is preserved and the last new component opens for editing. Larger
requested libraries can use successive batches. Duplicate names or stale state
reject the entire batch. Source fetching/placement currently supports single-unit
symbols; multi-unit public parts are rejected explicitly.

All writes require the current revision, validate before one Redux commit,
recheck their source at commit time, preserve file identity and support Undo/Redo.
Structural errors reject writes; electrical errors are returned for investigation.
Rendering, validation, DRC, netlists and layout use native editor engines in
cancellable workers. Stop cancels computation/provider requests; already applied
changes remain undoable.

The embedded skill refreshes its drawing/library instructions for every model
round using the live editor mode. Drawings are edited in place. Newly generated
symbols are placed ready to wire in a drawing, or added to the active library.
Downloads are created only on an explicit user request using `export_file`.
Real `.dsn`, standalone XML and SQLite `.TCLib` exports remain supported.
Pinout verification remains an independent model task; DRC is not simulation
or proof of circuit operation.

## Web search with ChatGPT

Signed-in ChatGPT requests expose the native Responses `web_search` tool beside
the TinyCAD tool namespace. Search/open-page activity stays in the collapsed
Working row with expandable details, and provider URL citations become clickable
inline links. Native search results and encrypted reasoning are preserved in
stateless request history. The model chooses when to search; capability remains
subject to its model and ChatGPT account/workspace policy. Restrictions are
reported without falling back to another billing path. Restart the local ChatGPT
runtime (or Desktop) after updating its request allowlist.

This enables hosted search for the **Sign in with ChatGPT** connection. The
existing API-key Chat Completions adapters and other providers do not gain web
search from this change. Their system instructions continue to say that online
research is unavailable.

The integration follows OpenAI's [web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
and [ChatGPT plan preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Architecture and verification

`providers.ts` adapts wire formats, `network.ts` selects direct/relayed transport,
`session.ts` manages conversation/tool rounds, and `tools.ts` bridges the editor.
`ChatAuth` and `ChatTransport` separate credentials and transport so future
ChatGPT sign-in uses the separate Responses transport and reuses all existing circuit tools.
`renderer/chat.ts` bundles shared native engines; `ChatPanel.tsx` provides the UI.

The portable TinyCAD skill, references/examples and validation schema snapshots
are in `src/chat/skill`. Refresh them with:

```
python3 scripts/sync-chat-resources.py ../TinyCAD.net
```

Start/build scripts generate the ignored native worker bundle automatically.
Checks:

```
npm run typecheck
npm run typecheck:server
npm run test:chat
npm run test:chat:builds
npm run test:chat:browser
```

Relay controller tests are in the TinyCAD.net service's `ChatControllerTests`.
Playwright tests verify that browser builds have no assistant and exercise the
Electron renderer with a test IPC bridge, real native/PDF workers and mocked
paid-provider responses. They cover connection order, model filtering,
composer settings, CORS routing, Markdown, native edits, stale revisions,
Undo/Redo, previews, library exports and PDF import. Live paid-provider behavior
still needs a valid API key.

## Compact activity and output-limit recovery

Each user turn has at most one collapsed activity row. Tool calls, intermediate
assistant updates, provider-returned thinking summaries and automatic recovery
notices accumulate inside that row. Opening it exposes nested disclosures;
opening an individual tool shows its arguments and result. Large tool details
are rendered only when opened. Final user-facing Markdown replies stay outside
the activity group.

Images passed to the model appear as **Model viewed an image** within activity.
The image is hidden until opened, can be hidden again, and uses the exact PNG or
uploaded image bytes sent to the provider. Successful provider responses (or
output-limit responses during recovery) mark inputs as viewed. Render tools no
longer create a second global image/file preview for every inspection. Explicit
native file exports still produce download links. When a PNG is sent as vision
input, duplicate SVG text is omitted from the provider tool-result payload;
editable XML and other necessary tool data remain available.

For API-key connections, the app starts with a 65,536-token output/reasoning allowance, raised to 128,000
for ChatGPT Sol/Luna/Astra. Conversation history
is preserved; this allowance does not change the input context window.
A truncated provider response below the cap triggers bounded automatic recovery: retry the
same input with a larger internal output allowance, up to two retries and a
model-specific cap. Truncated function calls are never parsed or executed, and a
retry cannot repeat tool edits from a partial response. The larger allowance is
retained for subsequent calls in the same turn. Persistent limits surface a
clear error suggesting a smaller step or lower thinking level; there is no user
output-size setting. Completed edits remain undoable. Provider-specific limits
can still prevent completion, and retries can consume additional API credits.

Requests stream through OpenAI-compatible SSE, Anthropic messages streaming and
Gemini streamGenerateContent. In-progress provider text/thinking
and tool preparation appear inside the activity row. Expanded activity includes
a timestamped phase log, current operation and elapsed time. Collapsed activity
shows the latest tool, image inspection or provider-supplied thinking excerpt.
The active Working label has a subtle ripple, disabled by reduced-motion
preferences. Thinking text is displayed only when the provider supplies it.
Incomplete/disconnected streams never execute partial function calls.

The combined picker follows [VS Code's model and thinking controls](https://code.visualstudio.com/docs/agent-customization/language-models).
The compact grouping follows the expandable reasoning/tool activity pattern
[documented by VS Code](https://code.visualstudio.com/updates/v1_145/).
Recovery follows [Anthropic's guidance for incomplete tool-use outputs](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons);
[OpenAI's completion limits include non-visible reasoning tokens](https://developers.openai.com/api/docs/guides/token-counting).

## Sign in with ChatGPT (Electron desktop)

Select **ChatGPT**, then **Sign in with ChatGPT**. Complete OpenAI sign-in and
approve ChatGPT plan usage in the external browser. TinyCAD shows the connected
account, a first-use confirmation, and **Using ChatGPT plan** with **Manage usage**
next to the composer. Model and thinking selection remain in the existing icon
popup. API-key connections remain available as an explicit alternative.

Eligibility and app limits are controlled by OpenAI and the selected account or
workspace. Identity-only consent keeps the account connected but disables chat
until plan usage is enabled. A usage or authorization error never silently
switches to API-key billing. Account controls offer continuing with the remembered email, signing in with a different account, reauthorizing an existing registration, and signing out. Only one account is retained. Sign-out
attempts remote revocation and reports when remote disconnection was not
confirmed. Account changes start a new chat; requests are pinned to their selected
registration so a different account cannot be charged mid-conversation.

This release supports the [public open-source/local flow](https://developers.openai.com/siwc/token-sharing-open-source).
Browser builds exclude the assistant entirely, including during development.
Hosted account-plan usage is outside this release and requires OpenAI approval. No hosted OAuth client ID or
secret is needed for the desktop/local flow.

### Run locally

`npm run dev` provides Electron sign-in through its main process. Browser commands
`npm run start:fs` and `npm run start:ga` run only the editor without a chat runtime.
Use Node 22 or newer for development.

The temporary OAuth callback uses a separately selected loopback port and stops
after completion, cancellation, or ten minutes.

### Credentials and inference

`chatgpt/runtime.js` uses OpenAI's documented dynamic client registration with
TinyCAD's own name, stable per-installation host ID, fresh state/nonce and PKCE.
It verifies ID-token signature, issuer, audience, expiration and nonce using
`jose` and OpenAI's JWKS. Issued client registrations survive logout and failed
code exchange; existing accounts must match their verified subject.

OAuth credentials remain in the local runtime. Electron stores them under
`app.getPath('userData')/chatgpt/accounts.json`. API keys are stored separately in
`app.getPath('userData')/chat/api-key.json`, bound to their provider and endpoint.
Both use Electron `safeStorage`: Windows DPAPI, macOS Keychain, or the Linux
Secret Service/KWallet keyring. Linux `basic_text` is rejected. Availability is
checked with an encryption/decryption round trip. If secure storage is unavailable,
setup informs the user, API keys and OAuth tokens stay in process memory, and no
new credentials are written to disk. Registration metadata and all preferences
remain persistent. Legacy plaintext desktop OAuth credentials are encrypted on
load, or removed from disk and retained only in memory when no keyring is available.
An inaccessible encrypted account remains untouched until explicitly replaced or
signed out. A corrupt/unlockable saved API key reports a reconnection error; it
is never interpreted as plaintext. File storage uses atomic writes and
owner-only permissions; rotating refreshes are serialized across processes.
Neither renderer state, browser storage, chat exports nor logs receive access
or refresh tokens. API keys are decrypted only for the trusted TinyCAD main frame
and used in renderer memory by the existing provider adapters; they never enter
browser storage. Electron also keeps authorization URLs with ID-token hints
out of renderer IPC. These are TinyCAD-specific registrations; the integration
does not read Codex credentials or browser cookies.

`src/chat/chatgpt.ts` sends the full portable conversation, uploaded PDFs/images,
vision tool results and signed/encrypted reasoning history to the public
Responses API through the protected runtime. Every request uses `store: false`,
`stream: true` and namespaced TinyCAD function tools. It omits unsupported
`max_output_tokens`, `previous_response_id` and server conversation fields: the
ChatGPT plan route controls its reply allowance. No MCP server or shell tools
are introduced. Tools execute only after `response.completed`; failed,
incomplete or disconnected streams never apply partial function calls.

Tests cover registration/state/PKCE, JWT verification, identity-only consent,
refresh serialization, revocation, browser CSRF/origin checks, Electron sender
validation, account pinning, tool history/files/vision, interrupted streams and
usage-limit failures. Browser tests exercise sign-in UI, native drawing reads
and edits, sign-out and permission/usage errors with mocked OpenAI responses.
A real eligible account is still needed to verify live sign-in and inference.

## Gemini access

Gemini setup uses an API key from [Google AI Studio](https://aistudio.google.com/apikey).
The AI connection wizard does not offer Google account sign-in. TinyCAD's separate
Google Drive sign-in is unchanged. Existing Google authorization adapters remain
internal and are not exposed as a new chat connection option.

## Parcel development/build isolation

Development servers use `.parcel-cache/dev-google`, `dev-filesystem` or
`dev-electron`, with output under `.tmp/dev-*`. Production builds keep their
own `.parcel-cache/build-*` directories and continue to write deployable files
to `dist`. Build and packaging commands must not delete the shared
`.parcel-cache` parent: Parcel workers read their configuration from that cache
while a dev server is running.

If an older running server reports `Got unexpected null` in `loadConfig`, stop
it and restart the same `npm run start:ga`, `start:fs` or `start:electron`
command. The updated commands use isolated caches and bypass the damaged legacy
cache. No dependency reinstall or credential changes are required.

After connecting an account or API key, TinyCAD preserves an available model
choice or selects the latest catalog version, preferring Sol for ChatGPT when
available. If a custom endpoint cannot list models, the composer still allows a
draft and explains how to choose a model; Send stays disabled until one is set.

## ChatGPT stream headers and diagnostics

The relay asks for `Accept: text/event-stream` and verifies SSE framing from a
bounded body prefix. Valid event streams are accepted even if an intermediary
omits or changes `Content-Type`; the local browser/Electron bridge supplies the
correct downstream event-stream header. This preserves streaming rather than
buffering the reply or repeating a billed request. The renderer still requires
`response.completed` before applying tool calls.

Completed streamed output items are retained even if `response.completed.output`
is empty. The client preserves tool calls, encrypted reasoning, message content and
citations from the explicit item/argument/content completion events. It still waits
for a successful `response.completed` and the entire stream before executing tools;
argument deltas alone never authorize an edit. The final output snapshot takes
precedence when supplied, preventing duplicate calls. This recovery does not repeat
a billed provider request.

Non-streaming JSON/HTML, empty responses and incomplete streams fail closed.
Errors include safe upstream HTTP status, media type and request ID when
available, without reflecting raw response bodies or credentials. Activity only
reports a responding stream after validation, and failures replace stale
“responding” text with the actual failure. Regression tests cover missing
headers, byte-fragmented prefixes, Unicode, invalid JSON/HTML, HTTP errors and
cancellation. A live ChatGPT diagnostic has completed a read-only tool call and
final reply through the updated local relay and client parser.
