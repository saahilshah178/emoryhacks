import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { z } from 'zod';
import { watchCamera } from './camera.mjs';
import { runAgent } from './chert-rooms.mjs';
import { createCoachCall } from './flow.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { gradeRecording } from './grade.mjs';
import { FPS, HEIGHT, WIDTH, captureFrame, setSpeaking, showGrading, showRecording, showResults, showSetup, showWelcomeScreen, startPortal, stopPortal, playDemo, stopDemo } from './portal.mjs';
import { startCallerRecording } from './record.mjs';
import { instructionsFor, loadSkills } from './skills.mjs';

const skills = await loadSkills();

function openaiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey && !/^(YOUR_|changeme)/i.test(apiKey) ? apiKey : '';
}

if (openaiKey()) {
  console.log('[coach] OpenAI Realtime for FaceTime voice. Gemini grades the recording.');
} else {
  console.warn('[coach] OPENAI_API_KEY is empty. Put it in .env.local for the FaceTime coach. Do not paste it into chat.');
}

const agent = defineAgent({
  entry: async ctx => {
    const portalMode = await startPortal(skills);
    await showWelcomeScreen();

    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    const caller = await ctx.waitForParticipant();

    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    const frame = async () => source.captureFrame(new VideoFrame(await captureFrame(), WIDTH, HEIGHT, VideoBufferType.RGBA));
    await frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(() => { void frame(); }, 1000 / FPS);

    if (!openaiKey()) {
      throw new Error('Set OPENAI_API_KEY in .env.local for the FaceTime coach. Do not paste it into chat.');
    }

    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
      }),
    });

    // The caller's microphone reaches the coach only after the greeting, and never while they are being recorded.
    let greeted = false;
    let wanted = true;
    const applyMic = () => session.input.setAudioEnabled(greeted && wanted);

    /** Runs the callback once the coach has finished the reply to the tool call being handled now. */
    let pendingReply = null;
    function afterReply(callback) {
      let ran = false;
      const run = () => {
        if (ran) return;
        ran = true;
        clearTimeout(timer);
        if (pendingReply === run) pendingReply = null;
        callback();
      };
      const timer = setTimeout(run, 15_000); // the coach never replied: go on anyway
      pendingReply = run;
    }
    session.on(voice.AgentSessionEventTypes.SpeechCreated, event => {
      if (event.source === 'tool_response' && pendingReply) event.speechHandle.addDoneCallback(pendingReply);
    });

    /** The coach says something because of what happened on the call, not because the caller spoke. */
    function say(instructions) {
      try {
        void session.interrupt();
        session.generateReply({ instructions, toolChoice: 'none' });
      } catch (error) {
        console.warn('[coach] could not speak:', error.message);
      }
    }

    // The caller's camera runs the call: see flow.mjs. Every line says when, so a call can be pieced together afterwards.
    const log = message => console.log(`${new Date().toTimeString().slice(0, 8)} ${message}`);
    let coach;
    const camera = watchCamera(ctx.room, {
      identity: caller.identity,
      log,
      onChange: change => { void coach?.cameraChanged(change); },
    });
    coach = createCoachCall({
      skills,
      camera,
      screen: {
        demo: (skill, options) => playDemo(skill, session.output.audio, options),
        stopDemo,
        setup: showSetup,
        recording: showRecording,
        grading: showGrading,
        results: showResults,
      },
      startRecording: options => startCallerRecording(camera, options),
      grade: gradeRecording,
      coach: {
        say,
        listen(open) { wanted = open; applyMic(); },
        afterReply,
      },
      hangUp: () => ctx.shutdown('caller asked to end'),
      log,
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      setSpeaking(event.newState === 'speaking');
    });
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      camera.close();
      await coach.close();
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({
        instructions: `${instructionsFor(skills)}\nThe picture on this call is currently: ${portalMode}.`,
        tools: {
          choose_skill: llm.tool({
            description: 'Play the demonstration for a skill the caller just named. Call only after they said the skill. Never guess. It returns what to tell them.',
            parameters: z.object({ skill: z.string().describe('Exact skill name the caller said') }),
            execute: async ({ skill }) => {
              if (!greeted) return 'The caller has not named a skill yet. Ask which skill they want, then wait.';
              return coach.chooseSkill(skill);
            },
          }),
          camera_not_noticed: llm.tool({
            description: 'Only when the caller says they already turned their camera off or on and nothing happened. Never call it because they said they are done: tell them to use the camera button instead.',
            parameters: z.object({ camera: z.enum(['off', 'on']).describe('What the caller says their camera is now') }),
            execute: async ({ camera: claimed }) => coach.cameraNotNoticed(claimed),
          }),
          end_call: llm.tool({
            description: 'Hang up after they ask to end the call.',
            parameters: z.object({}),
            execute: async () => coach.end(),
          }),
        },
      }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false, audioSampleRate: 24000, audioNumChannels: 1 },
    });
    applyMic();
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      const speech = session.generateReply({
        allowInterruptions: false,
        toolChoice: 'none',
        instructions: 'Greet in one short sentence: you are an AI caregiver coach. Ask which one skill they want. Do not name any skill. Do not call any tool. Do not mention texting.',
      });
      const open = () => { greeted = true; applyMic(); };
      void speech.waitForPlayout().then(open, open);
    });
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

process.on('exit', () => { void stopPortal(); });

runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'caregiver-coach' });
