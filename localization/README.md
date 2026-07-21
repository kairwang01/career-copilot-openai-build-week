# Localization workflow

`localization/*.json` is the canonical translation source. The app serves the generated mirror from
`public/localization/*.json` at runtime.

After editing translations, run:

```sh
npm run localization:sync
```

`npm run localization:check` verifies that every locale has the same keys and interpolation
placeholders as English, and that the public mirror is byte-for-byte current. It runs automatically
before `npm run build`.

The sync is idempotent and writes only changed locale files. It refuses to delete a locale file or key
that exists only in `public/localization`; promote that content into the canonical source first. Both
directories remain tracked so a sync is reviewable and reversible through the normal Git workflow.
