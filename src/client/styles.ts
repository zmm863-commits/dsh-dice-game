/**
 * dsh-dice-game styles. Scoped by the plugin's own data attributes and class
 * names so nothing leaks into the rest of the GUI; colors ride the dsh
 * --dsw-* tokens so the panel follows the active theme (light/dark and skins),
 * with neutral fallbacks when a token is missing.
 */

const CSS = `
/* --- center-column takeover (global rules, attribute-scoped) ---------------- */

[data-pane='conversation'] {
  position: relative;
}

/* The panel container rides inside the conversation grid item as an extra
   trailing child; hidden unless the panel is active. */
[data-dsh-dicegame-view] {
  position: absolute;
  inset: 0;
  display: none;
  /* Above the conversation composer (z-index 7 in the 0.1.0-rc.6 shell) so the
     panel paints over the input card. */
  z-index: 60;
  background: var(--dsw-alias-bg-base, #101018);
  flex-direction: column;
}

html[data-dsh-dicegame-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-dicegame-view] {
  display: flex;
}

/* While the panel is active, the conversation content underneath is hidden
   (it stays mounted and stateful). */
html[data-dsh-dicegame-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-dicegame-view]),
html[data-dsh-dicegame-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-dicegame-view]) {
  display: none !important;
}

/* --- title bar -------------------------------------------------------------- */

.dsh-dicegame-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  flex: 0 0 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-subtle, rgba(127,127,137,.2));
  background: var(--dsw-alias-bg-elevated, #1a1a24);
  box-sizing: border-box;
}

.dsh-dicegame-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #e6e6ef);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsh-dicegame-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--dsw-alias-border-subtle, rgba(127,127,137,.3));
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9a9ab0);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}

.dsh-dicegame-bar-btn:hover {
  background: var(--dsw-alias-bg-hover, rgba(127,127,137,.15));
  color: var(--dsw-alias-label-primary, #e6e6ef);
}

/* --- game iframe ------------------------------------------------------------ */

.dsh-dicegame-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: none;
  background: #0f0c29; /* the game's own backdrop */
  display: block;
}

/* --- sidebar entry row ------------------------------------------------------ */

.dsh-dicegame-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #9a9ab0);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.dsh-dicegame-entry:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover, rgba(127,127,137,.12));
  color: var(--dsw-alias-label-primary, #e6e6ef);
}

.dsh-dicegame-entry[data-active] {
  background: var(--dsw-specific-sidebar-nav-item-active, rgba(127,127,137,.2));
  color: var(--dsw-alias-label-primary, #e6e6ef);
  font-weight: 600;
}

.dsh-dicegame-entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex: 0 0 16px;
}

.dsh-dicegame-entry-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

const STYLE_ID = 'dsh-dicegame/styles.css'

/** Inject the plugin stylesheet once (idempotent). */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-dice-game'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
