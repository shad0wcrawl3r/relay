# Security policy

Relay holds tokens for Plane, Dev.to and Buffer, can publish and schedule posts
in your name, and runs a shell. Security reports are welcome and taken
seriously.

How Relay is built to stay safe is written up in
[docs/threat-model.md](docs/threat-model.md).

## Reporting a vulnerability

Please report privately. Don't open a public issue for a security problem.

- **GitHub (preferred):** [report a vulnerability](https://github.com/shad0wcrawl3r/relay/security/advisories/new)
  through private vulnerability reporting.
- **Email:** relay+security@shadowcrawler.dev

Include what you found, the steps to reproduce it, the Relay version and platform
(Settings → About → Copy build info) and what an attacker could do with it.
Please leave out real tokens, article text and anything from private projects.

## What to expect

- A reply within 3 days saying the report arrived and whether it reproduces.
- A fix in a new release as soon as it's ready. Relay has no bug bounty, but
  you'll be credited in the advisory and the changelog unless you'd rather not
  be.
- Coordinated disclosure: please give a fix up to 90 days before publishing
  details. We'll agree on a date together.

## Supported versions

Only the latest release gets security fixes. Installed copies are offered the
update at their next launch.

## Scope

In scope:

- The Relay desktop app (this repository).
- relay.shadowcrawler.dev, including the OAuth callback page (`site/`).
- The release pipeline (`.github/workflows`).

Out of scope:

- Plane, Dev.to, Buffer and AI providers themselves. Report those to them.
- Attacks that need an already compromised machine or the user's unlocked
  session and login password.
- Missing hardening with no practical impact (for example, missing headers on
  static pages that hold no data).

## Safe harbour

Research done in good faith, within this policy, against your own accounts and
installs, won't be treated as an attack. Don't access other people's data,
degrade the services Relay talks to, or publish from accounts that aren't yours.
