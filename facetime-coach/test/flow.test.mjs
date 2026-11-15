import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCoachCall, lines } from '../flow.mjs';
import { loadSkills } from '../skills.mjs';

const skills = await loadSkills();
const passed = { overall: 'passed', score_pct: 100, skill_match: true, overall_feedback: 'Nice work.', steps: [{ title: 'Brace the chair', status: 'passed', feedback: 'Tested.' }] };

/** A call with everything faked: what was shown, said, recorded and graded is written to `log`. */
function start({ cameraOn = true, demo = true, capture = { path: '/tmp/attempt.mp4', duration_s: 30 }, result = passed } = {}) {
  const log = [];
  const camera = { on: cameraOn, receiving: cameraOn };
  const recorders = [];
  const run = {
    log,
    camera,
    recorders,
    mic: null,
    said: () => log.filter(entry => entry.startsWith('say:')).map(entry => entry.slice(4)),
    shown: () => log.filter(entry => entry.startsWith('screen:')).map(entry => entry.slice(7)),
    /** The caller taps the camera button, and the watcher notices. */
    async turnCamera(on, at = Date.now()) {
      camera.on = on;
      camera.receiving = on;
      await run.call.cameraChanged({ on, at, reason: 'test' });
    },
  };
  run.call = createCoachCall({
    skills,
    camera,
    screen: {
      demo: async (skill, options) => {
        log.push(`screen:demo ${skill.slug} camera ${options.cameraOn ? 'on' : 'off'}`);
        return { playing: demo, start: () => { log.push('demo:start'); } };
      },
      stopDemo: async () => { log.push('stopDemo'); },
      setup: async skill => { log.push(`screen:setup ${skill.slug}`); },
      recording: async skill => { log.push(`screen:recording ${skill.slug}`); },
      grading: async skill => { log.push(`screen:grading ${skill.slug}`); },
      results: async (skill, shownResult) => { log.push(`screen:results ${skill.slug} ${shownResult.overall}`); },
    },
    startRecording(options) {
      const recorder = {
        options,
        error: null,
        stopped: null,
        cancelled: false,
        stop: async stopOptions => { recorder.stopped = stopOptions; log.push('record:stop'); return capture; },
        cancel: () => { recorder.cancelled = true; log.push('record:cancel'); },
      };
      recorders.push(recorder);
      log.push('record:start');
      return recorder;
    },
    grade: async skill => { log.push(`grade ${skill.slug}`); return result; },
    coach: {
      say: instructions => { log.push(`say:${instructions}`); },
      listen: open => { run.mic = open; },
      afterReply: callback => { run.replied = callback; },
    },
    hangUp: () => { log.push('hangUp'); },
  });
  return run;
}

test('the camera runs the whole call: off after the demonstration, on to record, off to grade', async () => {
  const run = start();
  const { call } = run;
  const reply = await call.chooseSkill('sit to stand');
  assert.equal(call.phase, 'demo');
  assert.match(reply, /turn their camera off/);
  assert.doesNotMatch(reply, /say (they|you) are done/i);
  assert.ok(!run.log.includes('demo:start'), 'the demonstration waits while the coach explains the camera button');
  run.replied();
  assert.ok(run.log.includes('demo:start'));

  await run.turnCamera(false);
  assert.equal(call.phase, 'setup');
  assert.deepEqual(run.said(), [lines.setup(call.skill)]);
  assert.ok(run.log.includes('stopDemo'), 'the demonstration stops');
  assert.equal(run.mic, true);

  await run.turnCamera(true);
  assert.equal(call.phase, 'recording');
  assert.equal(run.said().at(-1), lines.recording());
  assert.equal(run.mic, false, 'the coach does not listen while they practice');

  await run.turnCamera(false, 123456);
  assert.equal(call.phase, 'review');
  assert.deepEqual(run.recorders[0].stopped, { until: 123456 }, 'the recording ends where the picture went away');
  assert.deepEqual(run.shown(), [
    'demo sit_to_stand camera on', 'setup sit_to_stand', 'recording sit_to_stand', 'grading sit_to_stand', 'results sit_to_stand passed',
  ]);
  assert.equal(run.said().at(-2), lines.grading(false));
  assert.match(run.said().at(-1), /it passed \(100 percent\)/);
  assert.match(run.said().at(-1), /turn your camera back on/);
  assert.equal(run.mic, true);
});

