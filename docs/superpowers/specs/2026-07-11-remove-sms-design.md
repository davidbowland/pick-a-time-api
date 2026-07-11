# Remove SMS capability — Design

## Goal

Remove the app's ability to send SMS messages entirely. This means deleting the
share-via-SMS feature end-to-end (not replacing it with another delivery
mechanism), and removing the `phone`/`textsSent` fields from the user data
model, since their only consumer was this feature.

## Background

SMS sending exists in exactly one place today: `POST
/sessions/{sessionId}/users/{userId}/share` (`src/handlers/share-session.ts`).
It creates a new session user from a caller-supplied phone number, rate-limits
texts per user (`textsSent`, `incrementTextsSent`), and sends an invite link
via a third-party SMS gateway (`src/services/sms.ts`).

Separately, `phone` exists as a general `UserRecord` attribute — auto-populated
from the Google auth claim on `POST /users`, and editable via `PATCH
/phone`. The only place that ever *reads* `phone` for logic is the
duplicate-phone check inside the share flow. Per user decision, `phone` is
being removed along with SMS — this repo wants nothing to do with phone
numbers, not just SMS sending.

The codebase does not currently do any Google Calendar free/busy fetching —
that's an unbuilt future item (Plan C in
`docs/superpowers/plans/2026-07-10-pick-a-time-core-domain.md`), unrelated to
this change.

## Out of scope

- Any replacement notification/invite mechanism (e.g. email). The `/share`
  endpoint is deleted outright; users need another way to join a session
  (not addressed here).
- Editing `docs/pick-a-time-changes.md` and
  `docs/superpowers/plans/2026-07-10-pick-a-time-core-domain.md`. These are
  dated historical planning docs from the original Choosee → Pick-a-Time
  pivot, committed once and never revised since. They still describe SMS as
  part of the original plan; that's left as a historical record, not updated.

## Changes

### Delete outright

- `src/services/sms.ts`
- `__tests__/unit/services/sms.test.ts`
- `src/handlers/share-session.ts`
- `__tests__/unit/handlers/share-session.test.ts`
- `events/share-session.json`

### `template.yaml`

- Remove the `ShareSessionFunction`, `ShareSessionLogGroup`, and
  `ShareSessionLogGroupSubscription` resources (the `## Share / SMS` section)
  — this removes the `POST
  /sessions/{sessionId}/users/{userId}/share` route and its IAM
  grants/env vars.
- Remove `smsApiUrl` / `ssmSmsApiKeyName` from `EnvironmentMap` for both
  environments.
- Remove the SMS-related IAM statements (`ssm:GetParameter` on the SMS param,
  `kms:Decrypt`) and `SMS_API_KEY_PARAM_NAME`/`SMS_API_URL` env vars from
  `PatchUserFunction` and `PatchUserAuthFunction`. These grants are unused
  today — `patch-user.ts` never calls the SMS service — and are being cleaned
  up as part of this change since they're SMS permissions.

### `src/types.ts`

- `UserRecord`: remove `phone` and `textsSent`.
- Remove `ShareInput`, `SMSMessage`, `MessageType`.
- `AuthContext`: remove `googlePhone`.

### `src/config.ts`

- Remove `smsApiKeyParamName`, `smsApiUrl`, `smsRateLimitPerUser`.

### `src/services/secrets.ts`

- Remove `getSmsApiKey` (and its `smsApiKeyParamName` import). Keep
  `getRecaptchaSecretKey` and the shared `getParameter`/cache machinery.
- `__tests__/unit/services/secrets.test.ts`: drop the `getSmsApiKey` cases.

### `src/errors.ts`

- Remove `RateLimitError` and `DuplicatePhoneError` (both were
  SMS-share-only).
- Keep `MaxUsersError` — shared with `post-user.ts`.

### `src/services/dynamodb.ts`

- Remove `incrementTextsSent`.
- Remove the `textsSent` attribute write in `createUser`'s `Put` item.
- Drop the now-unused `RateLimitError` import.
- `__tests__/unit/services/dynamodb.test.ts`: drop the `incrementTextsSent`
  describe block and the `textsSent` attribute assertion in the `createUser`
  test.

### `src/utils/events.ts`

- Remove `PHONE_REGEX` and `parseShareBody`.
- Remove `/phone` from `ALLOWED_PATCH_PATHS` and its validation branch inside
  the patch-op loop.
- `__tests__/unit/utils/events.test.ts`: drop `parseShareBody` tests and the
  `/phone` patch-validation tests.

### `src/utils/auth.ts`

- Stop extracting `googlePhone` from JWT claims (`phone_number`).
- `__tests__/unit/utils/auth.test.ts`: drop `googlePhone` expectations.

### `src/handlers/post-user.ts`

- Remove the `phone`/`PHONE_REGEX`/`auth.googlePhone` assembly.
- Remove `textsSent: 0` and `phone` from the created `UserRecord`.
- `__tests__/unit/handlers/post-user.test.ts`: drop the `textsSent`
  assertion.

### `src/handlers/patch-user.ts`

- Remove the `/phone` branch from `applyUserPatch`.
- `__tests__/unit/handlers/patch-user.test.ts`: drop the `'should apply a
  /phone patch'` test case.

### `__tests__/unit/__mocks__.ts`

- Drop `phone`/`textsSent` from `userRecord`.
- Drop `shareInput` and the now-unused `ShareInput` import.

### `endpoints.rest`

- Remove the "Share plan via SMS" section.
- Remove the phone-patch example line; update the "Update user info" comment
  to just cover `name`.

## Verification

- `npm test` (or the project's configured test command) passes with full
  coverage thresholds intact after all of the above test-file edits.
- `grep -ri "sms\|phone" src/ __tests__/ template.yaml` (excluding
  unrelated hits like the `nouns.ts` word list) returns nothing tied to the
  removed feature.
- Confirm no other handler or util still imports anything from
  `src/services/sms.ts` or references `ShareInput`, `RateLimitError`,
  `DuplicatePhoneError`, `PHONE_REGEX`, `textsSent`, or `phone` on
  `UserRecord`.
