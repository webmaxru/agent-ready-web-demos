# Standalone chapter demos

Most chapters add a layer to the running example in `nordlys-cabins/layers/`.
When a chapter needs a demo that does not fit the booking site (a static
content site, a tiny MCP client, a log analysis script), it lives here in its
own folder named after the chapter, for example `chapters/06-choosing-the-right-agent-interface/`.
Chapter 12 has two demos, so its folder holds two workspaces:
`chapters/12-testing-and-measuring-in-production/testing/` and
`chapters/12-testing-and-measuring-in-production/measuring/`.

Each folder has its own `README.md`. If it has a `package.json`, it is an npm
workspace of this repository: `npm install` at the repository root installs it,
and `npm test -w chapters/<folder>` runs its tests (for Chapter 12,
`-w chapters/12-testing-and-measuring-in-production/testing` and so on). Name the scripts `test:unit`
(node:test, no browser) and `test:e2e` (Playwright): the root `npm run test:unit` and
`npm run test:e2e`, and CI, run those scripts in every workspace that has them.
