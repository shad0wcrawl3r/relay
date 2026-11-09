# Opening Relay on Windows (SmartScreen)

Relay's Windows builds aren't code-signed yet, so Windows warns before
running them. This page explains why and how to get past each warning.

## Why it happens

- Windows tags every file downloaded from the internet (the "Mark of the
  Web"). When you open a tagged file, Microsoft Defender SmartScreen checks
  its reputation.
- Reputation comes from the code-signing certificate. An unsigned file
  only has the reputation of its exact contents, and nobody has run a new
  release before you.
- So every new release starts with no reputation and gets the warning. The
  warning doesn't mean anything was found in the file. It means Windows
  hasn't seen it before.

## First, check the download

Only download Relay from the
[GitHub releases](https://github.com/shad0wcrawl3r/relay/releases) or
[relay.shadowcrawler.dev](https://relay.shadowcrawler.dev). Then check
the file against `SHA256SUMS` from the same release. In PowerShell:

```powershell
Get-FileHash .\relay-amd64-installer.exe -Algorithm SHA256
```

The hash must match the line for that file in `SHA256SUMS`. If it doesn't,
delete the file and don't run it.

## What you might see, and what to do

### The browser blocks the download

- **Edge** says the file "isn't commonly downloaded". Open the Downloads
  panel, point at the file, click **⋯ → Keep**, then
  **Show more → Keep anyway**.
- **Chrome** shows "This file isn't commonly downloaded". Click **Keep** in
  the Downloads panel.

### "Windows protected your PC"

Click **More info**, then **Run anyway**. This applies to the installer and
to the portable `relay.exe`.

### There's no Run anyway button

**Turn on Developer Mode, then restart.** This worked on a Windows 11 PC
that had no Run anyway button and no Unblock box:

1. Open **Settings → System → For developers**. On Windows 10 it's
   **Settings → Update & Security → For developers**.
2. Turn on **Developer Mode** and confirm.
3. Restart the PC. The change doesn't apply until you do.
4. Run the installer again.

Developer Mode also allows other developer features, such as installing
unsigned app packages, so turn it off afterwards if you don't need it. We
haven't checked whether turning it off blocks the installed Relay again.
If it does, please [open an issue](https://github.com/shad0wcrawl3r/relay/issues).

**Or clear the file's download tag**, if your PC offers it:

1. Right-click the file and open **Properties**.
2. On the **General** tab, tick **Unblock** next to Security, then click
   **OK**.

Or in PowerShell:

```powershell
Unblock-File .\relay-amd64-installer.exe
```

Some PCs don't show the **Unblock** box at all. Use Developer Mode
there.

### "Smart App Control blocked an app that may be unsafe" (Windows 11)

Smart App Control blocks unsigned apps, and there's no per-app exception.
Your options:

- Run Relay on another machine or in a VM, until signed builds exist.
- Turn Smart App Control off in **Windows Security → App & browser
  control → Smart App Control settings**. On some Windows versions this
  can't be turned back on without reinstalling Windows, so read the prompt
  before you confirm.

### Microsoft Defender quarantines relay.exe

Unsigned Go programs sometimes trigger false positives. If the hash matches
`SHA256SUMS`:

- restore the file from **Windows Security → Virus & threat protection →
  Protection history**;
- report it as a false positive at
  <https://www.microsoft.com/wdsi/filesubmission>.

Then please
[open an issue](https://github.com/shad0wcrawl3r/relay/issues) with the
detection name.

### A work or school PC

Your organisation's policy can remove **Run anyway** and **Unblock**, and block Developer Mode. Ask
your IT team, or use a personal machine.

## Fixing it properly

The real fix is signing the Windows builds. Options under consideration:

- SignPath's free signing for open-source projects;
- Azure Artifact Signing (formerly Trusted Signing), where eligible;
- a standard code-signing certificate.

Even signed builds build up SmartScreen reputation over time, so early
downloads of a signed release can still warn.
