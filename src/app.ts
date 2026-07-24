/**
 * Client entry: install tokens + theme, register the headless components, then
 * mount the app root. Imported by the Astro page as a module script.
 */
import '@emeli/tokens/css';
import '@emeli/theme-terracotta/message-row';
import '@emeli/ui-message-row';
import '@emeli/ui-message-list';
import '@emeli/ui-message-body';
import '@emeli/ui-compose';
import './app-root.js';
