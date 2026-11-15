import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { z } from 'zod';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { gradeRecording } from './grade.mjs';
import { FPS, HEIGHT, WIDTH, captureFrame, setSpeaking, showGrading, showRecording, showResults, showSkill, showWelcomeScreen, startPortal, stopPortal, playDemo, stopDemo } from './portal.mjs';
import { startCallerRecording } from './record.mjs';
import { findSkill, instructionsFor, loadSkills } from './skills.mjs';

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

    const call = { skill: null, phase: 'pick', recorder: null, result: null, listening: false, greeted: false };

    async function stopRecorder() {
      const recorder = call.recorder;
      call.recorder = null;
      if (!recorder?.stop) return null;
      return recorder.stop();
    }

    async function beginRecording() {
      if (!call.skill) return 'They have not chosen a skill yet. Ask which skill they want.';
      await stopDemo();
      await stopRecorder();
      await showRecording(call.skill);
      const recorder = await startCallerRecording(ctx.room);
      if (recorder.error) {
        call.phase = 'demo';
        await showSkill(call.skill);
        return recorder.error;
      }
      call.recorder = recorder;
      call.phase = 'recording';
      return `Recording ${call.skill.name}. Tell them to do the skill, then say they are done.`;
    }

    async function gradeNow() {
      if (call.phase !== 'recording' || !call.recorder) {
        return 'You are not recording. After they finish the demonstration, wait for them to say they are done, then record.';
      }
      const skill = call.skill;
      await showGrading(skill);
      call.phase = 'grading';
      const capture = await stopRecorder();
      if (capture?.error) {
        call.phase = 'review';
        await showSkill(skill);
        return capture.error;
      }
      const result = await gradeRecording(skill, capture);
      call.result = result;
      call.phase = 'review';
      await showResults(skill, result);
      const notes = (result.steps || []).map(step => `${step.title}: ${step.status}. ${step.feedback}`).join(' ');
      return `Graded ${skill.name} as ${result.overall}. ${result.overall_feedback} ${notes} Offer to end the call, record again, or practice another skill.`;
    }

    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({
        model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
        voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
      }),
    });
    const openMic = () => {
      if (call.listening) return;
      call.listening = true;
      session.input.setAudioEnabled(true);
    };
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      setSpeaking(event.newState === 'speaking');
    });
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      await stopDemo();
      await stopRecorder();
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
            description: 'Play the demonstration for a skill the caller just named. Call only after they said the skill. Never guess. Return immediately so they can say they are done.',
            parameters: z.object({ skill: z.string().describe('Exact skill name the caller said') }),
            execute: async ({ skill: query }) => {
              if (!call.greeted || !call.listening) {
                return 'The caller has not named a skill yet. Ask which skill they want, then wait.';
              }
              const skill = findSkill(skills, query);
              if (!skill) return `Unknown skill. Available: ${skills.map(item => item.name).join(', ')}`;
              await stopRecorder();
              call.skill = skill;
              call.phase = 'demo';
              call.result = null;
              const played = await playDemo(skill, session.output.audio);
              return `${played} Do not wait for the video to finish. When they say they are done, call caller_done.`;
            },
          }),
          caller_done: llm.tool({
            description: 'The caller said they are done. During the demonstration, stop the video and audio and start recording. During recording, stop and grade with Gemini.',
            parameters: z.object({}),
            execute: async () => {
              if (call.phase === 'demo' && call.skill) return beginRecording();
              if (call.phase === 'recording' && call.recorder) return gradeNow();
              if (!call.skill) return 'They have not chosen a skill yet. Ask which skill they want.';
              return 'Wait until a demonstration or a recording is in progress, then call this when they say they are done.';
            },
          }),
          rerecord: llm.tool({
            description: 'After they have seen suggestions, record the same skill again.',
            parameters: z.object({}),
            execute: async () => {
              if (!call.skill) return 'No skill yet.';
              call.result = null;
              return beginRecording();
            },
          }),
          end_call: llm.tool({
            description: 'Hang up after they ask to end the call.',
            parameters: z.object({}),
            execute: async () => {
              await stopDemo();
              await stopRecorder();
              setTimeout(() => ctx.shutdown('caller asked to end'), 1500);
              return 'Say goodbye in one short sentence, then the call will end.';
            },
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
    session.input.setAudioEnabled(false);
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      const speech = session.generateReply({
        allowInterruptions: false,
        toolChoice: 'none',
        instructions: 'Greet in one short sentence: you are an AI caregiver coach. Ask which one skill they want. Do not name any skill. Do not call any tool. Do not mention texting.',
      });
      void speech.waitForPlayout().then(() => {
        call.greeted = true;
        openMic();
      }).catch(() => {
        call.greeted = true;
        openMic();
      });
    });
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

process.on('exit', () => { void stopPortal(); });

runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'caregiver-coach' });
