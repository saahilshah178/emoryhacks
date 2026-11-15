// One call, as a small state machine driven by the caller's camera.
//
//   pick ─ names a skill ─▶ demo ─ camera off ─▶ setup ─ camera on ─▶ recording ─ camera off ─▶ grading ─▶ review
//                             └──── camera on (it was off during the demonstration) ────▲                     │
//                                                                                       └──── camera on ──────┘
//
// The caller never says "I'm done": turning the camera off ends a part, turning it on starts the next one.
// Everything the call touches is passed in, so the whole flow runs in tests without LiveKit, a model or a phone:
//   camera          { on, receiving }                      what the camera watcher sees right now
//   screen          { demo, stopDemo, setup, recording, grading, results }   the picture the caller sees
//   startRecording  ({ onLimit }) => recorder | { error }
//   grade           (skill, capture) => result
//   coach           { say(instructions), listen(open), afterReply(callback) }   the voice, and the caller's microphone
//   hangUp          () => void
import { findSkill } from './skills.mjs';

const CAMERA_BUTTON = 'the camera button in FaceTime';

export const lines = {
  demo: (skill, cameraOn) => `The ${skill.name} demonstration starts as soon as you finish speaking. Say, in two short sentences: the nurse uses hospital equipment, but they will do the home version with the things listed on the screen; ${cameraOn
    ? `when they have seen enough, they turn their camera off with ${CAMERA_BUTTON}`
    : `when they are ready to practice, they turn their camera on with ${CAMERA_BUTTON}, and recording starts`}. Do not ask them to say anything.`,
  noDemo: (skill, cameraOn) => `There is no demonstration video for ${skill.name}, so the screen shows what they need at home and the steps. Tell them, in two short sentences: get set up, then turn the camera ${cameraOn ? 'off and back on' : 'on'} with ${CAMERA_BUTTON}, and recording starts.`,
  setup: skill => `The caller turned their camera off, so the demonstration stopped. The screen now lists what they need at home and the steps for ${skill.name}. Tell them, in two short sentences: get set up with the things on the screen and prop the phone where it sees their whole body; when they are ready, turn the camera back on and recording starts.`,
  waiting: () => 'The caller\'s camera is off while they set up. Say one short sentence: take your time, and turn the camera back on when you are ready.',
  recording: () => 'The caller\'s camera is on and recording has started. Say only this: "Recording. Go ahead, and turn your camera off when you finish."',
  grading: limit => `Say only this: "${limit ? 'That is the recording limit, so I stopped there. ' : 'Got it. '}I am grading it now. Give me about half a minute."`,
  tooShort: () => 'That recording was only a few seconds, too short to grade, so nothing was graded. Tell them, in two short sentences: when they are ready, turn the camera on and keep it on until they have finished every step.',
  notGraded: () => 'Something went wrong and that recording could not be graded. Tell them, in one short sentence, to turn the camera on to try again.',
  noPicture: () => `You cannot see the caller's camera. Tell them, in one short sentence, to tap ${CAMERA_BUTTON} so their video is on, with the phone facing them.`,
  results(skill, result, cameraOn) {
    const overall = result.skill_match === false ? 'the recording did not look like this skill'
      : result.overall === 'passed' ? 'it passed'
        : result.overall === 'failed' ? 'it needs another try'
          : 'some steps could not be seen clearly';
    const score = result.score_pct == null ? '' : ` (${Math.round(result.score_pct)} percent)`;
    const notes = (result.steps || []).map(step => `${step.title}: ${step.status}. ${step.feedback}`).join(' ');
    return `The ${skill.name} attempt is graded: ${overall}${score}. ${result.overall_feedback || ''} Step notes: ${notes} `
      + 'Tell them the result in three short sentences: one thing that went well, and the one or two most useful fixes. Do not read out every step. '
      + `Then say: to try again, turn your camera ${cameraOn ? 'off and back on' : 'back on'}; or name another skill; or say goodbye.`;
  },
};

