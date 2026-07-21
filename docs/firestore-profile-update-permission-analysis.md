# Firestore Profile Update Permission Analysis

## Context

Some users hit `Missing or insufficient permissions` when saving Account `Full Name`.

The Account form writes to `users/{uid}` through `profiles.upsert`, changing:

- `full_name`
- `avatar_url`
- `updated_at`

## Finding

`firestore.rules` validates the full post-update `users/{uid}` document with `validUser(request.resource.data)`.
Older user documents can fail this full schema validation even when the current write only changes `full_name`.
Common legacy causes are missing required fields such as `credits` / `created_at`, string timestamps, or historical extra fields.

## Rule Change

The update rule still keeps `credits`, `subscription_status`, `created_at`, and `custom_provider` immutable from clients.
It now also allows a legacy-safe profile update path only when the affected fields are limited to:

- `full_name`
- `avatar_url`
- `updated_at`

Those fields are still type- and size-validated.

## Security Check

- Users cannot update another user's profile because `isOwner(userId)` is still required.
- Users cannot self-grant credits or paid plans because sensitive fields must stay unchanged.
- Users cannot change roles through the legacy path because affected keys must be profile-only.
- Schema pollution is still blocked for normal full-document-valid updates; the legacy path only tolerates existing legacy shape while limiting the current mutation.

## Follow-Up

Backfill legacy `users/{uid}` documents with canonical fields and timestamp types so the fallback path can be removed later.
