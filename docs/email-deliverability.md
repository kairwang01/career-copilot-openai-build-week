# Transactional email launch gate

**Release status:** external evidence required. The repository cannot prove the
current Firebase Auth sender configuration, domain authentication, or mailbox
delivery. Customer launch is blocked until the release owner records that
evidence for the exact target project.

## Product dependency

Password-based users whose Firebase account has `emailVerified === false` are
stopped by `components/VerifyEmailGate.tsx` before the candidate or employer
workspace mounts. The gate sends/resends a verification message, lets the user
reload verification state, enforces a client-side resend cooldown, and offers
sign-out. Federated providers that return an already verified Firebase account do
not enter this state.

Password reset is also a hard email dependency. A successful client API response
only proves that Firebase accepted the send request; it does not prove that a
message reached inbox or spam.

Do not remove or bypass the verification gate merely to make a release test pass.
If reliable delivery is not available, record a launch blocker and keep the
candidate out of customer production.

## Required evidence for the target project

Record all of the following in the release/change record without copying secrets
or user-specific action links:

1. Explicit Firebase project ID, inspected Identity Platform/Firebase Auth email
   template and sender configuration, and the operator/time of inspection.
2. Permanent sending domain and provider, plus current SPF, DKIM, and DMARC
   validation from an owner-controlled DNS account.
3. Permanent action URL/canonical app URL and an allowlisted redirect test.
4. End-to-end verification and password-reset tests from new accounts to at least
   one consumer mailbox and representative customer corporate mailboxes. Record
   delivery time, inbox/spam result, link completion, and expiry/reuse behavior.
5. Resend/rate-limit behavior, typo recovery or support path, and an approved
   procedure for users who cannot receive mail.
6. Sender reputation/bounce monitoring, incident owner, and rollback/escalation
   contact.

The test must be rerun after sender, DNS, Auth template, canonical domain, or
Identity Platform changes. Historical observations are not release evidence.

## Safe support procedure

An authorized support operator may use a reviewed server-side/Admin SDK procedure
to generate a one-user verification or reset link only under an identity-checked
support ticket. Treat the link as an authentication secret: do not print it in
shared logs, commit it, attach it to an issue, or expose an admin access token to a
browser. Record only redacted operational evidence and the final outcome.

This support path is incident recovery, not a substitute for working bulk email
delivery.

## Release decision

The gate is green only when both verification and password reset pass the real
mailbox matrix for the exact release project and permanent domain. Until then,
the code can be a locally tested release candidate, but the product is **NO-GO
for password-based customer onboarding**.

The ordered deployment and acceptance checks are in
[`deploy-checklist.md`](deploy-checklist.md) and
[`deployment/README.md`](deployment/README.md).
