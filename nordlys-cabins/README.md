# Nordlys Cabins

The running example of *The Agent-Ready Web*: a small cabin-rental
booking site, made agent-ready one layer per chapter.

```sh
npm start                              # clean front end, every layer
npm start -- --upto=6                  # the site after Chapter 6
npm start -- --variant=legacy --upto=0 # the agent-hostile baseline
npm test
```

Writing a chapter layer? Read [LAYERS.md](LAYERS.md). Everything else is in the
[repository README](../README.md).
