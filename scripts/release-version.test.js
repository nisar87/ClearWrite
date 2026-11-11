import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextVersion } from './release-version.js';

test('automatic releases continue the prerelease line after the highest published tag', () => {
  assert.equal(nextVersion('0.2.0-beta.3', ['0.2.0-beta.1', '0.2.0-beta.2', '0.2.0-beta.3']), '0.2.0-beta.4');
  assert.equal(nextVersion('0.2.0-beta.3', ['0.2.0-beta.3', '0.2.0-beta.9', '0.1.0-beta.40']), '0.2.0-beta.10');
  assert.equal(nextVersion('0.2.0-beta.3', []), '0.2.0-beta.3', 'an unpublished version is used as is');
  assert.equal(nextVersion('0.3.0-beta.1', ['0.2.0-beta.12']), '0.3.0-beta.1');
  assert.equal(nextVersion('1.0.0', ['0.2.0-beta.4']), '1.0.0');
  assert.throws(() => nextVersion('1.0.0', ['1.0.0']), /already released/);
});
