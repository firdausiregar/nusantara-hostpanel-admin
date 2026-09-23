'use strict';
const assert = require('node:assert/strict');
const v = require('../src/lib/validators');
const extra = require('../src/core/security/validators');
const { validatePassword } = require('../src/lib/password-policy');

// Network/domain/path trust-boundary inputs.
assert.equal(v.domain('Example.COM.'), 'example.com');
assert.throws(() => v.domain('example.com;rm -rf /'));
assert.throws(() => v.domain('-bad.example.com'));
assert.equal(v.port('4100'), 4100);
assert.throws(() => v.port('80'));
assert.equal(v.workingDir('/nusantara-hostpanel/apps/news'), '/nusantara-hostpanel/apps/news');
assert.throws(() => v.workingDir('/nusantara-hostpanel/apps/../etc'));
assert.throws(() => v.entryFile('../../etc/passwd'));
assert.equal(v.recordName('*'), '*');
assert.equal(v.recordName('*.regional'), '*.regional');
assert.throws(() => v.recordName('foo*'));

// Deployment input: public GitHub HTTPS only; no shell-like branch/script input.
assert.equal(extra.gitRepo('https://github.com/firdausiregar/nusantara-hostpanel-admin'), 'https://github.com/firdausiregar/nusantara-hostpanel-admin');
assert.equal(extra.gitRepo(''), '');
assert.throws(() => extra.gitRepo('git@github.com:owner/repo.git'));
assert.throws(() => extra.gitRepo('https://evil.example/owner/repo'));
assert.equal(extra.gitBranch('feature/mvc'), 'feature/mvc');
assert.throws(() => extra.gitBranch('../main'));
assert.equal(extra.npmScript('build:prod'), 'build:prod');
assert.throws(() => extra.npmScript('build && id'));
assert.equal(extra.healthPath('/healthz'), '/healthz');
assert.throws(() => extra.healthPath('http://169.254.169.254/latest/meta-data'));
assert.throws(() => extra.healthPath('/../etc/passwd'));

// Database identifiers are deliberately narrow and localhost users are enforced by helper logic.
assert.equal(extra.databaseName('kabar_nusantara'), 'kabar_nusantara');
assert.throws(() => extra.databaseName('db;DROP DATABASE mysql'));
assert.equal(extra.databaseUser('kabar_app'), 'kabar_app');
assert.throws(() => extra.databaseUser("user'@'%"));
assert.equal(extra.optionalInteger('512',0,65536,'Memory'),512);
assert.throws(() => extra.optionalInteger('-1',0,65536,'Memory'));
assert.throws(() => extra.optionalInteger('999999',0,65536,'Memory'));

// bcrypt input policy.
assert.equal(validatePassword('correct horse battery staple'), 'correct horse battery staple');
assert.throws(() => validatePassword('short'));
assert.throws(() => validatePassword('😀'.repeat(19))); // 76 UTF-8 bytes > bcrypt limit

console.log('security-basics: ok');
