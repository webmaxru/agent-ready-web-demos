# Nordlys Cabins

The running example of *Agent-Ready Websites in Action*: a small cabin-rental
booking site, made agent-ready layer by layer, chapter by chapter.

```sh
npm start                              # clean front end, every layer
npm start -- --upto=5                  # the site after Chapter 5
npm start -- --variant=legacy --upto=0 # the agent-hostile baseline
npm test
```

Writing a chapter layer? Read [LAYERS.md](LAYERS.md). Everything else is in the
[repository README](../README.md).
