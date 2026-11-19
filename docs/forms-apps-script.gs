/**
 * Lil' Outings forms -> Google Sheet (owner, Nov 2026).
 *
 * Setup (once):
 *   1. Create a Google Sheet (e.g. "Lil' Outings inbox").
 *   2. Extensions > Apps Script. Replace everything in Code.gs with this file. Save.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, allow access.
 *   4. Copy the Web app URL (https://script.google.com/macros/s/.../exec) into FORMS_ENDPOINT in web/app.js.
 * After editing this script later: Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy
 * (keeps the same URL).
 *
 * The site POSTs url-encoded fields. Each form gets its own tab, created on first use with a header row:
 *   form=suggest -> "Suggestions" (events/places people think are missing)
 *   form=partner -> "Partners"    (businesses asking about featured spots / newsletter sponsorships)
 * A hidden "website2" field is a honeypot: bots fill it, people don't, and those posts are dropped.
 * Each new row also sends you an email (set NOTIFY = false to stop that).
 */
const NOTIFY = true;

const FORMS = {
  suggest: { tab: 'Suggestions', cols: [['received', 'Received'], ['type', 'Event or place'], ['category', 'Category'], ['name', 'Name'], ['link', 'Link'], ['details', 'Where & when'], ['note', 'Note'], ['email', 'Their email'], ['page', 'Page']] },
  partner: { tab: 'Partners', cols: [['received', 'Received'], ['business', 'Business'], ['name', 'Contact name'], ['email', 'Email'], ['website', 'Website'], ['interest', 'Interested in'], ['message', 'Message'], ['page', 'Page']] }
};

function doPost(e) {
  const p = (e && e.parameter) || {};
  const form = FORMS[p.form];
  if (!form) return json({ ok: false, error: 'unknown form' });
  if (p.website2) return json({ ok: true }); // honeypot: pretend it worked

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(form.tab) || ss.insertSheet(form.tab);
    if (sh.getLastRow() === 0) {
      sh.appendRow(form.cols.map((c) => c[1]));
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, form.cols.length).setFontWeight('bold');
    }
    const row = form.cols.map(([key]) => (key === 'received' ? new Date() : clean(p[key])));
    sh.appendRow(row);
    if (NOTIFY) {
      const lines = form.cols.slice(1).map(([key, label], i) => (row[i + 1] ? `${label}: ${row[i + 1]}` : '')).filter(Boolean);
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), `Lil' Outings: new ${form.tab === 'Partners' ? 'partner enquiry' : 'suggestion'}`, `${lines.join('\n')}\n\n${ss.getUrl()}`);
    }
  } finally {
    lock.releaseLock();
  }
  return json({ ok: true });
}

// Plain text only, capped, and never a formula (a cell starting with = + - @ is stored as text).
function clean(v) {
  const s = String(v == null ? '' : v).slice(0, 2000).trim();
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
