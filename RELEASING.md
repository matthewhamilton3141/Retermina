# Releasing Retermina

Releases are built and published automatically by
[`.github/workflows/release.yml`](.github/workflows/release.yml) whenever you
push a version tag. The workflow builds signed installers for macOS, Windows,
and Linux, generates the updater manifest (`latest.json`), and attaches
everything to a GitHub Release. The in-app auto-updater reads that release via
the endpoint configured in `src-tauri/tauri.conf.json`:

```
https://github.com/matthewhamilton3141/Retermina/releases/latest/download/latest.json
```

## One-time setup: signing secrets

The updater verifies every download against the public key baked into
`tauri.conf.json` (`plugins.updater.pubkey`). CI needs the **matching private
key** to sign builds. Add these as repository secrets
(GitHub → repo → Settings → Secrets and variables → Actions → New secret):

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | The minisign **private** key that pairs with the `pubkey` in `tauri.conf.json` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password set when that key was generated (empty string if none) |

### If you don't have the private key

If the original private key is lost, generate a fresh keypair and replace the
public key in the config:

```bash
npm run tauri signer generate -- -w ~/.tauri/retermina.key
```

This prints a **public key** — paste it into `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json` — and writes the **private key** to the file path.
Put the private key's contents in `TAURI_SIGNING_PRIVATE_KEY` and its password
in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

> Regenerating the key means apps signed with the *old* key can no longer
> auto-update to builds signed with the *new* one. That's fine before you have
> real users; just make sure the first public release uses the final key.

## Cutting a release

1. **Bump the version** in all three places (keep them in sync):
   - `package.json` → `npm version <x.y.z> --no-git-tag-version`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version` (and the `retermina` entry in `Cargo.lock`)
2. **Commit** the bump to `main`.
3. **Tag and push** — the tag must start with `v` and match the version:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The **Release** workflow runs (~10–20 min across platforms). When it
   finishes it creates a **draft** GitHub Release with the installers and
   `latest.json` attached.
5. **Review and publish** the draft on GitHub.

> The updater only sees a **published, non-prerelease** release. While the
> release stays a draft, existing apps won't offer the update — publish when
> you're ready for users to receive it.

## Notes

- **Apple notarization is optional.** Updater signing (above) is separate from
  Apple code signing. Without an Apple Developer account, macOS users get a
  Gatekeeper "unidentified developer" warning and must right-click → Open the
  first time — but the app and auto-updates still work. Add Apple signing later
  for a warning-free install.
- The build runs `npm run build` (`tsc && vite build`) first, so a type error
  or failing build will fail the release before anything is published.