test('turning the camera on after the results records another try', async () => {
  const run = start();
  await run.call.chooseSkill('glove removal');
  await run.turnCamera(false);
  await run.turnCamera(true);
  await run.turnCamera(false);
  assert.equal(run.call.phase, 'review');
  await run.turnCamera(true);
  assert.equal(run.call.phase, 'recording');
  assert.equal(run.recorders.length, 2);
});

test('with the camera off during the demonstration, turning it on starts the recording', async () => {
  const run = start({ cameraOn: false });
  const reply = await run.call.chooseSkill('fall response');
  assert.match(reply, /turn their camera on/);
  await run.turnCamera(true);
  assert.equal(run.call.phase, 'recording');
  assert.ok(run.log.indexOf('stopDemo') < run.log.indexOf('record:start'));
});

test('a camera change before a skill is chosen does nothing', async () => {
  const run = start();
  await run.turnCamera(false);
  await run.turnCamera(true);
  assert.equal(run.call.phase, 'pick');
  assert.deepEqual(run.log, []);
});

test('a recording of a few seconds is not graded', async () => {
  const run = start({ capture: { tooShort: true, error: 'too short' } });
  await run.call.chooseSkill('sit to stand');
  await run.turnCamera(false);
  await run.turnCamera(true);
  await run.turnCamera(false);
  assert.equal(run.call.phase, 'setup');
  assert.equal(run.said().at(-1), lines.tooShort());
  assert.ok(!run.log.some(entry => entry.startsWith('grade')));
  assert.equal(run.mic, true);
});

test('a grading failure does not leave the call stuck with the microphone closed', async () => {
  const run = start();
  const call = createCoachCall({
    skills,
    camera: run.camera,
    screen: { demo: async () => ({ playing: true, start() {} }), stopDemo: async () => {}, setup: async () => { run.log.push('screen:setup'); }, recording: async () => {}, grading: async () => {}, results: async () => {} },
    startRecording: () => ({ error: null, stop: async () => ({ path: 'x', duration_s: 20 }), cancel() {} }),
    grade: async () => { throw new Error('the grader fell over'); },
    coach: { say: line => { run.log.push(`say:${line}`); }, listen: open => { run.mic = open; }, afterReply() {} },
    hangUp() {},
  });
  await call.chooseSkill('sit to stand');
  run.camera.on = false; await call.cameraChanged({ on: false, at: 1 });
  run.camera.on = true; await call.cameraChanged({ on: true, at: 2 });
  run.camera.on = false; await call.cameraChanged({ on: false, at: 3 });
  assert.equal(call.phase, 'setup');
  assert.equal(run.mic, true);
  assert.equal(run.said().at(-1), lines.notGraded());
});

test('a recording that reaches the limit is graded without waiting for the camera', async () => {
  const run = start();
  await run.call.chooseSkill('sit to stand');
  await run.turnCamera(false);
  await run.turnCamera(true);
  await run.recorders[0].options.onLimit();
  assert.equal(run.call.phase, 'review');
  assert.ok(run.said().includes(lines.grading(true)));
  assert.match(run.said().at(-1), /turn your camera off and back on/, 'the camera is still on, so trying again takes off and on');
});

