# Extension ⇄ PWA contract

The single source of truth is `shared/src/index.js` (validation) and `shared/src/index.d.ts`
(types). Both the extension and the PWA validate every message with it.

## Topology

```
popup ──(chrome.runtime.sendMessage, internal relay channel)──▶ service worker
service worker ◀──(chrome.runtime port "talentfly-protocol-v1", externally_connectable)──▶ PWA
```

The popup never talks to the PWA directly. The service worker forwards each request to the
connected PWA tab and returns the matching reply (correlated by `messageId`, 15 s timeout).

## Envelope

```json
{ "protocolVersion": 2, "messageId": "<1-128 chars [A-Za-z0-9_-]>", "type": "…", "payload": {} }
```

Max serialized size 256 KiB. Unknown keys are rejected.

## Messages

| Type | Direction | Payload | Reply |
|---|---|---|---|
| `PING` | popup → PWA | `{}` | `PONG` `{ ready: true }` |
| `LIST_RESUMES` | popup → PWA | `{}` | `RESUMES` `{ resumes: [{ id, name }] }` (IDs and names only) |
| `START_COMPARISON` | popup → PWA | `{ job, resumeIds }` | `STATUS_UPDATE` `{ runId, status, error? }` |
| `GET_RUN_STATUS` | popup → PWA | `{ runId }` | `STATUS_UPDATE`, or `ERROR` `NOT_FOUND` |
| `LATEST_RUN_FOR_URL` | popup → PWA | `{ sourceUrl }` (https, or http on localhost; max 2 000 chars) | `STATUS_UPDATE` for the newest run of any saved job read from that page (the `#fragment` is ignored), or `ERROR` `NOT_FOUND` |
| `LIST_JOBS` | popup → PWA | `{}` | `JOBS` `{ jobs: [{ id, title, company?, location? }] }` (unused by the popup) |
| `JOB_CAPTURED` | extension → PWA | `{ job }` | `CAPTURE_ACK` (legacy review flow; unused by the popup) |
| `ERROR` | PWA → extension | `{ code, message }` | — reply to **any** request the PWA rejects or fails |

`status` is one of `received | analysing | done | failed`; `error` is included for `failed`
runs. The PWA owns the run lifecycle: the extension stores nothing and asks the PWA each time it
opens (`LATEST_RUN_FOR_URL`) and while a run is `received` or `analysing` (`GET_RUN_STATUS`,
polled every 2 s, stopping on `done`/`failed` or after 3 consecutive failures). `ERROR.code` is one of
`INVALID_REQUEST | UNSUPPORTED_VERSION | NOT_FOUND | INTERNAL`; `message` is user-readable
(1–500 chars) and is shown in the popup.

### `job`

| Field | Rule |
|---|---|
| `title`, `company`, `location` | text, ≤ 200 chars, may be empty |
| `description` | text, 1–20 000 chars |
| `sourceUrl` | the page URL: `https` (or `http` on localhost), no credentials |
| `otherFields` | optional; ≤ 10 entries; key 1–100 chars; value 1–2 000 chars; `__proto__`, `constructor`, `prototype` rejected. Site-specific extras such as whoz.com's `Reference` |

`resumeIds`: 1–5 distinct IDs. The popup currently sends exactly one.

The extension builds `job` with `toCapturedJob()` (extension/src/job-capture.ts), which trims
and clamps every field to these limits before a message is created.

### Result link

The popup links to the exact run: `<PWA origin>/#history/<runId>`. The older
`?runId=<id>#inbox` link still opens the inbox and offers a link to the report.

### Idempotency

`START_COMPARISON.messageId` is the idempotency key: the PWA stores the job and creates the run
once per `messageId`, and returns the same run for a retry. The popup derives the ID from the
job content, chosen resume, and a "generation" that only the explicit **Compare again** action
increments. Retrying the same choice (even after a lost reply) is safe, a different resume is a new
run, and while a run for the page is waiting or analysing the popup offers no second one.

## Versioning

`PROTOCOL_VERSION` is bumped whenever a payload changes incompatibly. A receiver on another
version rejects the message with:

> Unsupported protocol version N; this build speaks version M. Reload the TalentFly extension
> on chrome://extensions and refresh the TalentFly tab.

History: **v1** initial; **v2** `START_COMPARISON` carries `job` instead of `jobId`, `ERROR`
response added; **v3** `GET_RUN_STATUS` and `LATEST_RUN_FOR_URL` added (a new message type is a
version bump so an out-of-date worker or PWA is reported clearly).

The extension is loaded from disk but Chrome keeps running the previous service worker until the
extension is reloaded, so a popup can briefly be newer than its worker. The popup therefore
performs a `HELLO` handshake with the service worker when it opens (internal channel, not part of
the PWA protocol). A worker that does not answer, or answers with another protocol version, is
shown as: *"The TalentFly extension background worker is out of date or not running. Reload
TalentFly on chrome://extensions, then reopen this popup."*

## Validation errors

Rejections name the problem, for example `The "START_COMPARISON" message is invalid:
job.description is longer than 20000 characters.` The PWA shows incompatible messages in its
UI and replies with `ERROR` when it knows the `messageId`.

## Changing the contract

1. Change `shared/src/index.js` and `index.d.ts` together.
2. If the change is incompatible, bump `PROTOCOL_VERSION` and add a history line above.
3. Update this document and the tests in `shared/test`, `extension/test/relay-contract.test.ts`,
   and the PWA inbox tests.
4. After rebuilding the extension, reload it on `chrome://extensions` **and** refresh the PWA.
