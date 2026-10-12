'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const validators = require('../src/lib/validators');
const root = path.resolve(__dirname, '..');
const ejs = require('ejs');
const layoutFile = path.join(root, 'src/views/partials/app-end.ejs');
const layout = ejs.render(fs.readFileSync(layoutFile, 'utf8'), { mobileNav: [], release: 'test', currentPath: '/', iconSvg: () => '' }, { filename: layoutFile });
assert.equal((layout.match(/<script\b[^>]*src="\/js\/app\.js/g) || []).length, 1);
assert.equal((layout.match(/<\/body>/g) || []).length, 1);

// Run helper definitions without the privileged CLI dispatcher or system writes.
const helperSource = fs.readFileSync(path.join(root, 'scripts/hostpanelctl.js'), 'utf8');
const helper = vm.createContext({ require, process: { geteuid: () => 0 }, console });
vm.runInContext(helperSource.slice(0, helperSource.indexOf('const [action, ...args]')), helper);
vm.runInContext('fail = (message) => { throw new Error(message); };', helper);
for (const raw of ['/nusantara-hostpanel/apps/riskapay', ' /nusantara-hostpanel/apps/riskapay/ ']) {
  assert.equal(helper.safePath(raw), validators.workingDir(raw));
}
for (const raw of ['/srv/apps/riskapay', '/etc/passwd', '/nusantara-hostpanel/apps/../etc', '/nusantara-hostpanel/apps/.', '/nusantara-hostpanel/apps/', '/nusantara-hostpanel/apps-evil/news', '/nusantara-hostpanel/apps/news;id']) {
  assert.throws(() => validators.workingDir(raw));
  assert.throws(() => helper.safePath(raw));
}
assert.equal(helper.certificatePatternCoversDomain('*.panel.firda.uz', 'riskapay.panel.firda.uz'), true);
assert.equal(helper.certificatePatternCoversDomain('*.panel.firda.uz', 'panel.firda.uz'), false);
assert.equal(helper.certificatePatternCoversDomain('*.panel.firda.uz', 'www.riskapay.panel.firda.uz'), false);
assert.equal(helper.certificatePatternCoversDomain('*.panel.firda.uz', 'riskapay.evilpanel.firda.uz'), false);

const wildcard = { name: 'panel.firda.uz-wildcard', certDir: '/etc/letsencrypt/live/panel.firda.uz-wildcard', names: ['panel.firda.uz', '*.panel.firda.uz'], exact: false };
helper.findCertificateForDomain = () => wildcard;
helper.detectPhpSocket = () => '/run/php/php8.2-fpm.sock';
const settings = helper.safeDomainProxySettings({ hostname: 'riskapay.panel.firda.uz', port: 4100 });
for (const config of [helper.nginxLocalTlsConfig(settings.domain, settings.port, wildcard.certDir), helper.phpMyAdminTlsConfig('db.panel.firda.uz', wildcard.certDir), helper.nginxAdvancedConfig(settings, 'local').content]) {
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.doesNotMatch(config, /TLSv1\.0\.0/);
  assert.ok(config.includes(wildcard.certDir + '/fullchain.pem'));
}
let activated = 0;
helper.activateExistingCertificate = () => { activated++; };
helper.certbotAcquire = () => { throw new Error('ACME must not run for an existing certificate'); };
helper.certbotIssue('riskapay.panel.firda.uz', '', 4100);
assert.equal(activated, 1);

// Real frontend bundle executed twice: each click must toggle exactly once.
class Element {
  constructor(classes = []) { this.classes = new Set(classes); this.attrs = {}; this.events = {}; this.classList = { contains: x => this.classes.has(x), add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), toggle: (x, force) => { const on = force ?? !this.classes.has(x); on ? this.classes.add(x) : this.classes.delete(x); return on; } }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  click() { (this.events.click || []).forEach(fn => fn({})); }
}
const sidebar = new Element(['-translate-x-full']), backdrop = new Element(['hidden']), toggle = new Element(), closer = new Element(), body = new Element();
const windowEvents = {};
const window = { innerWidth: 390, addEventListener: (name, fn) => { (windowEvents[name] ||= []).push(fn); } };
const document = { body, querySelector: s => ({ '[data-sidebar]': sidebar, '[data-sidebar-backdrop]': backdrop })[s] || null, querySelectorAll: s => ({ '[data-sidebar-toggle]': [toggle], '[data-sidebar-close]': [closer] })[s] || [] };
const frontend = vm.createContext({ window, document });
const bundle = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
vm.runInContext(bundle, frontend); vm.runInContext(bundle, frontend);
assert.equal(toggle.events.click.length, 1);
toggle.click(); assert.equal(toggle.attrs['aria-expanded'], 'true'); assert.equal(backdrop.classes.has('hidden'), false);
backdrop.click(); assert.equal(toggle.attrs['aria-expanded'], 'false');
toggle.click(); windowEvents.keydown.forEach(fn => fn({ key: 'Escape' })); assert.equal(toggle.attrs['aria-expanded'], 'false');
window.innerWidth = 1200; windowEvents.resize.forEach(fn => fn()); assert.equal(sidebar.attrs['aria-hidden'], 'false');
window.innerWidth = 390; windowEvents.resize.forEach(fn => fn()); assert.equal(sidebar.attrs['aria-hidden'], 'true');

async function controllerScenario(existingHttps, cooldown, email) {
  const calls = [], flashes = [], updates = [];
  const d = { id: 1, hostname: 'riskapay.panel.firda.uz', target_port: 4100, ssl_retry_after: cooldown ? '2999-01-01T00:00:00Z' : null };
  const model = { find: () => d, markAttempt: (...args) => updates.push(args) };
  const service = { proxyAdvanced: async () => ({ https: existingHttps, certificateName: wildcard.name }), run: async (...args) => calls.push(args), parseSslHelperError: e => ({ type: 'generic', message: e.message }) };
  const config = { tlsMode: 'local', runtimeMode: 'system', certbotEmail: email };
  const module = { exports: {} };
  const context = vm.createContext({ module, require: name => ({ './domains.model': model, './domains.service': service, '../../lib/validators': validators, '../../core/config': config, '../../lib/audit': () => {} })[name] });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/modules/domains/domains.controller.js'), 'utf8'), context);
  await module.exports.issue({ params: { id: 1 }, workspace: { id: 1 }, flash: (...args) => flashes.push(args) }, { redirect: () => {} });
  return { calls, flashes, updates };
}
(async () => {
  const reuse = await controllerScenario(true, true, '');
  assert.equal(reuse.calls.length, 0); assert.equal(reuse.flashes[0][0], 'success');
  const cooldown = await controllerScenario(false, true, 'iam@firda.uz');
  assert.equal(cooldown.calls.length, 0); assert.match(cooldown.flashes[0][1], /ditahan/);
  const issue = await controllerScenario(false, false, 'iam@firda.uz');
  assert.equal(issue.calls[0][0], 'certbot-issue'); assert.equal(issue.flashes[0][0], 'success');
  const missingEmail = await controllerScenario(false, false, '');
  assert.equal(missingEmail.calls.length, 0); assert.match(missingEmail.flashes[0][1], /CERTBOT_EMAIL/);
  console.log('admin-regressions: ok (mobile menu, safe paths, wildcard reuse, ACME cooldown)');
})().catch(error => { console.error(error); process.exitCode = 1; });
