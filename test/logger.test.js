'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { createLogger, LEVELS } = require('../src/logger');

test('createLogger returns an object with log methods', () => {
  const log = createLogger();
  assert.strictEqual(typeof log.debug, 'function');
  assert.strictEqual(typeof log.info, 'function');
  assert.strictEqual(typeof log.warn, 'function');
  assert.strictEqual(typeof log.error, 'function');
});

test('createLogger respects level filtering', () => {
  const messages = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args) => messages.push(args.join(' '));
  console.warn = (...args) => messages.push(args.join(' '));
  console.error = (...args) => messages.push(args.join(' '));

  try {
    const log = createLogger({ level: 'warn' });
    log.debug('hidden debug');
    log.info('hidden info');
    log.warn('visible warn');
    log.error('visible error');

    assert.ok(messages.every((m) => !m.includes('hidden')), 'debug and info should be filtered');
    assert.ok(messages.some((m) => m.includes('visible warn')));
    assert.ok(messages.some((m) => m.includes('visible error')));
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
});

test('createLogger JSON mode produces parseable output', () => {
  const messages = [];
  const origError = console.error;
  console.error = (...args) => messages.push(args.join(' '));

  try {
    const log = createLogger({ level: 'info', json: true });
    log.error('test error', { code: 500 });

    assert.strictEqual(messages.length, 1);
    const parsed = JSON.parse(messages[0]);
    assert.strictEqual(parsed.level, 'error');
    assert.strictEqual(parsed.message, 'test error');
    assert.strictEqual(parsed.meta.code, 500);
    assert.ok(parsed.timestamp);
  } finally {
    console.error = origError;
  }
});

test('createLogger child inherits prefix', () => {
  const messages = [];
  const origInfo = console.log;
  console.log = (...args) => messages.push(args.join(' '));

  try {
    const log = createLogger({ level: 'info', prefix: 'app' });
    const child = log.child({ prefix: 'server' });
    child.info('starting');

    assert.ok(messages.some((m) => m.includes('[app:server]')));
  } finally {
    console.log = origInfo;
  }
});

test('LEVELS has correct numeric ordering', () => {
  assert.strictEqual(LEVELS.debug, 10);
  assert.strictEqual(LEVELS.info, 20);
  assert.strictEqual(LEVELS.warn, 30);
  assert.strictEqual(LEVELS.error, 40);
});