test('camera changes while grading are ignored', async () => {
  const run = start();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const call = createCoachCall({
    skills,
    camera: run.camera,
    screen: { demo: async () => ({ playing: true, start() {} }), stopDemo: async () => {}, setup: async () => {}, recording: async () => {}, grading: async () => {}, results: async () => {} },
    startRecording: () => { run.recorders.push({}); return { error: null, stop: async () => ({ path: 'x', duration_s: 20 }), cancel() {} }; },
    grade: async () => { await held; return passed; },
    coach: { say() {}, listen() {}, afterReply() {} },
    hangUp() {},
  });
  await call.chooseSkill('sit to stand');
  run.camera.on = false; await call.cameraChanged({ on: false, at: 1 });
  run.camera.on = true; run.camera.receiving = true; await call.cameraChanged({ on: true, at: 2 });
  run.camera.on = false;
  const finishing = call.cameraChanged({ on: false, at: 3 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(call.phase, 'grading');
  run.camera.on = true;
  await call.cameraChanged({ on: true, at: 4 });
  release();
  await finishing;
  await call.settled;
  assert.equal(call.phase, 'review', 'the camera coming on mid-grading did not start a new recording');
  assert.equal(run.recorders.length, 1);
});

test('a change that was undone before its turn came is skipped', async () => {
  const run = start();
  await run.call.chooseSkill('sit to stand');
  run.camera.on = true; // the watcher already says on again
  await run.call.cameraChanged({ on: false, at: 1 });
  assert.equal(run.call.phase, 'demo');
});

test('the safety net: the caller says the camera is off and nothing happened', async () => {
  const run = start();
  await run.call.chooseSkill('sit to stand');
  const reply = await run.call.cameraNotNoticed('off');
  assert.equal(run.call.phase, 'setup');
  assert.equal(reply, lines.setup(run.call.skill));
  assert.deepEqual(run.said(), [], 'the reply goes back through the tool, not as a second voice');
});

test('the safety net does not record a camera it cannot see', async () => {
  const run = start({ cameraOn: false });
  await run.call.chooseSkill('sit to stand');
  const reply = await run.call.cameraNotNoticed('on');
  assert.equal(reply, lines.noPicture());
  assert.equal(run.call.phase, 'demo');
  assert.equal(run.recorders.length, 0);
});

test('the safety net starts the recording when pictures are arriving', async () => {
  const run = start({ cameraOn: false });
  await run.call.chooseSkill('sit to stand');
  run.camera.receiving = true; // a camera pointed at a room so still that the watcher calls it off
  const reply = await run.call.cameraNotNoticed('on');
  assert.equal(reply, lines.recording());
  assert.equal(run.call.phase, 'recording');
});

test('a skill with no demonstration goes straight to set-up', async () => {
  const run = start({ demo: false });
  const reply = await run.call.chooseSkill('stair assistance');
  assert.equal(run.call.phase, 'setup');
  assert.match(reply, /no demonstration video/);
  assert.deepEqual(run.shown(), ['demo stair_assistance camera on', 'setup stair_assistance']);
});

test('an unknown skill is not chosen', async () => {
  const run = start();
  const reply = await run.call.chooseSkill('juggling');
  assert.match(reply, /^Unknown skill/);
  assert.equal(run.call.phase, 'pick');
});

test('choosing another skill throws away a recording in progress only between parts', async () => {
  const run = start();
  await run.call.chooseSkill('sit to stand');
  await run.turnCamera(false);
  await run.turnCamera(true);
  const reply = await run.call.chooseSkill('glove removal');
  assert.match(reply, /recording is being made/);
  assert.equal(run.call.skill.slug, 'sit_to_stand');
});

test('ending the call hangs up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = start();
  await run.call.chooseSkill('sit to stand');
  const reply = await run.call.end();
  assert.match(reply, /goodbye/);
  t.mock.timers.tick(1500);
  assert.ok(run.log.includes('hangUp'));
});

test('the results line says what happened in words the coach can speak', () => {
  const skill = skills.find(item => item.slug === 'sit_to_stand');
  const failed = { overall: 'failed', score_pct: 41.7, skill_match: true, overall_feedback: 'Scoot forward first.', steps: [] };
  assert.match(lines.results(skill, failed, false), /it needs another try \(42 percent\)/);
  assert.match(lines.results(skill, { ...failed, skill_match: false }, false), /did not look like this skill/);
  assert.match(lines.results(skill, { ...failed, overall: 'unverified', score_pct: null }, true), /could not be seen clearly\. /);
});
