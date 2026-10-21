/**
 * Server-rendered page for a shared time report.
 *
 * A report link has to open in any browser (it is typically sent through
 * WhatsApp), so the page is plain self-contained HTML with no client bundle and
 * no API credentials. Everything it shows comes from the resolved token, and
 * every value is escaped.
 */

const escapeHtml = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDuration = (ms) => {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
};

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #1b1c23;
    --card: #2a2b35;
    --line: rgba(255,255,255,.08);
    --text: #f5f6fa;
    --muted: #9aa0b4;
    --accent: #3b82f6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 48px;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 13px; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px;
    margin-top: 16px;
  }
  .total { font-size: 34px; font-weight: 700; margin: 4px 0 0; }
  .row { display: flex; align-items: center; gap: 10px; }
  .row + .row { margin-top: 10px; }
  .row .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .value { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; margin-top: 4px; }
  .bar > span { display: block; height: 100%; background: var(--accent); }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 12px; }
  .win { margin: 6px 0 0 14px; font-size: 13px; color: var(--muted); }
  .empty { color: var(--muted); }
  footer { margin-top: 24px; font-size: 12px; color: var(--muted); text-align: center; }
  @media (max-width: 480px) { .total { font-size: 28px; } }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;

function renderNotFound() {
  return page(
    "Report unavailable",
    `<div class="card">
       <h1>This report is not available</h1>
       <p class="muted">The link may have expired, been revoked, or never existed.</p>
     </div>`
  );
}

function renderReport(report) {
  const maxDay = report.byDate.reduce(
    (max, d) => (d.totalDuration > max ? d.totalDuration : max),
    0
  );
  const maxApp = report.byApp.reduce(
    (max, a) => (a.totalDuration > max ? a.totalDuration : max),
    0
  );

  const range =
    report.dateFrom === report.dateTo
      ? escapeHtml(report.dateFrom)
      : `${escapeHtml(report.dateFrom)} &rarr; ${escapeHtml(report.dateTo)}`;

  const header = `
    <h1>${escapeHtml(report.title || "Time report")}</h1>
    <p class="muted">
      ${report.ownerName ? `Shared by ${escapeHtml(report.ownerName)} &middot; ` : ""}${range}
    </p>
    <div class="card">
      <h2>Total tracked time</h2>
      <p class="total">${escapeHtml(formatDuration(report.totalDuration))}</p>
      <p class="muted">${report.totalApps} application${report.totalApps === 1 ? "" : "s"} &middot; ${report.totalDays} day${report.totalDays === 1 ? "" : "s"}</p>
    </div>`;

  const days = report.byDate.length
    ? `<div class="card">
         <h2>By day</h2>
         ${report.byDate
           .map(
             (d) => `<div class="row">
               <div class="name">
                 ${escapeHtml(d.date)}
                 <div class="bar"><span style="width:${
                   maxDay > 0 ? Math.round((d.totalDuration / maxDay) * 100) : 0
                 }%"></span></div>
               </div>
               <div class="value">${escapeHtml(formatDuration(d.totalDuration))}</div>
             </div>`
           )
           .join("")}
       </div>`
    : "";

  const apps = report.byApp.length
    ? `<div class="card">
         <h2>By application</h2>
         ${report.byApp
           .map(
             (a) => `<div class="row">
               <div class="name">
                 ${escapeHtml(a.appName)}
                 <div class="bar"><span style="width:${
                   maxApp > 0 ? Math.round((a.totalDuration / maxApp) * 100) : 0
                 }%"></span></div>
                 ${(a.windows || [])
                   .slice(0, 5)
                   .map(
                     (w) =>
                       `<div class="win">${escapeHtml(w.title)} &middot; ${escapeHtml(
                         formatDuration(w.durationMs)
                       )}</div>`
                   )
                   .join("")}
               </div>
               <div class="value">${escapeHtml(formatDuration(a.totalDuration))}</div>
             </div>`
           )
           .join("")}
       </div>`
    : `<div class="card"><p class="empty">No tracked activity in this period.</p></div>`;

  const footer = `<footer>Read-only report &middot; link expires ${escapeHtml(
    new Date(report.expiresAt).toISOString().split("T")[0]
  )}</footer>`;

  return page(report.title || "Time report", header + days + apps + footer);
}

module.exports = { renderReport, renderNotFound, formatDuration, escapeHtml };
