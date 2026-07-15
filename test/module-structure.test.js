'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const packageApi = require('..');
const domainEngine = require('../src/engine');
const domainFormulaEngine = require('../src/engine/formula-engine');
const legacyFormulaEngine = require('../src/formula-engine');

test('package root exposes flat exports and domain namespaces', () => {
  for (const namespace of ['audit', 'core', 'engine', 'finance', 'server', 'services']) {
    assert.equal(typeof packageApi[namespace], 'object');
  }

  assert.equal(packageApi.getAllOpportunities, packageApi.engine.getAllOpportunities);
  assert.equal(packageApi.OddsService, packageApi.services.OddsService);
  assert.equal(packageApi.createApp, packageApi.server.createApp);
});

test('legacy formula engine facade resolves to the domain implementation', () => {
  assert.equal(legacyFormulaEngine, domainFormulaEngine);
});

test('engine entry point only references available modules', () => {
  assert.equal(typeof domainEngine.detectArbitrage, 'function');
  assert.equal(typeof domainEngine.detectQuarterHandicapArbitrage, 'function');
  assert.equal(typeof domainEngine.sizeStakeByConfidence, 'function');
});
