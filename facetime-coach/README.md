# Caregiver FaceTime coach

A Chert FaceTime coach. Someone FaceTimes the line, says **one** skill, watches the nurse demonstration, records themselves doing it, then sees AI suggestions. After that they can end the call, record again, or practice another skill.

FaceTime voice uses **OpenAI Realtime** (`OPENAI_API_KEY`). Grading uses **Gemini**, through the web app when `WEB_APP_USERNAME` / `WEB_APP_PASSWORD` are set, otherwise directly.

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

4. FaceTime Video **+16282787200**. After FaceTime is ready, say the skill you want (for example “sit to stand”). Watch the demonstration, then record yourself. Say you are done when you finish.

Windows: Node 24. If PowerShell blocks `chert.ps1`, use `chert.cmd`. `ffmpeg` is used to save the recording when it is installed; otherwise still frames are sent to Gemini.
