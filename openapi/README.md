# The spec, in pieces

`openapi.yaml` at the repo root is **generated**. Edit the files here instead,
then `make generate`.

```
openapi/
  openapi.yaml          the index: info, servers, security, shared components,
                        and one $ref per path and per schema — in the document's
                        original order
  paths/<domain>.yaml   82 path items, grouped by domain
  components/<domain>.yaml   90 schemas, grouped the same way
```

## Why it is bundled rather than read directly

The spec was one 4,600-line file, which made it the file two branches were most
likely to edit at once — and a merge conflict in 4.6k lines of YAML is
unpleasant in a way a conflict in Go is not (#114).

Splitting it was supposed to be a file move. It was not:

- **openapi-typescript** follows external `$ref`s without being asked. It
  produced byte-identical output on the first try.
- **oapi-codegen** cannot. An external reference means "this type is generated
  into a different Go package" — so without `--import-mapping` it refuses
  outright, and with it, it emits `type Health = Health` and drops the
  definition, enums and all. There is no flatten or bundle flag.

So the tree is bundled back into one document first, and both generators go on
reading exactly what they read before.

## The check that keeps this honest

The bundler is not trusted on inspection. `make generate` must produce
**byte-identical** `api.gen.go` and `schema.d.ts` — a bundler that dropped,
reordered or subtly rewrote something would move them, and CI's codegen job runs
that comparison on every change.

That is also why the index in `openapi/openapi.yaml` keeps the original document
order rather than grouping by domain: openapi-typescript emits declarations in
document order, so regrouping the index would rewrite half of `schema.d.ts` for
nothing and cost that proof.

## Working in here

- **Adding an endpoint** — the path item goes in `paths/<domain>.yaml`, its
  schemas in `components/<domain>.yaml`, and one `$ref` line for each goes in the
  index. Then `make generate`.
- **Refs to shared things** — from inside a domain file, the document is no
  longer the spec, so components are reached through the root:
  `$ref: "../openapi.yaml#/components/schemas/Error"`. The index and the small
  shared blocks (`parameters`, `responses`, `securitySchemes`) use plain
  `#/components/...` because for them the root *is* the document.
- **A path key in a `$ref`** is JSON-Pointer escaped — `/` becomes `~1`, so
  `/campaigns/{campaignId}` is `#/~1campaigns~1{campaignId}`.

## The bundler

`frontend/scripts/bundle-spec.mjs`, run by `npm run gen:bundle` and by
`make gen-spec`. It uses `@apidevtools/json-schema-ref-parser` rather than a full
OpenAPI toolchain: `@redocly/cli` does the same job and brings OpenTelemetry,
react-router and three critical advisories along to concatenate YAML. This adds
33 lines to the lockfile and no advisories.
