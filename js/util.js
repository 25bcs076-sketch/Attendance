/**
 * util.js — small shared helpers used across pages.
 */
const Util = (() => {
  // Every page that builds HTML strings out of student/professor-entered
  // text (name, roll number, subject, teacher name, etc.) via innerHTML
  // must escape it first, or a value like `<img src=x onerror=...>` typed
  // into any form field runs as script on whoever's screen renders it next
  // (the professor's dashboard, the report, etc.).
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { escapeHtml };
})();
