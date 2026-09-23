# RapiDoc, vendored

`rapidoc-min.js` is [RapiDoc](https://github.com/rapi-doc/RapiDoc) **9.3.8**,
MIT, exactly as npm ships it in `dist/rapidoc-min.js` minus its source-map
comment. It renders the API reference at `/api/docs` (#348).

It is a file here and not a line in `package.json` because the package
declares the dependencies it is *built* with — `@apitools/openapi-parser`,
`swagger-client`, thirty-odd `@swagger-api/apidom-*` packages, `tree-sitter`
with native install scripts — and the bundle needs none of them at runtime:
one self-contained web component. Installing it added 115 packages to the
lockfile to draw a page. This directory adds one.

To update: pick the release, then

```bash
docker run --rm -e HOME=/tmp -v "$PWD":/w -w /tmp node:26-alpine \
  sh -c 'npm pack rapidoc@9.3.8 >/dev/null && tar xzf rapidoc-*.tgz \
    && grep -v "^//# sourceMappingURL=" package/dist/rapidoc-min.js > /w/frontend/vendor/rapidoc/rapidoc-min.js \
    && cp package/dist/rapidoc-min.js.LICENSE.txt /w/frontend/vendor/rapidoc/THIRD-PARTY-NOTICES.txt \
    && cp package/LICENSE.txt /w/frontend/vendor/rapidoc/LICENSE.txt'
```

and change the version in this file. Dependabot does not see it; check the
release notes yourself when you do.
