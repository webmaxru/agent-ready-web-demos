# Appendix B: check the reference tables against a site

`check-reference.mjs` requests every fixed path, robots.txt line and header from
the tables in Appendix B and prints which ones a site serves. It only reads: GET
requests, plus one MCP `tools/list` call that changes nothing.

```sh
node check-reference.mjs http://127.0.0.1:3000        # Nordlys Cabins running locally
node check-reference.mjs https://example.com --json   # any site, JSON output
```

The test starts Nordlys Cabins with every layer and checks that it serves what
the appendix says it serves, and skips what it deliberately skips:

```sh
npm test -w chapters/appendix-b-reference
```

Node.js 24 or later, no dependencies beyond the Nordlys Cabins workspace.
A "yes" means the path answered 200 or the header is present. It does not
validate the content: the chapters and the graders do that.
