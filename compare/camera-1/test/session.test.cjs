const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Session, Journal } = require('../session.js');
const codec = require('../ar-data.js');
const A = 'AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=COMPARE.A';
const B = 'AR1;cube;3000;1000;600;scale=50;c=C07A3A;s=COMPARE.B';
function split(payload) {
  const id = (codec.crc32(payload) & 65535).toString(16).padStart(4, '0'), size = Math.ceil(payload.length / 2);
  return [0,1].map(i => `AR5;id=${id};part=${i+1};of=2;data=${payload.slice(i*size,(i+1)*size)}`);
}
function setup(prepare = async d => d) {
  const screen = { value: null, disposed: [] };
  const session = new Session(codec, { clear: () => screen.value = null, prepare,
    commit: d => screen.value = d, dispose: d => screen.disposed.push(d) });
  return { session, screen };
}
test('first multipart QR clears the previous visible model; ordinary sheet discards pending parts', async () => {
  const { session, screen } = setup(); await session.ingest(A);
  const parts = split(B); await session.ingest(parts[0]);
  assert.equal(screen.value, null); assert.equal(session.state, 'collecting');
  await session.ingest(A); assert.equal(session.parts.length, 0);
  await session.ingest(parts[1]); assert.equal(session.state, 'collecting'); assert.equal(screen.value, null);
  await session.ingest(parts[0]); assert.equal(screen.value.sheet, 'COMPARE.B');
});
test('new sheet blocks the old QR without camera reload; a different QR unblocks the next transition', async () => {
  const { session, screen } = setup(); await session.ingest(A); session.clear();
  assert.equal(await session.ingest(A), false); assert.equal(screen.value, null);
  await session.ingest(B); assert.equal(screen.value.sheet, 'COMPARE.B');
  await session.ingest(A); assert.equal(screen.value.sheet, 'COMPARE.A');
});
test('late geometry decode cannot restore a model after clear or a newer QR', async () => {
  let complete;
  const { session, screen } = setup(d => d.payload === A ? new Promise(r => complete = () => r(d)) : d);
  const pending = session.ingest(A); await session.ingest(B); complete(); await pending;
  assert.equal(screen.value.sheet, 'COMPARE.B'); assert.equal(screen.disposed.length, 1);
});
test('invalid QR preserves model; a decode failure is retryable', async () => {
  let fail = true;
  const { session, screen } = setup(async d => { if (d.payload === B && fail) { fail = false; throw Error('decode'); } return d; });
  await session.ingest(A); await assert.rejects(session.ingest('wrong')); assert.equal(screen.value.sheet, 'COMPARE.A');
  await assert.rejects(session.ingest(B)); assert.equal(screen.value, null); assert.equal(session.state, 'error');
  await session.ingest(B); assert.equal(screen.value.sheet, 'COMPARE.B');
});
test('bounded journal survives reload and storage failure without recording QR contents', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v) };
  const journal = new Journal(storage); for (let i=0;i<400;i++) journal.add('test', { i });
  assert.equal(journal.events.length, 250);
  assert.equal(new Journal(storage).report().sessions.length, 2);
  const broken = new Journal({ getItem: () => { throw Error(); }, setItem: () => { throw Error(); } });
  assert.doesNotThrow(() => broken.add('event'));
});

test('completed multipart QR does not repeatedly tear down the visible model; clear blocks all its known parts', async () => {
  const { session, screen } = setup(); const parts = split(B);
  for (const part of parts) await session.ingest(part);
  for (let i=0;i<5;i++) for (const part of parts) assert.equal(await session.ingest(part), false);
  assert.equal(screen.value.sheet, 'COMPARE.B'); assert.equal(session.state, 'aligning');
  session.clear(); for (const part of parts) await session.ingest(part);
  assert.equal(screen.value, null); assert.equal(session.state, 'scanning');
  await session.ingest(A); assert.equal(screen.value.sheet, 'COMPARE.A');
});
test('clear during multipart collection blocks the already seen fragment', async () => {
  const { session, screen } = setup(); const [part] = split(A);
  await session.ingest(part); session.clear(); await session.ingest(part);
  assert.equal(session.state, 'scanning'); assert.equal(screen.value, null);
});
test('late camera permission after pause stops tracks; old completion cannot replace a resumed stream', async () => {
  const { CameraLease } = require('../session.js'); const lease = new CameraLease();
  let finishOld, stopped = 0;
  const old = { getTracks: () => [{ stop: () => stopped++ }] };
  const current = { getTracks: () => [{ stop: () => {} }] };
  const pending = lease.open(() => new Promise(r => finishOld = r));
  lease.cancel(); await lease.open(async () => current); finishOld(old);
  assert.equal(await pending, null); assert.equal(stopped, 1); assert.equal(lease.owns(current), true);
  lease.cancel(); assert.equal(lease.owns(current), false);
});