export function createCoachCall({ skills, camera, screen, startRecording, grade, coach, hangUp, log = () => {} }) {
  const call = { phase: 'pick', skill: null, recorder: null, result: null };
  let turns = Promise.resolve();

  /** Camera changes and tool calls take turns, so two transitions never run at once. */
  function inTurn(work) {
    const turn = turns.then(work);
    turns = turn.catch(error => { log(`[coach] ${error?.stack || error}`); });
    return turn;
  }

  function enter(phase) {
    if (call.phase !== phase) log(`[coach] ${call.phase} -> ${phase}`);
    call.phase = phase;
    // While they practice, the coach stays quiet: what they say is meant for the person they are helping.
    coach.listen(phase !== 'recording' && phase !== 'grading');
  }

  function dropRecording() {
    const recorder = call.recorder;
    call.recorder = null;
    recorder?.cancel();
  }

  async function toSetup() {
    enter('setup');
    await screen.stopDemo();
    await screen.setup(call.skill, { cameraOn: camera.on });
    return lines.setup(call.skill);
  }

  async function beginRecording() {
    if (!camera.receiving) return lines.noPicture();
    await screen.stopDemo();
    dropRecording();
    const recorder = startRecording({
      onLimit: () => inTurn(() => (call.recorder === recorder ? finishRecording({ limit: true }) : undefined)),
    });
    if (recorder.error) return lines.noPicture();
    call.recorder = recorder;
    enter('recording');
    await screen.recording(call.skill);
    return lines.recording();
  }

  async function finishRecording({ until, limit = false } = {}) {
    const skill = call.skill;
    const recorder = call.recorder;
    call.recorder = null;
    enter('grading');
    let line;
    try {
      const capture = await recorder.stop({ until });
      if (capture.tooShort) {
        line = lines.tooShort();
      } else {
        await screen.grading(skill);
        coach.say(lines.grading(limit));
        call.result = await grade(skill, capture);
        line = lines.results(skill, call.result, camera.on);
      }
    } catch (error) {
      log(`[coach] could not grade: ${error?.stack || error}`);
      line = lines.notGraded();
    }
    // Whatever happened, the call does not stay in "grading" with the microphone closed:
    // it shows the newest results there are, or the set-up screen when there are none.
    if (call.result) {
      enter('review');
      await screen.results(skill, call.result, { cameraOn: camera.on });
    } else {
      enter('setup');
      await screen.setup(skill, { cameraOn: camera.on });
    }
    coach.say(line);
  }

  async function onCamera({ on, at }) {
    if (camera.on !== on) return; // it changed again while an earlier change was being handled
    let line;
    if (call.phase === 'demo') line = on ? await beginRecording() : await toSetup();
    else if (call.phase === 'setup') line = on ? await beginRecording() : lines.waiting();
    else if (call.phase === 'review' && on) line = await beginRecording();
    else if (call.phase === 'recording' && !on) await finishRecording({ until: at });
    if (line) coach.say(line);
  }

  return {
    get phase() { return call.phase; },
    get skill() { return call.skill; },
    /** Resolves when every change handed in so far has been dealt with. */
    get settled() { return turns; },

    /** The camera watcher's onChange. Nothing is being shown or recorded while picking or grading, so a change then means nothing. */
    cameraChanged(change) {
      if (call.phase === 'pick' || call.phase === 'grading') return Promise.resolve();
      return inTurn(() => onCamera(change));
    },

    /** Tool: the caller named a skill. Returns what the coach should say. */
    chooseSkill(query) {
      return inTurn(async () => {
        if (call.phase === 'recording' || call.phase === 'grading') return 'A recording is being made or graded. Wait for it to finish.';
        const skill = findSkill(skills, query);
        if (!skill) return `Unknown skill. Available: ${skills.map(item => item.name).join(', ')}`;
        dropRecording();
        call.skill = skill;
        call.result = null;
        enter('demo');
        const demo = await screen.demo(skill, { cameraOn: camera.on });
        if (demo.playing) {
          // The demonstration starts once the coach has said how to stop it, so they do not talk over each other.
          coach.afterReply(() => demo.start());
          return lines.demo(skill, camera.on);
        }
        enter('setup');
        await screen.setup(skill, { cameraOn: camera.on });
        return lines.noDemo(skill, camera.on);
      });
    },

    /**
     * Tool: the caller says they already turned the camera off or on and nothing happened.
     * A safety net for a camera change the watcher missed. `claimed` is 'off' or 'on'.
     */
    cameraNotNoticed(claimed) {
      return inTurn(async () => {
        const on = claimed === 'on';
        log(`[coach] the caller says the camera is ${on ? 'on' : 'off'}; the watcher sees ${camera.on ? 'on' : 'off'} (${call.phase})`);
        if (call.phase === 'pick') return 'No skill is chosen yet. Ask which skill they want.';
        if (call.phase === 'grading') return 'The recording is being graded. Ask them to wait a moment.';
        if (call.phase === 'recording') return 'Recording is running. Tell them to do the steps, then turn the camera off when they finish.';
        if (on) return beginRecording();
        if (call.phase === 'demo') return toSetup();
        if (call.phase === 'setup') return 'The screen already shows what to set up. Tell them: turn the camera on when they are ready, and recording starts.';
        return 'The results are on the screen. Tell them: turn the camera on to try again, name another skill, or say goodbye.';
      });
    },

    /** Tool: the caller asked to end the call. */
    end() {
      return inTurn(async () => {
        dropRecording();
        await screen.stopDemo();
        setTimeout(() => hangUp(), 1500);
        return 'Say goodbye in one short sentence, then the call will end.';
      });
    },

    /** The call is over: let go of anything still running. */
    async close() {
      dropRecording();
      await screen.stopDemo();
    },
  };
}
