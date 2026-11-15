# Caregiver FaceTime coach

A Chert FaceTime coach for practicing caregiver skills at home. Someone FaceTimes the line, says **one** skill, watches the nurse demonstration, records themselves doing the home version, then sees AI suggestions. After that they can try again, practice another skill, or end the call.

FaceTime voice uses **OpenAI Realtime** (`OPENAI_API_KEY`). **Gemini** grades the recording against the home steps in `skills/`.

## The camera runs the call

The caller never says "I'm done". The camera button in FaceTime is the signal:

| The caller | What happens |
| - | - |
| Says a skill | The nurse demonstration plays, with the list of household things to gather |
| Turns the camera **off**, or watches to the end | The demonstration stops. The screen shows what to set up and where to prop the phone |
| Turns the camera **on** | Recording starts |
| Turns the camera **off** | Recording stops and is graded. The screen shows a note for each step |
| Turns the camera **on** again | Another try at the same skill |

The coach listens only while it waits for the caller to speak. During the demonstration it would hear the nurse through the caller's phone and answer her; during a recording, what the caller says is meant for the person they are "helping". A recording stops by itself after 75 seconds, and one shorter than 5 seconds is not graded.

`camera.mjs` reads the camera from the bridge's `facetime-remote-video` track. Off is the track being muted or removed (what Chert documents), the last frame frozen for about two seconds (this line often keeps sending that frame, re-encoded, instead of muting), or no picture at all for 2.5 seconds. A live picture that only moves in part of the frame (someone standing still, talking) stays on. Each change is logged as `[camera] off (frozen picture)` and the like, with the signal that caused it. If a caller says they turned the camera off or on and nothing happened, the coach moves the call on from their word.

Caller video needs **caller capture** enabled on the Chert line. Without it the log says `[camera] the caller has no video track yet` and nothing can be recorded.

## The skills

Each file in `skills/` is the home version of one skill: five or six steps, no equipment, done alone, and every step is something a phone camera can see (the recording has no sound). A dining chair stands in for a wheelchair, a strip of tape for a tub edge, two socks for gloves, a big pillow for a person.

```md
### s2. Lock the brakes
A dining chair has no brakes, so wedge it against a wall or heavy furniture, then push on it to check it will not slide.
Pass when: the person pushes or presses on the chair to test it, and it stays put.
Try again when: the chair is never tested, or it slides when pushed and is used anyway.
Key step: yes
After: s1
```

- The line under the heading is what the caller reads on the screen.
- `Pass when` and `Try again when` are what Gemini grades against.
- `Key step: yes` means the attempt fails without it. Keep these to three a skill.
- `After:` lists the steps that must come first. A step with no `After` can happen at any time.

A file the grader could not use (a step with no instruction or no `Pass when`) stops the coach at start-up and names the file.

## Run it

1. From this folder:

   ```sh
   npm install
   cp .env.example .env.local
   ```

   Put `LIVEKIT_*` and `OPENAI_API_KEY` in `.env.local`. Leave the web app’s `GEMINI_API_KEY` in the repo `.env`, or copy it into this folder’s `.env.local`. Never paste keys into chat.

2. Terminal 1:

   ```sh
   npm start
   ```

3. Terminal 2, same folder:

   ```sh
   npx --yes --prefer-online @trychert/facetime@0.1.0-beta.21 doctor
   npx --yes --prefer-online @trychert/facetime@0.1.0-beta.21 dev --agent caregiver-coach
   ```

4. FaceTime Video **+16282787200**. After FaceTime is ready, say the skill you want (for example “sit to stand”). Watch the demonstration, turn your camera off, set up, turn it back on and do the steps, then turn it off.

Calls on a trial or Shared line end after 5 minutes, and some demonstrations run longer than that: turn the camera off once you have seen enough.

Windows: Node 24. If PowerShell blocks `chert.ps1`, use `chert.cmd`. `ffmpeg` is used to save the recording when it is installed; otherwise still frames are sent to Gemini.

## Check a change

```sh
npm test          # the camera rules, the call flow, the recorder and every skill file
npm run preview   # every screen the caller sees, as PNGs in preview/; flags text that runs off the screen
```

After changing the agent, restart both `npm start` and `chert dev`. A waiting room can still hold the old code.
