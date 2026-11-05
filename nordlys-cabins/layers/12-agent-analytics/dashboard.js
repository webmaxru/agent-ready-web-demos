// The /__agents page: plain server-rendered tables, no scripts, no inline styles.

const LABELS = {
  'signed-agent': 'Signed agent (Web Bot Auth verified)',
  training: 'Training crawler',
  search: 'Search crawler',
  'user-fetch': 'User-triggered fetch',
  'browsing-agent': 'Browsing agent',
  'other-bot': 'Other or unverified bot',
  unknown: 'Unknown (mostly people)',
};

export function dashboardPage({ html, toString }, s) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const ratio = (p) => (p.crawlToRefer === null ? 'no referrals yet' : `${p.crawlToRefer.toFixed(1)} : 1`);
  return toString(html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Agent traffic | Nordlys Cabins</title>
  <link rel="stylesheet" href="/css/site.css">
</head>
<body>
<main id="main">
  <h1>Agent traffic</h1>
  <p>${s.total} requests since the server started (${s.period.first ?? 'none yet'} to ${s.period.last ?? 'none yet'}).
     JSON: <a href="/__agents.json">/__agents.json</a></p>

  <table>
    <caption>Requests by kind of visitor</caption>
    <thead><tr><th scope="col">Visitor</th><th scope="col">Requests</th><th scope="col">Share</th><th scope="col">HTML pages</th></tr></thead>
    <tbody>${s.classes.map((c) => html`<tr><th scope="row">${LABELS[c.name]}</th><td>${c.requests}</td><td>${pct(c.share)}</td><td>${c.html}</td></tr>`)}</tbody>
  </table>

  <table>
    <caption>Named agents and the evidence behind each label</caption>
    <thead><tr><th scope="col">Agent</th><th scope="col">Counted as</th><th scope="col">Evidence</th><th scope="col">Requests</th></tr></thead>
    <tbody>${s.agents.map((a) => html`<tr><th scope="row">${a.agent}</th><td>${LABELS[a.class]}</td><td>${a.evidence}</td><td>${a.requests}</td></tr>`)}</tbody>
  </table>

  <table>
    <caption>Platforms: crawling compared with visitors sent back</caption>
    <thead><tr><th scope="col">Platform</th><th scope="col">Crawls</th><th scope="col">User fetches</th><th scope="col">Agent visits</th><th scope="col">Referrals</th><th scope="col">Crawl-to-refer</th></tr></thead>
    <tbody>${s.platforms.map((p) => html`<tr><th scope="row">${p.name}</th><td>${p.crawls}</td><td>${p.userFetches}</td><td>${p.agentVisits}</td><td>${p.referrals}</td><td>${ratio(p)}</td></tr>`)}</tbody>
  </table>

  <table>
    <caption>Bookings by kind of visitor</caption>
    <thead><tr><th scope="col">Visitor</th><th scope="col">Bookings</th></tr></thead>
    <tbody>${Object.entries(s.bookings.byClass).map(([k, n]) => html`<tr><th scope="row">${LABELS[k] ?? k}</th><td>${n}</td></tr>`)}</tbody>
  </table>
</main>
</body>
</html>`);
}
