# Chapter 6: a decision helper

`plan.mjs` holds the chapter's decision trees and staged plan as data, and
`decide.mjs` prints a plan for one site (a content site also gets an "Also do" line):

```sh
node decide.mjs --type booking                     # content | booking | saas | ecommerce
node decide.mjs --type ecommerce --platform shopify # shopify | wordpress | cloudflare | custom
node decide.mjs --type saas --has-api
npm run test:unit -w chapters/06-choosing-the-right-agent-interface   # or: node --test
```

The stages map to the isitagentready.com levels and the Lighthouse Agentic
Browsing audits as of 2 November 2026. Edit the data when they change.
